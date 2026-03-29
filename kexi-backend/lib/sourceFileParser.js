const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');
const {
  matchExpenseDetail,
  resolveTemplateWorkbook,
} = require('./sourceFileWorkbook');
const { readSettings } = require('./appSettings');

const DIRECT_PARSE_EXTENSIONS = new Set(['xls', 'xlsx', 'csv']);
const REVIEW_EXTENSIONS = new Set(['doc', 'docx']);
const TEMPLATE_PLACEMENT_CACHE = new Map();
const ZHIPU_API_URL =
  process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

const REQUIRED_SOURCE_GROUPS = [
  {
    key: 'expense',
    label: '报销明细.pdf',
    pattern: /报销|费用|支出|采购|发票|回单|流水|明细|出入库|库存|盘点|物料/i,
  },
  {
    key: 'revenue',
    label: '营业报表.xlsx',
    pattern: /营业|营收|收银|业绩|经营日报|经营月报|日报|体质表/i,
  },
  {
    key: 'payroll',
    label: '员工工资明细表.xlsx',
    pattern: /工资|薪资|提成|绩效|社保|人力/i,
  },
];

const BODY_SHEET_SECTIONS = {
  expense: {
    key: 'cost_expense',
    label: '费用与报销',
    target: '体质表 / 成本费用',
    description: '用于补齐门店报销、杂费、水电、物料等成本支出。',
  },
  revenue: {
    key: 'revenue_channel',
    label: '营收与渠道',
    target: '体质表 / 营收结构',
    description: '用于补齐营收、客单价、渠道占比、平台结构等经营指标。',
  },
  payroll: {
    key: 'payroll_labor',
    label: '工资与人效',
    target: '体质表 / 人力成本',
    description: '用于补齐工资、提成、绩效、人效与人工成本相关字段。',
  },
  complete: {
    key: 'body_table_complete',
    label: '体质表整表',
    target: '体质表 / 汇总数据 + 明细数据',
    description: '用于接收已经整理好的体质表中间结果，可直接生成整张体质表。',
  },
  unknown: {
    key: 'manual_review',
    label: '待人工归类',
    target: '体质表 / 待复核',
    description: '当前可以接收文件，但仍需人工确认应落到哪一类指标。',
  },
};

const TEXT_REPLACEMENTS = new Map([
  ['⻚', '页'],
  ['⽉', '月'],
  ['⽿', '耳'],
  ['⼯', '工'],
  ['⼲', '干'],
  ['⿊', '黑'],
  ['⼈', '人'],
  ['⽔', '水'],
  ['⾐', '衣'],
  ['⼦', '子'],
]);

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, 'result')) {
      return toNumber(value.result);
    }

    if (Object.prototype.hasOwnProperty.call(value, 'text')) {
      return toNumber(value.text);
    }
  }

  const source = String(value).trim();
  const negativeByParen = /^[（(].*[)）]$/.test(source.replace(/\s+/g, ''));
  let numeric = Number(
    source
      .replace(/,/g, '')
      .replace(/%/g, '')
      .replace(/[()（）]/g, '')
      .replace(/[^\d.-]/g, ''),
  );

  if (negativeByParen && Number.isFinite(numeric) && numeric > 0) {
    numeric *= -1;
  }

  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeText(value = '') {
  if (!value) {
    return '';
  }

  const normalized = String(value)
    .normalize('NFKC')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return [...normalized].map((character) => TEXT_REPLACEMENTS.get(character) || character).join('');
}

function normalizePlacementLabel(value = '') {
  return normalizeText(value)
    .replace(/\n/g, '')
    .replace(/[：:]/g, '')
    .trim();
}

function sanitizeSourceItemName(value = '') {
  return normalizeText(value)
    .replace(/--\s*\d+\s*of\s*\d+\s*--/gi, ' ')
    .replace(/^[—–-\s]+/, '')
    .replace(/\s+/g, ' ')
    .replace(/[：:，,、。；;]+$/g, '')
    .trim();
}

function normalizeExpenseAlias(value = '') {
  const cleaned = normalizeText(value || '').trim();

  if (cleaned === '粉') {
    return '粉类餐食';
  }

  if (cleaned === '姜') {
    return '姜类原料';
  }

  if (cleaned === '1-15餐') {
    return '工作餐（1-15号）';
  }

  if (cleaned === '16-31号餐费') {
    return '工作餐（16-31号）';
  }

  if (cleaned === '杯盖') {
    return '茶饮杯盖';
  }

  if (cleaned === '空调材料+人工') {
    return '空调维修材料及人工';
  }

  if (cleaned === '话费') {
    return '话费充值';
  }

  if (/^1[-—~至]15.*员工餐费$/.test(cleaned) || /^1[-—~至]15日?餐费$/.test(cleaned)) {
    return '工作餐（1-15号）';
  }

  if (/^16[-—~至]31.*员工餐费$/.test(cleaned) || /^16[-—~至]31日?餐费$/.test(cleaned)) {
    return '工作餐（16-31号）';
  }

  if (/粉面费用|米粉|米线/.test(cleaned)) {
    return '粉类餐食';
  }

  if (/一次性.*杯盖/.test(cleaned)) {
    return '茶饮杯盖';
  }

  if (/^造型?干胶$/.test(cleaned)) {
    return '干胶';
  }

  if (/小黄姜|生姜|老姜/.test(cleaned)) {
    return '姜类原料';
  }

  if (/隔水垫/.test(cleaned)) {
    return '隔水垫';
  }

  if (/一次性.*手套|PVC手套/.test(cleaned)) {
    return '手套';
  }

  return cleaned;
}

function findLastFilledValue(values = []) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const current = values[index];

    if (String(current ?? '').trim()) {
      return current;
    }
  }

  return '';
}

function getTemplatePlacementCatalog({ storeName = '', periodLabel = '' } = {}) {
  const cacheKey = `${storeName}::${periodLabel}`;

  if (TEMPLATE_PLACEMENT_CACHE.has(cacheKey)) {
    return TEMPLATE_PLACEMENT_CACHE.get(cacheKey);
  }

  try {
    const template = resolveTemplateWorkbook({ storeName, periodLabel });

    if (!template?.filePath) {
      TEMPLATE_PLACEMENT_CACHE.set(cacheKey, null);
      return null;
    }

    const workbook = XLSX.readFile(template.filePath, { raw: false });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      blankrows: false,
      defval: '',
    });

    const details = new Map();
    const categories = new Map();
    let currentCategoryName = '';
    let currentCategoryRow = null;

    for (let rowIndex = 7; rowIndex < Math.min(rows.length, 66); rowIndex += 1) {
      const row = rows[rowIndex] || [];
      const categoryCell = normalizePlacementLabel(row[0]);
      const detailCell = normalizePlacementLabel(row[2]);

      if (categoryCell) {
        currentCategoryName = categoryCell;
        currentCategoryRow = rowIndex + 1;
        categories.set(categoryCell, {
          name: categoryCell,
          row: rowIndex + 1,
        });
      }

      if (detailCell) {
        details.set(detailCell, {
          name: detailCell,
          row: rowIndex + 1,
          categoryName: currentCategoryName,
          categoryRow: currentCategoryRow,
        });
      }
    }

    const catalog = {
      workbookName: path.basename(template.filePath),
      sheetName: sheetName || 'Sheet1',
      details,
      categories,
    };

    TEMPLATE_PLACEMENT_CACHE.set(cacheKey, catalog);
    return catalog;
  } catch {
    TEMPLATE_PLACEMENT_CACHE.set(cacheKey, null);
    return null;
  }
}

function resolveBodySheetPlacement({
  detailName = '',
  fallbackCategory = '',
  storeName = '',
  periodLabel = '',
} = {}) {
  const catalog = getTemplatePlacementCatalog({ storeName, periodLabel });
  const normalizedDetail = normalizePlacementLabel(detailName);
  const normalizedCategory = normalizePlacementLabel(fallbackCategory);

  if (catalog && normalizedDetail && catalog.details.has(normalizedDetail)) {
    const placement = catalog.details.get(normalizedDetail);

    return {
      placementType: 'detail',
      targetWorkbookName: catalog.workbookName,
      targetSheetName: catalog.sheetName,
      targetCategory: placement.categoryName,
      targetDetail: placement.name,
      targetRow: placement.row,
      targetLabel: `体质表《${catalog.workbookName}》 > 明细数据 > ${placement.categoryName} > ${placement.name}（第${placement.row}行）`,
      note: '',
    };
  }

  if (catalog && normalizedCategory && catalog.categories.has(normalizedCategory)) {
    const placement = catalog.categories.get(normalizedCategory);

    return {
      placementType: 'category',
      targetWorkbookName: catalog.workbookName,
      targetSheetName: catalog.sheetName,
      targetCategory: placement.name,
      targetDetail: '',
      targetRow: placement.row,
      targetLabel: `体质表《${catalog.workbookName}》 > 明细数据 > ${placement.name}（第${placement.row}行汇总）`,
      note: '当前来源只能定位到分类级别，若要精确回填到单行，需要补充更细的原始单据或人工拆分。',
    };
  }

  if (detailName) {
    return {
      placementType: 'detail',
      targetWorkbookName: '',
      targetSheetName: '',
      targetCategory: '',
      targetDetail: detailName,
      targetRow: null,
      targetLabel: `体质表明细 > ${detailName}`,
      note: '',
    };
  }

  if (fallbackCategory) {
    return {
      placementType: 'category',
      targetWorkbookName: '',
      targetSheetName: '',
      targetCategory: fallbackCategory,
      targetDetail: '',
      targetRow: null,
      targetLabel: `体质表分类 > ${fallbackCategory}`,
      note: '当前来源只能定位到分类级别，若要精确回填到单行，需要补充更细的原始单据或人工拆分。',
    };
  }

  return null;
}

