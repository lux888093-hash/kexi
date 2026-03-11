const { buildDashboard, comparePeriod } = require('./financialAnalytics');
const { readSettings } = require('./appSettings');
const {
  FINANCIAL_ANALYST_AGENT_NAME,
  FINANCIAL_ANALYST_AGENT_VERSION,
} = require('./financialAgentPrompt');
const { runZhipuFinancialAgent } = require('./zhipuFinancialAgent');

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function currency(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function grade(score) {
  if (score >= 85) {
    return '优势';
  }

  if (score >= 70) {
    return '稳健';
  }

  if (score >= 55) {
    return '承压';
  }

  return '预警';
}

function dedupeList(items, limit = 3) {
  return [...new Set((items || []).filter(Boolean))].slice(0, limit);
}

function normalizeText(value, maxLength = 80) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.slice(0, maxLength);
}

function normalizePriority(value) {
  const candidate = String(value || '').toLowerCase();

  if (candidate === 'high' || candidate === 'medium' || candidate === 'low') {
    return candidate;
  }

  return 'medium';
}

function selectReportsForFilters(reports, appliedFilters = {}) {
  return reports
    .filter((report) => {
      if (
        Array.isArray(appliedFilters.storeIds) &&
        appliedFilters.storeIds.length &&
        !appliedFilters.storeIds.includes(report.storeId)
      ) {
        return false;
      }

      if (
        appliedFilters.periodStart &&
        comparePeriod(report.period, appliedFilters.periodStart) < 0
      ) {
        return false;
      }

      if (
        appliedFilters.periodEnd &&
        comparePeriod(report.period, appliedFilters.periodEnd) > 0
      ) {
        return false;
      }

      return true;
    })
    .sort((left, right) => {
      const periodCompare = comparePeriod(left.period, right.period);

      if (periodCompare !== 0) {
        return periodCompare;
      }

      return left.storeId.localeCompare(right.storeId);
    });
}

function growthMessage(storeReports) {
  if (storeReports.length < 2) {
    return null;
  }

  const sorted = [...storeReports].sort((left, right) =>
    comparePeriod(left.period, right.period),
  );
  const current = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];
  const previousRevenue = previous.summary.recognizedRevenue;

  if (!previousRevenue) {
    return null;
  }

  const change =
    (current.summary.recognizedRevenue - previousRevenue) / previousRevenue;

  return {
    direction: change >= 0 ? '上升' : '下降',
    ratio: Math.abs(change),
  };
}

function createAgentMeta({
  mode,
  provider,
  model = '',
  note = '',
}) {
  const live = mode === 'llm';

  return {
    name: FINANCIAL_ANALYST_AGENT_NAME,
    version: FINANCIAL_ANALYST_AGENT_VERSION,
    provider,
    model,
    mode,
    statusLine: live
      ? `已启用智谱 ${model} 财务分析师实时分析`
      : '当前展示规则兜底分析',
    note:
      note ||
      (live
        ? 'AI 已基于当前筛选后的结构化财务数据完成真实大模型分析。'
        : '当前未使用智谱实时分析，结果来自本地规则引擎。'),
  };
}

function createFallbackStoreAnalysis(storeSummary, storeReports, dashboard) {
  const highlights = [];
  const risks = [];
  const actions = [];
  const evidence = [];
  const newMemberRate =
    storeSummary.customerCount > 0
      ? storeSummary.newMembers / storeSummary.customerCount
      : 0;

  if (storeSummary.profitMargin >= 0.28) {
    highlights.push(`利润率 ${percent(storeSummary.profitMargin)}，盈利能力处于优先梯队。`);
  } else if (storeSummary.profitMargin >= 0.22) {
    highlights.push(`利润率 ${percent(storeSummary.profitMargin)}，整体盈利仍可维持。`);
  } else {
    risks.push(`利润率仅 ${percent(storeSummary.profitMargin)}，利润空间明显承压。`);
  }

  if (storeSummary.avgTicket > storeSummary.avgCustomerCost * 1.45) {
    highlights.push(
      `客单价 ${currency(storeSummary.avgTicket)} 高于单客成本 ${currency(
        storeSummary.avgCustomerCost,
      )}，单客模型相对健康。`,
    );
  } else {
    risks.push(
      `客单价 ${currency(storeSummary.avgTicket)} 与单客成本 ${currency(
        storeSummary.avgCustomerCost,
      )} 差距偏窄，单客毛利弹性不足。`,
    );
  }

  if (storeSummary.platformRevenueShare >= 0.75) {
    risks.push(
      `平台收入占比 ${percent(storeSummary.platformRevenueShare)}，平台渠道依赖偏高。`,
    );
    actions.push('压缩平台依赖，优先把高频复购客户引导到会员、储值和私域复购。');
  } else {
    highlights.push(
      `平台收入占比 ${percent(storeSummary.platformRevenueShare)}，渠道结构相对可控。`,
    );
  }

  if (newMemberRate >= 0.12) {
    highlights.push(`新增会员 ${storeSummary.newMembers} 人，拉新转化效率较好。`);
  } else if (storeSummary.customerCount > 0) {
    actions.push('复盘前台转卡话术和离店二触动作，提升到店客户会员化率。');
  }

  const trend = growthMessage(storeReports);

  if (trend) {
    evidence.push(`近两期营收环比${trend.direction} ${percent(trend.ratio)}。`);
  }

  evidence.push(
    `营收 ${currency(storeSummary.revenue)}，净利润 ${currency(
      storeSummary.profit,
    )}，健康度 ${storeSummary.healthScore} 分。`,
  );

  if (dashboard.costBreakdown[0]) {
    actions.push(
      `重点跟踪“${dashboard.costBreakdown[0].name}”占比变化，先抓最大成本项。`,
    );
  }

  if (!actions.length) {
    actions.push('继续按周复盘利润率、单客成本和会员转化，避免指标回落。');
  }

  return {
    storeId: storeSummary.storeId,
    storeName: storeSummary.storeName,
    healthScore: storeSummary.healthScore,
    grade: grade(storeSummary.healthScore),
    summary: normalizeText(
      `${storeSummary.storeName} 当前健康度 ${storeSummary.healthScore} 分，利润率 ${percent(
        storeSummary.profitMargin,
      )}，${storeSummary.platformRevenueShare >= 0.75 ? '平台依赖偏高' : '渠道结构相对稳定'}。`,
      72,
    ),
    highlights: dedupeList(highlights, 3),
    risks: dedupeList(risks, 3),
    actions: dedupeList(actions, 3),
    evidence: dedupeList(evidence, 3),
    priority:
      storeSummary.healthScore < 50 || storeSummary.profitMargin < 0.2
        ? 'high'
        : 'medium',
  };
}

