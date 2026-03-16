const path = require('path');
const XLSX = require('xlsx');
const {
  cleanText,
  formatPeriodLabel,
  inferPeriod,
  resolveStore,
} = require('./financialConstants');

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

function toPercent(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const text = String(value);
  const numeric = toNumber(text);
  return text.includes('%') ? numeric / 100 : numeric;
}

function parseChannelBreakdown(text) {
  const source = cleanText(text);
  const matches = [
    ...source.matchAll(
      /(微信银联支付宝|现金|美团|抖音)\s*[：:]\s*([-\d,.]+)/g,
    ),
  ];

  return matches.reduce((channels, match) => {
    channels[match[1]] = toNumber(match[2]);
    return channels;
  }, {});
}

function sanitizeCategoryName(value) {
  return cleanText(value).replace(/[：:]+$/g, '');
}

function sanitizeMetricLabel(value) {
  return cleanText(value).replace(/[：:]+$/g, '');
}

function isNumericLikeValue(value) {
  const text = cleanText(value);

  if (!text) {
    return false;
  }

  return /^-?[\d,.]+%?$/.test(text);
}

function inferMetricValueType(label, rawValue) {
  if (String(rawValue || '').includes('%')) {
    return 'percent';
  }

  if (/(利润率|占比|比例|比重)/.test(label)) {
    return 'percent';
  }

  if (/(客数|会员数|人数)/.test(label)) {
    return 'count';
  }

  if (/(实收|金额|开支|成本|费用|利润|客单价|客成本|管理费)/.test(label)) {
    return 'amount';
  }

  return 'number';
}

function extractMetricPairsFromRow(row, rowIndex, source) {
  const metrics = [];
  const maxValueOffset = source === 'footer' ? 4 : 2;

  for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
    const label = sanitizeMetricLabel(row[columnIndex]);

    if (!label) {
      continue;
    }

    let valueIndex = -1;

    for (
      let cursor = columnIndex + 1;
      cursor < row.length && cursor <= columnIndex + maxValueOffset;
      cursor += 1
    ) {
      const candidate = cleanText(row[cursor]);

      if (!candidate) {
        continue;
      }

      if (!isNumericLikeValue(candidate)) {
        break;
      }

      valueIndex = cursor;
      break;
    }

    if (valueIndex === -1) {
      continue;
    }

    const rawValue = cleanText(row[valueIndex]);
    const valueType = inferMetricValueType(label, rawValue);
    const numericValue = valueType === 'percent' ? toPercent(rawValue) : toNumber(rawValue);

    metrics.push({
      label,
      rawValue,
      numericValue,
      valueType,
      source,
      rowIndex,
      columnIndex,
      valueColumnIndex: valueIndex,
    });

    columnIndex = valueIndex;
  }

  return metrics;
}

function extractSummaryMetrics(rows) {
  const detailIndex = rows.findIndex((row) =>
    sanitizeMetricLabel(row[0]).startsWith('明细数据'),
  );
  const footerIndex = rows.findIndex((row) =>
    sanitizeMetricLabel(row[0]).startsWith('总结'),
  );
  const headerEnd = detailIndex === -1 ? 8 : detailIndex;
  const headerMetrics = rows
    .slice(0, headerEnd)
    .flatMap((row, rowIndex) => extractMetricPairsFromRow(row, rowIndex, 'header'));
  const footerMetrics =
    footerIndex === -1
      ? []
      : rows
          .slice(footerIndex + 1, footerIndex + 8)
          .flatMap((row, offset) =>
            extractMetricPairsFromRow(row, footerIndex + 1 + offset, 'footer'),
          );

  return [...headerMetrics, ...footerMetrics];
}