function buildExpenseBodySheetMappings(entries = [], options = {}) {
  const grouped = new Map();

  entries.forEach((entry) => {
    const sourceName = normalizeExpenseAlias(sanitizeSourceItemName(entry?.name));
    const amount = toNumber(entry?.amount);

    if (!sourceName || !Number.isFinite(amount) || amount === 0) {
      return;
    }

    const fallbackCategory = /水电费/.test(sourceName) ? '水电' : '';
    const detailName = fallbackCategory ? '' : matchExpenseDetail(sourceName);
    const placement = resolveBodySheetPlacement({
      detailName,
      fallbackCategory,
      storeName: options.storeName,
      periodLabel: options.periodLabel,
    });
    const key = placement
      ? `${placement.placementType}:${placement.targetCategory}:${placement.targetDetail}`
      : `unmapped:${sourceName}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        sourceNames: [],
        amount: 0,
        placementType: placement?.placementType || 'unmapped',
        targetWorkbookName: placement?.targetWorkbookName || '',
        targetSheetName: placement?.targetSheetName || '',
        targetCategory: placement?.targetCategory || '',
        targetDetail: placement?.targetDetail || '',
        targetRow: placement?.targetRow || null,
        targetLabel: placement?.targetLabel || '待人工归类 / 待复核',
        note: placement ? (placement.note || '') : '当前项目未命中体质表映射规则，建议先挂到待人工归类。',
      });
    }

    const current = grouped.get(key);
    current.amount = Number((current.amount + amount).toFixed(2));

    if (!current.sourceNames.includes(sourceName)) {
      current.sourceNames.push(sourceName);
    }
  });

  return [...grouped.values()].sort((left, right) => right.amount - left.amount);
}

function getSheetRows(workbook, sheetName = '') {
  if (!sheetName || !workbook?.Sheets?.[sheetName]) {
    return [];
  }

  return XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: false,
    blankrows: false,
    defval: '',
  });
}

function detectExpenseWorkbookHeader(rows = []) {
  let bestMatch = null;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 8); rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const normalizedRow = row.map((cell) => normalizeText(cell).replace(/\s+/g, ''));
    const serialIndex = normalizedRow.findIndex((cell) => /^(序号|编号)$/.test(cell));
    const dateIndex = normalizedRow.findIndex((cell) => /日期|时间/.test(cell));
    const categoryIndex = normalizedRow.findIndex((cell) => /类目|分类|项目类别|费用类别/.test(cell));
    const amountIndex = normalizedRow.findIndex((cell) => /金额|数额|支出|费用/.test(cell));
    const detailIndex = normalizedRow.findIndex((cell) => /明细|内容|项目|品名|名称/.test(cell));
    const noteIndex = normalizedRow.findIndex((cell) => /备注|说明/.test(cell));
    let score = 0;

    if (serialIndex !== -1) {
      score += 1;
    }

    if (dateIndex !== -1) {
      score += 2;
    }

    if (categoryIndex !== -1) {
      score += 3;
    }

    if (amountIndex !== -1) {
      score += 3;
    }

    if (detailIndex !== -1) {
      score += 3;
    }

    if (noteIndex !== -1) {
      score += 1;
    }

    if (score < 8 || categoryIndex === -1 || amountIndex === -1 || detailIndex === -1) {
      continue;
    }

    const current = {
      rowIndex,
      serialIndex,
      dateIndex,
      categoryIndex,
      amountIndex,
      detailIndex,
      noteIndex,
      score,
    };

    if (!bestMatch || current.score > bestMatch.score) {
      bestMatch = current;
    }
  }

  return bestMatch;
}

function findBestExpenseWorkbookSheet(workbook) {
  let bestMatch = null;

  (workbook?.SheetNames || []).forEach((sheetName) => {
    const rows = getSheetRows(workbook, sheetName);
    const header = detectExpenseWorkbookHeader(rows);

    if (!header) {
      return;
    }

    const denseRowCount = rows.filter((row) =>
      Array.isArray(row) && row.some((cell) => String(cell || '').trim()),
    ).length;
    const current = {
      sheetName,
      rows,
      header,
      score: header.score * 100 + denseRowCount,
    };

    if (!bestMatch || current.score > bestMatch.score) {
      bestMatch = current;
    }
  });

  return bestMatch;
}

function detectBodyTableExtractHeader(rows = []) {
  let bestMatch = null;

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 6); rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const normalizedRow = row.map((cell) => normalizeText(cell).replace(/\s+/g, ''));
    const nameIndex = normalizedRow.findIndex((cell) => /^(细分项名称|细分项)$/.test(cell));
    const amountIndex = normalizedRow.findIndex((cell) => /^(细分项金额|金额)$/.test(cell));
    const noteIndex = normalizedRow.findIndex((cell) => /备注|说明/.test(cell));

    if (nameIndex === -1 || amountIndex === -1) {
      continue;
    }

    const current = {
      rowIndex,
      nameIndex,
      amountIndex,
      noteIndex,
      score: 10 + (noteIndex !== -1 ? 2 : 0),
    };

    if (!bestMatch || current.score > bestMatch.score) {
      bestMatch = current;
    }
  }

  return bestMatch;
}

function isBodyTableMetricLabel(value = '') {
  const normalized = normalizeText(value).replace(/\s+/g, '');
  return /月总客数|核算总实收|机机乐总实收|储蓄金额|月度总实收|微信银联支付宝|项目实收|月平均客单价|月平均客成本|新增会员数/.test(
    normalized,
  );
}

function countBodyTableMetricRows(rows = [], header = {}) {
  let count = 0;

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];

    if (isBodyTableMetricLabel(row[header.nameIndex])) {
      count += 1;
    }
  }

  return count;
}

function findBodyTableExtractSheet(workbook) {
  let bestMatch = null;

  (workbook?.SheetNames || []).forEach((sheetName) => {
    const rows = getSheetRows(workbook, sheetName);
    const header = detectBodyTableExtractHeader(rows);

    if (!header) {
      return;
    }

    const metricCount = countBodyTableMetricRows(rows, header);

    if (metricCount < 4 && !/细分项提取/i.test(sheetName)) {
      return;
    }

    const denseRowCount = rows.filter((row) =>
      Array.isArray(row) && row.some((cell) => String(cell || '').trim()),
    ).length;
    const current = {
      sheetName,
      rows,
      header,
      metricCount,
      score: header.score * 100 + metricCount * 20 + denseRowCount,
    };

    if (!bestMatch || current.score > bestMatch.score) {
      bestMatch = current;
    }
  });

  return bestMatch;
}

function extractBodyTableInlineNumber(label = '', amountCell = '') {
  const directAmount = String(amountCell || '').trim();

  if (directAmount) {
    return toNumber(directAmount);
  }

  const matched = normalizeText(label).match(/[：:]\s*([（(]?-?[\d,.]+[)）]?)/);
  return matched ? toNumber(matched[1]) : 0;
}

function parseBodyTableChannels(channelText = '') {
  const source = normalizeText(channelText);

  return {
    walletChannel: toNumber(source.match(/微信银联支付宝[：:]\s*([（(]?-?[\d,.]+[)）]?)/)?.[1] || 0),
    cashChannel: toNumber(source.match(/现金[：:]\s*([（(]?-?[\d,.]+[)）]?)/)?.[1] || 0),
    meituanRevenue: toNumber(source.match(/美团[：:]\s*([（(]?-?[\d,.]+[)）]?)/)?.[1] || 0),
    douyinRevenue: toNumber(source.match(/抖音[：:]\s*([（(]?-?[\d,.]+[)）]?)/)?.[1] || 0),
  };
}

function refineBodyTableExtractAmount(amount, note = '') {
  const rawAmount = toNumber(amount);
  const normalizedNote = normalizeText(note);

  if (!normalizedNote || !Number.isFinite(rawAmount)) {
    return rawAmount;
  }

  const explicitTotalMatch = normalizedNote.match(
    /([0-9]+(?:\.[0-9]+)?)\s*分摊到\s*1[.．、,，]?\s*2[.．、,，]?\s*3/,
  );

  if (explicitTotalMatch) {
    const derived = Number(explicitTotalMatch[1]) / 3;

    if (Number.isFinite(derived) && Math.abs(rawAmount - derived) < 0.02) {
      return derived;
    }
  }

  const qtyPriceMatch = normalizedNote.match(
    /1[.．、,，]?\s*2[.．、,，]?\s*3\s*分摊\s*([0-9]+(?:\.[0-9]+)?)\s*个[，,]\s*([0-9]+(?:\.[0-9]+)?)\s*元\/个/,
  );

  if (qtyPriceMatch) {
    const derived = (Number(qtyPriceMatch[1]) * Number(qtyPriceMatch[2])) / 3;

    if (Number.isFinite(derived) && Math.abs(rawAmount - derived) < 0.02) {
      return derived;
    }
  }

  return rawAmount;
}

function buildBodyTableExtractDetailMappings(entries = [], options = {}) {
  const grouped = new Map();

  entries.forEach((entry) => {
    const detailName = sanitizeSourceItemName(entry?.name);
    const amount = toNumber(entry?.amount);
    const note = sanitizeSourceItemName(entry?.note);

    if (!detailName || !Number.isFinite(amount)) {
      return;
    }

    const placement = resolveBodySheetPlacement({
      detailName,
      storeName: options.storeName,
      periodLabel: options.periodLabel,
    });
    const key = placement
      ? `${placement.placementType}:${placement.targetCategory}:${placement.targetDetail}`
      : `unmapped:${detailName}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        sourceNames: [],
        amount: 0,
        placementType: placement?.placementType || 'unmapped',
        targetWorkbookName: placement?.targetWorkbookName || '',
        targetSheetName: placement?.targetSheetName || '',
        targetCategory: placement?.targetCategory || '',
        targetDetail: placement?.targetDetail || '',
        targetRow: placement?.targetRow || null,
        targetLabel: placement?.targetLabel || '待人工归类 / 待复核',
        note: placement ? (placement.note || '') : '当前项目未命中体质表映射规则，建议人工复核。',
      });
    }

    const current = grouped.get(key);
    current.amount = Number((current.amount + amount).toFixed(2));

    if (!current.sourceNames.includes(detailName)) {
      current.sourceNames.push(detailName);
    }

    if (note) {
      const notes = current.note ? current.note.split('；').filter(Boolean) : [];

      if (!notes.includes(note)) {
        notes.push(note);
      }

      current.note = notes.join('；');
    }
  });

  return [...grouped.values()].sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount));
}

