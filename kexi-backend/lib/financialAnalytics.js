const { STORE_REGISTRY, formatPeriodLabel, sortPeriods } = require('./financialConstants');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sumBy(items, selector) {
  return items.reduce((sum, item) => sum + selector(item), 0);
}

function calculateHealthScore(summary) {
  const marginScore = clamp((summary.profitMargin || 0) / 0.35, 0, 1) * 42;
  const unitEconomics =
    summary.avgTicket > 0 ? (summary.avgTicket - summary.avgCustomerCost) / summary.avgTicket : 0;
  const unitScore = clamp(unitEconomics / 0.45, 0, 1) * 28;
  const memberRate =
    summary.customerCount > 0 ? (summary.newMembers || 0) / summary.customerCount : 0;
  const memberScore = clamp(memberRate / 0.18, 0, 1) * 15;
  const platformScore = clamp(1 - (summary.platformRevenueShare || 0) / 0.75, 0, 1) * 15;

  return Math.round(marginScore + unitScore + memberScore + platformScore);
}

function createEmptySummary() {
  return {
    revenue: 0,
    grossRevenue: 0,
    cost: 0,
    profit: 0,
    profitMargin: 0,
    customerCount: 0,
    avgTicket: 0,
    avgCustomerCost: 0,
    newMembers: 0,
    savingsAmount: 0,
    projectRevenue: 0,
    managementFee: 0,
    platformRevenue: 0,
    platformRevenueShare: 0,
    channelTotal: 0,
    healthScore: 0,
  };
}

function mergeSummaries(reports) {
  const base = createEmptySummary();
  const revenue = sumBy(reports, (report) => report.summary.recognizedRevenue);
  const cost = sumBy(reports, (report) => report.summary.totalCost);
  const profit = sumBy(reports, (report) => report.summary.profit);
  const customerCount = sumBy(reports, (report) => report.summary.customerCount);
  const platformRevenue = sumBy(reports, (report) => report.summary.platformRevenue);

  base.revenue = round(revenue);
  base.grossRevenue = round(sumBy(reports, (report) => report.summary.grossRevenue));
  base.cost = round(cost);
  base.profit = round(profit);
  base.customerCount = Math.round(customerCount);
  base.newMembers = Math.round(sumBy(reports, (report) => report.summary.newMembers));
  base.savingsAmount = round(sumBy(reports, (report) => report.summary.savingsAmount));
  base.projectRevenue = round(sumBy(reports, (report) => report.summary.projectRevenue));
  base.managementFee = round(sumBy(reports, (report) => report.summary.managementFee));
  base.platformRevenue = round(platformRevenue);
  base.channelTotal = round(sumBy(reports, (report) => report.summary.channelTotal));
  base.profitMargin = revenue > 0 ? round(profit / revenue, 4) : 0;
  base.avgTicket = customerCount > 0 ? round(revenue / customerCount, 2) : 0;
  base.avgCustomerCost = customerCount > 0 ? round(cost / customerCount, 2) : 0;
  const platformBase = base.channelTotal || base.grossRevenue || revenue;
  base.platformRevenueShare = platformBase > 0 ? round(platformRevenue / platformBase, 4) : 0;
  base.healthScore = reports.length ? calculateHealthScore(base) : 0;

  return base;
}

function aggregateCostBreakdown(reports) {
  const categoryMap = new Map();

  for (const report of reports) {
    for (const category of report.categories) {
      const current = categoryMap.get(category.name) || { name: category.name, value: 0 };
      current.value += category.amount;
      categoryMap.set(category.name, current);
    }
  }

  const total = [...categoryMap.values()].reduce((sum, category) => sum + category.value, 0);

  return [...categoryMap.values()]
    .map((category) => ({
      ...category,
      value: round(category.value),
      ratio: total > 0 ? round(category.value / total, 4) : 0,
    }))
    .sort((left, right) => right.value - left.value);
}

