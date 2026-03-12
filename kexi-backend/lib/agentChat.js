const { readSettings } = require('./appSettings');
const {
  FINANCIAL_ANALYST_AGENT_NAME,
  FINANCIAL_ANALYST_AGENT_VERSION,
} = require('./financialAgentPrompt');
const {
  STORE_REGISTRY,
  cleanText,
  inferPeriod,
  resolveStore,
} = require('./financialConstants');
const { buildFinancialContextBundle } = require('./financialAi');
const { runZhipuFinancialChatAgent } = require('./zhipuFinancialAgent');

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function currency(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function percentPoint(value) {
  return `${Math.abs(Number(value || 0) * 100).toFixed(1)} 个百分点`;
}

function normalizeText(value, maxLength = 1600) {
  const text = String(value || '')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (!text) {
    return '';
  }

  return text.slice(0, maxLength);
}

function buildFinancialAgentMeta({
  mode,
  provider = mode === 'llm' ? 'zhipu' : 'local',
  model = '',
  note = '',
}) {
  return {
    id: 'financial_analyst',
    name: FINANCIAL_ANALYST_AGENT_NAME,
    version: FINANCIAL_ANALYST_AGENT_VERSION,
    mode,
    provider,
    model,
    note,
  };
}

function normalizeMonthToken(token) {
  const map = {
    一: '01',
    二: '02',
    三: '03',
    四: '04',
    五: '05',
    六: '06',
    七: '07',
    八: '08',
    九: '09',
    十: '10',
    十一: '11',
    十二: '12',
  };

  if (!token) {
    return null;
  }

  if (map[token]) {
    return map[token];
  }

  const numeric = Number(token);

  if (numeric >= 1 && numeric <= 12) {
    return String(numeric).padStart(2, '0');
  }

  return null;
}

function inferPeriodFromQuestion(question, reports) {
  const explicit = inferPeriod(question);

  if (explicit) {
    return explicit;
  }

  const text = String(question || '');
  const monthMatch = text.match(/(十二|十一|十|一|二|三|四|五|六|七|八|九|1[0-2]|0?[1-9])\s*月/);

  if (!monthMatch) {
    return null;
  }

  const month = normalizeMonthToken(monthMatch[1]);

  if (!month) {
    return null;
  }

  const matchingPeriods = reports
    .map((report) => report.period)
    .filter((period) => period.endsWith(`-${month}`))
    .sort();

  if (matchingPeriods.length) {
    return matchingPeriods[matchingPeriods.length - 1];
  }

  const latestYear = reports
    .map((report) => report.period.split('-')[0])
    .sort()
    .pop();

  return latestYear ? `${latestYear}-${month}` : null;
}

function inferQuestionFilters(question, reports) {
  const store = resolveStore(question);
  const period = inferPeriodFromQuestion(question, reports);

  return {
    storeIds: store ? [store.id] : [],
    periodStart: period,
    periodEnd: period,
  };
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((Number(value || 0) + Number.EPSILON) * factor) / factor;
}

function exactCurrency(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function integerText(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

function normalizeLookupText(value) {
  return String(value || '')
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '')
    .toLowerCase();
}

function formatPeriodLabelFromPeriod(period) {
  if (!period) {
    return '未指定月份';
  }

  const [year, month] = String(period).split('-');
  return `${year}年${Number(month)}月`;
}

function computeCategoryAmount(category) {
  if (Number.isFinite(Number(category?.amount))) {
    return roundNumber(category.amount);
  }

  return roundNumber(
    (category?.items || []).reduce(
      (sum, item) => sum + Number(item.amount || 0),
      0,
    ),
  );
}

function computeCategoryRatio(category, totalCost = 0) {
  if (Number.isFinite(Number(category?.ratio))) {
    return Number(category.ratio);
  }

  const amount = computeCategoryAmount(category);
  return totalCost > 0 ? roundNumber(amount / totalCost, 4) : 0;
}

const SUMMARY_LOOKUPS = [
  {
    key: 'recognizedRevenue',
    label: '营收',
    aliases: ['营收', '收入', '营业额', '认收'],
    getValue: (report) => report.summary?.recognizedRevenue,
    formatter: exactCurrency,
  },
  {
    key: 'grossRevenue',
    label: '总实收',
    aliases: ['总实收', '实收', '毛收入', '毛营收'],
    getValue: (report) => report.summary?.grossRevenue,
    formatter: exactCurrency,
  },
  {
    key: 'profit',
    label: '净利润',
    aliases: ['净利润', '利润'],
    getValue: (report) => report.summary?.profit,
    formatter: exactCurrency,
  },
  {
    key: 'profitMargin',
    label: '利润率',
    aliases: ['利润率', '净利率'],
    getValue: (report) => report.summary?.profitMargin,
    formatter: percent,
  },
  {
    key: 'totalCost',
    label: '总成本',
    aliases: ['总成本', '总费用'],
    getValue: (report) => report.summary?.totalCost,
    formatter: exactCurrency,
  },
  {
    key: 'avgTicket',
    label: '客单价',
    aliases: ['客单价', '客单'],
    getValue: (report) => report.summary?.avgTicket,
    formatter: exactCurrency,
  },
  {
    key: 'avgCustomerCost',
    label: '单客成本',
    aliases: ['单客成本', '单客费用', '单客花费'],
    getValue: (report) => report.summary?.avgCustomerCost,
    formatter: exactCurrency,
  },
  {
    key: 'platformRevenueShare',
    label: '平台占比',
    aliases: ['平台占比', '平台收入占比', '平台订单占比'],
    getValue: (report) => report.summary?.platformRevenueShare,
    formatter: percent,
  },
  {
    key: 'customerCount',
    label: '客户数',
    aliases: ['客户数', '客数', '客流', '到店人数'],
    getValue: (report) => report.summary?.customerCount,
    formatter: integerText,
  },
  {
    key: 'newMembers',
    label: '新增会员',
    aliases: ['新增会员', '新会员'],
    getValue: (report) => report.summary?.newMembers,
    formatter: integerText,
  },
];

const CATEGORY_ALIASES = {
  水电: ['水电费', '水电成本'],
  '门店宿舍 租金': ['租金总成本', '房租总成本', '租金支出', '房租支出', '房租成本', '门店租金', '租金', '店租'],
  手续费: ['平台手续费', '手续费成本'],
  生活费: ['生活费', '餐费成本'],
  消耗品: ['耗材', '消耗品成本'],
  增值服务: ['增值服务成本'],
  头疗师工资: ['头疗师工资', '技师工资', '手工工资'],
  管理工资: ['管理工资', '管理人员工资'],
  付管理公司: ['管理公司费用', '管理费加推广费'],
  工程维修: ['工程维修', '维修费'],
  其他开支: ['其他费用'],
  其它开支: ['其它费用'],
  其他工资: ['其他工资'],
};

const ITEM_ALIASES = {
  电: ['电费'],
  水: ['水费'],
  门店租金: ['房租', '门店房租'],
  物业费: ['物业费'],
  宿舍: ['宿舍费'],
  管理费: ['管理费'],
  推广费: ['推广费', '投流费', '广告费'],
  餐费: ['餐费'],
};

function buildAliasList(label, extraAliases = []) {
  return [...new Set([label, ...extraAliases].map(normalizeLookupText).filter(Boolean))];
}

function getLookupMatchScore(normalizedQuestion, aliases = []) {
  return aliases.reduce((best, alias) => {
    if (!alias) {
      return best;
    }

    if (alias.length === 1) {
      return best;
    }

    return normalizedQuestion.includes(alias) ? Math.max(best, alias.length) : best;
  }, 0);
}

function wantsRatioAnswer(question = '') {
  return /(占比|比例|比重|费率)/.test(String(question || ''));
}

function isAnalysisIntent(question = '') {
  return /(为什么|为何|原因|分析|建议|整改|优先|对比|趋势|怎么|如何|拆解|动作|问题|风险|改善|优化|解释)/.test(
    String(question || ''),
  );
}

function isMetricAnalysisQuestion(question = '') {
  return /(高吗|低吗|贵吗|偏高|偏低|正常吗|合理吗|怎么样|为什么|为何|原因|分析|怎么看)/.test(
    String(question || ''),
  );
}

function isFactLookupQuestion(question = '') {
  return /(多少|几|是多少|金额|占比|比例|费用|费|成本|支出|收入|营收|利润|利润率|客单价|单客成本|会员|客户|水电|租金|房租|手续费|物业费)/.test(
    String(question || ''),
  );
}

function shouldUseDirectLookup(question = '') {
  return isFactLookupQuestion(question) && !isAnalysisIntent(question);
}

function asksForAllStores(question = '') {
  return /(?:\u6240\u6709\u95e8\u5e97|\u5168\u90e8\u95e8\u5e97|\u6240\u6709\u5e97|\u5168\u90e8\u5e97|\u5404\u95e8\u5e97|\u5404\u5e97|\u6bcf\u4e2a\u95e8\u5e97|\u6bcf\u5bb6\u95e8\u5e97|\u516d\u5bb6\u95e8\u5e97|6\u5bb6\u95e8\u5e97|6\u4e2a\u95e8\u5e97|6\u5bb6\u5e97|\u5206\u522b\u5217|\u9010\u5e97|\u4e00\u5bb6\u4e00\u5bb6|^\s*\u95e8\u5e97(?=.*(?:\u660e\u7ec6|\u6392\u540d|\u5bf9\u6bd4|\u82b1\u8d39|\u8d39\u7528|\u6210\u672c|\u652f\u51fa|\u591a\u5c11)))/.test(
    String(question || ''),
  );
}

function sanitizeAllStoresLookupQuestion(question = '') {
  return String(question || '')
    .replace(
      /(?:\u6240\u6709\u95e8\u5e97|\u5168\u90e8\u95e8\u5e97|\u6240\u6709\u5e97|\u5168\u90e8\u5e97|\u5404\u95e8\u5e97|\u5404\u5e97|\u6bcf\u4e2a\u95e8\u5e97|\u6bcf\u5bb6\u95e8\u5e97|\u516d\u5bb6\u95e8\u5e97|6\u5bb6\u95e8\u5e97|6\u4e2a\u95e8\u5e97|6\u5bb6\u5e97)/g,
      ' ',
    )
    .replace(
      /(?:\u5206\u522b\u5217\u4e00\u4e0b|\u5206\u522b\u5217\u51fa|\u5206\u522b|\u9010\u5e97|\u4e00\u5bb6\u4e00\u5bb6|\u5217\u4e00\u4e0b|\u5217\u51fa)/g,
      ' ',
    )
    .replace(/^\s*\u95e8\u5e97/g, ' ')
    .replace(/(?:\u82b1\u8d39\u660e\u7ec6|\u8d39\u7528\u660e\u7ec6|\u652f\u51fa\u660e\u7ec6|\u660e\u7ec6\u6570\u636e|\u60c5\u51b5\u5982\u4e0b|\u60c5\u51b5|\u660e\u7ec6|\u6570\u636e)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLatestReportPeriod(reports = []) {
  return [...new Set((reports || []).map((report) => report.period).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .pop() || null;
}

function getStoreOrder(storeId = '') {
  const index = STORE_REGISTRY.findIndex((store) => store.id === storeId);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function sortReportsByStoreOrder(reports = []) {
  return [...reports].sort((left, right) => {
    const leftOrder = getStoreOrder(left.storeId);
    const rightOrder = getStoreOrder(right.storeId);

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    return String(left.storeName || '').localeCompare(String(right.storeName || ''), 'zh-CN');
  });
}

function findCategoryByAliases(report, aliases = []) {
  return (report.categories || []).find((category) => {
    const categoryAliases = buildAliasList(
      category.name,
      CATEGORY_ALIASES[category.name] || [],
    );
    return categoryAliases.some((alias) => aliases.includes(alias));
  }) || null;
}

function findItemByAliases(report, aliases = []) {
  for (const category of report.categories || []) {
    for (const item of category.items || []) {
      const itemAliases = buildAliasList(item.name, ITEM_ALIASES[item.name] || []);

      if (itemAliases.some((alias) => aliases.includes(alias))) {
        return {
          category,
          item,
        };
      }
    }
  }

  return null;
}

function findSummaryMetricByAliases(report, aliases = []) {
  return (
    (report.summaryMetrics || []).find((metric) => {
      const metricAliases = buildAliasList(metric.label);
      return metricAliases.some((alias) => aliases.includes(alias));
    }) || null
  );
}

function formatSummaryMetricValue(metric, value = metric?.numericValue) {
  if (metric?.valueType === 'percent') {
    return percent(value);
  }

  if (metric?.valueType === 'count') {
    return integerText(value);
  }

  if (metric?.valueType === 'amount') {
    return exactCurrency(value);
  }

  return cleanText(metric?.rawValue || value || '');
}

function findLookupReport(question, reports) {
  const store = resolveStore(question);

  if (!store) {
    return {
      store: null,
      report: null,
      requestedPeriod: inferPeriodFromQuestion(question, reports),
      usedLatestPeriod: false,
    };
  }

  const requestedPeriod = inferPeriodFromQuestion(question, reports);
  const storeReports = reports
    .filter((report) => report.storeId === store.id)
    .sort((left, right) => left.period.localeCompare(right.period));

  if (!storeReports.length) {
    return {
      store,
      report: null,
      requestedPeriod,
      usedLatestPeriod: false,
    };
  }

  const report = requestedPeriod
    ? storeReports.find((item) => item.period === requestedPeriod) || null
    : storeReports[storeReports.length - 1];

  return {
    store,
    report,
    requestedPeriod,
    usedLatestPeriod: !requestedPeriod && Boolean(report),
  };
}

function pickLookupTarget(question, report) {
  const normalizedQuestion = normalizeLookupText(question);
  const answerAsRatio = wantsRatioAnswer(question);
  const candidates = [];

  SUMMARY_LOOKUPS.forEach((metric) => {
    const aliases = buildAliasList(metric.label, metric.aliases);
    const matchScore = getLookupMatchScore(normalizedQuestion, aliases);

    if (!matchScore) {
      return;
    }

    const value = metric.getValue(report);

    candidates.push({
      kind: 'summary',
      key: metric.key,
      label: metric.label,
      aliases,
      matchScore,
      priority: 1,
      value,
      formattedValue: metric.formatter(value),
      formatter: metric.formatter,
      valueForReport: (peerReport) => metric.getValue(peerReport),
    });
  });

  (report.summaryMetrics || []).forEach((metric) => {
    const aliases = buildAliasList(metric.label);
    const matchScore = getLookupMatchScore(normalizedQuestion, aliases);

    if (!matchScore) {
      return;
    }

    const formattedValue = formatSummaryMetricValue(metric);

    candidates.push({
      kind: 'summary_metric',
      label: metric.label,
      aliases,
      matchScore,
      priority: 1,
      value: metric.numericValue,
      formattedValue,
      formatter: (value) => formatSummaryMetricValue(metric, value),
      valueForReport: (peerReport) => {
        const matchedMetric = findSummaryMetricByAliases(peerReport, aliases);
        return matchedMetric ? matchedMetric.numericValue : null;
      },
    });
  });

  (report.categories || []).forEach((category) => {
    const amount = computeCategoryAmount(category);
    const ratio = computeCategoryRatio(category, report.summary?.totalCost || 0);
    const aliases = buildAliasList(
      category.name,
      CATEGORY_ALIASES[category.name] || [],
    );
    const categoryMatchScore = getLookupMatchScore(normalizedQuestion, aliases);

    if (categoryMatchScore) {
      candidates.push({
        kind: 'category',
        label: category.name,
        aliases,
        matchScore: categoryMatchScore,
        priority: 2,
        amount,
        ratio,
        value: answerAsRatio ? ratio : amount,
        formattedValue: answerAsRatio ? percent(ratio) : exactCurrency(amount),
        formatter: answerAsRatio ? percent : exactCurrency,
        wantsRatio: answerAsRatio,
        breakdown: [...(category.items || [])]
          .filter((item) => Math.abs(Number(item.amount || 0)) > 0)
          .sort(
            (left, right) =>
              Math.abs(Number(right.amount || 0)) -
              Math.abs(Number(left.amount || 0)),
          )
          .map((item) => ({
            label: item.name,
            amount: roundNumber(item.amount),
          })),
        valueForReport: (peerReport) => {
          const matchedCategory = findCategoryByAliases(peerReport, aliases);

          if (!matchedCategory) {
            return null;
          }

          const matchedAmount = computeCategoryAmount(matchedCategory);

          if (answerAsRatio) {
            return computeCategoryRatio(
              matchedCategory,
              peerReport.summary?.totalCost || 0,
            );
          }

          return matchedAmount;
        },
      });
    }

    (category.items || []).forEach((item) => {
      const aliases = buildAliasList(item.name, ITEM_ALIASES[item.name] || []);
      const itemMatchScore = getLookupMatchScore(normalizedQuestion, aliases);

      if (!itemMatchScore) {
        return;
      }

      const amount = roundNumber(item.amount);
      const ratio =
        Number(report.summary?.totalCost || 0) > 0
          ? roundNumber(amount / report.summary.totalCost, 4)
          : 0;

      candidates.push({
        kind: 'item',
        label: item.name,
        categoryName: category.name,
        aliases,
        matchScore: itemMatchScore,
        priority: 3,
        amount,
        ratio,
        value: answerAsRatio ? ratio : amount,
        formattedValue: answerAsRatio ? percent(ratio) : exactCurrency(amount),
        formatter: answerAsRatio ? percent : exactCurrency,
        wantsRatio: answerAsRatio,
        valueForReport: (peerReport) => {
          const matchedItem = findItemByAliases(peerReport, aliases);

          if (!matchedItem) {
            return null;
          }

          const matchedAmount = roundNumber(matchedItem.item.amount);

          if (answerAsRatio) {
            return Number(peerReport.summary?.totalCost || 0) > 0
              ? roundNumber(matchedAmount / peerReport.summary.totalCost, 4)
              : 0;
          }

          return matchedAmount;
        },
      });
    });
  });

  return candidates.sort((left, right) => {
    if (right.matchScore !== left.matchScore) {
      return right.matchScore - left.matchScore;
    }

    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }

    return String(right.label || '').length - String(left.label || '').length;
  })[0] || null;
}

function buildLookupPeerComparison({ report, target, reports }) {
  const peers = reports
    .filter((item) => item.period === report.period)
    .map((peerReport) => ({
      storeId: peerReport.storeId,
      storeName: peerReport.storeName,
      value: target.valueForReport(peerReport),
    }))
    .filter((item) => item.value !== null && item.value !== undefined);

  if (peers.length < 2) {
    return null;
  }

  const byHigh = [...peers].sort((left, right) => right.value - left.value);
  const byLow = [...peers].sort((left, right) => left.value - right.value);

  return {
    count: peers.length,
    average:
      peers.reduce((sum, item) => sum + Number(item.value || 0), 0) / peers.length,
    higherRank: byHigh.findIndex((item) => item.storeId === report.storeId) + 1,
    lowerRank: byLow.findIndex((item) => item.storeId === report.storeId) + 1,
    highest: byHigh[0],
    lowest: byLow[0],
  };
}

function buildAllStoresPeerComparison(rows = []) {
  const numericRows = rows.filter((row) => row.value !== null && row.value !== undefined);

  if (!numericRows.length) {
    return null;
  }

  const byHigh = [...numericRows].sort((left, right) => right.value - left.value);
  const byLow = [...numericRows].sort((left, right) => left.value - right.value);

  return {
    count: rows.length,
    numericCount: numericRows.length,
    average:
      numericRows.reduce((sum, row) => sum + Number(row.value || 0), 0) / numericRows.length,
    highest: byHigh[0],
    lowest: byLow[0],
  };
}

function buildDirectLookupFacts({ report, target, peerComparison, usedLatestPeriod }) {
  const facts = [
    `已直接查询原始月报：${report.storeName} ${report.periodLabel || formatPeriodLabelFromPeriod(report.period)} ${target.label}为 ${target.formattedValue}。`,
  ];

  if (target.kind === 'item' && target.categoryName) {
    facts.push(`该指标归属科目：${target.categoryName}。`);
  }

  if (target.kind === 'category' && !target.wantsRatio && target.breakdown?.length) {
    facts.push(
      `明细：${target.breakdown
        .map((item) => `${item.label} ${exactCurrency(item.amount)}`)
        .join('；')}。`,
    );
  }

  if (peerComparison) {
    facts.push(
      `同月对比：最高为 ${peerComparison.highest.storeName} ${target.formatter(
        peerComparison.highest.value,
      )}，最低为 ${peerComparison.lowest.storeName} ${target.formatter(
        peerComparison.lowest.value,
      )}，${report.storeName} 排第 ${peerComparison.higherRank} 高。`,
    );
  }

  if (usedLatestPeriod) {
    facts.push(
      `用户未指定月份，已按该门店最新月报 ${report.periodLabel || formatPeriodLabelFromPeriod(report.period)} 查询。`,
    );
  }

  return facts;
}

function buildDirectLookupReply({ report, target, peerComparison, usedLatestPeriod }) {
  const lines = [
    '## 查询结果',
    `- 门店：${report.storeName}`,
    `- 月份：${report.periodLabel || formatPeriodLabelFromPeriod(report.period)}`,
    `- 指标：${target.wantsRatio ? `${target.label}占总成本比例` : target.label}`,
    `- 结果：**${target.formattedValue}**`,
  ];

  if (target.kind === 'item' && target.categoryName) {
    lines.push(`- 归属科目：${target.categoryName}`);
  }

  if (target.kind === 'category' && !target.wantsRatio && target.breakdown?.length) {
    lines.push('', '## 明细');
    target.breakdown.forEach((item) => {
      lines.push(`- ${item.label}：${exactCurrency(item.amount)}`);
    });
  }

  if (peerComparison) {
    lines.push('', '## 同期对比');
    lines.push(
      `- 同月 ${peerComparison.count} 家门店中，${report.storeName} 排第 ${peerComparison.higherRank} 高 / 第 ${peerComparison.lowerRank} 低。`,
    );
    lines.push(
      `- 最高：${peerComparison.highest.storeName} ${target.formatter(peerComparison.highest.value)}`,
    );
    lines.push(
      `- 最低：${peerComparison.lowest.storeName} ${target.formatter(peerComparison.lowest.value)}`,
    );
  }

  lines.push('', '## 说明');

  if (usedLatestPeriod) {
    lines.push(
      `- 你没有指定月份，这里按该店最新月报 **${report.periodLabel || formatPeriodLabelFromPeriod(report.period)}** 查询。`,
    );
  }

  lines.push('- 这是直接查询原始财务月报得到的结果，本条回答没有使用模型估算。');

  return lines.join('\n');
}

function buildAllStoresLookupFacts({ periodLabel, target, rows, peerComparison, usedLatestPeriod }) {
  const facts = [
    `\u5df2\u76f4\u63a5\u6309\u95e8\u5e97\u67e5\u8be2\u539f\u59cb\u6708\u62a5\uff1a${periodLabel} ${target.label}\u5df2\u9010\u5e97\u62c9\u53d6\u3002`,
  ];

  if (target.kind === 'item' && target.categoryName) {
    facts.push(`\u8be5\u6307\u6807\u5f52\u5c5e\u79d1\u76ee\uff1a${target.categoryName}\u3002`);
  }

  facts.push(
    rows
      .map((row) => {
        if (row.value === null || row.value === undefined) {
          return `${row.storeName} \u672a\u8bb0\u5f55`;
        }

        return `${row.storeName} ${target.formatter(row.value)}`;
      })
      .join('\uff1b'),
  );

  if (peerComparison && peerComparison.numericCount >= 2) {
    facts.push(
      `\u540c\u671f${peerComparison.numericCount}\u5bb6\u95e8\u5e97\u5bf9\u6bd4\uff1a\u6700\u9ad8\u4e3a ${peerComparison.highest.storeName} ${target.formatter(
        peerComparison.highest.value,
      )}\uff0c\u6700\u4f4e\u4e3a ${peerComparison.lowest.storeName} ${target.formatter(
        peerComparison.lowest.value,
      )}\u3002`,
    );
  }

  if (usedLatestPeriod) {
    facts.push(`\u7528\u6237\u672a\u6307\u5b9a\u6708\u4efd\uff0c\u5df2\u6309\u6700\u65b0\u6708\u62a5 ${periodLabel} \u67e5\u8be2\u3002`);
  }

  return facts;
}

function buildAllStoresLookupReply({
  periodLabel,
  target,
  rows,
  peerComparison,
  usedLatestPeriod,
}) {
  const rankedRows = [...rows].sort((left, right) => {
    const leftMissing = left.value === null || left.value === undefined;
    const rightMissing = right.value === null || right.value === undefined;

    if (leftMissing && rightMissing) {
      return String(left.storeName || '').localeCompare(String(right.storeName || ''), 'zh-CN');
    }

    if (leftMissing) {
      return 1;
    }

    if (rightMissing) {
      return -1;
    }

    return Number(right.value || 0) - Number(left.value || 0);
  });
  const lines = [
    '## \u5df2\u6838\u9a8c\u7ed3\u679c',
    `- \u6708\u4efd\uff1a${periodLabel}`,
    `- \u6307\u6807\uff1a${target.wantsRatio ? `${target.label}\u5360\u603b\u6210\u672c\u6bd4\u4f8b` : target.label}`,
    `- \u95e8\u5e97\u6570\uff1a${rows.length}`,
    `- \u6392\u5e8f\uff1a${target.wantsRatio ? '\u6309\u6bd4\u4f8b\u4ece\u9ad8\u5230\u4f4e' : '\u6309\u91d1\u989d\u4ece\u9ad8\u5230\u4f4e'}`,
  ];

  if (target.kind === 'item' && target.categoryName) {
    lines.push(`- \u5f52\u5c5e\u79d1\u76ee\uff1a${target.categoryName}`);
  }

  lines.push('', '## \u5404\u95e8\u5e97\u660e\u7ec6');
  rankedRows.forEach((row, index) => {
    const valueText =
      row.value === null || row.value === undefined
        ? '\u672a\u8bb0\u5f55'
        : `**${target.formatter(row.value)}**`;

    if (row.value === null || row.value === undefined) {
      lines.push(`- ${row.storeName}\uff1a${valueText}`);
      return;
    }

    lines.push(`${index + 1}. ${row.storeName}\uff1a${valueText}`);
  });

  if (peerComparison && peerComparison.numericCount >= 2) {
    lines.push('', '## \u540c\u671f\u6458\u8981');
    lines.push(
      `- \u6700\u9ad8\uff1a${peerComparison.highest.storeName} ${target.formatter(peerComparison.highest.value)}`,
    );
    lines.push(
      `- \u6700\u4f4e\uff1a${peerComparison.lowest.storeName} ${target.formatter(peerComparison.lowest.value)}`,
    );
    lines.push(`- \u5747\u503c\uff1a${target.formatter(peerComparison.average)}`);
  }

  lines.push('', '## \u8bf4\u660e');

  if (usedLatestPeriod) {
    lines.push(
      `- \u4f60\u6ca1\u6709\u6307\u5b9a\u6708\u4efd\uff0c\u8fd9\u91cc\u6309\u5df2\u5bfc\u5165\u7684\u6700\u65b0\u6708\u62a5 **${periodLabel}** \u67e5\u8be2\u3002`,
    );
  }

  lines.push(
    '- \u4ee5\u4e0a\u7ed3\u679c\u4e3a\u76f4\u63a5\u67e5\u8be2\u539f\u59cb\u8d22\u52a1\u6708\u62a5\u660e\u7ec6\u5f97\u51fa\uff0c\u672c\u6761\u56de\u7b54\u672a\u4f7f\u7528\u6a21\u578b\u4f30\u7b97\u3002',
  );
  lines.push(
    '- \u5982\u679c\u4f60\u60f3\u77e5\u9053\u201c\u54ea\u5bb6\u504f\u9ad8\u3001\u4e3a\u4ec0\u4e48\u9ad8\u3001\u5148\u6574\u6539\u54ea\u5bb6\u201d\uff0c\u53ef\u4ee5\u5728\u8fd9\u7ec4\u771f\u5b9e\u6570\u636e\u57fa\u7840\u4e0a\u7ee7\u7eed\u8ffd\u95ee\u3002',
  );

  return lines.join('\n');
}

function buildAllStoresLookupAnalysisFallback({
  periodLabel,
  target,
  rows,
  peerComparison,
}) {
  const numericRows = [...rows]
    .filter((row) => row.value !== null && row.value !== undefined)
    .sort((left, right) => Number(right.value || 0) - Number(left.value || 0));

  if (numericRows.length < 2 || !peerComparison) {
    return '';
  }

  const average = Number(peerComparison.average || 0);
  const highest = numericRows[0];
  const second = numericRows[1] || null;
  const lowest = numericRows[numericRows.length - 1];
  const highestGap = roundNumber(Number(highest.value || 0) - average);
  const secondGap = second
    ? roundNumber(Number(second.value || 0) - average)
    : null;
  const lowestGap = roundNumber(average - Number(lowest.value || 0));
  const spread = roundNumber(Number(highest.value || 0) - Number(lowest.value || 0));
  const aboveAverageStores = numericRows
    .filter((row) => Number(row.value || 0) > average)
    .map((row) => row.storeName);
  const belowAverageStores = numericRows
    .filter((row) => Number(row.value || 0) < average)
    .map((row) => row.storeName);
  const lines = ['## 数据解读'];

  lines.push(
    `- 从排名看，${highest.storeName}${
      second ? `和${second.storeName}` : ''
    }位于前列，${second
      ? `${highest.storeName}${highestGap >= 0 ? '高于' : '低于'}同月均值 ${target.formatter(
          Math.abs(highestGap),
        )}，${second.storeName}${secondGap >= 0 ? '高于' : '低于'}同月均值 ${target.formatter(Math.abs(secondGap))}。`
      : `${highestGap >= 0 ? '高于' : '低于'}同月均值 ${target.formatter(Math.abs(highestGap))}。`}`,
  );
  lines.push(
    `- ${lowest.storeName}最低，低于同月均值 ${target.formatter(lowestGap)}；最高与最低相差 ${target.formatter(spread)}。`,
  );

  if (aboveAverageStores.length && belowAverageStores.length) {
    lines.push(
      `- 高于同月均值的门店有 ${aboveAverageStores.join('、')}；低于同月均值的门店有 ${belowAverageStores.join('、')}。`,
    );
  }

  lines.push(
    `- 这组解读只基于 **${periodLabel}** 单月 ${target.label} 结果，能说明同期高低分布，但不能直接当作长期趋势判断。`,
  );

  return lines.join('\n');
}

function describePeerPosition(peerComparison) {
  if (!peerComparison) {
    return '无法判断';
  }

  const bucketSize = Math.max(1, Math.ceil(peerComparison.count / 3));

  if (peerComparison.higherRank <= bucketSize) {
    return '偏高';
  }

  if (peerComparison.lowerRank <= bucketSize) {
    return '偏低';
  }

  return '居中';
}

function buildStoreCategorySnapshot(report) {
  return [...(report.categories || [])]
    .map((category) => ({
      name: category.name,
      amount: computeCategoryAmount(category),
      ratio: computeCategoryRatio(category, report.summary?.totalCost || 0),
    }))
    .sort((left, right) => right.amount - left.amount);
}

function buildMetricAnalysisReply({ report, target, peerComparison }) {
  const periodLabel = report.periodLabel || formatPeriodLabelFromPeriod(report.period);
  const position = describePeerPosition(peerComparison);
  const categorySnapshot = buildStoreCategorySnapshot(report);
  const categoryName = target.kind === 'category' ? target.label : target.categoryName;
  const categoryRank =
    categoryName
      ? categorySnapshot.findIndex((item) => item.name === categoryName) + 1
      : 0;
  const categoryCount = categorySnapshot.length;
  const focusCategory = categorySnapshot.find((item) => item.name === categoryName) || null;
  const peerAverage = peerComparison
    ? roundNumber(peerComparison.average, target.wantsRatio ? 4 : 2)
    : null;
  const gapFromAverage =
    peerAverage === null
      ? null
      : roundNumber(
          Number(target.amount || target.value || 0) - peerAverage,
          target.wantsRatio ? 4 : 2,
        );
  const higherCostCategories = categorySnapshot
    .filter((item) => item.name !== categoryName)
    .slice(0, 3)
    .map((item) => `${item.name} ${exactCurrency(item.amount)}`);
  const lines = [
    '## 结论',
    `- ${report.storeName}${periodLabel}的${target.label}为 **${target.formattedValue}**，${
      peerComparison
        ? `同月 ${peerComparison.count} 家门店中排第 ${peerComparison.higherRank} 高 / 第 ${peerComparison.lowerRank} 低，属于${position}水平。`
        : '当前缺少同月可比门店，暂时无法判断高低。'
    }`,
  ];

  lines.push('', '## 原因拆解');

  if (peerComparison && peerAverage !== null) {
    lines.push(
      `1. 横向对比：同月均值为 **${target.formatter(peerAverage)}**，${report.storeName} ${
        gapFromAverage >= 0 ? '高于' : '低于'
      }均值 **${target.formatter(Math.abs(gapFromAverage))}**。`,
    );
  }

  if (focusCategory && categoryRank > 0) {
    lines.push(
      `2. 门店内部看，${categoryName}占总成本 **${percent(focusCategory.ratio)}**，在 ${categoryCount} 个成本大类中排第 ${categoryRank} 高，不是门店最主要的成本压力。`,
    );
  }

  if (target.kind === 'category' && target.breakdown?.length) {
    lines.push(
      `3. 科目结构：${target.breakdown
        .map((item) => `${item.label} ${exactCurrency(item.amount)}`)
        .join('；')}。`,
    );
  } else if (target.kind === 'item' && target.categoryName && focusCategory) {
    const categoryAmount = Number(focusCategory.amount || 0);
    const itemShareInCategory =
      categoryAmount > 0
        ? percent(Number(target.amount || 0) / categoryAmount)
        : '0.0%';
    lines.push(
      `3. 归属结构：该项归属 **${target.categoryName}**，自身占该科目 **${itemShareInCategory}**。`,
    );
  }

  lines.push('', '## 关键依据');
  lines.push(`- 门店总成本：${exactCurrency(report.summary?.totalCost || 0)}`);

  if (peerComparison) {
    lines.push(
      `- 同月最高：${peerComparison.highest.storeName} ${target.formatter(peerComparison.highest.value)}；最低：${peerComparison.lowest.storeName} ${target.formatter(peerComparison.lowest.value)}`,
    );
  }

  if (higherCostCategories.length) {
    lines.push(`- 店内更大的成本项：${higherCostCategories.join('；')}`);
  }

  lines.push('', '## 优先动作');
  lines.push(
    `1. 先优先盯住更大的成本项，而不是把 ${target.label} 当成当前第一整改重点。`,
  );
  lines.push(
    `2. 把 ${target.label} 纳入月度监控，重点看后续是否连续两到三个月异常抬升。`,
  );

  if (target.kind === 'category' && target.breakdown?.[0]) {
    lines.push(
      `3. 如果后续波动上升，先排查 **${target.breakdown[0].label}** 这一项，因为它是当前科目中的主要构成。`,
    );
  } else {
    lines.push('3. 如果后续继续上升，再结合营业时长、设备负荷和用量记录做复核。');
  }

  lines.push('', '## 说明');
  lines.push('- 以上结论全部基于原始财务月报的真实数值和同月门店对比计算得出。');

  return lines.join('\n');
}

function buildLookupClarificationReply({ store, requestedPeriod }) {
  const periodLabel = requestedPeriod
    ? formatPeriodLabelFromPeriod(requestedPeriod)
    : '最新月报';

  return [
    '## 未找到精确字段',
    `- 已查询 ${store.name} ${periodLabel} 的原始月报，但当前问法还不能唯一映射到某个真实指标或科目。`,
    '- 请把问题说得更具体一些，例如：`万象城店水电费是多少？`、`万象城店物业费是多少？`、`万象城店利润率是多少？`',
    '- 为了保证数据真实，这类问题在未命中精确字段时不会再交给模型猜。 ',
  ].join('\n');
}

function buildAllStoresLookupClarificationReply({ requestedPeriod }) {
  const periodLabel = requestedPeriod
    ? formatPeriodLabelFromPeriod(requestedPeriod)
    : '\u6700\u65b0\u6708\u62a5';

  return [
    '## \u672a\u627e\u5230\u7cbe\u786e\u5b57\u6bb5',
    `- \u5df2\u51c6\u5907\u6309\u5168\u90e8\u95e8\u5e97\u67e5\u8be2 ${periodLabel} \u7684\u539f\u59cb\u6708\u62a5\uff0c\u4f46\u5f53\u524d\u95ee\u6cd5\u8fd8\u4e0d\u80fd\u552f\u4e00\u6620\u5c04\u5230\u67d0\u4e2a\u771f\u5b9e\u6307\u6807\u6216\u660e\u7ec6\u9879\u3002`,
    '- \u4f60\u53ef\u4ee5\u76f4\u63a5\u95ee\uff1a\u201c\u5206\u522b\u5217\u51fa\u6240\u6709\u95e8\u5e97\u7684\u9644\u52a0\u503c\u4ea7\u54c1\u82b1\u8d39\u201d\u3001\u201c\u5404\u95e8\u5e97\u6c34\u7535\u8d39\u591a\u5c11\u201d\u3001\u201c\u6bcf\u4e2a\u95e8\u5e97\u5229\u6da6\u7387\u662f\u591a\u5c11\u201d\u3002',
    '- \u4e3a\u4e86\u4fdd\u8bc1\u6570\u636e\u771f\u5b9e\uff0c\u8fd9\u7c7b\u95ee\u9898\u5728\u672a\u547d\u4e2d\u7cbe\u786e\u5b57\u6bb5\u65f6\u4e0d\u4f1a\u4ea4\u7ed9\u6a21\u578b\u731c\u6d4b\u3002',
  ].join('\n');
}

function buildAllStoresMissingDataReply({ requestedPeriod }) {
  const periodLabel = requestedPeriod
    ? formatPeriodLabelFromPeriod(requestedPeriod)
    : '\u6307\u5b9a\u6708\u4efd';

  return `\u5f53\u524d\u6ca1\u6709 ${periodLabel} \u7684\u5168\u90e8\u95e8\u5e97\u6708\u62a5\u6570\u636e\u53ef\u4f9b\u67e5\u8be2\u3002`;
}

function resolveDirectLookup(question, reports) {
  const lookupReport = findLookupReport(question, reports);

  if (!lookupReport.store || !lookupReport.report) {
    return {
      ...lookupReport,
      target: null,
      peerComparison: null,
      retrievedFacts: [],
    };
  }

  const target = pickLookupTarget(question, lookupReport.report);

  if (!target) {
    return {
      ...lookupReport,
      target: null,
      peerComparison: null,
      retrievedFacts: [],
    };
  }

  const peerComparison = buildLookupPeerComparison({
    report: lookupReport.report,
    target,
    reports,
  });

  return {
    ...lookupReport,
    target,
    peerComparison,
    retrievedFacts: buildDirectLookupFacts({
      report: lookupReport.report,
      target,
      peerComparison,
      usedLatestPeriod: lookupReport.usedLatestPeriod,
    }),
  };
}

function pickLookupTargetAcrossReports(question, reportsForPeriod) {
  const candidates = reportsForPeriod
    .map((report) => {
      const target = pickLookupTarget(question, report);

      if (!target) {
        return null;
      }

      const coverageCount = reportsForPeriod.filter((peerReport) => {
        const value = target.valueForReport(peerReport);
        return value !== null && value !== undefined;
      }).length;

      return {
        ...target,
        coverageCount,
      };
    })
    .filter(Boolean);

  return (
    candidates.sort((left, right) => {
      if (right.matchScore !== left.matchScore) {
        return right.matchScore - left.matchScore;
      }

      if (right.priority !== left.priority) {
        return right.priority - left.priority;
      }

      if (right.coverageCount !== left.coverageCount) {
        return right.coverageCount - left.coverageCount;
      }

      return String(right.label || '').length - String(left.label || '').length;
    })[0] || null
  );
}

function resolveAllStoresLookup(question, reports) {
  const store = resolveStore(question);
  const shouldHandle = !store && asksForAllStores(question) && !isAnalysisIntent(question);
  const sanitizedQuestion = sanitizeAllStoresLookupQuestion(question);
  const requestedPeriod = inferPeriodFromQuestion(question, reports);
  const period = requestedPeriod || getLatestReportPeriod(reports);
  const reportsForPeriod = period
    ? sortReportsByStoreOrder(reports.filter((report) => report.period === period))
    : [];

  if (!shouldHandle) {
    return {
      shouldHandle: false,
      store: null,
      requestedPeriod,
      period,
      reportsForPeriod,
      usedLatestPeriod: false,
      target: null,
      rows: [],
      peerComparison: null,
      retrievedFacts: [],
    };
  }

  if (!reportsForPeriod.length) {
    return {
      shouldHandle: true,
      store: null,
      requestedPeriod,
      period,
      reportsForPeriod,
      usedLatestPeriod: !requestedPeriod && Boolean(period),
      target: null,
      rows: [],
      peerComparison: null,
      retrievedFacts: [],
    };
  }

  const target = pickLookupTargetAcrossReports(sanitizedQuestion, reportsForPeriod);

  if (!target) {
    return {
      shouldHandle: true,
      store: null,
      requestedPeriod,
      period,
      reportsForPeriod,
      usedLatestPeriod: !requestedPeriod,
      target: null,
      rows: [],
      peerComparison: null,
      retrievedFacts: [],
    };
  }

  const rows = reportsForPeriod.map((report) => ({
    storeId: report.storeId,
    storeName: report.storeName,
    period: report.period,
    periodLabel: report.periodLabel || formatPeriodLabelFromPeriod(report.period),
    value: target.valueForReport(report),
  }));
  const peerComparison = buildAllStoresPeerComparison(rows);
  const periodLabel =
    rows[0]?.periodLabel ||
    reportsForPeriod[0]?.periodLabel ||
    formatPeriodLabelFromPeriod(period);

  return {
    shouldHandle: true,
    store: null,
    requestedPeriod,
    period,
    periodLabel,
    reportsForPeriod,
    usedLatestPeriod: !requestedPeriod,
    target,
    rows,
    peerComparison,
    retrievedFacts: buildAllStoresLookupFacts({
      periodLabel,
      target,
      rows,
      peerComparison,
      usedLatestPeriod: !requestedPeriod,
    }),
  };
}

function buildStorePeerComparisonLines(store, context) {
  const peerComparison = context.peerComparison;

  if (!peerComparison || peerComparison.focusStore?.storeId !== store.storeId) {
    return [];
  }

  const { peerStoreCount, focusStoreRanks, focusVsAverage, leaders } = peerComparison;
  const lines = [];

  if (focusStoreRanks?.profitMarginRank && focusStoreRanks?.healthScoreRank) {
    lines.push(
      `同周期 ${peerStoreCount} 家门店里，利润率排第 ${focusStoreRanks.profitMarginRank}/${peerStoreCount}，健康度排第 ${focusStoreRanks.healthScoreRank}/${peerStoreCount}。`,
    );
  }

  const gapParts = [];

  if (Math.abs(focusVsAverage?.profitMarginGap || 0) >= 0.01) {
    gapParts.push(
      `利润率比门店均值${focusVsAverage.profitMarginGap > 0 ? '高' : '低'} ${percentPoint(
        focusVsAverage.profitMarginGap,
      )}`,
    );
  }

  if (Math.abs(focusVsAverage?.platformRevenueShareGap || 0) >= 0.03) {
    gapParts.push(
      `平台占比比门店均值${focusVsAverage.platformRevenueShareGap > 0 ? '高' : '低'} ${percentPoint(
        focusVsAverage.platformRevenueShareGap,
      )}`,
    );
  }

  if (Math.abs(focusVsAverage?.avgTicketGap || 0) >= 8) {
    gapParts.push(
      `客单价比门店均值${focusVsAverage.avgTicketGap > 0 ? '高' : '低'} ${currency(
        Math.abs(focusVsAverage.avgTicketGap),
      )}`,
    );
  }

  if (Math.abs(focusVsAverage?.avgCustomerCostGap || 0) >= 8) {
    gapParts.push(
      `单客成本比门店均值${focusVsAverage.avgCustomerCostGap > 0 ? '高' : '低'} ${currency(
        Math.abs(focusVsAverage.avgCustomerCostGap),
      )}`,
    );
  }

  if (gapParts.length) {
    lines.push(gapParts.join('，') + '。');
  }

  if (
    leaders?.profitMarginLeader &&
    leaders.profitMarginLeader.storeId !== store.storeId
  ) {
    lines.push(
      `对标看，利润率领先门店是 ${leaders.profitMarginLeader.storeName}（${percent(
        leaders.profitMarginLeader.profitMargin,
      )}），这说明当前还有优化空间。`,
    );
  }

  return lines.slice(0, 2);
}

function buildStoreFocusedFallbackReply({ question, dashboard, context }) {
  const resolvedStore = resolveStore(question);

  if (!resolvedStore) {
    return '';
  }

  const store = dashboard.storeComparison.find(
    (item) => item.storeId === resolvedStore.id,
  );
  const snapshot = context.reportSnapshots.find(
    (item) => item.storeId === resolvedStore.id,
  );

  if (!store) {
    return `${resolvedStore.name} 当前没有可分析的财务月报数据。`;
  }

  const reasons = [];
  const evidence = [
    `${snapshot?.periodLabel || dashboard.overview.latestPeriod || '当前'}营收 ${currency(
      store.revenue,
    )}，净利润 ${currency(store.profit)}，利润率 ${percent(store.profitMargin)}。`,
    `客单价 ${currency(store.avgTicket)}，单客成本 ${currency(store.avgCustomerCost)}，健康度 ${store.healthScore} 分。`,
  ];

  if (store.platformRevenueShare >= 0.8) {
    reasons.push(
      `平台收入占比 ${percent(store.platformRevenueShare)}，渠道依赖偏高，平台费用会侵蚀利润。`,
    );
  }

  if (store.avgTicket - store.avgCustomerCost <= 30) {
    reasons.push(
      `客单价与单客成本之间的利润垫偏窄，当前单客毛利只有 ${currency(
        store.avgTicket - store.avgCustomerCost,
      )}。`,
    );
  }

  if (snapshot?.topCostCategories?.[0]) {
    reasons.push(
      `当前最大成本项是“${snapshot.topCostCategories[0].name}”，占比 ${percent(
        snapshot.topCostCategories[0].ratio,
      )}。`,
    );
  }

  const actions = [];

  if (store.platformRevenueShare >= 0.8) {
    actions.push('优先压降平台依赖，把高频复购客户转向会员、储值和私域复购。');
  }

  if (snapshot?.topCostItems?.[0]) {
    actions.push(`复盘“${snapshot.topCostItems[0].name}”支出，看是否存在低效投放或冗余成本。`);
  }

  const peerComparisonLines = buildStorePeerComparisonLines(store, context);

  if (peerComparisonLines.length) {
    evidence.push(...peerComparisonLines);
  }

  const leader = context.peerComparison?.leaders?.profitMarginLeader;

  if (leader && leader.storeId !== store.storeId) {
    actions.push(
      `对标 ${leader.storeName} 的利润率和单客模型，逐项拆出客单价、平台占比和重点成本差距。`,
    );
  }

  if (!actions.length) {
    actions.push('先对标利润率更高门店，逐项复盘客单价、单客成本和重点成本项。');
  }

  return [
    `结论：从 ${snapshot?.periodLabel || dashboard.overview.latestPeriod || '最新'} 数据看，${store.storeName} 利润率 ${percent(
      store.profitMargin,
    )}，${
      /为什么|为何|原因/.test(question)
        ? '利润承压核心集中在渠道结构偏重和成本效率承压。'
        : '当前经营财务状态需要重点盯利润率和渠道结构。'
    }`,
    '原因拆解：',
    ...reasons.slice(0, 3).map((line, index) => `${index + 1}. ${line}`),
    '关键证据：',
    ...evidence.slice(0, 4).map((line) => `- ${line}`),
    '优先动作：',
    ...actions.slice(0, 3).map((line, index) => `${index + 1}. ${line}`),
    dashboard.trend.length < 2 ? '补充多月数据后，才能进一步判断趋势变化。' : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildOverallFinancialFallbackReply({ dashboard }) {
  const bestMarginStore = [...dashboard.storeComparison].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const watchStore = [...dashboard.storeComparison].sort(
    (left, right) => left.healthScore - right.healthScore,
  )[0];

  return [
    `结论：当前整体营收 ${currency(dashboard.overview.revenue)}，净利润 ${currency(
      dashboard.overview.profit,
    )}，利润率 ${percent(dashboard.overview.profitMargin)}。`,
    '核心问题：',
    `1. 平台收入占比 ${percent(dashboard.overview.platformRevenueShare)}，渠道结构仍然偏重平台。`,
    dashboard.costBreakdown[0]
      ? `2. 当前最大成本压力来自“${dashboard.costBreakdown[0].name}”，占总成本 ${percent(
          dashboard.costBreakdown[0].ratio,
        )}。`
      : '',
    bestMarginStore
      ? `3. 当前利润率表现较好的门店是 ${bestMarginStore.storeName}，利润率 ${percent(
          bestMarginStore.profitMargin,
        )}。`
      : '',
    watchStore
      ? `4. 当前最该优先盯的门店是 ${watchStore.storeName}，健康度 ${watchStore.healthScore} 分。`
      : '',
    '如果你要，我可以继续按门店拆解原因、证据和 30 天整改动作。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildFinancialFallbackReply({ question, dashboard, context }) {
  return (
    buildStoreFocusedFallbackReply({ question, dashboard, context }) ||
    buildOverallFinancialFallbackReply({ dashboard })
  );
}

function formatLookupTarget(target) {
  if (!target) {
    return null;
  }

  return {
    kind: target.kind,
    label: target.label,
    categoryName: target.categoryName || '',
    wantsRatio: Boolean(target.wantsRatio),
  };
}

function buildClarificationExamples(storeName) {
  if (storeName) {
    return [
      `${storeName}水电费是多少？`,
      `${storeName}物业费是多少？`,
      `${storeName}利润率是多少？`,
      `${storeName}为什么利润低？`,
    ];
  }

  return [
    '分别列出所有门店的附加值产品花费',
    '各门店水电费多少？',
    '每个门店利润率是多少？',
    '哪家门店最该优先整改？',
  ];
}

function buildRequestResolution({
  message,
  context,
  directLookup,
  allStoresLookup,
}) {
  const exactLookupRequested = shouldUseDirectLookup(message);
  const analysisRequested = isAnalysisIntent(message);
  const metricAnalysisRequested =
    directLookup.target &&
    (directLookup.target.kind === 'category' ||
      directLookup.target.kind === 'item') &&
    isMetricAnalysisQuestion(message);
  const requestedPeriod =
    directLookup.requestedPeriod ||
    allStoresLookup.requestedPeriod ||
    context.analysisScope?.periodStart ||
    null;
  const periodLabel =
    (requestedPeriod && formatPeriodLabelFromPeriod(requestedPeriod)) ||
    allStoresLookup.periodLabel ||
    context.reportSnapshots?.[0]?.periodLabel ||
    context.analysisScope?.periodLabel ||
    context.analysisScope?.periodStart ||
    '当前范围';

  if (!context.reportSnapshots.length) {
    return {
      status: 'no_reports',
      needsClarification: false,
      requestedPeriod,
      periodLabel,
      exactLookupRequested,
      analysisRequested,
      message: '当前没有可用财务月报数据。',
      availableStores: STORE_REGISTRY.map((store) => store.name),
    };
  }

  if (allStoresLookup.shouldHandle) {
    if (!allStoresLookup.reportsForPeriod.length) {
      return {
        status: 'all_stores_missing_period',
        needsClarification: false,
        requestedPeriod: allStoresLookup.requestedPeriod,
        periodLabel,
        exactLookupRequested: true,
        analysisRequested: false,
        message: `当前没有 ${periodLabel} 的全部门店月报数据。`,
      };
    }

    if (!allStoresLookup.target) {
      return {
        status: 'all_stores_ambiguous_target',
        needsClarification: true,
        requestedPeriod: allStoresLookup.requestedPeriod,
        periodLabel,
        exactLookupRequested: true,
        analysisRequested: false,
        message: '当前问题还不能唯一映射到某个真实指标或明细项。',
        suggestedQuestions: buildClarificationExamples(),
      };
    }

    return {
      status: 'all_stores_lookup',
      needsClarification: false,
      requestedPeriod: allStoresLookup.requestedPeriod,
      periodLabel: allStoresLookup.periodLabel || periodLabel,
      exactLookupRequested: true,
      analysisRequested: false,
      target: formatLookupTarget(allStoresLookup.target),
      usedLatestPeriod: allStoresLookup.usedLatestPeriod,
      storeScope: 'all_stores',
      matchedStoreCount: allStoresLookup.rows.length,
    };
  }

  if (directLookup.store) {
    if (!directLookup.report) {
      return {
        status: 'store_missing_report',
        needsClarification: false,
        storeId: directLookup.store.id,
        storeName: directLookup.store.name,
        requestedPeriod: directLookup.requestedPeriod,
        periodLabel,
        exactLookupRequested,
        analysisRequested,
        message: `当前没有 ${directLookup.store.name} ${periodLabel} 的财务月报数据。`,
      };
    }

    if (exactLookupRequested && !directLookup.target) {
      return {
        status: 'store_ambiguous_target',
        needsClarification: true,
        storeId: directLookup.store.id,
        storeName: directLookup.store.name,
        requestedPeriod: directLookup.requestedPeriod,
        periodLabel,
        exactLookupRequested: true,
        analysisRequested,
        message: '当前问题还不能唯一映射到某个真实指标或明细项。',
        suggestedQuestions: buildClarificationExamples(directLookup.store.name),
      };
    }

    if (directLookup.target && metricAnalysisRequested) {
      return {
        status: 'metric_analysis',
        needsClarification: false,
        storeId: directLookup.store.id,
        storeName: directLookup.store.name,
        requestedPeriod: directLookup.requestedPeriod,
        periodLabel,
        exactLookupRequested: false,
        analysisRequested: true,
        target: formatLookupTarget(directLookup.target),
        usedLatestPeriod: directLookup.usedLatestPeriod,
      };
    }

    if (directLookup.target && exactLookupRequested) {
      return {
        status: 'exact_lookup',
        needsClarification: false,
        storeId: directLookup.store.id,
        storeName: directLookup.store.name,
        requestedPeriod: directLookup.requestedPeriod,
        periodLabel,
        exactLookupRequested: true,
        analysisRequested: false,
        target: formatLookupTarget(directLookup.target),
        usedLatestPeriod: directLookup.usedLatestPeriod,
      };
    }

    if (analysisRequested) {
      return {
        status: 'store_analysis',
        needsClarification: false,
        storeId: directLookup.store.id,
        storeName: directLookup.store.name,
        requestedPeriod: directLookup.requestedPeriod,
        periodLabel,
        exactLookupRequested,
        analysisRequested: true,
        usedLatestPeriod: directLookup.usedLatestPeriod,
      };
    }
  }

  return {
    status: 'general_analysis',
    needsClarification: false,
    requestedPeriod,
    periodLabel,
    exactLookupRequested,
    analysisRequested,
    availableStores: STORE_REGISTRY.map((store) => store.name),
  };
}

function buildFinancialAgentExecutionContext({
  message,
  history = [],
  reports,
  settings,
}) {
  const directLookup = resolveDirectLookup(message, reports);
  const allStoresLookup = resolveAllStoresLookup(message, reports);
  const filters = inferQuestionFilters(message, reports);
  const { context } = buildFinancialContextBundle(reports, filters);
  const retrievedFacts = [
    ...(directLookup.retrievedFacts || []),
    ...(allStoresLookup.retrievedFacts || []),
  ];
  const requestResolution = buildRequestResolution({
    message,
    context,
    directLookup,
    allStoresLookup,
  });
  const llmContext = {
    ...context,
    retrievedFacts,
    requestResolution,
  };

  if (settings.llmProvider !== 'zhipu' || !settings.zhipuApiKey) {
    return {
      payload: {
        reply: '当前未配置智谱 Key，财务问答无法提供 AI 分析。',
        agent: buildFinancialAgentMeta({
          mode: 'error',
          provider: 'zhipu',
          note: '当前未配置智谱 Key，财务问答不会再退回本地规则分析。',
        }),
      },
    };
  }

  return {
    history,
    llmContext,
    message,
    preferredModel: settings.zhipuModel,
    settings,
  };
}

function buildGenericAgentReply(agentId, message) {
  const normalized = String(message || '').trim();

  if (agentId === 'default' || agentId === 'scalp_expert') {
    return {
      reply: `当前首页真正接通数据的是“财务分析师”。你刚才的问题是：${normalized}\n\n如果你要，我可以继续把“头疗专家”也接入专属知识库和问答链路。`,
      agent: {
        id: agentId,
        name: agentId === 'default' ? '默认智能体' : '头疗专家',
        mode: 'fallback',
        provider: 'local',
        model: '',
        note: '该智能体暂未接入专属数据链路。',
      },
    };
  }

  if (agentId === 'scheduling') {
    return {
      reply: `排班智能体的首页问答还没接入真实排班数据。等你把预约和排班模块的数据表接上后，这里就能直接回答“哪个时段还有空位”。`,
      agent: {
        id: agentId,
        name: '排班管家',
        mode: 'fallback',
        provider: 'local',
        model: '',
        note: '该智能体暂未接入排班数据。',
      },
    };
  }

  return {
    reply: `当前该智能体还没接入专属业务数据。已经接通的是“财务分析师”，你可以直接切过去问门店利润、成本和整改优先级。`,
    agent: {
      id: agentId,
      name: '客服助手',
      mode: 'fallback',
      provider: 'local',
      model: '',
      note: '该智能体暂未接入专属数据链路。',
    },
  };
}

async function buildFinancialAgentReply({
  message,
  history = [],
  reports,
  settings,
}) {
  const executionContext = buildFinancialAgentExecutionContext({
    message,
    history,
    reports,
    settings,
  });

  if (executionContext.payload) {
    return executionContext.payload;
  }

  try {
    const result = await runZhipuFinancialChatAgent({
      apiKey: executionContext.settings.zhipuApiKey,
      question: executionContext.message,
      history: executionContext.history,
      context: executionContext.llmContext,
      preferredModel: executionContext.preferredModel,
    });
    const reply = normalizeText(result.reply, 6000);

    if (!reply) {
      throw new Error('智谱返回空内容。');
    }

    return {
      reply,
      agent: buildFinancialAgentMeta({
        mode: 'llm',
        model: result.model,
        note: `已基于当前财务数据完成智谱 ${result.model} 实时问答。`,
      }),
    };
  } catch (error) {
    const errorText = normalizeText(error.message, 160);

    return {
      reply: `智谱 AI 暂时未返回有效分析，请稍后重试。${errorText ? `\n\n错误信息：${errorText}` : ''}`,
      agent: buildFinancialAgentMeta({
        mode: 'error',
        provider: 'zhipu',
        note: `智谱问答失败：${errorText || '未知错误'}`,
      }),
    };
  }
}

async function buildWorkspaceAgentReply({
  agentId,
  message,
  history = [],
  reports,
  settings = readSettings(),
}) {
  if (agentId === 'financial_analyst') {
    return buildFinancialAgentReply({
      message,
      history,
      reports,
      settings,
    });
  }

  return buildGenericAgentReply(agentId, message);
}

module.exports = {
  buildFinancialAgentExecutionContext,
  buildWorkspaceAgentReply,
};