function buildExpenseWorkbookEntries(rows = [], header = {}, sheetName = '') {
  const entries = [];
  const detailCounts = new Map();

  for (let rowIndex = header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const joinedText = normalizeText(row.join(' '));

    if (!joinedText) {
      continue;
    }

    if (/总合计|本月合计|本页合计/.test(joinedText)) {
      continue;
    }

    const amount = toNumber(row[header.amountIndex]);
    const rawCategory = sanitizeSourceItemName(row[header.categoryIndex]);
    const rawName = sanitizeSourceItemName(row[header.detailIndex] || rawCategory);
    const name = normalizeExpenseAlias(rawName || rawCategory);

    if (!name || !Number.isFinite(amount) || amount === 0) {
      continue;
    }

    const currentCount = detailCounts.get(name) || 0;
    detailCounts.set(name, currentCount + 1);

    entries.push({
      name,
      rawName,
      category: normalizeExpenseAlias(rawCategory),
      rawCategory,
      amount,
      date: sanitizeSourceItemName(row[header.dateIndex]),
      note: sanitizeSourceItemName(row[header.noteIndex]),
      rowIndex: rowIndex + 1,
      sheetName,
      source: 'expense-workbook',
    });
  }

  return entries;
}

function safeTrimSentence(value = '') {
  return String(value || '').replace(/[。；，\s]+$/g, '').trim();
}

function getAiClassificationSettings() {
  try {
    const stored = readSettings();
    const apiKey = String(process.env.ZHIPU_API_KEY || stored?.zhipuApiKey || '').trim();
    const model = String(process.env.ZHIPU_MODEL || stored?.zhipuModel || 'glm-4.7-flash').trim();

    return {
      apiKey,
      model: model || 'glm-4.7-flash',
    };
  } catch {
    return {
      apiKey: String(process.env.ZHIPU_API_KEY || '').trim(),
      model: String(process.env.ZHIPU_MODEL || 'glm-4.7-flash').trim() || 'glm-4.7-flash',
    };
  }
}

function extractJsonObjectFromText(text = '') {
  const source = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!source) {
    return null;
  }

  try {
    return JSON.parse(source);
  } catch (_error) {
    // Fall through to bracket scan.
  }

  const startIndex = source.indexOf('{');

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(source.slice(startIndex, index + 1));
        } catch (_error) {
          return null;
        }
      }
    }
  }

  return null;
}

async function classifyExpenseEntriesWithAI(entries = [], options = {}) {
  const { apiKey, model } = getAiClassificationSettings();
  const catalog = getTemplatePlacementCatalog({
    storeName: options.storeName,
    periodLabel: options.periodLabel,
  });

  if (!apiKey || !entries.length || !catalog) {
    return [];
  }

  const detailOptions = [...catalog.details.values()].map((item) => ({
    detailName: item.name,
    categoryName: item.categoryName,
  }));

  if (!detailOptions.length) {
    return [];
  }

  const messages = [
    {
      role: 'system',
      content:
        '你是门店财务单据归类助手。请根据候选体质表明细，为每一条未命中的费用记录选择最合适的 detailName。只能从候选列表中选择；如果无法判断就返回 UNMAPPED。只输出 JSON 对象，格式为 {"items":[{"index":0,"detailName":"餐费","reason":"..."}] }。',
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          storeName: options.storeName || '',
          periodLabel: options.periodLabel || '',
          candidateDetails: detailOptions,
          unresolvedItems: entries.map((entry) => ({
            index: entry.index,
            category: entry.category || '',
            name: entry.name || '',
            note: entry.note || '',
            amount: entry.amount || 0,
          })),
        },
        null,
        2,
      ),
    },
  ];

  try {
    const response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        top_p: 0.6,
        max_tokens: 900,
        messages,
        response_format: {
          type: 'json_object',
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return [];
    }

    const content = payload?.choices?.[0]?.message?.content || '';
    const parsed = extractJsonObjectFromText(content);
    const items = Array.isArray(parsed?.items) ? parsed.items : Array.isArray(parsed) ? parsed : [];

    return items
      .map((item) => ({
        index: Number(item?.index),
        detailName: sanitizeSourceItemName(item?.detailName),
        reason: safeTrimSentence(item?.reason || ''),
      }))
      .filter((item) => Number.isInteger(item.index) && item.detailName && item.detailName !== 'UNMAPPED');
  } catch {
    return [];
  }
}

function resolveExpenseWorkbookEntryPlacement(entry = {}, options = {}) {
  const explicitCategoryCandidates = [
    entry.category,
    entry.rawCategory,
  ].filter(Boolean);

  for (const candidate of explicitCategoryCandidates) {
    const placement = resolveBodySheetPlacement({
      detailName: candidate,
      fallbackCategory: candidate,
      storeName: options.storeName,
      periodLabel: options.periodLabel,
    });

    if (placement?.targetDetail || placement?.targetCategory) {
      return placement;
    }
  }

  const matchedDetailName = matchExpenseDetail(
    [entry.category, entry.name, entry.note].filter(Boolean).join(' '),
  );

  if (matchedDetailName) {
    return resolveBodySheetPlacement({
      detailName: matchedDetailName,
      fallbackCategory: entry.category || '',
      storeName: options.storeName,
      periodLabel: options.periodLabel,
    });
  }

  return null;
}