function aggregateTopItems(reports) {
  const itemMap = new Map();

  for (const report of reports) {
    for (const item of report.topCostItems) {
      const key = `${item.categoryName}:${item.name}`;
      const current = itemMap.get(key) || {
        categoryName: item.categoryName,
        name: item.name,
        value: 0,
        notes: item.notes,
      };

      current.value += item.amount;
      itemMap.set(key, current);
    }
  }

  return [...itemMap.values()]
    .map((item) => ({
      ...item,
      value: round(item.value),
    }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 8);
}

function aggregateAllCostItems(reports) {
  const itemMap = new Map();

  for (const report of reports) {
    if (!report.lineItems) continue;
    for (const item of report.lineItems) {
      const key = `${item.categoryName}:${item.name}`;
      const current = itemMap.get(key) || {
        categoryName: item.categoryName,
        name: item.name,
        value: 0,
        notes: item.notes,
      };

      current.value += item.amount;
      itemMap.set(key, current);
    }
  }

  return [...itemMap.values()]
    .map((item) => ({
      ...item,
      value: round(item.value),
    }))
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
}

function aggregateChannels(reports) {
  const channelMap = new Map();

  for (const report of reports) {
    for (const channel of report.channels) {
      const current = channelMap.get(channel.name) || { name: channel.name, value: 0 };
      current.value += channel.value;
      channelMap.set(channel.name, current);
    }
  }

  const total = [...channelMap.values()].reduce((sum, channel) => sum + channel.value, 0);

  return [...channelMap.values()]
    .map((channel) => ({
      ...channel,
      value: round(channel.value),
      share: total > 0 ? round(channel.value / total, 4) : 0,
    }))
    .sort((left, right) => right.value - left.value);
}

function comparePeriod(left, right) {
  return left.localeCompare(right);
}

function normalizeFilters(reports, filters = {}) {
  const availablePeriods = sortPeriods(reports.map((report) => report.period));
  const latestPeriod = availablePeriods[availablePeriods.length - 1] || null;
  const storeIds =
    Array.isArray(filters.storeIds) && filters.storeIds.length
      ? filters.storeIds
      : STORE_REGISTRY.map((store) => store.id);
  const periodStart =
    filters.periodStart === 'all' ? null : filters.periodStart || latestPeriod;
  const periodEnd = filters.periodEnd === 'all' ? null : filters.periodEnd || periodStart;

  return {
    storeIds,
    periodStart,
    periodEnd,
    availablePeriods,
    latestPeriod,
  };
}

function filterReports(reports, normalizedFilters) {
  return reports.filter((report) => {
    if (!normalizedFilters.storeIds.includes(report.storeId)) {
      return false;
    }

    if (normalizedFilters.periodStart && comparePeriod(report.period, normalizedFilters.periodStart) < 0) {
      return false;
    }

    if (normalizedFilters.periodEnd && comparePeriod(report.period, normalizedFilters.periodEnd) > 0) {
      return false;
    }

    return true;
  });
}

function buildTrend(selectedReports) {
  const periodMap = new Map();

  for (const report of selectedReports) {
    const current = periodMap.get(report.period) || {
      period: report.period,
      label: formatPeriodLabel(report.period),
      revenue: 0,
      cost: 0,
      profit: 0,
    };

    current.revenue += report.summary.recognizedRevenue;
    current.cost += report.summary.totalCost;
    current.profit += report.summary.profit;
    periodMap.set(report.period, current);
  }

  return [...periodMap.values()]
    .map((point) => ({
      ...point,
      revenue: round(point.revenue),
      cost: round(point.cost),
      profit: round(point.profit),
    }))
    .sort((left, right) => comparePeriod(left.period, right.period));
}

function buildStoreSummaries(reports, selectedReports, normalizedFilters) {
  return STORE_REGISTRY.map((store) => {
    const allReports = reports
      .filter((report) => report.storeId === store.id)
      .sort((left, right) => comparePeriod(left.period, right.period));
    const activeReports = selectedReports
      .filter((report) => report.storeId === store.id)
      .sort((left, right) => comparePeriod(left.period, right.period));
    const latestReport = allReports[allReports.length - 1] || null;
    const selectedSummary = mergeSummaries(activeReports);
    const currentPeriodReport =
      normalizedFilters.periodEnd &&
      allReports.find((report) => report.period === normalizedFilters.periodEnd);

    return {
      storeId: store.id,
      storeName: store.name,
      loadedPeriods: allReports.map((report) => report.period),
      latestPeriod: latestReport?.period || null,
      lastUploadedAt: latestReport?.uploadedAt || null,
      reportCount: activeReports.length,
      isLoaded: Boolean(allReports.length),
      currentPeriodLoaded: Boolean(currentPeriodReport),
      ...selectedSummary,
      costBreakdown: aggregateCostBreakdown(activeReports),
      channels: aggregateChannels(activeReports),
      allCostItems: aggregateAllCostItems(activeReports),
    };
  });
}

function buildDashboard(reports, filters = {}) {
  const normalizedFilters = normalizeFilters(reports, filters);
  const selectedReports = filterReports(reports, normalizedFilters);
  const overview = mergeSummaries(selectedReports);
  const trend = buildTrend(selectedReports);
  const costBreakdown = aggregateCostBreakdown(selectedReports);
  const channels = aggregateChannels(selectedReports);
  const storeStatus = buildStoreSummaries(reports, selectedReports, normalizedFilters);
  const comparison = storeStatus
    .filter((store) => store.reportCount > 0)
    .sort((left, right) => right.healthScore - left.healthScore);

  return {
    availablePeriods: normalizedFilters.availablePeriods,
    appliedFilters: {
      storeIds: normalizedFilters.storeIds,
      periodStart: normalizedFilters.periodStart,
      periodEnd: normalizedFilters.periodEnd,
    },
    overview: {
      ...overview,
      latestPeriod: normalizedFilters.latestPeriod,
      loadedStoreCount: storeStatus.filter((store) => store.isLoaded).length,
      missingStoreCount: storeStatus.filter((store) => !store.isLoaded).length,
      selectedStoreCount: comparison.length,
      reportCount: selectedReports.length,
    },
    trend,
    costBreakdown,
    topCostItems: aggregateTopItems(selectedReports),
    channels,
    storeStatus,
    storeComparison: comparison,
  };
}

module.exports = {
  buildDashboard,
  calculateHealthScore,
  comparePeriod,
};