function getMetricValue(metrics, matchers, options = {}) {
  const tests = Array.isArray(matchers) ? matchers : [matchers];
  const source = options.source || null;
  const matches = metrics.filter((metric) => {
    if (source && metric.source !== source) {
      return false;
    }

    return tests.some((matcher) =>
      matcher instanceof RegExp
        ? matcher.test(metric.label)
        : metric.label.includes(String(matcher)),
    );
  });
  const selected = matches[matches.length - 1];

  return selected ? selected.numericValue : 0;
}

function extractHeaderContext(rows) {
  const header = cleanText(rows[0]?.[0]);
  const filename = path.basename(rows.__fileName || '');
  const store = resolveStore(header) || resolveStore(filename);
  const period = inferPeriod(header) || inferPeriod(filename);

  return { header, store, period };
}

function parseSummary(rows) {
  const summaryMetrics = extractSummaryMetrics(rows);
  const channels = rows
    .slice(0, 8)
    .reduce((collection, row) => {
      row.forEach((cell) => {
        const text = cleanText(cell);

        if (/(微信银联支付宝|美团|抖音|现金)/.test(text)) {
          Object.assign(collection, parseChannelBreakdown(text));
        }
      });

      return collection;
    }, {});

  const summary = {
    customerCount: getMetricValue(summaryMetrics, /^月总客数/),
    recognizedRevenue:
      getMetricValue(summaryMetrics, /^核算总实收/) ||
      getMetricValue(summaryMetrics, /^月度总实收/, { source: 'footer' }),
    grossRevenue: getMetricValue(summaryMetrics, /^月度总实收/, {
      source: 'header',
    }),
    savingsAmount: getMetricValue(summaryMetrics, /^储蓄金额/),
    totalCost:
      getMetricValue(summaryMetrics, /^月总开支/) ||
      getMetricValue(summaryMetrics, /^月度总开支/),
    avgTicket: getMetricValue(summaryMetrics, /^月平均客单价/),
    avgCustomerCost: getMetricValue(summaryMetrics, /^月平均客成本/),
    newMembers: getMetricValue(summaryMetrics, /^新增会员数/),
    projectRevenue: getMetricValue(summaryMetrics, /^项目实收/),
    managementFee: getMetricValue(summaryMetrics, /^管理公司费/),
    profit: getMetricValue(summaryMetrics, /^月报表利润/),
    profitMargin:
      getMetricValue(summaryMetrics, /^利润率$/) ||
      getMetricValue(summaryMetrics, /^月报表利润率/),
    machineRevenue: getMetricValue(summaryMetrics, /^机机乐总实收/),
    channels,
  };

  summary.profit =
    getMetricValue(summaryMetrics, [/^月报表利润$/, /^净利润$/, /^利润$/]) ||
    summary.profit;

  summary.profitMargin =
    getMetricValue(summaryMetrics, [
      /^利润率$/,
      /^月报表利润率$/,
      /^净利率$/,
      /^月报表净利率$/,
    ]) || summary.profitMargin;

  if (!summary.profit) {
    summary.profit = summary.recognizedRevenue - summary.totalCost;
  }

  if (!summary.profitMargin && summary.recognizedRevenue > 0) {
    summary.profitMargin = summary.profit / summary.recognizedRevenue;
  }

  if (!summary.grossRevenue) {
    summary.grossRevenue = summary.recognizedRevenue;
  }

  summary.profit = Math.round((summary.profit + Number.EPSILON) * 100) / 100;
  summary.profitMargin =
    Math.round((summary.profitMargin + Number.EPSILON) * 10000) / 10000;

  return {
    summary,
    summaryMetrics,
  };
}

