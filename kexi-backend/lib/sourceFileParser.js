const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { PDFParse } = require('pdf-parse');

const DIRECT_PARSE_EXTENSIONS = new Set(['xls', 'xlsx', 'csv']);
const REVIEW_EXTENSIONS = new Set(['doc', 'docx']);

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

  const numeric = Number(
    String(value)
      .replace(/,/g, '')
      .replace(/%/g, '')
      .replace(/[^\d.-]/g, ''),
  );

  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeText(value = '') {
  const normalized = String(value || '')
    .normalize('NFKC')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();

  return [...normalized].map((character) => TEXT_REPLACEMENTS.get(character) || character).join('');
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
    minimumFractionDigits: 0,
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

  const ignored = new Set(['本页合计', '总合计', '1月总合计', '本月总合计']);
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

function buildParsedDataSummary({
  sourceGroupKey = '',
  parserMode = '',
  metrics = {},
  previewText = '',
  storeName = '',
  periodLabel = '',
}) {
  const summary = [];

  if (sourceGroupKey === 'expense') {
    if (Number.isFinite(metrics.totalAmount)) {
      summary.push(`识别到 ${periodLabel || '本期'}报销总额 ${formatCurrency(metrics.totalAmount)}`);
    }

    if (metrics.pageCount) {
      summary.push(`提取了 ${metrics.pageCount} 页报销明细文本`);
    }

    const expenseItems = extractExpenseItems(previewText, 5);

    if (expenseItems.length) {
      summary.push(`抓取到 ${expenseItems.join('、')} 等费用条目`);
    }

    summary.push(`将纳入体质表「${getBodySheetSection(sourceGroupKey).label}」`);
    return summary;
  }

  if (sourceGroupKey === 'revenue') {
    if (metrics.sheetName) {
      summary.push(`读取到工作表 ${metrics.sheetName}`);
    }

    if (metrics.rowCount) {
      summary.push(`可提取约 ${metrics.rowCount} 行经营数据`);
    }

    summary.push('可纳入营收、客单价、渠道结构、平台占比等指标');
    summary.push(`将纳入体质表「${getBodySheetSection(sourceGroupKey).label}」`);
    return summary;
  }

  if (sourceGroupKey === 'payroll') {
    if (metrics.sheetName) {
      summary.push(`读取到工资台账工作表 ${metrics.sheetName}`);
    }

    if (metrics.rowCount) {
      summary.push(`可提取约 ${metrics.rowCount} 行薪酬/人力数据`);
    }

    summary.push('可纳入工资、提成、绩效、人力成本与人效指标');
    summary.push(`将纳入体质表「${getBodySheetSection(sourceGroupKey).label}」`);
    return summary;
  }

  if (parserMode === 'pdf-text' && metrics.pageCount) {
    summary.push(`提取了 ${metrics.pageCount} 页 PDF 文本`);
  }

  if (storeName || periodLabel) {
    summary.push(`已识别对象：${[storeName, periodLabel].filter(Boolean).join(' ')}`);
  }

  summary.push(`建议先归入体质表「${getBodySheetSection(sourceGroupKey).label}」待复核`);
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
  const matched = text.match(/((?:20\d{2}\s*年)?\s*\d{1,2}\s*[月⽉])/);

  if (matched) {
    const inferred = matched[1].replace(/\s+/g, '');

    if (fallback && !/20\d{2}年/.test(inferred) && /20\d{2}年/.test(fallback)) {
      return fallback;
    }

    return inferred;
  }

  return fallback || '';
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
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('Excel 文件未找到可读取的工作表。');
  }

  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    raw: false,
    blankrows: false,
  });

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
      if (/营业|营收|收银|业绩|经营日报|经营月报|日报/i.test(normalizeText(originalName))) {
        return parseRevenueWorkbook(filePath, {
          originalName,
          storeName: selectedStore,
          periodLabel: selectedMonth,
        });
      }

      if (/出入库|库存|盘点|申购|物料/i.test(normalizeText(originalName))) {
        return parseInventoryWorkbook(filePath, {
          originalName,
          storeName: selectedStore,
          periodLabel: selectedMonth,
        });
      }
      const preview = readSpreadsheetPreview(filePath);
      const sourceGroup = detectSourceGroup(originalName, preview.text);
      const bodySheetSection = getBodySheetSection(sourceGroup?.key);
      const storeName = inferStoreName(`${originalName}\n${preview.text}`, selectedStore);
      const periodLabel = inferPeriodLabel(`${originalName}\n${preview.text}`, selectedMonth);
      const parsedDataSummary = buildParsedDataSummary({
        sourceGroupKey: sourceGroup?.key || '',
        parserMode: 'spreadsheet',
        metrics: {
          rowCount: preview.rowCount,
          sheetName: preview.sheetName,
        },
        previewText: preview.text,
        storeName,
        periodLabel,
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
        },
        note: buildParsedNote({
          sourceGroup,
          parserMode: 'spreadsheet',
          sheetName: preview.sheetName,
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
    const expenseEntries = buildExpenseEntries(preview.text);

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
      structuredData: {
        kind: 'expense-pdf',
        totalAmount,
        items: expenseEntries,
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