function buildRankingSnapshot(dashboard) {
  const stores = dashboard.storeComparison;
  const revenueLeader = [...stores].sort((left, right) => right.revenue - left.revenue)[0];
  const marginLeader = [...stores].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const watchStore = [...stores].sort(
    (left, right) => left.healthScore - right.healthScore,
  )[0];
  const platformRiskStore = [...stores].sort(
    (left, right) => right.platformRevenueShare - left.platformRevenueShare,
  )[0];

  return dedupeList(
    [
      revenueLeader
        ? `营收第一是 ${revenueLeader.storeName}，营收 ${currency(revenueLeader.revenue)}。`
        : '',
      marginLeader
        ? `利润率第一是 ${marginLeader.storeName}，利润率 ${percent(
            marginLeader.profitMargin,
          )}。`
        : '',
      watchStore
        ? `当前重点关注 ${watchStore.storeName}，健康度 ${watchStore.healthScore} 分。`
        : '',
      platformRiskStore && platformRiskStore.platformRevenueShare >= 0.8
        ? `${platformRiskStore.storeName} 平台占比 ${percent(
            platformRiskStore.platformRevenueShare,
          )}，渠道依赖最重。`
        : '',
    ],
    3,
  );
}

function buildAnomalies(dashboard) {
  const stores = dashboard.storeComparison;
  const anomalies = [];
  const averageRevenue =
    dashboard.overview.selectedStoreCount > 0
      ? dashboard.overview.revenue / dashboard.overview.selectedStoreCount
      : 0;

  const highPlatformStores = [...stores]
    .filter((store) => store.platformRevenueShare >= 0.85)
    .sort((left, right) => right.platformRevenueShare - left.platformRevenueShare)
    .slice(0, 2);

  highPlatformStores.forEach((store) => {
    anomalies.push(
      `${store.storeName} 平台占比 ${percent(store.platformRevenueShare)}，明显高于健康区间。`,
    );
  });

  const lowMarginHighRevenueStores = [...stores]
    .filter(
      (store) =>
        store.revenue >= averageRevenue && store.profitMargin < dashboard.overview.profitMargin,
    )
    .sort((left, right) => left.profitMargin - right.profitMargin)
    .slice(0, 1);

  lowMarginHighRevenueStores.forEach((store) => {
    anomalies.push(
      `${store.storeName} 营收不低但利润率仅 ${percent(
        store.profitMargin,
      )}，存在“有规模没利润”迹象。`,
    );
  });

  const highCostStore = [...stores].sort(
    (left, right) => right.avgCustomerCost - left.avgCustomerCost,
  )[0];

  if (
    highCostStore &&
    highCostStore.avgCustomerCost > dashboard.overview.avgCustomerCost * 1.08
  ) {
    anomalies.push(
      `${highCostStore.storeName} 单客成本 ${currency(
        highCostStore.avgCustomerCost,
      )}，高于整体均值。`,
    );
  }

  if (dashboard.topCostItems[0]) {
    anomalies.push(
      `重点成本项“${dashboard.topCostItems[0].name}”金额 ${currency(
        dashboard.topCostItems[0].value,
      )}，需要复核支出效率。`,
    );
  }

  return dedupeList(anomalies, 3);
}

