const { buildDashboard, comparePeriod } = require('./financialAnalytics');

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function currency(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function grade(score) {
  if (score >= 85) {
    return '强势';
  }

  if (score >= 70) {
    return '稳健';
  }

  if (score >= 55) {
    return '承压';
  }

  return '预警';
}

function growthMessage(storeReports) {
  if (storeReports.length < 2) {
    return null;
  }

  const sorted = [...storeReports].sort((left, right) => comparePeriod(left.period, right.period));
  const current = sorted[sorted.length - 1];
  const previous = sorted[sorted.length - 2];
  const change =
    previous.summary.recognizedRevenue > 0
      ? (current.summary.recognizedRevenue - previous.summary.recognizedRevenue) /
        previous.summary.recognizedRevenue
      : 0;

  return {
    direction: change >= 0 ? '上升' : '下降',
    ratio: Math.abs(change),
  };
}

function createStoreAnalysis(storeSummary, dashboard) {
  const highlights = [];
  const risks = [];
  const actions = [];

  if (storeSummary.profitMargin >= 0.28) {
    highlights.push(`利润率达到 ${percent(storeSummary.profitMargin)}，门店盈利结构处于健康区间。`);
  } else {
    risks.push(`利润率仅 ${percent(storeSummary.profitMargin)}，需要优先压缩可变成本和平台损耗。`);
  }

  if (storeSummary.avgTicket > storeSummary.avgCustomerCost * 1.45) {
    highlights.push(
      `客单价 ${currency(storeSummary.avgTicket)} 明显高于客成本 ${currency(storeSummary.avgCustomerCost)}，单客毛利空间充足。`,
    );
  } else {
    risks.push(
      `客单价 ${currency(storeSummary.avgTicket)} 与客成本 ${currency(storeSummary.avgCustomerCost)} 差距偏窄，单客利润弹性不足。`,
    );
  }

  if (storeSummary.platformRevenueShare >= 0.55) {
    risks.push(`平台渠道收入占比达到 ${percent(storeSummary.platformRevenueShare)}，门店对美团/抖音流量依赖偏高。`);
    actions.push('将高频复购客户逐步引导到企微、会员卡和储值渠道，降低平台抽成压力。');
  } else {
    highlights.push(`平台收入占比 ${percent(storeSummary.platformRevenueShare)}，渠道结构相对均衡。`);
  }

  if (storeSummary.newMembers > 0 && storeSummary.customerCount > 0) {
    const rate = storeSummary.newMembers / storeSummary.customerCount;

    if (rate >= 0.12) {
      highlights.push(`新增会员 ${storeSummary.newMembers} 人，拉新转化效率较好。`);
    } else {
      actions.push('复盘前台成交话术和离店二次触达策略，提升到店客户向会员与疗程卡的转化。');
    }
  }

  const topCostCategory = dashboard.costBreakdown[0];

  if (topCostCategory) {
    actions.push(`重点跟踪“${topCostCategory.name}”占比变化，当前它是筛选范围内最大的成本压力源。`);
  }

  if (!actions.length) {
    actions.push('继续按周复盘利润率、客成本和会员转化，避免指标在下月出现回撤。');
  }

  return {
    storeId: storeSummary.storeId,
    storeName: storeSummary.storeName,
    healthScore: storeSummary.healthScore,
    grade: grade(storeSummary.healthScore),
    summary: `${storeSummary.storeName} 当前财务健康度 ${storeSummary.healthScore} 分，属于${grade(
      storeSummary.healthScore,
    )}状态。核心结论是盈利能力 ${
      storeSummary.profitMargin >= 0.28 ? '稳定' : '承压'
    }，并且${storeSummary.platformRevenueShare >= 0.55 ? '需要降低平台依赖。' : '渠道结构尚可。'}`,
    highlights,
    risks,
    actions: [...new Set(actions)].slice(0, 3),
  };
}

function buildAiAnalysis(reports, filters = {}) {
  const dashboard = buildDashboard(reports, filters);
  const selectedStores = dashboard.storeComparison;

  const storeAnalyses = selectedStores.map((storeSummary) =>
    createStoreAnalysis(storeSummary, dashboard),
  );

  const bestRevenueStore = [...selectedStores].sort((left, right) => right.revenue - left.revenue)[0];
  const bestMarginStore = [...selectedStores].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const watchStore = [...selectedStores].sort((left, right) => left.healthScore - right.healthScore)[0];

  const overallHighlights = [];
  const overallRisks = [];
  const overallActions = [];

  if (bestRevenueStore) {
    overallHighlights.push(
      `${bestRevenueStore.storeName} 贡献营收最高，为 ${currency(bestRevenueStore.revenue)}。`,
    );
  }

  if (bestMarginStore) {
    overallHighlights.push(
      `${bestMarginStore.storeName} 的利润率最高，达到 ${percent(bestMarginStore.profitMargin)}。`,
    );
  }

  if (watchStore && watchStore.healthScore < 60) {
    overallRisks.push(
      `${watchStore.storeName} 健康度最低，仅 ${watchStore.healthScore} 分，应列为下月重点督办门店。`,
    );
  }

  if (dashboard.overview.platformRevenueShare > 0.5) {
    overallRisks.push(
      `当前筛选范围内的平台收入占比为 ${percent(dashboard.overview.platformRevenueShare)}，平台抽成和返佣会持续侵蚀利润。`,
    );
  }

  if (dashboard.costBreakdown[0]) {
    overallActions.push(
      `先抓“${dashboard.costBreakdown[0].name}”这项大头成本，建立周级别复盘机制。`,
    );
  }

  if (watchStore) {
    overallActions.push(`把 ${watchStore.storeName} 作为辅导样本，对标 ${bestMarginStore?.storeName || '表现最佳门店'} 的客单与成本结构。`);
  }

  if (dashboard.trend.length < 2) {
    overallActions.push('继续补齐更多月份报表，系统才能输出更可靠的趋势判断和环比洞察。');
  }

  return {
    generatedAt: new Date().toISOString(),
    appliedFilters: dashboard.appliedFilters,
    overall: {
      healthScore: dashboard.overview.healthScore,
      grade: grade(dashboard.overview.healthScore),
      summary: `当前筛选范围财务健康度 ${dashboard.overview.healthScore} 分，营收 ${currency(
        dashboard.overview.revenue,
      )}，利润 ${currency(dashboard.overview.profit)}，利润率 ${percent(
        dashboard.overview.profitMargin,
      )}。`,
      highlights: overallHighlights,
      risks: overallRisks,
      actions: overallActions.slice(0, 3),
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

module.exports = {
  buildAiAnalysis,
};
