const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ExcelJS = require('exceljs');

const WORKSPACE_DIR = path.resolve(__dirname, '..', '..');
const PARSING_EXPORTS_DIR = path.join(__dirname, '..', 'exports', 'parsing-drafts');
const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'uploads',
  'data',
  'exports',
]);

const DETAIL_RULES = [
  { detailName: '退费支出', patterns: [/退年卡|退费|退款/] },
  { detailName: '员工福利', patterns: [/员工聚餐|团建|员工福利|福利/] },
  { detailName: '话费及网络费', patterns: [/话费|网络费|宽带|wifi/i] },
  { detailName: '水', patterns: [/水费/] },
  { detailName: '电', patterns: [/水电费|电费/] },
  { detailName: '固定资产-空调', patterns: [/空调/] },
  { detailName: '新项目物料', patterns: [/采耳|新项目/] },
  { detailName: '低值耐耗品', patterns: [/帽子支架|支架|补水枪|低值|耐耗/] },
  { detailName: '办公费', patterns: [/红笔|圆珠笔|打印|价目表|办公/] },
  { detailName: '其他消耗品', patterns: [/热敏纸|订书针|订书机|计算器|鼠标垫|削笔刀|笔筒/] },
  { detailName: '洗衣液、柔顺剂', patterns: [/洗衣液|柔顺剂|洗衣粉/] },
  { detailName: '床单、口罩、手套', patterns: [/床单|口罩|手套|美容巾/] },
  { detailName: '工程维修及硬件配件', patterns: [/疏通|维修|硬件|配件/] },
  { detailName: '清洁产品', patterns: [/84|酒精|洗洁精|消毒液|酒精棉片/] },
  { detailName: '纸巾、棉签', patterns: [/纸巾|抽纸|棉签|纸巾/] },
  { detailName: '洗护道具', patterns: [/章鱼刷|经络刷|拨筋棒|牛角梳|头梳|洗护道具/] },
  {
    detailName: '附加值产品',
    patterns: [/护发精油|茶麸包|姜泥按摩膏|热敷眼罩|冷敷眼罩|发热眼罩|补水液|弹力素|助眠精油|玫瑰按摩膏/],
  },
  {
    detailName: 'B区小项产品',
    patterns: [/炎症护理液|头皮舒缓|净化液|头皮护理液|洁泥膏|防脱精华|白檀/],
  },
  { detailName: '赠送洗护产品', patterns: [/山茶控油蓬松洗发水|赠送洗护/] },
  { detailName: '洗护产品', patterns: [/洗发水|护发素|发膜|洗护产品/] },
  { detailName: '坚果、面包干、糖果', patterns: [/坚果|面包干|糖果|黑豆/] },
  { detailName: '茶饮杯子', patterns: [/茶杯|纸杯|杯子|杯盖|冷泡茶瓶/] },
  { detailName: '茶饮材料', patterns: [/茶饮材料|铁观音|枸杞|红糖|糖浆/] },
  { detailName: '袋子系列', patterns: [/包装袋|打包袋|纸袋|客用袋|盐包袋/] },
  { detailName: '木炭、固体酒精', patterns: [/木炭|固体酒精/] },
  { detailName: '杂费', patterns: [/装饰|杂费|节庆/] },
  { detailName: '餐费', patterns: [/餐费|餐|米粉|米线|粉|面|盒饭|早餐|午餐|晚餐/] },
  { detailName: '成本物料', patterns: [/发泥|干胶|隔水垫|姜|垃圾袋|物料/] },
];

function ensureParsingExportsDir() {
  fs.mkdirSync(PARSING_EXPORTS_DIR, { recursive: true });
}

function walkWorkbookCandidates(dir, collection = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) {
        return;
      }

      walkWorkbookCandidates(fullPath, collection);
      return;
    }

    if (entry.isFile() && /\.(xlsx|xls)$/i.test(entry.name) && !entry.name.startsWith('~$')) {
      collection.push(fullPath);
    }
  });

  return collection;
}

function safeText(value = '') {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'object' && value.text) {
    return String(value.text).replace(/\r/g, '').trim();
  }

  return String(value).replace(/\r/g, '').trim();
}

function normalizeKey(value = '') {
  return safeText(value)
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .replace(/[：:()（）\-_.]/g, '')
    .toLowerCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const numeric = Number(
    String(value)
      .replace(/,/g, '')
      .replace(/[^\d.-]/g, ''),
  );

  return Number.isFinite(numeric) ? numeric : 0;
}