function buildThirtyDayPlan(dashboard) {
  const stores = dashboard.storeComparison;
  const watchStore = [...stores].sort(
    (left, right) => left.healthScore - right.healthScore,
  )[0];
  const bestMarginStore = [...stores].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const platformRiskStore = [...stores].sort(
    (left, right) => right.platformRevenueShare - left.platformRevenueShare,
  )[0];
  const topCostItem = dashboard.topCostItems[0];

  return dedupeList(
    [
      platformRiskStore
        ? `7天内先拆解 ${platformRiskStore.storeName} 的平台订单与私域复购，优先压降平台占比。`
        : '',
      topCostItem
        ? `14天内复盘“${topCostItem.name}”对应支出，明确保留、压缩和替代方案。`
        : '',
      watchStore && bestMarginStore
        ? `30天内让 ${watchStore.storeName} 对标 ${bestMarginStore.storeName}，跟踪利润率、客单价和单客成本。`
        : '',
    ],
    3,
  );
}

function buildOwnerBrief(dashboard) {
  const stores = dashboard.storeComparison;
  const watchStore = [...stores].sort(
    (left, right) => left.healthScore - right.healthScore,
  )[0];
  const revenueLeader = [...stores].sort((left, right) => right.revenue - left.revenue)[0];
  const platformRiskStore = [...stores].sort(
    (left, right) => right.platformRevenueShare - left.platformRevenueShare,
  )[0];

  return normalizeText(
    `老板视角：当前整体利润率 ${percent(
      dashboard.overview.profitMargin,
    )}，最大风险是${
      platformRiskStore && platformRiskStore.platformRevenueShare >= 0.8
        ? `${platformRiskStore.storeName} 等门店平台依赖偏高`
        : '成本结构承压'
    }；优先盯 ${watchStore?.storeName || '承压门店'}，现金贡献主力是 ${
      revenueLeader?.storeName || '头部门店'
    }。`,
    120,
  );
}

function buildFallbackAnalysisFromDashboard(dashboard, selectedReports) {
  const storesById = selectedReports.reduce((collection, report) => {
    const current = collection.get(report.storeId) || [];
    current.push(report);
    collection.set(report.storeId, current);
    return collection;
  }, new Map());

  const selectedStores = dashboard.storeComparison;
  const storeAnalyses = selectedStores.map((storeSummary) =>
    createFallbackStoreAnalysis(
      storeSummary,
      storesById.get(storeSummary.storeId) || [],
      dashboard,
    ),
  );

  const bestRevenueStore = [...selectedStores].sort(
    (left, right) => right.revenue - left.revenue,
  )[0];
  const bestMarginStore = [...selectedStores].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const watchStore = [...selectedStores].sort(
    (left, right) => left.healthScore - right.healthScore,
  )[0];

  const overallHighlights = [];
  const overallRisks = [];
  const overallActions = [];
  const diagnosis = [];
  const dataGaps = [];
  const rankingSnapshot = buildRankingSnapshot(dashboard);
  const anomalies = buildAnomalies(dashboard);
  const plan30d = buildThirtyDayPlan(dashboard);
  const ownerBrief = buildOwnerBrief(dashboard);

  if (bestRevenueStore) {
    overallHighlights.push(
      `${bestRevenueStore.storeName} 当前营收最高，为 ${currency(bestRevenueStore.revenue)}。`,
    );
  }

  if (bestMarginStore) {
    overallHighlights.push(
      `${bestMarginStore.storeName} 利润率最高，达到 ${percent(
        bestMarginStore.profitMargin,
      )}。`,
    );
  }

  if (dashboard.overview.platformRevenueShare > 0.75) {
    overallRisks.push(
      `平台收入占比高达 ${percent(
        dashboard.overview.platformRevenueShare,
      )}，平台费用会持续侵蚀利润。`,
    );
  }

  if (watchStore && watchStore.healthScore < 50) {
    overallRisks.push(
      `${watchStore.storeName} 健康度仅 ${watchStore.healthScore} 分，应列为重点辅导门店。`,
    );
  }

  if (dashboard.costBreakdown[0]) {
    diagnosis.push(
      `当前最大成本压力来自“${dashboard.costBreakdown[0].name}”，占总成本 ${percent(
        dashboard.costBreakdown[0].ratio,
      )}。`,
    );
  }

  if (dashboard.overview.profitMargin < 0.22) {
    diagnosis.push(
      `整体利润率仅 ${percent(dashboard.overview.profitMargin)}，需要同步压成本和提客单。`,
    );
  } else {
    diagnosis.push(
      `整体利润率为 ${percent(dashboard.overview.profitMargin)}，盈利基础尚可但仍有优化空间。`,
    );
  }

  if (dashboard.costBreakdown[0]) {
    overallActions.push(
      `先从“${dashboard.costBreakdown[0].name}”建立周复盘和门店对标机制。`,
    );
  }

  if (watchStore && bestMarginStore) {
    overallActions.push(
      `以 ${watchStore.storeName} 为整改样本，对标 ${bestMarginStore.storeName} 的利润结构和渠道结构。`,
    );
  }

  if (dashboard.trend.length < 2) {
    dataGaps.push('当前仅有单月样本，无法输出可靠趋势判断，建议补齐至少 3 个月月报。');
  }

  if (!overallActions.length) {
    overallActions.push('继续补齐历史月报，并持续复盘利润率、客单价与单客成本。');
  }

  return {
    generatedAt: new Date().toISOString(),
    appliedFilters: dashboard.appliedFilters,
    overall: {
      healthScore: dashboard.overview.healthScore,
      grade: grade(dashboard.overview.healthScore),
      summary: normalizeText(
        `当前筛选范围健康度 ${dashboard.overview.healthScore} 分，营收 ${currency(
          dashboard.overview.revenue,
        )}，利润率 ${percent(dashboard.overview.profitMargin)}。`,
        72,
      ),
      highlights: dedupeList(overallHighlights, 3),
      risks: dedupeList(overallRisks, 3),
      actions: dedupeList(overallActions, 3),
      diagnosis: dedupeList(diagnosis, 3),
      dataGaps: dedupeList(dataGaps, 3),
      ownerBrief,
      rankingSnapshot,
      anomalies,
      plan30d,
    },
    comparison: {
      bestRevenueStore: bestRevenueStore
        ? {
            storeId: bestRevenueStore.storeId,
            storeName: bestRevenueStore.storeName,
            revenue: bestRevenueStore.revenue,
          }
        : null,
      bestMarginStore: bestMarginStore
        ? {
            storeId: bestMarginStore.storeId,
            storeName: bestMarginStore.storeName,
            profitMargin: bestMarginStore.profitMargin,
          }
        : null,
      watchStore: watchStore
        ? {
            storeId: watchStore.storeId,
            storeName: watchStore.storeName,
            healthScore: watchStore.healthScore,
          }
        : null,
    },
    stores: storeAnalyses,
  };
}

