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
  const matches = [...source.matchAll(/(微信银联支付宝|现金|美团|抖音)\s*[：:]\s*([-\d,.]+)/g)];

  return matches.reduce((channels, match) => {
    channels[match[1]] = toNumber(match[2]);
    return channels;
  }, {});
}

function sanitizeCategoryName(value) {
  return cleanText(value).replace(/[：:]+$/g, '');
}

function extractHeaderContext(rows) {
  const header = cleanText(rows[0]?.[0]);
  const filename = path.basename(rows.__fileName || '');
  const store = resolveStore(header) || resolveStore(filename);
  const period = inferPeriod(header) || inferPeriod(filename);

  return { header, store, period };
}

function parseSummary(rows) {
  const summary = {
    customerCount: 0,
    recognizedRevenue: 0,
    grossRevenue: 0,
    savingsAmount: 0,
    totalCost: 0,
    avgTicket: 0,
    avgCustomerCost: 0,
    newMembers: 0,
    projectRevenue: 0,
    managementFee: 0,
    profit: 0,
    profitMargin: 0,
    channels: {},
  };

  for (const row of rows.slice(0, 8)) {
    const cells = row.map(cleanText);

    cells.forEach((cell, index) => {
      if (!cell) {
        return;
      }

      if (cell.startsWith('月总客数')) {
        summary.customerCount = toNumber(row[index + 1]);
      } else if (cell.startsWith('核算总实收')) {
        summary.recognizedRevenue = toNumber(row[index + 1]);
      } else if (cell.startsWith('储蓄金额')) {
        summary.savingsAmount = toNumber(row[index + 1]);
      } else if (cell.startsWith('月度总实收')) {
        summary.grossRevenue = toNumber(row[index + 1]);
      } else if (cell.startsWith('月总开支')) {
        summary.totalCost = toNumber(row[index + 1]);
      } else if (cell.startsWith('月平均客单价')) {
        summary.avgTicket = toNumber(row[index + 1]);
      } else if (cell.startsWith('月平均客成本')) {
        summary.avgCustomerCost = toNumber(row[index + 1]);
      } else if (cell.startsWith('新增会员数')) {
        summary.newMembers = toNumber(row[index + 1]);
      } else if (cell.includes('微信银联支付宝')) {
        summary.channels = parseChannelBreakdown(cell);
      } else if (cell.includes('项目实收')) {
        summary.projectRevenue = toNumber(row[index + 2] ?? row[index + 1]);
      }
    });
  }

  for (const row of rows) {
    const label = cleanText(row[0]);

    if (label.startsWith('月度总实收')) {
      summary.recognizedRevenue = toNumber(row[3] ?? row[1]) || summary.recognizedRevenue;
    } else if (label.startsWith('月度总开支')) {
      summary.totalCost = toNumber(row[3] ?? row[1]) || summary.totalCost;
    } else if (label.startsWith('管理公司费')) {
      summary.managementFee = toNumber(row[3] ?? row[1]);
    } else if (label.startsWith('月报表利润率')) {
      summary.profitMargin = toPercent(row[3] ?? row[1]);
    } else if (label.startsWith('月报表利润')) {
      summary.profit = toNumber(row[3] ?? row[1]);
    }
  }

  if (!summary.profit) {
    summary.profit = summary.recognizedRevenue - summary.totalCost;
  }

  if (!summary.profitMargin && summary.recognizedRevenue > 0) {
    summary.profitMargin = summary.profit / summary.recognizedRevenue;
  }

  if (!summary.grossRevenue) {
    summary.grossRevenue = summary.recognizedRevenue;
  }

  return summary;
}

function parseCategories(rows, totalCost) {
  const headerIndex = rows.findIndex((row) => cleanText(row[0]) === '开支项分类汇总金额');

  if (headerIndex === -1) {
    return [];
  }

  const categories = [];
  let currentCategory = null;

  for (const row of rows.slice(headerIndex + 1)) {
    const firstCell = cleanText(row[0]);

    if (firstCell.startsWith('合计')) {
      break;
    }

    if (firstCell.startsWith('总结')) {
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
    });
  }

  return categories.map((category) => {
    const amount = category.items.reduce((sum, item) => sum + item.amount, 0);

    return {
      ...category,
      amount,
      ratio: totalCost > 0 ? amount / totalCost : 0,
      items: category.items.sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount)),
    };
  });
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
    throw new Error('无法从文件名或表头识别月份，请确保文件名包含“2026年1月”这类时间信息。');
  }

  const summary = parseSummary(rows);
  const categories = parseCategories(rows, summary.totalCost);
  const channelEntries = Object.entries(summary.channels);
  const platformRevenue =
    (summary.channels['美团'] || 0) + (summary.channels['抖音'] || 0);
  const channelTotal = channelEntries.reduce((sum, [, value]) => sum + value, 0);
  const platformRevenueBase = channelTotal || summary.grossRevenue || summary.recognizedRevenue;

  return {
    id: `${store.id}-${period}`,
    storeId: store.id,
    storeName: store.name,
    period,
    periodLabel: formatPeriodLabel(period),
    sheetName,
    sourceFileName: options.originalName || path.basename(filePath),
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
    categories,
    topCostItems: categories
      .flatMap((category) =>
        category.items.map((item) => ({
          categoryName: category.name,
          ...item,
        })),
      )
      .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
      .slice(0, 12),
  };
}

module.exports = {
  parseWorkbook,
};