async function buildExpenseWorkbookBodySheetMappings(entries = [], options = {}) {
  const grouped = new Map();
  const resolvedPlacements = new Array(entries.length).fill(null);
  const unresolvedEntries = [];
  const aiEnabled = Boolean(getAiClassificationSettings().apiKey);

  entries.forEach((entry, index) => {
    const placement = resolveExpenseWorkbookEntryPlacement(entry, options);

    if (placement) {
      resolvedPlacements[index] = placement;
      return;
    }

    unresolvedEntries.push({
      index,
      category: entry.category,
      name: entry.name,
      note: entry.note,
      amount: entry.amount,
    });
  });

  if (unresolvedEntries.length) {
    const aiMatches = await classifyExpenseEntriesWithAI(unresolvedEntries, options);

    aiMatches.forEach((match) => {
      const placement = resolveBodySheetPlacement({
        detailName: match.detailName,
        storeName: options.storeName,
        periodLabel: options.periodLabel,
      });

      if (!placement) {
        return;
      }

      resolvedPlacements[match.index] = {
        ...placement,
        note: [placement.note, match.reason ? `AI 模糊归类：${match.reason}` : 'AI 模糊归类结果，建议人工复核。']
          .filter(Boolean)
          .join('；'),
      };
    });
  }

  entries.forEach((entry, index) => {
    const sourceName = normalizeExpenseAlias(sanitizeSourceItemName(entry?.name));
    const amount = toNumber(entry?.amount);
    const placement = resolvedPlacements[index];

    if (!sourceName || !Number.isFinite(amount) || amount === 0) {
      return;
    }

    const key = placement
      ? `${placement.placementType}:${placement.targetCategory}:${placement.targetDetail}`
      : `unmapped:${sourceName}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        sourceNames: [],
        amount: 0,
        placementType: placement?.placementType || 'unmapped',
        targetWorkbookName: placement?.targetWorkbookName || '',
        targetSheetName: placement?.targetSheetName || '',
        targetCategory: placement?.targetCategory || '',
        targetDetail: placement?.targetDetail || '',
        targetRow: placement?.targetRow || null,
        targetLabel: placement?.targetLabel || '待人工归类 / 待复核',
        note: placement
          ? (placement.note || '')
          : (aiEnabled
            ? '当前项目未命中规则或 AI 归类，请人工复核。'
            : '当前项目未命中规则；如已配置 ZHIPU_API_KEY，可启用 AI 模糊归类。'),
      });
    }

    const current = grouped.get(key);
    current.amount = Number((current.amount + amount).toFixed(2));

    if (!current.sourceNames.includes(sourceName)) {
      current.sourceNames.push(sourceName);
    }
  });

  return [...grouped.values()].sort((left, right) => right.amount - left.amount);
}

function buildRevenueBodySheetMappings(metrics = {}, options = {}) {
  const catalog = getTemplatePlacementCatalog({
    storeName: options.storeName,
    periodLabel: options.periodLabel,
  });
  const workbookLabel = catalog?.workbookName ? `体质表《${catalog.workbookName}》` : '体质表';

  return [
    {
      sourceNames: ['消费人数'],
      amount: toNumber(metrics.customerCount),
      placementType: 'summary',
      targetWorkbookName: catalog?.workbookName || '',
      targetSheetName: catalog?.sheetName || '',
      targetCategory: '汇总数据',
      targetDetail: '月总客数',
      targetRow: 3,
      targetLabel: `${workbookLabel} > 汇总数据 > 月总客数（第3行）`,
      note: '',
    },
    {
      sourceNames: ['核算总实收'],
      amount: toNumber(metrics.recognizedRevenue),
      placementType: 'summary',
      targetWorkbookName: catalog?.workbookName || '',
      targetSheetName: catalog?.sheetName || '',
      targetCategory: '汇总数据',
      targetDetail: '核算总实收',
      targetRow: 3,
      targetLabel: `${workbookLabel} > 汇总数据 > 核算总实收（第3行）`,
      note: '',
    },
    {
      sourceNames: ['月度总实收与渠道结构'],
      amount: toNumber(metrics.grossRevenue),
      placementType: 'summary',
      targetWorkbookName: catalog?.workbookName || '',
      targetSheetName: catalog?.sheetName || '',
      targetCategory: '汇总数据',
      targetDetail: '月度总实收 / 渠道结构',
      targetRow: 4,
      targetLabel: `${workbookLabel} > 汇总数据 > 月度总实收 / 渠道结构（第4行）`,
      note: '',
    },
    {
      sourceNames: ['新增会员数'],
      amount: toNumber(metrics.newMembers),
      placementType: 'summary',
      targetWorkbookName: catalog?.workbookName || '',
      targetSheetName: catalog?.sheetName || '',
      targetCategory: '汇总数据',
      targetDetail: '新增会员数',
      targetRow: 5,
      targetLabel: `${workbookLabel} > 汇总数据 > 新增会员数（第5行）`,
      note: '',
    },
  ].filter((item) => item.amount > 0);
}

function parseInventoryRegisterRows(rows = [], sheetName = '') {
  const items = [];

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 3) {
    const inRow = rows[rowIndex] || [];
    const outRow = rows[rowIndex + 1] || [];
    const stockRow = rows[rowIndex + 2] || [];
    const name = sanitizeSourceItemName(inRow[0]);

    if (!name) {
      continue;
    }

    items.push({
      name,
      amount: toNumber(inRow[37]),
      unitPrice: toNumber(inRow[36]),
      inboundQuantity: toNumber(inRow[35]),
      outboundQuantity: toNumber(outRow[35]),
      endingStock: toNumber(findLastFilledValue(stockRow.slice(4, 35))) || toNumber(inRow[1]),
      spec: normalizeText(inRow[2]),
      sheetName,
      source: 'inventory-register',
    });
  }

  return items;
}

function parseFixedAssetRows(rows = [], sheetName = '') {
  const items = [];

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 3) {
    const inRow = rows[rowIndex] || [];
    const outRow = rows[rowIndex + 1] || [];
    const stockRow = rows[rowIndex + 2] || [];
    const name = sanitizeSourceItemName(inRow[0]);

    if (!name) {
      continue;
    }

    items.push({
      name,
      unitPrice: toNumber(inRow[36] || inRow[37]),
      inboundQuantity: toNumber(inRow[35]),
      outboundQuantity: toNumber(outRow[35]),
      endingStock: toNumber(findLastFilledValue(stockRow.slice(4, 35))) || toNumber(inRow[1]),
      spec: normalizeText(inRow[2]),
      sheetName,
      source: 'fixed-asset-register',
    });
  }

  return items;
}

function getExtension(fileName = '') {
  const normalized = String(fileName || '').trim().toLowerCase();
  const extension = path.extname(normalized);
  return extension ? extension.slice(1) : '';
}

function detectSourceGroup(...parts) {
  const source = normalizeText(parts.filter(Boolean).join('\n'));

  return (
    REQUIRED_SOURCE_GROUPS.find((group) => group.pattern.test(source)) || null
  );
}

function formatCurrency(amount) {
  return `¥${Number(amount || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getBodySheetSection(sourceGroupKey = '') {
  return BODY_SHEET_SECTIONS[sourceGroupKey] || BODY_SHEET_SECTIONS.unknown;
}

function extractPreviewLines(text = '', limit = 5) {
  return normalizeText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);
}

function extractExpenseItems(text = '', limit = 6) {
  const source = normalizeText(text);
  const matches = [
    ...source.matchAll(/([\u4e00-\u9fa5A-Za-z0-9+\-＋—\/]+)\s*([0-9]+(?:\.[0-9]+)?)元/g),
  ];

  const ignored = new Set(['本页合计', '总合计', '1月总合计', '本月总合计', '合计']);
  const unique = [];

  matches.forEach((match) => {
    const label = String(match[1] || '')
      .trim()
      .replace(/[0-9.]+$/g, '')
      .trim();

    if (!label || ignored.has(label) || /合计/.test(label)) {
      return;
    }

    if (!unique.includes(label)) {
      unique.push(label);
    }
  });

  return unique.slice(0, limit);
}

function extractExpenseItemsFromRows(rows = [], limit = 6) {
  const items = [];
  const ignored = /合计|日期|金额|备注|项|分类|汇总/;

  for (let i = 0; i < Math.min(rows.length, 50); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;

    const description = String(row[0] || row[1] || row[2] || '').trim();
    const amount = toNumber(row[1] || row[2] || row[3] || row[4]);

    if (description && amount > 0 && !ignored.test(description)) {
      items.push(`${description} (${formatCurrency(amount)})`);
      if (items.length >= limit) break;
    }
  }
  return items;
}

function sumExpenseFromRows(rows = []) {
  let total = 0;
  let amountColumnIndex = -1;

  // Try to find amount column
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    amountColumnIndex = row.findIndex(cell => /金额|数额|支出|合计/i.test(normalizeText(cell)));
    if (amountColumnIndex !== -1) break;
  }

  if (amountColumnIndex === -1) amountColumnIndex = 1; // Fallback

  rows.forEach(row => {
    const val = toNumber(row[amountColumnIndex]);
    if (val > 0) total += val;
  });

  return total;
}

function buildExpenseEntries(text = '') {
  const source = normalizeText(text);
  const matches = [
    ...source.matchAll(/([\u4e00-\u9fa5A-Za-z0-9+\-＋—\/（）()、，,.\s]+?)\s*([-\d]+(?:\.\d+)?)元/g),
  ];

  const ignored = new Set(['本页合计', '总合计', '1月总合计', '本月总合计']);
  const entries = [];

  matches.forEach((match) => {
    const name = String(match[1] || '')
      .replace(/^珂溪头疗.*?报销明细/, '')
      .replace(/\s+/g, ' ')
      .trim();
    const amount = Number(match[2]);

    if (!name || ignored.has(name) || /合计/.test(name) || !Number.isFinite(amount)) {
      return;
    }

    entries.push({
      name,
      amount,
      source: 'expense-pdf',
    });
  });

  return entries;
}

function buildPreviewFromEntries(entries = [], limit = 5) {
  return entries.slice(0, limit).map((entry) => `${entry.name} ${formatCurrency(entry.amount)}`);
}

function findRowValue(rows = [], labelPattern, valueOffset = 1) {
  for (const row of rows) {
    for (let index = 0; index < row.length; index += 1) {
      const cell = normalizeText(row[index]);

      if (!cell || !labelPattern.test(cell)) {
        continue;
      }

      return row[index + valueOffset];
    }
  }

  return '';
}

function findRechargeTotals(rows = []) {
  const totals = {
    cash: 0,
    union: 0,
    wechat: 0,
    alipay: 0,
    total: 0,
  };

  let inRechargeSection = false;

  rows.forEach((row) => {
    const firstCell = normalizeText(row[0]);

    if (/会员充值汇总/.test(firstCell)) {
      inRechargeSection = true;
      return;
    }

    if (!inRechargeSection) {
      return;
    }

    if (/非营业收入统计|新增会员充值|新增会员数/.test(firstCell)) {
      inRechargeSection = false;
      return;
    }

    if (/^汇总$/.test(firstCell)) {
      totals.total = toNumber(row[1]);
      return;
    }

    if (/^现金$/.test(firstCell)) {
      totals.cash = toNumber(row[1]);
      return;
    }

    if (/^银联$/.test(firstCell)) {
      totals.union = toNumber(row[1]);
      return;
    }

    if (/^微信$/.test(firstCell)) {
      totals.wechat = toNumber(row[1]);
      return;
    }

    if (/^支付宝$/.test(firstCell)) {
      totals.alipay = toNumber(row[1]);
    }
  });

  return totals;
}

function parseBodyTableExtractWorkbook(filePath, options = {}) {
  const originalName = options.originalName || path.basename(filePath);
  const workbook = options.workbook || XLSX.readFile(filePath, { raw: false });
  const bestSheet = options.sheetMeta || findBodyTableExtractSheet(workbook);

  if (!bestSheet?.sheetName || !bestSheet?.header) {
    throw new Error('当前 Excel 未识别到体质表细分项提取结构。');
  }

  const rows = bestSheet.rows || getSheetRows(workbook, bestSheet.sheetName);
  const detailEntries = [];
  let customerCount = 0;
  let recognizedRevenue = 0;
  let machineRevenue = 0;
  let savingsAmount = 0;
  let grossRevenue = 0;
  let channelText = '';
  let projectRevenueHint = 0;
  let averageTicket = 0;
  let averageCost = 0;
  let newMembers = 0;

  for (let rowIndex = bestSheet.header.rowIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = Array.isArray(rows[rowIndex]) ? rows[rowIndex] : [];
    const rawLabel = row[bestSheet.header.nameIndex];
    const label = sanitizeSourceItemName(rawLabel);
    const amountCell = row[bestSheet.header.amountIndex];
    const note = sanitizeSourceItemName(
      bestSheet.header.noteIndex === -1 ? '' : row[bestSheet.header.noteIndex],
    );

    if (!label) {
      continue;
    }

    if (/^月总客数/.test(label)) {
      customerCount = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    if (/^核算总实收/.test(label)) {
      recognizedRevenue = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    if (/^机机乐总实收/.test(label)) {
      machineRevenue = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    if (/^储蓄金额/.test(label)) {
      savingsAmount = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    if (/^月度总实收/.test(label)) {
      grossRevenue = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    if (/^微信银联支付宝/.test(label)) {
      channelText = String(rawLabel || '').replace(/\r/g, '').trim();
      continue;
    }

    if (/^项目实收/.test(label)) {
      projectRevenueHint = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    if (/^月平均客单价/.test(label)) {
      averageTicket = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    if (/^月平均客成本/.test(label)) {
      averageCost = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    if (/^新增会员数/.test(label)) {
      newMembers = extractBodyTableInlineNumber(label, amountCell);
      continue;
    }

    const amount = refineBodyTableExtractAmount(toNumber(amountCell), note);

    if (!Number.isFinite(amount)) {
      continue;
    }

    detailEntries.push({
      name: label,
      amount,
      note,
      rowIndex: rowIndex + 1,
      sheetName: bestSheet.sheetName,
      source: 'body-table-extract',
    });
  }

  const storeName = options.storeName || '';
  const periodLabel = options.periodLabel || '';
  const channels = parseBodyTableChannels(channelText);
  const totalAmount = Number(
    detailEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0).toFixed(5),
  );
  const topItems = [...detailEntries]
    .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
    .slice(0, 8);
  const revenueData = {
    kind: 'revenue-report',
    customerCount,
    recognizedRevenue,
    grossRevenue,
    machineRevenue,
    savingsAmount,
    projectRevenue: recognizedRevenue || projectRevenueHint,
    newMembers,
    channels,
    channelText,
    averageTicket,
    averageCost,
    projectRevenueHint,
  };
  const revenueMappings = buildRevenueBodySheetMappings(revenueData, {
    storeName,
    periodLabel,
  });
  const detailMappings = buildBodyTableExtractDetailMappings(detailEntries, {
    storeName,
    periodLabel,
  });
  const bodySheetMappings = [...revenueMappings, ...detailMappings];

  return {
    fileName: originalName,
    extension: getExtension(originalName),
    status: 'parsed',
    parserMode: 'spreadsheet',
    sourceGroupKey: 'complete',
    coveredSourceGroupKeys: ['revenue', 'expense', 'payroll'],
    sourceGroupLabel: '体质表中间结果.xlsx',
    storeName,
    periodLabel,
    bodySheetSection: getBodySheetSection('complete'),
    parsedDataSummary: [
      `识别到 ${detailEntries.length} 条体质表细分项，净额 ${formatCurrency(totalAmount)}`,
      `已读取工作表 ${bestSheet.sheetName}，命中“细分项名称 / 细分项金额 / 备注”结构`,
      `汇总指标已提取：月总客数 ${customerCount}、核算总实收 ${formatCurrency(recognizedRevenue)}、月度总实收 ${formatCurrency(grossRevenue)}`,
      '当前文件已覆盖营收、费用、工资三类核心资料，可直接生成体质表草稿',
    ],
    previewLines: [
      `月总客数 ${customerCount}`,
      `核算总实收 ${formatCurrency(recognizedRevenue)}`,
      `月度总开支 ${formatCurrency(totalAmount)}`,
      ...topItems.slice(0, 2).map((item) => `${item.name} ${formatCurrency(item.amount)}`),
    ].filter(Boolean).slice(0, 5),
    metrics: {
      rowCount: detailEntries.length,
      sheetName: bestSheet.sheetName,
      totalAmount,
      customerCount,
      recognizedRevenue,
      grossRevenue,
    },
    bodySheetMappings,
    structuredData: {
      kind: 'body-table-extract',
      revenue: revenueData,
      totalAmount,
      items: detailEntries,
      topItems,
      bodySheetMappings,
    },
    note: `已识别为体质表中间结果，读取 ${bestSheet.sheetName} 工作表，共 ${detailEntries.length} 条细分项；识别对象为 ${[storeName, periodLabel].filter(Boolean).join(' ')}。`,
  };
}

async function parseExpenseWorkbook(filePath, options = {}) {
  const originalName = options.originalName || path.basename(filePath);
  const workbook = options.workbook || XLSX.readFile(filePath, { raw: false });
  const bestSheet = options.sheetMeta || findBestExpenseWorkbookSheet(workbook);

  if (!bestSheet?.sheetName || !bestSheet?.header) {
    throw new Error('当前 Excel 未识别到标准报销明细表头。');
  }

  const rows = bestSheet.rows || getSheetRows(workbook, bestSheet.sheetName);
  const entries = buildExpenseWorkbookEntries(rows, bestSheet.header, bestSheet.sheetName);

  if (!entries.length) {
    throw new Error('报销明细表未读取到有效金额行。');
  }

  const storeName = inferStoreName(`${originalName}\n${rows[0]?.join(' ') || ''}`, options.storeName || '');
  const inferredPeriodLabel = inferPeriodLabel(
    `${originalName}\n${rows.slice(0, 3).map((row) => row.join(' ')).join('\n')}`,
    options.periodLabel || '',
  );
  const periodLabel = enrichPeriodLabelFromTemplate(storeName, inferredPeriodLabel);
  const totalAmount = Number(
    entries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0).toFixed(2),
  );
  const bodySheetMappings = await buildExpenseWorkbookBodySheetMappings(entries, {
    storeName,
    periodLabel,
  });
  const categoryBreakdown = [...entries.reduce((accumulator, entry) => {
    const key = entry.category || '未分类';

    if (!accumulator.has(key)) {
      accumulator.set(key, {
        category: key,
        amount: 0,
        count: 0,
      });
    }

    const current = accumulator.get(key);
    current.amount = Number((current.amount + Number(entry.amount || 0)).toFixed(2));
    current.count += 1;
    return accumulator;
  }, new Map()).values()].sort((left, right) => right.amount - left.amount);
  const previewLines = buildPreviewFromEntries(
    [...entries].sort((left, right) => right.amount - left.amount),
    5,
  );
  const topItems = [...entries].sort((left, right) => right.amount - left.amount).slice(0, 8);

  return {
    fileName: originalName,
    extension: getExtension(originalName),
    status: 'parsed',
    parserMode: 'spreadsheet',
    sourceGroupKey: 'expense',
    sourceGroupLabel: '报销明细.xlsx',
    storeName,
    periodLabel,
    bodySheetSection: getBodySheetSection('expense'),
    parsedDataSummary: [
      `识别到 ${entries.length} 条报销明细，累计 ${formatCurrency(totalAmount)}`,
      `已读取工作表 ${bestSheet.sheetName}，表头命中“日期 / 类目 / 金额 / 明细 / 备注”结构`,
      categoryBreakdown.length
        ? `主要费用类目包括 ${categoryBreakdown.slice(0, 4).map((item) => `${item.category}（${formatCurrency(item.amount)}）`).join('、')}`
        : '当前未识别到稳定的类目结构',
      bodySheetMappings.some((item) => item.placementType === 'unmapped')
        ? '存在少量未自动归口条目，已标记待复核 / 可走 AI 模糊归类'
        : '已生成体质表归口建议，可直接进入数据洞察和体质表草稿',
    ],
    previewLines,
    metrics: {
      rowCount: entries.length,
      sheetName: bestSheet.sheetName,
      totalAmount,
    },
    bodySheetMappings,
    structuredData: {
      kind: 'expense-pdf',
      sourceType: 'expense-workbook',
      totalAmount,
      items: entries,
      topItems,
      categoryBreakdown,
      bodySheetMappings,
      sheetName: bestSheet.sheetName,
      periodLabel,
    },
    note: `已识别为报销明细 Excel，读取 ${bestSheet.sheetName} 工作表，共 ${entries.length} 条费用记录；识别对象为 ${[storeName, periodLabel].filter(Boolean).join(' ')}。`,
  };
}

function parseRevenueWorkbook(filePath, options = {}) {
  const originalName = options.originalName || path.basename(filePath);
  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('营业报表未找到可读取的工作表。');
  }

  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: '',
  });

  const totalRow = rows.find((row) => normalizeText(row[0]) === '合计') || [];
  const rechargeTotals = findRechargeTotals(rows);
  const cashPerformance = toNumber(findRowValue(rows, /^现金业绩$/));
  const customerCount = toNumber(findRowValue(rows, /^消费人数$/));
  const newMembers = toNumber(findRowValue(rows, /^新增会员数$/));
  const memberCardPayment = toNumber(totalRow[10]);
  const projectCardPayment = toNumber(totalRow[11]);
  const douyinRevenue = toNumber(totalRow[12]);
  const cashChannel = toNumber(totalRow[3]) + rechargeTotals.cash;
  const unionAmount = toNumber(totalRow[4]) + rechargeTotals.union;
  const wechatAmount = toNumber(totalRow[5]) + rechargeTotals.wechat;
  const alipayAmount = toNumber(totalRow[6]) + rechargeTotals.alipay;
  const walletChannel = unionAmount + wechatAmount + alipayAmount;
  const revenueBase =
    toNumber(findRowValue(rows, /^营业总额$/)) ||
    toNumber(totalRow[2]) ||
    0;
  const grossRevenue = revenueBase + rechargeTotals.total;
  const meituanRevenue = Math.max(0, grossRevenue - walletChannel - cashChannel - douyinRevenue);
  const recognizedRevenue = cashPerformance + memberCardPayment + projectCardPayment;
  const machineRevenue = cashPerformance + rechargeTotals.total;
  const storeName = inferStoreName(originalName, options.storeName || '');
  const periodLabel = inferPeriodLabel(originalName, options.periodLabel || '');
  const channelText = `微信银联支付宝：${walletChannel.toFixed(2)} 现金：${cashChannel.toFixed(2)} 美团：${meituanRevenue.toFixed(2)} 抖音：${douyinRevenue.toFixed(2)}`;
  const bodySheetMappings = buildRevenueBodySheetMappings(
    {
      customerCount,
      recognizedRevenue,
      grossRevenue,
      newMembers,
    },
    {
      storeName,
      periodLabel,
    },
  );

  return {
    fileName: originalName,
    extension: getExtension(originalName),
    status: 'parsed',
    parserMode: 'spreadsheet',
    sourceGroupKey: 'revenue',
    sourceGroupLabel: '营业报表.xlsx',
    storeName,
    periodLabel,
    bodySheetSection: getBodySheetSection('revenue'),
    bodySheetMappings,
    parsedDataSummary: buildParsedDataSummary({
      sourceGroupKey: 'revenue',
      parserMode: 'spreadsheet',
      metrics: {
        rowCount: rows.length,
        sheetName,
        customerCount,
        recognizedRevenue,
        grossRevenue,
      },
      previewText: channelText,
      storeName,
      periodLabel,
    }),
    previewLines: [
      `消费人数 ${customerCount}`,
      `核算总实收 ${formatCurrency(recognizedRevenue)}`,
      `储蓄金额 ${formatCurrency(rechargeTotals.total)}`,
      channelText,
      `新增会员数 ${newMembers}`,
    ],
    metrics: {
      rowCount: rows.length,
      sheetName,
      customerCount,
      recognizedRevenue,
      grossRevenue,
      savingsAmount: rechargeTotals.total,
    },
    structuredData: {
      kind: 'revenue-report',
      customerCount,
      recognizedRevenue,
      grossRevenue,
      machineRevenue,
      savingsAmount: rechargeTotals.total,
      projectRevenue: recognizedRevenue,
      newMembers,
      channels: {
        walletChannel,
        cashChannel,
        meituanRevenue,
        douyinRevenue,
      },
      channelText,
      bodySheetMappings,
    },
    note: buildParsedNote({
      sourceGroup: { key: 'revenue' },
      parserMode: 'spreadsheet',
      sheetName,
      storeName,
      periodLabel,
    }),
  };
}

function parseInventoryWorkbook(filePath, options = {}) {
  const originalName = options.originalName || path.basename(filePath);
  const workbook = XLSX.readFile(filePath, { raw: false });
  const storeName = inferStoreName(originalName, options.storeName || '');
  const periodLabel = inferPeriodLabel(originalName, options.periodLabel || '');
  const inventoryItems = [];
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    blankrows: false,
    defval: '',
  });

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 3) {
    const row = rows[rowIndex];
    const name = normalizeText(row[0]);
    const amount = toNumber(row[37]);

    if (!name || !amount) {
      continue;
    }

    inventoryItems.push({
      name,
      amount,
      sheetName,
      source: 'inventory-register',
    });
  }

  const totalAmount = inventoryItems.reduce((sum, item) => sum + item.amount, 0);

  return {
    fileName: originalName,
    extension: getExtension(originalName),
    status: 'parsed',
    parserMode: 'spreadsheet',
    sourceGroupKey: 'expense',
    sourceGroupLabel: '出入库登记表.xlsx',
    storeName,
    periodLabel,
    bodySheetSection: getBodySheetSection('expense'),
    parsedDataSummary: [
      `提取了 ${inventoryItems.length} 条出入库采购记录`,
      `识别到物料采购金额 ${formatCurrency(totalAmount)}`,
      `将纳入体质表「${getBodySheetSection('expense').label}」`,
    ],
    previewLines: buildPreviewFromEntries(inventoryItems, 5),
    metrics: {
      rowCount: inventoryItems.length,
      totalAmount,
      sheetName: sheetName || 'Sheet1',
    },
    structuredData: {
      kind: 'inventory-register',
      items: inventoryItems,
      totalAmount,
    },
    note: `已识别为出入库/物料台账，提取 ${inventoryItems.length} 条采购记录，识别对象为 ${[storeName, periodLabel].filter(Boolean).join(' ')}。`,
  };
}

function parseDetailedInventoryWorkbook(filePath, options = {}) {
  const originalName = options.originalName || path.basename(filePath);
  const workbook = XLSX.readFile(filePath, { raw: false });
  const storeName = inferStoreName(originalName, options.storeName || '');
  const periodLabel = inferPeriodLabel(originalName, options.periodLabel || '');
  const mainSheetName = workbook.SheetNames[0];
  const mainRows = XLSX.utils.sheet_to_json(workbook.Sheets[mainSheetName], {
    header: 1,
    raw: false,
    blankrows: false,
    defval: '',
  });
  const inventoryItems = parseInventoryRegisterRows(mainRows, mainSheetName);
  const purchaseItems = inventoryItems
    .filter((item) => item.amount > 0)
    .map((item) => ({
      name: item.name,
      amount: item.amount,
      unitPrice: item.unitPrice,
      inboundQuantity: item.inboundQuantity,
      outboundQuantity: item.outboundQuantity,
      endingStock: item.endingStock,
      spec: item.spec,
      sheetName: item.sheetName,
      source: item.source,
    }));
  const totalAmount = purchaseItems.reduce((sum, item) => sum + item.amount, 0);
  const topOutboundItems = [...inventoryItems]
    .filter((item) => item.outboundQuantity > 0)
    .sort((left, right) => right.outboundQuantity - left.outboundQuantity)
    .slice(0, 8);
  const zeroStockItems = inventoryItems
    .filter((item) => item.outboundQuantity > 0 && item.endingStock === 0)
    .sort((left, right) => right.outboundQuantity - left.outboundQuantity)
    .slice(0, 6);
  const fixedAssetSheetName = workbook.SheetNames.find((name, index) => index > 0 && /固定资产/i.test(name)) || workbook.SheetNames[1] || '';
  const fixedAssets = fixedAssetSheetName
    ? parseFixedAssetRows(
        XLSX.utils.sheet_to_json(workbook.Sheets[fixedAssetSheetName], {
          header: 1,
          raw: false,
          blankrows: false,
          defval: '',
        }),
        fixedAssetSheetName,
      )
    : [];
  const highValueAssets = [...fixedAssets]
    .filter((item) => item.unitPrice >= 100)
    .sort((left, right) => right.unitPrice - left.unitPrice)
    .slice(0, 8);
  const durableTools = [...fixedAssets]
    .filter((item) => item.unitPrice > 0 && item.unitPrice < 100 && item.endingStock >= 5)
    .sort((left, right) => right.endingStock - left.endingStock)
    .slice(0, 8);
  const bodySheetMappings = buildExpenseBodySheetMappings(purchaseItems, {
    storeName,
    periodLabel,
  });

  if (fixedAssets.length) {
    bodySheetMappings.push({
      sourceNames: highValueAssets
        .slice(0, 5)
        .map((item) => `${item.name}${item.endingStock ? `${item.endingStock}${item.spec || ''}` : ''}`),
      amount: 0,
      placementType: 'reference',
      targetWorkbookName: '',
      targetSheetName: fixedAssetSheetName,
      targetCategory: '辅助说明',
      targetDetail: '固定资产台账',
      targetRow: null,
      targetLabel: '固定资产台账 / 门店设备配置说明',
      note: '固定资产工作表用于设备盘点与门店承载能力说明，不建议直接并入当月消耗成本；若发生当月新增硬件采购，再按单据回填对应成本行。',
    });
  }

  return {
    fileName: originalName,
    extension: getExtension(originalName),
    status: 'parsed',
    parserMode: 'spreadsheet',
    sourceGroupKey: 'expense',
    sourceGroupLabel: '出入库登记表.xlsx',
    storeName,
    periodLabel,
    bodySheetSection: getBodySheetSection('expense'),
    parsedDataSummary: [
      `识别 ${purchaseItems.length} 条当月采购金额记录，累计 ${formatCurrency(totalAmount)}`,
      topOutboundItems.length
        ? `高频消耗项集中在 ${topOutboundItems.slice(0, 3).map((item) => `${item.name}${item.outboundQuantity}${item.spec || ''}`).join('、')}`
        : '已提取日常耗材的出入库与库存轨迹',
      fixedAssets.length
        ? `额外识别固定资产工作表，共 ${fixedAssets.length} 条设备/耐用品记录`
        : '当前文件仅包含日常耗材工作表',
      '日常耗材将映射到体质表成本费用区，固定资产建议作为辅助说明单独管理',
    ],
    previewLines: [
      ...topOutboundItems.slice(0, 3).map((item) => `${item.name} 出仓${item.outboundQuantity}${item.spec || ''} / 采购${formatCurrency(item.amount)}`),
      ...highValueAssets.slice(0, 2).map((item) => `固定资产：${item.name} ${item.endingStock}${item.spec || ''} / 单价${formatCurrency(item.unitPrice)}`),
    ].slice(0, 5),
    metrics: {
      rowCount: purchaseItems.length,
      totalAmount,
      sheetName: mainSheetName || 'Sheet1',
      sheetCount: workbook.SheetNames.length,
    },
    bodySheetMappings,
    structuredData: {
      kind: 'inventory-register',
      items: purchaseItems,
      totalAmount,
      mainSheetName,
      mainSheetItems: inventoryItems,
      topOutboundItems,
      zeroStockItems,
      fixedAssetSheetName,
      fixedAssets,
      highValueAssets,
      durableTools,
      sheets: [
        {
          sheetName: mainSheetName,
          sheetType: 'daily-register',
          itemCount: inventoryItems.length,
          purchaseItemCount: purchaseItems.length,
        },
        ...(fixedAssets.length
          ? [{
              sheetName: fixedAssetSheetName,
              sheetType: 'fixed-assets',
              itemCount: fixedAssets.length,
            }]
          : []),
      ],
    },
    note: `已识别为出入库/物料台账，提取 ${purchaseItems.length} 条采购金额记录，并追踪 ${inventoryItems.length} 条库存项目；${fixedAssets.length ? `另含 ${fixedAssets.length} 条固定资产记录，` : ''}识别对象为 ${[storeName, periodLabel].filter(Boolean).join(' ')}。`,
  };
}

function buildParsedDataSummary({
  sourceGroupKey = '',
  parserMode = '',
  metrics = {},
  previewText = '',
  storeName = '',
  periodLabel = '',
  expenseItems = [],
}) {
  const summary = [];

  if (sourceGroupKey === 'expense') {
    if (Number.isFinite(metrics.totalAmount) && metrics.totalAmount > 0) {
      summary.push(`识别到报销/费用总额 ${formatCurrency(metrics.totalAmount)}`);
    }

    if (metrics.pageCount) {
      summary.push(`提取了 ${metrics.pageCount} 页报销文本`);
    } else if (metrics.rowCount) {
      summary.push(`读取到 ${metrics.rowCount} 行费用明细`);
    }

    const items = expenseItems.length ? expenseItems : extractExpenseItems(previewText, 4);

    if (items.length) {
      summary.push(`抓取条目：${items.slice(0, 4).join('、')} 等`);
    }

    summary.push(`数据归口：已归类至「${getBodySheetSection(sourceGroupKey).label}」→ ${getBodySheetSection(sourceGroupKey).target}`);
    return summary;
  }

  if (sourceGroupKey === 'revenue') {
    if (metrics.recognizedRevenue) {
      summary.push(`提取核心指标：核算总实收 ${formatCurrency(metrics.recognizedRevenue)}`);
    }
    
    if (metrics.customerCount) {
      summary.push(`识别经营规模：消费人数 ${metrics.customerCount} 人`);
    }

    if (metrics.sheetName) {
      summary.push(`解析详情：已读取工作表 ${metrics.sheetName}`);
    }

    summary.push(`数据归口：已归类至「${getBodySheetSection(sourceGroupKey).label}」→ ${getBodySheetSection(sourceGroupKey).target}`);
    return summary;
  }

  if (sourceGroupKey === 'payroll') {
    if (metrics.rowCount) {
      summary.push(`识别到约 ${metrics.rowCount} 行薪酬人力数据`);
    }

    summary.push(`数据归口：已归类至「${getBodySheetSection(sourceGroupKey).label}」→ ${getBodySheetSection(sourceGroupKey).target}`);
    return summary;
  }

  if (parserMode === 'pdf-text' && metrics.pageCount) {
    summary.push(`提取了 ${metrics.pageCount} 页 PDF 文本`);
  }

  if (storeName || periodLabel) {
    summary.push(`识别对象：${[storeName, periodLabel].filter(Boolean).join(' ')}`);
  }

  summary.push(`建议归口：体质表「${getBodySheetSection(sourceGroupKey).label}」待复核`);
  return summary;
}

function extractMonthTotal(text = '') {
  const source = normalizeText(text);
  const monthSpecificMatches = [
    ...source.matchAll(/(?:\d{1,2}|[一二三四五六七八九十]+)\s*[月⽉]\s*总?合计\s*([0-9]+(?:\.[0-9]+)?)/g),
  ];

  if (monthSpecificMatches.length) {
    const match = monthSpecificMatches[monthSpecificMatches.length - 1];
    return Number(match[1]);
  }

  const totalMatches = [
    ...source.matchAll(/总?合计\s*([0-9]+(?:\.[0-9]+)?)/g),
  ];

  if (totalMatches.length) {
    const match = totalMatches[totalMatches.length - 1];
    return Number(match[1]);
  }

  return null;
}

function inferStoreName(source = '', fallback = '') {
  const text = normalizeText(source);
  const stores = ['华创店', '佳兆业店', '德思勤店', '凯德壹店', '梅溪湖店', '万象城店'];
  const matched = stores.find((store) => text.includes(store));
  return matched || fallback || '';
}

function inferPeriodLabel(source = '', fallback = '') {
  const text = normalizeText(source);
  const matched = text.match(/(?:(20\d{2})\s*年\s*)?(\d{1,2})\s*[月⽉]/);

  if (matched) {
    const year = matched[1] || String(fallback || '').match(/20\d{2}/)?.[0] || '';
    const month = Number(matched[2]);
    const inferred = year ? `${year}年${month}月` : `${month}月`;

    if (fallback && !/20\d{2}年/.test(inferred) && /20\d{2}年/.test(fallback)) {
      return fallback;
    }

    return inferred;
  }

  return fallback || '';
}

function enrichPeriodLabelFromTemplate(storeName = '', periodLabel = '') {
  const currentLabel = String(periodLabel || '').trim();

  if (!currentLabel || /20\d{2}年/.test(currentLabel)) {
    return currentLabel;
  }

  const catalog = getTemplatePlacementCatalog({ storeName, periodLabel: currentLabel });

  if (!catalog?.workbookName) {
    return currentLabel;
  }

  return inferPeriodLabel(catalog.workbookName, currentLabel) || currentLabel;
}

function buildParsedNote({
  sourceGroup,
  parserMode,
  pageCount = 0,
  sheetName = '',
  totalAmount = null,
  charCount = 0,
  storeName = '',
  periodLabel = '',
}) {
  const parts = [];

  if (sourceGroup?.key === 'expense') {
    parts.push('已识别为报销/费用明细');
  } else if (sourceGroup?.key === 'revenue') {
    parts.push('已识别为经营/营收类报表');
  } else if (sourceGroup?.key === 'payroll') {
    parts.push('已识别为工资/人力类台账');
  } else {
    parts.push('已识别为可解析源文件');
  }

  if (parserMode === 'pdf-text') {
    parts.push(`已提取 ${pageCount} 页 PDF 文本`);
  } else if (parserMode === 'spreadsheet') {
    parts.push(`已读取工作表 ${sheetName || 'Sheet1'}`);
  }

  if (storeName && periodLabel) {
    parts.push(`识别对象为 ${storeName} ${periodLabel}`);
  } else if (storeName) {
    parts.push(`识别对象为 ${storeName}`);
  }

  if (Number.isFinite(totalAmount)) {
    parts.push(`识别到总合计 ${formatCurrency(totalAmount)}`);
  }

  if (charCount >= 80 && parserMode === 'pdf-text') {
    parts.push(`正文提取 ${charCount} 字`);
  }

  return `${parts.join('，')}。`;
}

function buildReviewReason(extension) {
  if (extension === 'pdf') {
    return 'PDF 已接收，但当前未提取到足够文本，可能是扫描件；建议补充可复制文本版 PDF 或人工复核。';
  }

  if (REVIEW_EXTENSIONS.has(extension)) {
    return 'Word 文件已接收，但当前仅作为辅助说明材料，不直接参与核心财务字段提取。';
  }

  return '文件已接收，但当前结构暂不稳定，建议人工复核。';
}

function readSpreadsheetPreview(filePath) {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheetName = (workbook.SheetNames || [])
    .map((name) => ({
      name,
      rowCount: getSheetRows(workbook, name).length,
    }))
    .sort((left, right) => right.rowCount - left.rowCount)[0]?.name;

  if (!sheetName) {
    throw new Error('Excel 文件未找到可读取的工作表。');
  }

  const rows = getSheetRows(workbook, sheetName);

  const previewLines = rows
    .slice(0, 12)
    .map((row) =>
      (Array.isArray(row) ? row : [])
        .map((cell) => String(cell || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim(),
    )
    .filter(Boolean)
    .slice(0, 5);

  return {
    sheetName,
    rowCount: rows.length,
    previewLines,
    text: previewLines.join('\n'),
  };
}

async function readPdfPreview(filePath) {
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });

  try {
    const result = await parser.getText();
    const text = normalizeText(result.text || '');

    return {
      pageCount: Number(result.total || 0),
      text,
      previewLines: extractPreviewLines(text, 6),
      charCount: text.length,
    };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function parseSourceFile(filePath, options = {}) {
  const originalName = options.originalName || path.basename(filePath);
  const extension = getExtension(originalName);
  const selectedStore = options.storeName || '';
  const selectedMonth = options.periodLabel || '';

  if (DIRECT_PARSE_EXTENSIONS.has(extension)) {
    try {
      const workbook = XLSX.readFile(filePath, { raw: false });
      const bodyTableExtractMeta = findBodyTableExtractSheet(workbook);

      if (bodyTableExtractMeta) {
        return parseBodyTableExtractWorkbook(filePath, {
          originalName,
          storeName: selectedStore,
          periodLabel: selectedMonth,
          workbook,
          sheetMeta: bodyTableExtractMeta,
        });
      }

      if (/营业|营收|收银|业绩|经营日报|经营月报|日报/i.test(normalizeText(originalName))) {
        try {
          return parseRevenueWorkbook(filePath, {
            originalName,
            storeName: selectedStore,
            periodLabel: selectedMonth,
          });
        } catch (revenueError) {
          console.warn(`[Parser] Revenue workbook specific parsing failed for ${originalName}:`, revenueError.message);
          // Fall through to generic spreadsheet parse
        }
      }

      if (/出入库|库存|盘点|申购|物料/i.test(normalizeText(originalName))) {
        try {
          return parseDetailedInventoryWorkbook(filePath, {
            originalName,
            storeName: selectedStore,
            periodLabel: selectedMonth,
          });
        } catch (inventoryError) {
          console.warn(`[Parser] Inventory workbook specific parsing failed for ${originalName}:`, inventoryError.message);
          // Fall through to generic spreadsheet parse
        }
      }

      try {
        const expenseSheetMeta = findBestExpenseWorkbookSheet(workbook);

        if (
          expenseSheetMeta &&
          (
            /报销|费用|支出|采购|发票|回单|流水|明细/i.test(normalizeText(originalName)) ||
            expenseSheetMeta.header.score >= 8
          )
        ) {
          return await parseExpenseWorkbook(filePath, {
            originalName,
            storeName: selectedStore,
            periodLabel: selectedMonth,
            workbook,
            sheetMeta: expenseSheetMeta,
          });
        }
      } catch (expenseWorkbookError) {
        console.warn(`[Parser] Expense workbook specific parsing failed for ${originalName}:`, expenseWorkbookError.message);
        // Fall through to generic spreadsheet parse
      }

      const preview = readSpreadsheetPreview(filePath);

      const sourceGroup = detectSourceGroup(originalName, preview.text);
      const bodySheetSection = getBodySheetSection(sourceGroup?.key);
      const storeName = inferStoreName(`${originalName}\n${preview.text}`, selectedStore);
      const periodLabel = inferPeriodLabel(`${originalName}\n${preview.text}`, selectedMonth);

      let totalAmount = 0;
      let expenseItems = [];

      if (sourceGroup?.key === 'expense') {
        const workbook = XLSX.readFile(filePath, { raw: false });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, blankrows: false });
        
        totalAmount = sumExpenseFromRows(rows);
        expenseItems = extractExpenseItemsFromRows(rows, 4);
      }

      const parsedDataSummary = buildParsedDataSummary({
        sourceGroupKey: sourceGroup?.key || '',
        parserMode: 'spreadsheet',
        metrics: {
          rowCount: preview.rowCount,
          sheetName: preview.sheetName,
          totalAmount: totalAmount || null,
        },
        previewText: preview.text,
        storeName,
        periodLabel,
        expenseItems,
      });

      return {
        fileName: originalName,
        extension,
        status: 'parsed',
        parserMode: 'spreadsheet',
        sourceGroupKey: sourceGroup?.key || '',
        sourceGroupLabel: sourceGroup?.label || '',
        storeName,
        periodLabel,
        bodySheetSection,
        parsedDataSummary,
        previewLines: preview.previewLines,
        metrics: {
          rowCount: preview.rowCount,
          sheetName: preview.sheetName,
          totalAmount: totalAmount || null,
        },
        note: buildParsedNote({
          sourceGroup,
          parserMode: 'spreadsheet',
          sheetName: preview.sheetName,
          totalAmount: totalAmount || null,
          storeName,
          periodLabel,
        }),
      };
    } catch (error) {
      const sourceGroup = detectSourceGroup(originalName);

      if (/password-protected/i.test(String(error.message || '')) || /加密|受保护/.test(String(error.message || ''))) {
        const bodySheetSection = getBodySheetSection(sourceGroup?.key);

        return {
          fileName: originalName,
          extension,
          status: 'review',
          parserMode: 'spreadsheet',
          sourceGroupKey: sourceGroup?.key || '',
          sourceGroupLabel: sourceGroup?.label || '',
          storeName: selectedStore,
          periodLabel: selectedMonth,
          bodySheetSection,
          parsedDataSummary: [
            '当前 Excel 已加密，暂时无法直接抽取明细字段。',
            `建议先归入体质表「${bodySheetSection.label}」待复核`,
          ],
          previewLines: [],
          metrics: {},
          reason: 'Excel 已加密或受保护，请提供可读取版本或密码后再解析。',
        };
      }

      throw error;
    }
  }

  if (extension === 'pdf') {
    const preview = await readPdfPreview(filePath);
    const sourceGroup = detectSourceGroup(originalName, preview.text);
    const bodySheetSection = getBodySheetSection(sourceGroup?.key);
    const storeName = inferStoreName(`${originalName}\n${preview.text}`, selectedStore);
    const periodLabel = inferPeriodLabel(`${originalName}\n${preview.text}`, selectedMonth);
    const totalAmount = extractMonthTotal(preview.text);
    const expenseEntries = buildExpenseEntries(preview.text).map((entry) => ({
      ...entry,
      name: normalizeExpenseAlias(sanitizeSourceItemName(entry.name)),
    }));
    const bodySheetMappings = buildExpenseBodySheetMappings(expenseEntries, {
      storeName,
      periodLabel,
    });

    if (preview.charCount < 20) {
      return {
        fileName: originalName,
        extension,
        status: 'review',
        parserMode: 'pdf-text',
        sourceGroupKey: sourceGroup?.key || '',
        sourceGroupLabel: sourceGroup?.label || '',
        storeName,
        periodLabel,
        bodySheetSection,
        parsedDataSummary: [
          '当前 PDF 可接收，但文本提取不足，建议补充文本版 PDF 或人工复核。',
          `建议先归入体质表「${bodySheetSection.label}」待复核`,
        ],
        previewLines: [],
        metrics: {
          pageCount: preview.pageCount,
          charCount: preview.charCount,
        },
        reason: buildReviewReason(extension),
      };
    }

    return {
      fileName: originalName,
      extension,
      status: 'parsed',
      parserMode: 'pdf-text',
      sourceGroupKey: sourceGroup?.key || '',
      sourceGroupLabel: sourceGroup?.label || '',
      storeName,
      periodLabel,
      bodySheetSection,
      parsedDataSummary: buildParsedDataSummary({
        sourceGroupKey: sourceGroup?.key || '',
        parserMode: 'pdf-text',
        metrics: {
          pageCount: preview.pageCount,
          charCount: preview.charCount,
          totalAmount,
        },
        previewText: preview.text,
        storeName,
        periodLabel,
      }),
      previewLines: preview.previewLines,
      metrics: {
        pageCount: preview.pageCount,
        charCount: preview.charCount,
        totalAmount,
      },
      bodySheetMappings,
      structuredData: {
        kind: 'expense-pdf',
        totalAmount,
        items: expenseEntries,
        topItems: [...expenseEntries]
          .sort((left, right) => right.amount - left.amount)
          .slice(0, 8),
        bodySheetMappings,
      },
      note: buildParsedNote({
        sourceGroup,
        parserMode: 'pdf-text',
        pageCount: preview.pageCount,
        totalAmount,
        charCount: preview.charCount,
        storeName,
        periodLabel,
      }),
    };
  }

  if (REVIEW_EXTENSIONS.has(extension)) {
    const sourceGroup = detectSourceGroup(originalName);
    const bodySheetSection = getBodySheetSection(sourceGroup?.key);

    return {
      fileName: originalName,
      extension,
      status: 'review',
      parserMode: 'document',
      sourceGroupKey: sourceGroup?.key || '',
      sourceGroupLabel: sourceGroup?.label || '',
      storeName: selectedStore,
      periodLabel: selectedMonth,
      bodySheetSection,
      parsedDataSummary: [
        '当前先接收为辅助说明材料，不直接抽取核心财务字段。',
        `建议先归入体质表「${bodySheetSection.label}」待复核`,
      ],
      previewLines: [],
      metrics: {},
      reason: buildReviewReason(extension),
    };
  }

  return {
    fileName: originalName,
    extension,
    status: 'unsupported',
    parserMode: 'unsupported',
    sourceGroupKey: '',
    sourceGroupLabel: '',
    storeName: selectedStore,
    periodLabel: selectedMonth,
    bodySheetSection: getBodySheetSection(''),
    parsedDataSummary: [],
    previewLines: [],
    metrics: {},
    reason: extension
      ? `暂不支持 .${extension} 格式。`
      : '文件格式无法识别。',
  };
}

module.exports = {
  REQUIRED_SOURCE_GROUPS,
  parseSourceFile,
};