function getCategoryAmount(category) {
  if (Number.isFinite(Number(category?.amount))) {
    return round(Number(category.amount));
  }

  return round(
    (category?.items || []).reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    ),
  );
}

function getCategoryRatio(category, totalCost = 0) {
  if (Number.isFinite(Number(category?.ratio))) {
    return Number(category.ratio);
  }

  const amount = getCategoryAmount(category);
  return totalCost > 0 ? round(amount / totalCost, 4) : 0;
}

function pickReportContext(report) {
  const costCategories = [...(report.categories || [])]
    .map((category) => ({
      name: category.name,
      amount: getCategoryAmount(category),
      ratio: getCategoryRatio(category, report.summary?.totalCost || 0),
      topItems: [...(category.items || [])]
        .sort(
          (left, right) =>
            Math.abs(Number(right.amount || 0)) -
            Math.abs(Number(left.amount || 0)),
        )
        .slice(0, 3)
        .map((item) => ({
          name: item.name,
          amount: item.amount,
          notes: item.notes,
        })),
    }))
    .sort((left, right) => right.amount - left.amount);

  return {
    storeId: report.storeId,
    storeName: report.storeName,
    period: report.period,
    periodLabel: report.periodLabel,
    summary: {
      recognizedRevenue: report.summary.recognizedRevenue,
      grossRevenue: report.summary.grossRevenue,
      totalCost: report.summary.totalCost,
      profit: report.summary.profit,
      profitMargin: report.summary.profitMargin,
      customerCount: report.summary.customerCount,
      avgTicket: report.summary.avgTicket,
      avgCustomerCost: report.summary.avgCustomerCost,
      newMembers: report.summary.newMembers,
      savingsAmount: report.summary.savingsAmount,
      platformRevenue: report.summary.platformRevenue,
      platformRevenueShare: report.summary.platformRevenueShare,
    },
    channels: report.channels,
    topCostCategories: costCategories,
    topCostItems: report.topCostItems.slice(0, 5).map((item) => ({
      categoryName: item.categoryName,
      name: item.name,
      amount: item.amount,
      notes: item.notes,
    })),
  };
}

function averageMetric(stores, selector, precision = 2) {
  if (!stores.length) {
    return 0;
  }

  return round(
    stores.reduce((sum, store) => sum + Number(selector(store) || 0), 0) /
      stores.length,
    precision,
  );
}

function rankStore(stores, storeId, selector, direction = 'desc') {
  const sorted = [...stores].sort((left, right) => {
    const leftValue = Number(selector(left) || 0);
    const rightValue = Number(selector(right) || 0);

    return direction === 'asc'
      ? leftValue - rightValue
      : rightValue - leftValue;
  });

  const index = sorted.findIndex((store) => store.storeId === storeId);
  return index === -1 ? null : index + 1;
}

function pickStoreBenchmark(store) {
  return {
    storeId: store.storeId,
    storeName: store.storeName,
    revenue: store.revenue,
    profit: store.profit,
    profitMargin: store.profitMargin,
    customerCount: store.customerCount,
    avgTicket: store.avgTicket,
    avgCustomerCost: store.avgCustomerCost,
    newMembers: store.newMembers,
    platformRevenueShare: store.platformRevenueShare,
    healthScore: store.healthScore,
  };
}