function sanitizeDisplayName(value = '') {
  return safeText(value).replace(/[\\/:*?"<>|]+/g, '-');
}

function buildDisplayFileName(storeName = '', periodLabel = '') {
  const parts = [sanitizeDisplayName(periodLabel), sanitizeDisplayName(storeName)].filter(Boolean);
  return `${parts.join('')}体质表.xlsx` || '体质表.xlsx';
}

function scoreTemplateCandidate(filePath, { storeName = '', periodLabel = '' }) {
  const baseName = normalizeKey(path.basename(filePath));
  const relativePath = path.relative(WORKSPACE_DIR, filePath);
  let score = 0;

  if (baseName.includes(normalizeKey(storeName))) {
    score += 50;
  }

  if (baseName.includes(normalizeKey(periodLabel))) {
    score += 40;
  }

  if (baseName.includes('体质表')) {
    score += 30;
  }

  if (baseName.includes('xx')) {
    score -= 20;
  }

  if (relativePath.includes(`${path.sep}文件${path.sep}文件${path.sep}`)) {
    score += 10;
  }

  if (relativePath.includes(`${path.sep}来源${path.sep}`)) {
    score -= 100;
  }

  score -= relativePath.length / 1000;

  return score;
}

function resolveTemplateWorkbook({ storeName = '', periodLabel = '' }) {
  const candidates = walkWorkbookCandidates(WORKSPACE_DIR).filter((filePath) => {
    const baseName = normalizeKey(path.basename(filePath));
    return baseName.includes('体质表');
  });

  const exactCandidates = candidates
    .filter((filePath) => {
      const baseName = normalizeKey(path.basename(filePath));
      return (
        baseName.includes(normalizeKey(storeName)) &&
        baseName.includes(normalizeKey(periodLabel)) &&
        !baseName.includes('xx')
      );
    })
    .sort((left, right) =>
      scoreTemplateCandidate(right, { storeName, periodLabel }) -
      scoreTemplateCandidate(left, { storeName, periodLabel }),
    );

  if (exactCandidates.length) {
    return {
      filePath: exactCandidates[0],
      isReferenceWorkbook: true,
    };
  }

  const genericCandidates = candidates
    .filter((filePath) => normalizeKey(path.basename(filePath)).includes('xx'))
    .sort((left, right) =>
      scoreTemplateCandidate(right, { storeName, periodLabel }) -
      scoreTemplateCandidate(left, { storeName, periodLabel }),
    );

  if (genericCandidates.length) {
    return {
      filePath: genericCandidates[0],
      isReferenceWorkbook: false,
    };
  }

  return null;
}

function extractTemplateLayout(worksheet) {
  const detailRows = new Map();
  const groups = [];
  let currentGroup = null;

  for (let row = 8; row <= 65; row += 1) {
    const categoryLabel = safeText(worksheet.getCell(`A${row}`).value);
    const detailName = safeText(worksheet.getCell(`C${row}`).value);

    if (categoryLabel) {
      if (currentGroup) {
        currentGroup.endRow = row - 1;
        groups.push(currentGroup);
      }

      currentGroup = {
        summaryRow: row,
        startRow: row,
        endRow: 65,
        categoryLabel,
      };
    }

    if (detailName) {
      detailRows.set(normalizeKey(detailName), {
        row,
        detailName,
      });
    }
  }

  if (currentGroup) {
    groups.push(currentGroup);
  }

  return {
    detailRows,
    groups,
  };
}

function clearInputArea(worksheet) {
  ['B3', 'D3', 'F3', 'H3', 'B4', 'C4', 'I4', 'B5', 'D5', 'F5', 'H5', 'D68', 'D69', 'D70', 'D71', 'D72'].forEach((address) => {
    worksheet.getCell(address).value = null;
  });

  for (let row = 8; row <= 66; row += 1) {
    worksheet.getCell(`D${row}`).value = null;
    worksheet.getCell(`H${row}`).value = null;
    worksheet.getCell(`I${row}`).value = null;
  }

  worksheet.getCell('E67').value = null;
}

function createAccumulator() {
  return {
    revenue: null,
    details: new Map(),
    unresolved: [],
  };
}

function appendDetailAmount(accumulator, detailName, amount, evidence) {
  if (!detailName || !Number.isFinite(amount) || !amount) {
    return;
  }

  if (!accumulator.details.has(detailName)) {
    accumulator.details.set(detailName, {
      amount: 0,
      evidence: [],
    });
  }

  const current = accumulator.details.get(detailName);
  current.amount += amount;

  if (evidence) {
    current.evidence.push(evidence);
  }
}

function matchExpenseDetail(itemName = '') {
  const normalized = safeText(itemName);

  for (const rule of DETAIL_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(normalized))) {
      return rule.detailName;
    }
  }

  return '';
}