function parseCategories(rows, totalCost) {
  const headerIndex = rows.findIndex(
    (row) => cleanText(row[0]) === '开支项分类汇总金额',
  );

  if (headerIndex === -1) {
    return {
      categories: [],
      sectionMeta: {
        headerIndex: -1,
        endIndex: -1,
        parsedCategoryCount: 0,
        parsedItemCount: 0,
      },
    };
  }

  const categories = [];
  let currentCategory = null;
  let endIndex = rows.length;

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const firstCell = cleanText(row[0]);

    if (firstCell.startsWith('合计')) {
      endIndex = rowIndex;
      break;
    }

    if (firstCell.startsWith('总结')) {
      endIndex = rowIndex;
      break;
    }

    if (firstCell) {
      currentCategory = {
        name: sanitizeCategoryName(firstCell),
        reportedRatio: toPercent(row[1]),
        allocationCostPerCustomer: toNumber(row[6]),
        items: [],
      };
      categories.push(currentCategory);
    }

    if (!currentCategory) {
      continue;
    }

    const itemName = cleanText(row[2]);

    if (!itemName) {
      continue;
    }

    currentCategory.items.push({
      name: itemName,
      amount: toNumber(row[3]),
      categoryShare: toPercent(row[4]),
      costPerCustomer: toNumber(row[5]),
      notes: cleanText(row[7]),
      previousMonthHint: cleanText(row[8]),
      sourceRowIndex: rowIndex,
    });
  }

  const normalizedCategories = categories.map((category) => {
    const amount = category.items.reduce((sum, item) => sum + item.amount, 0);

    return {
      ...category,
      amount,
      ratio: totalCost > 0 ? amount / totalCost : 0,
      items: category.items.sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount)),
    };
  });

  return {
    categories: normalizedCategories,
    sectionMeta: {
      headerIndex,
      endIndex,
      parsedCategoryCount: normalizedCategories.length,
      parsedItemCount: normalizedCategories.reduce(
        (sum, category) => sum + category.items.length,
        0,
      ),
    },
  };
}

function parseWorkbook(filePath, options = {}) {
  const workbook = XLSX.readFile(filePath, { raw: false });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    defval: '',
    raw: false,
  });
  rows.__fileName = options.originalName || path.basename(filePath);

  const context = extractHeaderContext(rows);
  const store = resolveStore(options.storeId || options.storeName) || context.store;
  const period = options.period || context.period;

  if (!store) {
    throw new Error('无法从文件名或表头识别门店，请在上传时手动选择门店。');
  }

  if (!period) {
    throw new Error(
      '无法从文件名或表头识别月份，请确认文件名包含“2026年1月”这类时间信息。',
    );
  }

  const { summary, summaryMetrics } = parseSummary(rows);
  const { categories, sectionMeta } = parseCategories(rows, summary.totalCost);
  const channelEntries = Object.entries(summary.channels);
  const platformRevenue =
    (summary.channels['美团'] || 0) + (summary.channels['抖音'] || 0);
  const channelTotal = channelEntries.reduce((sum, [, value]) => sum + value, 0);
  const platformRevenueBase = channelTotal || summary.grossRevenue || summary.recognizedRevenue;
  const lineItems = categories.flatMap((category) =>
    category.items.map((item) => ({
      categoryName: category.name,
      ...item,
    })),
  );

  return {
    id: `${store.id}-${period}`,
    storeId: store.id,
    storeName: store.name,
    period,
    periodLabel: formatPeriodLabel(period),
    sheetName,
    sourceFileName: options.originalName || path.basename(filePath),
    sourceRelativePath: options.sourceRelativePath || '',
    uploadedAt: options.uploadedAt || new Date().toISOString(),
    headerTitle: context.header,
    summary: {
      ...summary,
      platformRevenue,
      platformRevenueShare:
        platformRevenueBase > 0 ? platformRevenue / platformRevenueBase : 0,
      channelTotal,
    },
    channels: channelEntries.map(([name, value]) => ({
      name,
      value,
      share: channelTotal > 0 ? value / channelTotal : 0,
    })),
    summaryMetrics,
    categories,
    lineItems,
    parseAudit: {
      workbookRowCount: rows.length,
      parsedSummaryMetricCount: summaryMetrics.length,
      ...sectionMeta,
    },
    topCostItems: [...lineItems]
      .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
      .slice(0, 12),
  };
}

module.exports = {
  parseWorkbook,
};