function buildPeerComparison(dashboard, peerDashboard) {
  const focusStoreId =
    Array.isArray(dashboard.appliedFilters.storeIds) &&
    dashboard.appliedFilters.storeIds.length === 1
      ? dashboard.appliedFilters.storeIds[0]
      : null;

  if (!focusStoreId || !peerDashboard?.storeComparison?.length) {
    return null;
  }

  const peerStores = peerDashboard.storeComparison;
  const focusStore = peerStores.find((store) => store.storeId === focusStoreId);

  if (!focusStore) {
    return null;
  }

  const revenueLeader = [...peerStores].sort(
    (left, right) => right.revenue - left.revenue,
  )[0];
  const marginLeader = [...peerStores].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const healthLeader = [...peerStores].sort(
    (left, right) => right.healthScore - left.healthScore,
  )[0];
  const comparisonHighlights = [
    `同周期 ${peerStores.length} 家门店里，${focusStore.storeName} 利润率排第 ${
      rankStore(peerStores, focusStoreId, (store) => store.profitMargin)
    }/${peerStores.length}，平台占比从低到高排第 ${
      rankStore(
        peerStores,
        focusStoreId,
        (store) => store.platformRevenueShare,
        'asc',
      )
    }/${peerStores.length}。`,
    `${focusStore.storeName} 相比同周期均值：利润率${
      focusStore.profitMargin >= averageMetric(peerStores, (store) => store.profitMargin, 4)
        ? '高'
        : '低'
    } ${Math.abs(
      round(
        focusStore.profitMargin -
          averageMetric(peerStores, (store) => store.profitMargin, 4),
        4,
      ) * 100,
    ).toFixed(1)} 个百分点，平台占比${
      focusStore.platformRevenueShare >=
      averageMetric(peerStores, (store) => store.platformRevenueShare, 4)
        ? '高'
        : '低'
    } ${Math.abs(
      round(
        focusStore.platformRevenueShare -
          averageMetric(peerStores, (store) => store.platformRevenueShare, 4),
        4,
      ) * 100,
    ).toFixed(1)} 个百分点，客单价${
      focusStore.avgTicket >= averageMetric(peerStores, (store) => store.avgTicket, 2)
        ? '高'
        : '低'
    } ${currency(
      Math.abs(
        round(
          focusStore.avgTicket - averageMetric(peerStores, (store) => store.avgTicket, 2),
          2,
        ),
      ),
    )}。`,
    marginLeader
      ? `同周期利润率标杆门店是 ${marginLeader.storeName}，利润率 ${percent(
          marginLeader.profitMargin,
        )}；营收领先门店是 ${revenueLeader.storeName}，营收 ${currency(
          revenueLeader.revenue,
        )}。`
      : '',
  ].filter(Boolean);

  return {
    peerStoreCount: peerStores.length,
    focusStore: pickStoreBenchmark(focusStore),
    focusStoreRanks: {
      revenueRank: rankStore(peerStores, focusStoreId, (store) => store.revenue),
      profitMarginRank: rankStore(
        peerStores,
        focusStoreId,
        (store) => store.profitMargin,
      ),
      avgTicketRank: rankStore(
        peerStores,
        focusStoreId,
        (store) => store.avgTicket,
      ),
      avgCustomerCostRankLowToHigh: rankStore(
        peerStores,
        focusStoreId,
        (store) => store.avgCustomerCost,
        'asc',
      ),
      platformShareRankLowToHigh: rankStore(
        peerStores,
        focusStoreId,
        (store) => store.platformRevenueShare,
        'asc',
      ),
      healthScoreRank: rankStore(
        peerStores,
        focusStoreId,
        (store) => store.healthScore,
      ),
    },
    samePeriodAverage: {
      revenue: averageMetric(peerStores, (store) => store.revenue, 2),
      profitMargin: averageMetric(peerStores, (store) => store.profitMargin, 4),
      avgTicket: averageMetric(peerStores, (store) => store.avgTicket, 2),
      avgCustomerCost: averageMetric(
        peerStores,
        (store) => store.avgCustomerCost,
        2,
      ),
      platformRevenueShare: averageMetric(
        peerStores,
        (store) => store.platformRevenueShare,
        4,
      ),
      healthScore: averageMetric(peerStores, (store) => store.healthScore, 0),
    },
    focusVsAverage: {
      revenueGap: round(
        focusStore.revenue - averageMetric(peerStores, (store) => store.revenue, 2),
        2,
      ),
      profitMarginGap: round(
        focusStore.profitMargin -
          averageMetric(peerStores, (store) => store.profitMargin, 4),
        4,
      ),
      avgTicketGap: round(
        focusStore.avgTicket - averageMetric(peerStores, (store) => store.avgTicket, 2),
        2,
      ),
      avgCustomerCostGap: round(
        focusStore.avgCustomerCost -
          averageMetric(peerStores, (store) => store.avgCustomerCost, 2),
        2,
      ),
      platformRevenueShareGap: round(
        focusStore.platformRevenueShare -
          averageMetric(peerStores, (store) => store.platformRevenueShare, 4),
        4,
      ),
      healthScoreGap: Math.round(
        focusStore.healthScore -
          averageMetric(peerStores, (store) => store.healthScore, 0),
      ),
    },
    leaders: {
      revenueLeader: revenueLeader ? pickStoreBenchmark(revenueLeader) : null,
      profitMarginLeader: marginLeader ? pickStoreBenchmark(marginLeader) : null,
      healthLeader: healthLeader ? pickStoreBenchmark(healthLeader) : null,
    },
    comparisonHighlights,
    peerStores: peerStores.map(pickStoreBenchmark),
  };
}

