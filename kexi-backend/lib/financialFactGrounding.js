const DEFAULT_FACT_LIMIT = 120;

function normalizeText(value, maxLength = 240) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.slice(0, maxLength);
}

function currency(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function percentPoint(value) {
  return `${Math.abs(Number(value || 0) * 100).toFixed(1)} 个百分点`;
}

function integerText(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function dedupeFacts(facts = []) {
  const seen = new Set();

  return facts.filter((fact) => {
    const id = normalizeText(fact?.id, 80);

    if (!id || seen.has(id)) {
      return false;
    }

    seen.add(id);
    return true;
  });
}

function sanitizeFactPart(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'unknown';
}

function createFactCatalog(context = {}) {
  return {
    version: 'financial-facts-v1',
    scope: {
      latestPeriod: context.scope?.latestPeriod || '',
      selectedStoreCount: Number(context.scope?.selectedStoreCount || 0),
    },
    facts: [],
  };
}

function pushFact(catalog, fact) {
  if (!catalog || !fact) {
    return;
  }

  const id = normalizeText(fact.id, 80);
  const promptText = normalizeText(fact.promptText, 220);
  const inlineText = normalizeText(
    fact.inlineText || fact.statementText || fact.promptText,
    220,
  );

  if (!id || !promptText || !inlineText) {
    return;
  }

  catalog.facts.push({
    id,
    factScope: fact.factScope || 'general',
    storeId: fact.storeId || '',
    storeName: fact.storeName || '',
    promptText,
    inlineText,
    statementText: normalizeText(
      fact.statementText || fact.inlineText || fact.promptText,
      220,
    ),
    valueType: fact.valueType || 'text',
    value:
      fact.value === null || fact.value === undefined ? null : Number(fact.value),
  });
}

function buildGapText(label, storeName, gap, formatter = percent) {
  if (!Number.isFinite(Number(gap)) || Math.abs(Number(gap)) < 0.0005) {
    return `${storeName}${label}与同期门店平均基本持平`;
  }

  return `${storeName}${label}较同期门店平均${
    Number(gap) > 0 ? '高' : '低'
  } ${formatter(gap)}`;
}

function buildFinancialFactCatalog(context = {}) {
  const catalog = createFactCatalog(context);
  const overall = context.overallMetrics || {};
  const latestPeriod = context.scope?.latestPeriod || '';
  const latestPeriodLabel = context.analysisScope?.periodLabel || latestPeriod;

  if (context.scope?.selectedStoreCount) {
    pushFact(catalog, {
      id: 'overall.scope',
      factScope: 'overall',
      valueType: 'text',
      promptText: `当前范围共 ${integerText(context.scope.selectedStoreCount)} 家门店，最新周期 ${latestPeriodLabel || '未指定'}`,
      inlineText: `当前范围 ${integerText(context.scope.selectedStoreCount)} 家门店，周期 ${latestPeriodLabel || '未指定'}`,
    });
  }

  [
    {
      key: 'revenue',
      id: 'overall.revenue',
      inlineText: `当前范围营收 ${currency(overall.revenue)}`,
      valueType: 'currency',
    },
    {
      key: 'profit',
      id: 'overall.profit',
      inlineText: `当前范围净利润 ${currency(overall.profit)}`,
      valueType: 'currency',
    },
    {
      key: 'profitMargin',
      id: 'overall.profit_margin',
      inlineText: `当前范围利润率 ${percent(overall.profitMargin)}`,
      valueType: 'percent',
    },
    {
      key: 'avgTicket',
      id: 'overall.avg_ticket',
      inlineText: `当前范围客单价 ${currency(overall.avgTicket)}`,
      valueType: 'currency',
    },
    {
      key: 'avgCustomerCost',
      id: 'overall.avg_customer_cost',
      inlineText: `当前范围单客成本 ${currency(overall.avgCustomerCost)}`,
      valueType: 'currency',
    },
    {
      key: 'platformRevenueShare',
      id: 'overall.platform_share',
      inlineText: `当前范围平台占比 ${percent(overall.platformRevenueShare)}`,
      valueType: 'percent',
    },
    {
      key: 'healthScore',
      id: 'overall.health_score',
      inlineText: `当前范围健康度 ${integerText(overall.healthScore)} 分`,
      valueType: 'count',
    },
  ].forEach((fact) => {
    if (overall[fact.key] === null || overall[fact.key] === undefined) {
      return;
    }

    pushFact(catalog, {
      id: fact.id,
      factScope: 'overall',
      valueType: fact.valueType,
      value: overall[fact.key],
      promptText: fact.inlineText,
      inlineText: fact.inlineText,
    });
  });

  const overallTopCategory = (context.costBreakdown || [])[0];

  if (overallTopCategory) {
    pushFact(catalog, {
      id: 'overall.top_cost_category',
      factScope: 'overall',
      valueType: 'text',
      promptText: `当前范围最大成本项 ${overallTopCategory.name}（${currency(
        overallTopCategory.value,
      )}，占总成本 ${percent(overallTopCategory.ratio)}）`,
      inlineText: `当前范围最大成本项 ${overallTopCategory.name}（${currency(
        overallTopCategory.value,
      )}，占总成本 ${percent(overallTopCategory.ratio)}）`,
    });
  }

  const overallTopItem = (context.topCostItems || [])[0];

  if (overallTopItem) {
    pushFact(catalog, {
      id: 'overall.top_cost_item',
      factScope: 'overall',
      valueType: 'text',
      promptText: `当前范围重点成本项 ${overallTopItem.name}（${currency(
        overallTopItem.amount || overallTopItem.value,
      )}）`,
      inlineText: `当前范围重点成本项 ${overallTopItem.name}（${currency(
        overallTopItem.amount || overallTopItem.value,
      )}）`,
    });
  }

  const rankedStores = [...(context.storeBenchmarks || [])];
  const priorityStore = [...rankedStores].sort((left, right) => {
    if (left.healthScore !== right.healthScore) {
      return left.healthScore - right.healthScore;
    }

    if (left.profitMargin !== right.profitMargin) {
      return left.profitMargin - right.profitMargin;
    }

    return right.platformRevenueShare - left.platformRevenueShare;
  })[0];
  const marginLeader = [...rankedStores].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];

  if (priorityStore) {
    pushFact(catalog, {
      id: 'overall.priority_store',
      factScope: 'overall',
      storeId: priorityStore.storeId,
      storeName: priorityStore.storeName,
      valueType: 'text',
      promptText: `最值得优先整改的门店是 ${priorityStore.storeName}（健康度 ${integerText(
        priorityStore.healthScore,
      )} 分，利润率 ${percent(priorityStore.profitMargin)}，平台占比 ${percent(
        priorityStore.platformRevenueShare,
      )}）`,
      inlineText: `最值得优先整改的门店是 ${priorityStore.storeName}（健康度 ${integerText(
        priorityStore.healthScore,
      )} 分，利润率 ${percent(priorityStore.profitMargin)}，平台占比 ${percent(
        priorityStore.platformRevenueShare,
      )}）`,
    });
  }

  if (marginLeader) {
    pushFact(catalog, {
      id: 'overall.best_margin_store',
      factScope: 'overall',
      storeId: marginLeader.storeId,
      storeName: marginLeader.storeName,
      valueType: 'text',
      promptText: `利润率最高门店 ${marginLeader.storeName}（${percent(
        marginLeader.profitMargin,
      )}）`,
      inlineText: `利润率最高门店 ${marginLeader.storeName}（${percent(
        marginLeader.profitMargin,
      )}）`,
    });
  }

  const snapshotMap = new Map(
    (context.reportSnapshots || [])
      .filter((snapshot) => snapshot?.storeId)
      .map((snapshot) => [snapshot.storeId, snapshot]),
  );

  (context.storeBenchmarks || []).forEach((store) => {
    const storeKey = sanitizeFactPart(store.storeId || store.storeName);
    const prefix = `store.${storeKey}`;
    const storeName = store.storeName || store.storeId || '门店';
    const snapshot = snapshotMap.get(store.storeId) || null;

    [
      {
        key: 'revenue',
        suffix: 'revenue',
        inlineText: `${storeName}营收 ${currency(store.revenue)}`,
        valueType: 'currency',
      },
      {
        key: 'profit',
        suffix: 'profit',
        inlineText: `${storeName}净利润 ${currency(store.profit)}`,
        valueType: 'currency',
      },
      {
        key: 'profitMargin',
        suffix: 'profit_margin',
        inlineText: `${storeName}利润率 ${percent(store.profitMargin)}`,
        valueType: 'percent',
      },
      {
        key: 'avgTicket',
        suffix: 'avg_ticket',
        inlineText: `${storeName}客单价 ${currency(store.avgTicket)}`,
        valueType: 'currency',
      },
      {
        key: 'avgCustomerCost',
        suffix: 'avg_customer_cost',
        inlineText: `${storeName}单客成本 ${currency(store.avgCustomerCost)}`,
        valueType: 'currency',
      },
      {
        key: 'platformRevenueShare',
        suffix: 'platform_share',
        inlineText: `${storeName}平台占比 ${percent(store.platformRevenueShare)}`,
        valueType: 'percent',
      },
      {
        key: 'healthScore',
        suffix: 'health_score',
        inlineText: `${storeName}健康度 ${integerText(store.healthScore)} 分`,
        valueType: 'count',
      },
      {
        key: 'newMembers',
        suffix: 'new_members',
        inlineText: `${storeName}新增会员 ${integerText(store.newMembers)} 人`,
        valueType: 'count',
      },
    ].forEach((fact) => {
      if (store[fact.key] === null || store[fact.key] === undefined) {
        return;
      }

      pushFact(catalog, {
        id: `${prefix}.${fact.suffix}`,
        factScope: 'store',
        storeId: store.storeId,
        storeName,
        valueType: fact.valueType,
        value: store[fact.key],
        promptText: fact.inlineText,
        inlineText: fact.inlineText,
      });
    });

    if (snapshot?.summary?.customerCount !== null && snapshot?.summary?.customerCount !== undefined) {
      pushFact(catalog, {
        id: `${prefix}.customer_count`,
        factScope: 'store',
        storeId: store.storeId,
        storeName,
        valueType: 'count',
        value: snapshot.summary.customerCount,
        promptText: `${storeName}客户数 ${integerText(snapshot.summary.customerCount)} 人次`,
        inlineText: `${storeName}客户数 ${integerText(snapshot.summary.customerCount)} 人次`,
      });
    }

    const topCategory = snapshot?.topCostCategories?.[0];

    if (topCategory) {
      pushFact(catalog, {
        id: `${prefix}.top_cost_category`,
        factScope: 'store',
        storeId: store.storeId,
        storeName,
        valueType: 'text',
        promptText: `${storeName}最大成本项 ${topCategory.name}（${currency(
          topCategory.amount,
        )}，占总成本 ${percent(topCategory.ratio)}）`,
        inlineText: `${storeName}最大成本项 ${topCategory.name}（${currency(
          topCategory.amount,
        )}，占总成本 ${percent(topCategory.ratio)}）`,
      });
    }

    const topItem = snapshot?.topCostItems?.[0];

    if (topItem) {
      pushFact(catalog, {
        id: `${prefix}.top_cost_item`,
        factScope: 'store',
        storeId: store.storeId,
        storeName,
        valueType: 'text',
        promptText: `${storeName}重点成本项 ${topItem.name}（${currency(topItem.amount)}）`,
        inlineText: `${storeName}重点成本项 ${topItem.name}（${currency(topItem.amount)}）`,
      });
    }
  });

  const peer = context.peerComparison;

  if (peer?.focusStore?.storeId) {
    const storeKey = sanitizeFactPart(peer.focusStore.storeId);
    const prefix = `peer.${storeKey}`;
    const storeName = peer.focusStore.storeName || peer.focusStore.storeId;

    [
      {
        value: peer.samePeriodAverage?.profitMargin,
        suffix: 'avg_profit_margin',
        inlineText: `同期门店平均利润率 ${percent(peer.samePeriodAverage?.profitMargin)}`,
        valueType: 'percent',
      },
      {
        value: peer.samePeriodAverage?.avgTicket,
        suffix: 'avg_avg_ticket',
        inlineText: `同期门店平均客单价 ${currency(peer.samePeriodAverage?.avgTicket)}`,
        valueType: 'currency',
      },
      {
        value: peer.samePeriodAverage?.avgCustomerCost,
        suffix: 'avg_avg_customer_cost',
        inlineText: `同期门店平均单客成本 ${currency(
          peer.samePeriodAverage?.avgCustomerCost,
        )}`,
        valueType: 'currency',
      },
      {
        value: peer.samePeriodAverage?.platformRevenueShare,
        suffix: 'avg_platform_share',
        inlineText: `同期门店平均平台占比 ${percent(
          peer.samePeriodAverage?.platformRevenueShare,
        )}`,
        valueType: 'percent',
      },
      {
        value: peer.samePeriodAverage?.healthScore,
        suffix: 'avg_health_score',
        inlineText: `同期门店平均健康度 ${integerText(peer.samePeriodAverage?.healthScore)} 分`,
        valueType: 'count',
      },
    ].forEach((fact) => {
      if (fact.value === null || fact.value === undefined) {
        return;
      }

      pushFact(catalog, {
        id: `${prefix}.${fact.suffix}`,
        factScope: 'peer',
        storeId: peer.focusStore.storeId,
        storeName,
        valueType: fact.valueType,
        value: fact.value,
        promptText: fact.inlineText,
        inlineText: fact.inlineText,
      });
    });

    [
      {
        value: peer.focusVsAverage?.profitMarginGap,
        suffix: 'gap_profit_margin',
        inlineText: buildGapText(
          '利润率',
          storeName,
          peer.focusVsAverage?.profitMarginGap,
          percentPoint,
        ),
      },
      {
        value: peer.focusVsAverage?.avgTicketGap,
        suffix: 'gap_avg_ticket',
        inlineText: buildGapText(
          '客单价',
          storeName,
          peer.focusVsAverage?.avgTicketGap,
          currency,
        ),
      },
      {
        value: peer.focusVsAverage?.avgCustomerCostGap,
        suffix: 'gap_avg_customer_cost',
        inlineText: buildGapText(
          '单客成本',
          storeName,
          peer.focusVsAverage?.avgCustomerCostGap,
          currency,
        ),
      },
      {
        value: peer.focusVsAverage?.platformRevenueShareGap,
        suffix: 'gap_platform_share',
        inlineText: buildGapText(
          '平台占比',
          storeName,
          peer.focusVsAverage?.platformRevenueShareGap,
          percentPoint,
        ),
      },
      {
        value: peer.focusVsAverage?.healthScoreGap,
        suffix: 'gap_health_score',
        inlineText: buildGapText(
          '健康度',
          storeName,
          peer.focusVsAverage?.healthScoreGap,
          integerText,
        ),
      },
    ].forEach((fact) => {
      if (fact.value === null || fact.value === undefined) {
        return;
      }

      pushFact(catalog, {
        id: `${prefix}.${fact.suffix}`,
        factScope: 'peer',
        storeId: peer.focusStore.storeId,
        storeName,
        valueType: 'text',
        value: fact.value,
        promptText: fact.inlineText,
        inlineText: fact.inlineText,
      });
    });

    [
      {
        value: peer.focusStoreRanks?.profitMargin,
        suffix: 'rank_profit_margin',
        inlineText: `${storeName}利润率排名 ${integerText(
          peer.focusStoreRanks?.profitMargin,
        )}/${integerText(peer.peerStoreCount)}`,
      },
      {
        value: peer.focusStoreRanks?.platformRevenueShare,
        suffix: 'rank_platform_share',
        inlineText: `${storeName}平台占比排名 ${integerText(
          peer.focusStoreRanks?.platformRevenueShare,
        )}/${integerText(peer.peerStoreCount)}`,
      },
      {
        value: peer.focusStoreRanks?.healthScore,
        suffix: 'rank_health_score',
        inlineText: `${storeName}健康度排名 ${integerText(
          peer.focusStoreRanks?.healthScore,
        )}/${integerText(peer.peerStoreCount)}`,
      },
    ].forEach((fact) => {
      if (!fact.value) {
        return;
      }

      pushFact(catalog, {
        id: `${prefix}.${fact.suffix}`,
        factScope: 'peer',
        storeId: peer.focusStore.storeId,
        storeName,
        valueType: 'text',
        value: fact.value,
        promptText: fact.inlineText,
        inlineText: fact.inlineText,
      });
    });

    [
      {
        leader: peer.leaders?.revenueLeader,
        id: 'leader.revenue',
        inlineText: peer.leaders?.revenueLeader
          ? `营收领先门店 ${peer.leaders.revenueLeader.storeName}（${currency(
              peer.leaders.revenueLeader.revenue,
            )}）`
          : '',
      },
      {
        leader: peer.leaders?.profitMarginLeader,
        id: 'leader.profit_margin',
        inlineText: peer.leaders?.profitMarginLeader
          ? `利润率领先门店 ${peer.leaders.profitMarginLeader.storeName}（${percent(
              peer.leaders.profitMarginLeader.profitMargin,
            )}）`
          : '',
      },
      {
        leader: peer.leaders?.healthLeader,
        id: 'leader.health',
        inlineText: peer.leaders?.healthLeader
          ? `健康度领先门店 ${peer.leaders.healthLeader.storeName}（${integerText(
              peer.leaders.healthLeader.healthScore,
            )} 分）`
          : '',
      },
    ].forEach((fact) => {
      if (!fact.leader || !fact.inlineText) {
        return;
      }

      pushFact(catalog, {
        id: fact.id,
        factScope: 'leader',
        storeId: fact.leader.storeId || '',
        storeName: fact.leader.storeName || '',
        valueType: 'text',
        promptText: fact.inlineText,
        inlineText: fact.inlineText,
      });
    });
  }

  catalog.facts = dedupeFacts(catalog.facts);
  return catalog;
}

function buildFactMap(catalog = {}) {
  return new Map(
    (catalog.facts || [])
      .filter((fact) => fact?.id)
      .map((fact) => [fact.id, fact]),
  );
}

function scoreFactForRequest(fact, requestResolution = {}) {
  let score = 0;
  const targetStoreId = requestResolution.storeId || '';
  const status = requestResolution.status || '';

  if (fact.factScope === 'overall') {
    score += 10;
  }

  if (fact.factScope === 'leader') {
    score += 6;
  }

  if (fact.factScope === 'peer') {
    score += 12;
  }

  if (fact.factScope === 'store') {
    score += 8;
  }

  if (targetStoreId && fact.storeId === targetStoreId) {
    score += 24;
  }

  if (!targetStoreId && fact.factScope === 'store') {
    score += 4;
  }

  if (status === 'store_analysis' || status === 'metric_analysis') {
    if (fact.factScope === 'peer') {
      score += 6;
    }

    if (fact.id.endsWith('.top_cost_category') || fact.id.endsWith('.top_cost_item')) {
      score += 8;
    }
  }

  return score;
}

function formatGroundedFactsForPrompt(catalog = {}, options = {}) {
  const limit = Number(options.limit || DEFAULT_FACT_LIMIT);
  const requestResolution = options.requestResolution || {};
  const facts = [...(catalog.facts || [])]
    .sort((left, right) => {
      const scoreGap =
        scoreFactForRequest(right, requestResolution) -
        scoreFactForRequest(left, requestResolution);

      if (scoreGap !== 0) {
        return scoreGap;
      }

      return left.id.localeCompare(right.id);
    })
    .slice(0, limit);

  return facts.map((fact) => `- ${fact.id}: ${fact.promptText}`).join('\n');
}

const FACT_TOKEN_PATTERN = /\{\{\s*FACT:([a-zA-Z0-9._-]+)\s*\}\}/g;

function extractFactIds(text = '') {
  return [...String(text || '').matchAll(FACT_TOKEN_PATTERN)].map((match) => match[1]);
}

function stripFactTokens(text = '') {
  return String(text || '').replace(FACT_TOKEN_PATTERN, '');
}

function hasUnsupportedRawNumbers(text = '') {
  return /\d/.test(stripFactTokens(text));
}

function renderGroundedText(text = '', catalog = {}, options = {}) {
  const factMap = buildFactMap(catalog);
  let hasUnknownFactId = false;

  const rendered = String(text || '').replace(FACT_TOKEN_PATTERN, (_, factId) => {
    const fact = factMap.get(factId);

    if (!fact) {
      hasUnknownFactId = true;
      return '';
    }

    return fact.inlineText;
  });

  return {
    text: normalizeText(rendered, options.maxLength || 240),
    hasUnknownFactId,
    rawHasUnsupportedNumber: hasUnsupportedRawNumbers(text),
    factIds: extractFactIds(text),
  };
}

function sanitizeGroundedText(text, catalog = {}, fallback = '', options = {}) {
  const rendered = renderGroundedText(text, catalog, options);

  if (
    !rendered.text ||
    rendered.hasUnknownFactId ||
    rendered.rawHasUnsupportedNumber
  ) {
    return normalizeText(fallback, options.maxLength || 240);
  }

  return rendered.text;
}

function sanitizeGroundedList(items, catalog = {}, fallbackItems = [], options = {}) {
  const limit = Number(options.limit || 3);
  const maxLength = Number(options.maxLength || 180);
  const normalized = [];

  for (const item of items || []) {
    const text = sanitizeGroundedText(item, catalog, '', {
      maxLength,
    });

    if (text && !normalized.includes(text)) {
      normalized.push(text);
    }

    if (normalized.length >= limit) {
      break;
    }
  }

  if (normalized.length) {
    return normalized;
  }

  return [...new Set((fallbackItems || []).map((item) => normalizeText(item, maxLength)).filter(Boolean))].slice(
    0,
    limit,
  );
}

module.exports = {
  buildFinancialFactCatalog,
  formatGroundedFactsForPrompt,
  hasUnsupportedRawNumbers,
  renderGroundedText,
  sanitizeGroundedList,
  sanitizeGroundedText,
};