function mergeStructuredData(accumulator, parsedFiles = []) {
  parsedFiles.forEach((file) => {
    const structuredData = file?.structuredData || {};

    if (structuredData.kind === 'revenue-report') {
      accumulator.revenue = structuredData;
      return;
    }

    if (structuredData.kind === 'expense-pdf' || structuredData.kind === 'inventory-register') {
      (Array.isArray(structuredData.items) ? structuredData.items : []).forEach((item) => {
        const detailName = matchExpenseDetail(item.name);

        if (!detailName) {
          accumulator.unresolved.push(item.name);
          return;
        }

        appendDetailAmount(accumulator, detailName, toNumber(item.amount), item.name);
      });
    }
  });
}

function setCellFormula(worksheet, address, formula, result = 0) {
  worksheet.getCell(address).value = { formula, result };
}

function buildChannelText(revenue = {}) {
  const channels = revenue.channels || {};
  const walletChannel = toNumber(channels.walletChannel);
  const cashChannel = toNumber(channels.cashChannel);
  const meituanRevenue = toNumber(channels.meituanRevenue);
  const douyinRevenue = toNumber(channels.douyinRevenue);

  return `微信银联支付宝：${walletChannel.toFixed(2)} 现金：${cashChannel.toFixed(2)} 美团：${meituanRevenue.toFixed(2)} 抖音：${douyinRevenue.toFixed(2)}`;
}

function buildSummaryNote({ reviewFiles = [], failFiles = [], unresolvedItems = [] }) {
  const parts = [];

  if (reviewFiles.length) {
    parts.push(`待复核：${reviewFiles.map((file) => safeText(file.fileName)).filter(Boolean).join('、')}`);
  }

  if (failFiles.length) {
    parts.push(`未解析：${failFiles.map((file) => safeText(file.fileName)).filter(Boolean).join('、')}`);
  }

  if (unresolvedItems.length) {
    parts.push(`未自动归类：${[...new Set(unresolvedItems)].slice(0, 8).join('、')}`);
  }

  return parts.join('；');
}

function extractTitleSuffix(value = '') {
  const title = safeText(value);
  const match = title.match(/(成本控制体质检测表.*)$/);
  return match ? match[1] : '成本控制体质检测表';
}