function buildFinancialContext(dashboard, selectedReports, options = {}) {
  const referenceDashboard =
    options.peerDashboard?.storeComparison?.length ? options.peerDashboard : dashboard;

  return {
    businessProfile: {
      industry: '连锁头疗/美业门店',
      analysisObjective: '基于月度财务数据输出经营财务诊断、风险识别和行动建议',
      outputAudience: ['老板', '财务负责人', '区域运营负责人', '店长'],
    },
    scope: {
      appliedFilters: dashboard.appliedFilters,
      availablePeriods: dashboard.availablePeriods,
      selectedReportCount: dashboard.overview.reportCount,
      selectedStoreCount: dashboard.overview.selectedStoreCount,
      latestPeriod: dashboard.overview.latestPeriod,
    },
    overallMetrics: {
      revenue: dashboard.overview.revenue,
      grossRevenue: dashboard.overview.grossRevenue,
      cost: dashboard.overview.cost,
      profit: dashboard.overview.profit,
      profitMargin: dashboard.overview.profitMargin,
      customerCount: dashboard.overview.customerCount,
      avgTicket: dashboard.overview.avgTicket,
      avgCustomerCost: dashboard.overview.avgCustomerCost,
      newMembers: dashboard.overview.newMembers,
      platformRevenue: dashboard.overview.platformRevenue,
      platformRevenueShare: dashboard.overview.platformRevenueShare,
      healthScore: dashboard.overview.healthScore,
    },
    trend: dashboard.trend,
    costBreakdown: dashboard.costBreakdown.slice(0, 10),
    topCostItems: dashboard.topCostItems.slice(0, 10),
    channels: dashboard.channels,
    rankingSnapshotCandidates: buildRankingSnapshot(referenceDashboard),
    anomalyCandidates: buildAnomalies(referenceDashboard),
    thirtyDayPlanCandidates: buildThirtyDayPlan(referenceDashboard),
    ownerBriefCandidate: buildOwnerBrief(referenceDashboard),
    storeBenchmarks: referenceDashboard.storeComparison.map(pickStoreBenchmark),
    peerComparison: buildPeerComparison(dashboard, options.peerDashboard),
    reportSnapshots: selectedReports.map(pickReportContext),
  };
}

function buildFinancialContextBundle(reports, filters = {}) {
  const dashboard = buildDashboard(reports, filters);
  const selectedReports = selectReportsForFilters(reports, dashboard.appliedFilters);
  const peerDashboard =
    Array.isArray(dashboard.appliedFilters.storeIds) &&
    dashboard.appliedFilters.storeIds.length === 1
      ? buildDashboard(reports, {
          periodStart: dashboard.appliedFilters.periodStart,
          periodEnd: dashboard.appliedFilters.periodEnd,
        })
      : null;

  return {
    dashboard,
    peerDashboard,
    selectedReports,
    context: buildFinancialContext(dashboard, selectedReports, {
      peerDashboard,
    }),
  };
}

function normalizeNarrativeList(items, fallbackItems = [], limit = 3) {
  const normalized = dedupeList(
    (items || []).map((item) => normalizeText(item, 72)).filter(Boolean),
    limit,
  );

  return normalized.length ? normalized : fallbackItems;
}

const STORE_COMPARISON_METRICS = [
  {
    key: 'profitMargin',
    aliases: ['利润率'],
    highTokens: ['高于', '高过', '偏高', '更高', '较高'],
    lowTokens: ['低于', '低过', '偏低', '更低', '较低'],
    formatter: percent,
    tolerance: 0.0005,
  },
  {
    key: 'avgTicket',
    aliases: ['客单价', '客单'],
    highTokens: ['高于', '高过', '偏高', '更高', '较高'],
    lowTokens: ['低于', '低过', '偏低', '更低', '较低'],
    formatter: currency,
    tolerance: 0.5,
  },
  {
    key: 'avgCustomerCost',
    aliases: ['单客成本', '单客费用', '单客花费'],
    highTokens: ['高于', '高过', '偏高', '更高', '较高'],
    lowTokens: ['低于', '低过', '偏低', '更低', '较低'],
    formatter: currency,
    tolerance: 0.5,
  },
  {
    key: 'platformRevenueShare',
    aliases: ['平台占比', '平台收入占比', '平台订单占比'],
    highTokens: ['高于', '高过', '偏高', '更高', '较高'],
    lowTokens: ['低于', '低过', '偏低', '更低', '较低'],
    formatter: percent,
    tolerance: 0.0005,
  },
];

function getAverageReferenceForStore(storeId, financialContext = {}) {
  if (
    financialContext.peerComparison?.focusStore?.storeId === storeId &&
    financialContext.peerComparison?.samePeriodAverage
  ) {
    return {
      label: '同周期门店均值',
      values: financialContext.peerComparison.samePeriodAverage,
    };
  }

  if (financialContext.overallMetrics) {
    return {
      label: '当前筛选门店均值',
      values: financialContext.overallMetrics,
    };
  }

  return null;
}

function containsAnyKeyword(text, keywords = []) {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasDirectionalMismatch(text, storeBenchmark, averageReference) {
  const normalized = normalizeText(text, 120);

  if (
    !normalized ||
    !storeBenchmark ||
    !averageReference?.values ||
    !/(平均|均值)/.test(normalized)
  ) {
    return false;
  }

  for (const metric of STORE_COMPARISON_METRICS) {
    if (!containsAnyKeyword(normalized, metric.aliases)) {
      continue;
    }

    const storeValue = Number(storeBenchmark[metric.key]);
    const averageValue = Number(averageReference.values[metric.key]);

    if (!Number.isFinite(storeValue) || !Number.isFinite(averageValue)) {
      continue;
    }

    const gap = storeValue - averageValue;

    if (Math.abs(gap) <= metric.tolerance) {
      continue;
    }

    if (containsAnyKeyword(normalized, metric.highTokens) && gap < 0) {
      return true;
    }

    if (containsAnyKeyword(normalized, metric.lowTokens) && gap > 0) {
      return true;
    }

    if (
      metric.key === 'avgCustomerCost' &&
      normalized.includes('成本控制') &&
      /较好|良好|优秀|不错|更好/.test(normalized) &&
      gap > metric.tolerance
    ) {
      return true;
    }

    if (
      metric.key === 'avgCustomerCost' &&
      normalized.includes('成本控制') &&
      /承压|较差|偏弱|不佳|压力/.test(normalized) &&
      gap < -metric.tolerance
    ) {
      return true;
    }
  }

  return false;
}

function sanitizeStoreNarrativeText(
  value,
  fallbackValue,
  storeBenchmark,
  averageReference,
  maxLength = 72,
) {
  const normalized = normalizeText(value, maxLength);

  if (!normalized) {
    return fallbackValue;
  }

  return hasDirectionalMismatch(normalized, storeBenchmark, averageReference)
    ? fallbackValue
    : normalized;
}

function sanitizeStoreNarrativeList(
  items,
  fallbackItems,
  storeBenchmark,
  averageReference,
  limit = 3,
) {
  const sanitized = dedupeList(
    (items || [])
      .map((item) =>
        sanitizeStoreNarrativeText(
          item,
          '',
          storeBenchmark,
          averageReference,
          72,
        ),
      )
      .filter(Boolean),
    limit,
  );

  return sanitized.length ? sanitized : fallbackItems;
}

function buildVerifiedStoreComparisonEvidence(storeBenchmark, averageReference) {
  if (!storeBenchmark || !averageReference?.values) {
    return [];
  }

  const metrics = [
    {
      key: 'avgCustomerCost',
      label: '单客成本',
      formatter: currency,
    },
    {
      key: 'avgTicket',
      label: '客单价',
      formatter: currency,
    },
    {
      key: 'profitMargin',
      label: '利润率',
      formatter: percent,
    },
  ];

  return metrics
    .map((metric) => {
      const storeValue = Number(storeBenchmark[metric.key]);
      const averageValue = Number(averageReference.values[metric.key]);

      if (!Number.isFinite(storeValue) || !Number.isFinite(averageValue)) {
        return '';
      }

      if (Math.abs(storeValue - averageValue) < 0.0005) {
        return `${metric.label} ${metric.formatter(storeValue)}，与${averageReference.label}基本持平。`;
      }

      return `${metric.label} ${metric.formatter(storeValue)}，${
        storeValue > averageValue ? '高于' : '低于'
      }${averageReference.label} ${metric.formatter(averageValue)}。`;
    })
    .filter(Boolean)
    .slice(0, 2);
}

function mergeStoreEvidence(store, llmStore, storeBenchmark, averageReference) {
  const verifiedEvidence = buildVerifiedStoreComparisonEvidence(
    storeBenchmark,
    averageReference,
  );
  const llmEvidence = sanitizeStoreNarrativeList(
    llmStore?.evidence,
    [],
    storeBenchmark,
    averageReference,
    3,
  );

  return dedupeList(
    [
      ...verifiedEvidence,
      ...llmEvidence,
      ...((store.evidence || []).map((item) => normalizeText(item, 72)).filter(Boolean)),
    ],
    4,
  );
}

function mergeNarrativeAnalysis(fallbackAnalysis, llmAnalysis, agentMeta, financialContext = {}) {
  const merged = {
    ...fallbackAnalysis,
    agent: agentMeta,
  };

  if (llmAnalysis?.overall) {
    merged.overall = {
      ...fallbackAnalysis.overall,
      summary:
        normalizeText(llmAnalysis.overall.summary, 72) ||
        fallbackAnalysis.overall.summary,
      highlights: normalizeNarrativeList(
        llmAnalysis.overall.highlights,
        fallbackAnalysis.overall.highlights,
      ),
      risks: normalizeNarrativeList(
        llmAnalysis.overall.risks,
        fallbackAnalysis.overall.risks,
      ),
      actions: normalizeNarrativeList(
        llmAnalysis.overall.actions,
        fallbackAnalysis.overall.actions,
      ),
      diagnosis: normalizeNarrativeList(
        llmAnalysis.overall.diagnosis,
        fallbackAnalysis.overall.diagnosis || [],
      ),
      dataGaps: normalizeNarrativeList(
        llmAnalysis.overall.dataGaps,
        fallbackAnalysis.overall.dataGaps || [],
      ),
      ownerBrief:
        normalizeText(llmAnalysis.overall.ownerBrief, 120) ||
        fallbackAnalysis.overall.ownerBrief ||
        '',
      rankingSnapshot: normalizeNarrativeList(
        llmAnalysis.overall.rankingSnapshot,
        fallbackAnalysis.overall.rankingSnapshot || [],
      ),
      anomalies: normalizeNarrativeList(
        llmAnalysis.overall.anomalies,
        fallbackAnalysis.overall.anomalies || [],
      ),
      plan30d: normalizeNarrativeList(
        llmAnalysis.overall.plan30d,
        fallbackAnalysis.overall.plan30d || [],
      ),
    };
  }

  const llmStoreMap = new Map(
    (llmAnalysis?.stores || [])
      .filter((store) => store?.storeId)
      .map((store) => [store.storeId, store]),
  );
  const storeBenchmarkMap = new Map(
    (financialContext.storeBenchmarks || [])
      .filter((store) => store?.storeId)
      .map((store) => [store.storeId, store]),
  );

  merged.stores = fallbackAnalysis.stores.map((store) => {
    const llmStore = llmStoreMap.get(store.storeId);
    const storeBenchmark = storeBenchmarkMap.get(store.storeId) || null;
    const averageReference = getAverageReferenceForStore(
      store.storeId,
      financialContext,
    );

    if (!llmStore) {
      return {
        ...store,
        evidence: mergeStoreEvidence(
          store,
          null,
          storeBenchmark,
          averageReference,
        ),
      };
    }

    return {
      ...store,
      summary: sanitizeStoreNarrativeText(
        llmStore.summary,
        store.summary,
        storeBenchmark,
        averageReference,
        72,
      ),
      highlights: sanitizeStoreNarrativeList(
        llmStore.highlights,
        store.highlights,
        storeBenchmark,
        averageReference,
      ),
      risks: sanitizeStoreNarrativeList(
        llmStore.risks,
        store.risks,
        storeBenchmark,
        averageReference,
      ),
      actions: sanitizeStoreNarrativeList(
        llmStore.actions,
        store.actions,
        storeBenchmark,
        averageReference,
      ),
      evidence: mergeStoreEvidence(
        store,
        llmStore,
        storeBenchmark,
        averageReference,
      ),
      priority: normalizePriority(llmStore.priority || store.priority),
    };
  });

  return merged;
}

async function buildAiAnalysis(reports, filters = {}, options = {}) {
  const { dashboard, selectedReports, context: financialContext } =
    buildFinancialContextBundle(reports, filters);
  const fallbackAnalysis = buildFallbackAnalysisFromDashboard(
    dashboard,
    selectedReports,
  );
  const settings = options.settings || readSettings();

  if (!selectedReports.length) {
    return {
      ...fallbackAnalysis,
      agent: createAgentMeta({
        mode: 'fallback',
        provider: 'rules',
        note: '当前筛选范围没有可分析的财务数据，暂未触发智谱分析。',
      }),
    };
  }

  if (settings.llmProvider !== 'zhipu') {
    return {
      ...fallbackAnalysis,
      agent: createAgentMeta({
        mode: 'fallback',
        provider: 'rules',
        note: '当前系统未启用智谱模型，暂时展示规则兜底分析。',
      }),
    };
  }

  if (!settings.zhipuApiKey) {
    return {
      ...fallbackAnalysis,
      agent: createAgentMeta({
        mode: 'fallback',
        provider: 'zhipu',
        note: '尚未配置智谱 API Key，暂时展示规则兜底分析。',
      }),
    };
  }

  try {
    const llmResult = await runZhipuFinancialAgent({
      apiKey: settings.zhipuApiKey,
      context: financialContext,
      preferredModel: settings.zhipuModel,
    });

    return mergeNarrativeAnalysis(fallbackAnalysis, llmResult.parsed, {
      ...createAgentMeta({
        mode: 'llm',
        provider: 'zhipu',
        model: llmResult.model,
      }),
      generatedBy: 'zhipu-live-analysis',
    }, financialContext);
  } catch (error) {
    return {
      ...fallbackAnalysis,
      agent: createAgentMeta({
        mode: 'fallback',
        provider: 'zhipu',
        note: `智谱分析暂时不可用，已切回规则兜底：${normalizeText(
          error.message,
          80,
        )}`,
      }),
    };
  }
}

module.exports = {
  buildAiAnalysis,
  buildFinancialContextBundle,
};