function setWorkbookValues({
  worksheet,
  layout,
  storeName = '',
  periodLabel = '',
  parsedFiles = [],
  reviewFiles = [],
  failFiles = [],
}) {
  const accumulator = createAccumulator();
  mergeStructuredData(accumulator, parsedFiles);

  clearInputArea(worksheet);

  const revenue = accumulator.revenue || {};
  const titleSuffix = extractTitleSuffix(worksheet.getCell('A1').value);
  worksheet.getCell('A1').value = `珂溪头疗-${storeName || '门店'} ${periodLabel || ''}${titleSuffix}`;
  worksheet.getCell('B3').value = toNumber(revenue.customerCount);
  worksheet.getCell('D3').value = toNumber(revenue.recognizedRevenue || revenue.projectRevenue);
  worksheet.getCell('F3').value = toNumber(revenue.machineRevenue || revenue.recognizedRevenue);
  worksheet.getCell('H3').value = toNumber(revenue.savingsAmount);
  worksheet.getCell('B4').value = toNumber(revenue.grossRevenue || revenue.recognizedRevenue);
  worksheet.getCell('C4').value = buildChannelText(revenue);
  worksheet.getCell('I4').value = toNumber(revenue.projectRevenue || revenue.recognizedRevenue);
  worksheet.getCell('H5').value = toNumber(revenue.newMembers);

  for (const [detailName, payload] of accumulator.details.entries()) {
    const layoutRow = layout.detailRows.get(normalizeKey(detailName));

    if (!layoutRow) {
      accumulator.unresolved.push(detailName);
      continue;
    }

    worksheet.getCell(`D${layoutRow.row}`).value = Number(payload.amount.toFixed(2));

    if (payload.evidence.length) {
      worksheet.getCell(`H${layoutRow.row}`).value = [...new Set(payload.evidence)].slice(0, 8).join('、');
    }
  }

  worksheet.getCell('D22').value = {
    formula: 'ROUND(D3*0.06,4)',
    result: Number((toNumber(revenue.recognizedRevenue || revenue.projectRevenue) * 0.06).toFixed(4)),
  };

  layout.groups.forEach((group) => {
    const detailCells = `D${group.startRow}:D${group.endRow}`;
    const customerCount = toNumber(worksheet.getCell('B3').value);
    const recognizedRevenue = toNumber(worksheet.getCell('D3').value);
    const groupAmount = Array.from({ length: group.endRow - group.startRow + 1 }, (_, index) =>
      toNumber(worksheet.getCell(`D${group.startRow + index}`).value),
    ).reduce((sum, value) => sum + value, 0);

    setCellFormula(
      worksheet,
      `B${group.summaryRow}`,
      `IF(D3=0,0,SUM(${detailCells})/D3)`,
      recognizedRevenue > 0 ? groupAmount / recognizedRevenue : 0,
    );
    setCellFormula(
      worksheet,
      `G${group.summaryRow}`,
      `IF(B3=0,0,SUM(${detailCells})/B3)`,
      customerCount > 0 ? groupAmount / customerCount : 0,
    );

    for (let row = group.startRow; row <= group.endRow; row += 1) {
      const amount = toNumber(worksheet.getCell(`D${row}`).value);

      setCellFormula(
        worksheet,
        `E${row}`,
        `IF(B5=0,0,D${row}/B5)`,
        0,
      );
      setCellFormula(
        worksheet,
        `F${row}`,
        `IF(B3=0,0,D${row}/B3)`,
        customerCount > 0 ? amount / customerCount : 0,
      );
    }
  });

  const totalCost = Array.from({ length: 58 }, (_, index) =>
    toNumber(worksheet.getCell(`D${8 + index}`).value),
  ).reduce((sum, value) => sum + value, 0);
  const customerCount = toNumber(worksheet.getCell('B3').value);
  const recognizedRevenue = toNumber(worksheet.getCell('D3').value);
  const profit = recognizedRevenue - totalCost;

  setCellFormula(worksheet, 'D66', 'SUM(D8:D65)', totalCost);
  setCellFormula(worksheet, 'B66', 'IF(D3=0,0,D66/D3)', recognizedRevenue > 0 ? totalCost / recognizedRevenue : 0);
  setCellFormula(worksheet, 'F66', 'IF(B3=0,0,D66/B3)', customerCount > 0 ? totalCost / customerCount : 0);
  setCellFormula(worksheet, 'G66', 'IF(B3=0,0,D66/B3)', customerCount > 0 ? totalCost / customerCount : 0);
  setCellFormula(worksheet, 'B5', 'D66', totalCost);
  setCellFormula(worksheet, 'D5', 'IF(B3=0,0,D3/B3)', customerCount > 0 ? recognizedRevenue / customerCount : 0);
  setCellFormula(worksheet, 'F5', 'IF(B3=0,0,B5/B3)', customerCount > 0 ? totalCost / customerCount : 0);
  setCellFormula(worksheet, 'D68', 'D3', recognizedRevenue);
  setCellFormula(worksheet, 'D69', 'D66', totalCost);
  setCellFormula(worksheet, 'D70', 'D22+D23', toNumber(worksheet.getCell('D22').value?.result || worksheet.getCell('D22').value) + toNumber(worksheet.getCell('D23').value));
  setCellFormula(worksheet, 'D71', 'D68-D69', profit);
  setCellFormula(worksheet, 'D72', 'IF(D68=0,0,D71/D68)', recognizedRevenue > 0 ? profit / recognizedRevenue : 0);

  const summaryNote = buildSummaryNote({
    reviewFiles,
    failFiles,
    unresolvedItems: accumulator.unresolved,
  });

  worksheet.getCell('E67').value = summaryNote || '';
}

async function createParsingDraftWorkbook({
  storeName = '',
  periodLabel = '',
  parsedFiles = [],
  reviewFiles = [],
  failFiles = [],
  missingFiles = [],
}) {
  ensureParsingExportsDir();

  const template = resolveTemplateWorkbook({ storeName, periodLabel });

  if (!template?.filePath) {
    throw new Error('未找到可用的体质表模板文件。');
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(template.filePath);
  workbook.calcProperties.fullCalcOnLoad = true;

  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('体质表模板未找到工作表。');
  }

  const layout = extractTemplateLayout(worksheet);

  setWorkbookValues({
    worksheet,
    layout,
    storeName,
    periodLabel,
    parsedFiles: Array.isArray(parsedFiles) ? parsedFiles : [],
    reviewFiles: Array.isArray(reviewFiles) ? reviewFiles : [],
    failFiles: Array.isArray(failFiles) ? failFiles : [],
    missingFiles: Array.isArray(missingFiles) ? missingFiles : [],
  });

  const token = `${Date.now()}-${crypto.randomUUID()}.xlsx`;
  const filePath = path.join(PARSING_EXPORTS_DIR, token);
  const downloadFileName = buildDisplayFileName(storeName, periodLabel);

  await workbook.xlsx.writeFile(filePath);

  return {
    token,
    filePath,
    downloadFileName,
  };
}

function resolveParsingExportPath(token = '') {
  const safeToken = path.basename(String(token || '').trim());

  if (!safeToken) {
    return null;
  }

  const filePath = path.join(PARSING_EXPORTS_DIR, safeToken);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return filePath;
}

module.exports = {
  createParsingDraftWorkbook,
  resolveParsingExportPath,
};
