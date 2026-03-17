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
const {
  sanitizeGroundedList,
  sanitizeGroundedText,
} = require('./financialFactGrounding');
const { buildFinancialContextBundle } = require('./financialAi');
const {
  runZhipuFinancialChatAgent,
  runZhipuGroundedFinancialChatAgent,
  shouldUseWebSearch,
} = require('./zhipuFinancialAgent');

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

function decorateSectionTitle(title = '') {
  const normalized = String(title || '')
    .replace(/^#+\s*/, '')
    .replace(/[：:]\s*$/, '')
    .trim();

  const map = {
    结论: '🎯 先说结论',
    先说结论: '🎯 先说结论',
    核心结论: '🎯 核心结论',
    核心判断: '🎯 核心判断',
    原因拆解: '🔍 为什么会这样',
    为什么会这样: '🔍 为什么会这样',
    先抓问题: '🔍 先看问题',
    先看问题: '🔍 先看问题',
    为什么是它: '🔍 为什么是它',
    排序依据: '🔍 排序依据',
    指标拆解: '🔍 指标拆解',
    指标拆开看: '🔍 指标拆开看',
    整体表现: '📊 整体表现',
    重点门店: '🏪 重点门店',
    关键信息: '📎 关键信息',
    查询口径: '🧾 查询口径',
    这个数怎么来的: '🧮 这个数怎么来的',
    明细: '📎 明细',
    关键证据: '📌 关键依据',
    关键依据: '📌 关键依据',
    横向对比: '↔️ 横向对比',
    横向差异: '↔️ 横向差异',
    对标差异: '↔️ 对标差异',
    差异来源: '📎 差异来源',
    '30 天动作': '✅ 接下来 30 天',
    '接下来 30 天': '✅ 接下来 30 天',
    优先动作: '✅ 下一步怎么做',
    先抓动作: '✅ 先抓动作',
    下一步: '✅ 下一步',
    下一步怎么做: '✅ 下一步怎么做',
    管理动作: '✅ 管理动作',
    亮点: '✨ 亮点',
    风险: '⚠️ 风险',
    复盘指标: '📈 复盘指标',
    数据口径: '🧾 数据口径',
    查询结果: '📌 查询结果',
    已核验结果: '📌 已核验结果',
    关键明细: '📎 关键明细',
    各门店明细: '🏪 各门店明细',
    同期摘要: '📊 同期摘要',
    同期对比: '↔️ 同期对比',
    补充说明: '🧾 补充说明',
    说明: '🧾 补充说明',
    解析来源: '📂 解析来源',
    算法与逻辑: '🧮 计算逻辑',
    计算口径说明: '🧮 计算口径',
    解析逻辑: '🧮 解析逻辑',
    提示: '💡 提示',
    未找到精确字段: '❓ 还差一个精确字段',
    当前缺口: '❓ 当前缺口',
    当前缺失: '❓ 当前缺失',
    先说卡点: '❓ 先说卡点',
    已知条件: '📎 已知条件',
    目前已知: '📎 目前已知',
    可继续追问: '💬 你可以这样问',
    你可以这样问: '💬 你可以这样问',
    下一步建议: '✅ 下一步建议',
    数据解读: '📊 数据解读',
  };

  return map[normalized] || normalized;
}

function polishFinancialReply(value = '') {
  const withNaturalSources = String(value || '').replace(
    /\[本地月报\]\[([^\]]+)\]\s*/g,
    (_match, scopeLabel) => `从${scopeLabel}数据看，`,
  );

  const withDecoratedHeadings = withNaturalSources
    .replace(/^([^\n：:]{2,16})[：:]\s*$/gm, (match, title) => {
      const decorated = decorateSectionTitle(title);
      return decorated === title ? match : `## ${decorated}`;
    })
    .split('\n')
    .map((line) => {
      const headingMatch = line.match(/^(#{2,3})\s+(.+)$/);

      if (!headingMatch) {
        return line;
      }

      return `${headingMatch[1]} ${decorateSectionTitle(headingMatch[2])}`;
    })
    .join('\n');

  return normalizeText(
    withDecoratedHeadings
      .replace(/从([^\n，。；]+)数据看，\s*，/g, '从$1数据看，')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n'),
    6000,
  );
}

function isMetaGuidanceLine(text = '') {
  const normalized = String(text || '').trim();

  if (!normalized) {
    return true;
  }

  return /^(这里写|请回答当前用户问题|先给结论，例如|最后补一句|优先用\s*\{\{FACT|没有合适事实时|不要直接写数字|只写定性判断)/.test(
    normalized,
  );
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
  const store = resolveQuestionStore(question, reports);
  const period = inferPeriodFromQuestion(question, reports);

  return {
    storeIds: store ? [store.id] : [],
    periodStart: period,
    periodEnd: period,
  };
}

function inferQuestionFiltersWithDefaults(question, reports, defaults = {}) {
  const store = resolveQuestionStore(question, reports, defaults.store || null);
  const period = inferPeriodFromQuestion(question, reports) || defaults.period || null;

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

function isDerivationQuestion(question = '') {
  const text = String(question || '');
  return [
    '怎么算',
    '怎么得出',
    '如何得出',
    '怎么解析',
    '如何解析',
    '怎么来的',
    '来源',
    '依据',
    '为什么是这个数',
    '如何算出',
    '怎样算出',
  ].some((token) => text.includes(token));
}

function isParsingLookupIntent(question = '') {
  const text = String(question || '');
  return [
    '多少',
    '金额',
    '收入',
    '营收',
    '占比',
    '比例',
    '数据',
    '明细',
    '列出',
    '是多少',
    '怎么得出',
    '如何得出',
    '怎么算',
    '怎么解析',
    '如何解析',
    '来源',
    '依据',
  ].some((token) => text.includes(token));
}

function normalizeParsingPeriod(parsingContext = {}) {
  if (/^\d{4}-\d{2}$/.test(String(parsingContext.period || ''))) {
    return String(parsingContext.period);
  }

  return inferPeriod(parsingContext.periodLabel || '') || null;
}

function buildChannelEntries(report = {}) {
  if (Array.isArray(report.channels) && report.channels.length) {
    return report.channels
      .map((channel) => ({
        name: cleanText(channel?.name),
        value: roundNumber(channel?.value),
        share:
          channel?.share !== null && channel?.share !== undefined
            ? Number(channel.share)
            : null,
      }))
      .filter((channel) => channel.name);
  }

  return Object.entries(report.summary?.channels || {})
    .map(([name, value]) => ({
      name: cleanText(name),
      value: roundNumber(value),
      share: null,
    }))
    .filter((channel) => channel.name);
}

function resolveStoreFromReports(storeName = '', reports = []) {
  const normalizedStoreName = normalizeLookupText(storeName);

  if (!normalizedStoreName) {
    return null;
  }

  const matchedReport = (reports || []).find((report) => {
    const normalizedReportStore = normalizeLookupText(report.storeName);
    const reportAlias = normalizedReportStore.replace(/\u5e97$/, '');
    const inputAlias = normalizedStoreName.replace(/\u5e97$/, '');
    return (
      report.storeId === storeName ||
      normalizedReportStore === normalizedStoreName ||
      normalizedReportStore.includes(normalizedStoreName) ||
      normalizedStoreName.includes(normalizedReportStore) ||
      (reportAlias &&
        (reportAlias === inputAlias ||
          normalizedStoreName.includes(reportAlias) ||
          reportAlias.includes(inputAlias)))
    );
  });

  return matchedReport
    ? {
        id: matchedReport.storeId,
        name: matchedReport.storeName,
      }
    : null;
}

function resolveQuestionStore(question = '', reports = [], fallbackStore = null) {
  return (
    resolveStore(question) ||
    resolveStoreFromReports(question, reports) ||
    fallbackStore ||
    null
  );
}

function findChannelEntry(report = {}, channelName = '') {
  return buildChannelEntries(report).find((channel) => channel.name === channelName) || null;
}

function buildParsingSummaryMetrics(summary = {}) {
  const pairs = [
    ['营收', summary.recognizedRevenue],
    ['总实收', summary.grossRevenue],
    ['客户数', summary.customerCount],
    ['新增会员', summary.newMembers],
    ['客单价', summary.avgTicket],
    ['平台占比', summary.platformRevenueShare],
    ['微信银联支付宝收入', summary.channels?.['微信银联支付宝']],
    ['现金收入', summary.channels?.['现金']],
    ['美团收入', summary.channels?.['美团']],
    ['抖音收入', summary.channels?.['抖音']],
  ];

  return pairs
    .filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)))
    .map(([label, numericValue]) => ({
      label,
      rawValue: String(numericValue),
      numericValue: Number(numericValue),
      valueType: /占比/.test(label) ? 'percent' : /数$/.test(label) ? 'count' : 'amount',
      source: 'parsing',
      rowIndex: -1,
      columnIndex: -1,
      valueColumnIndex: -1,
    }));
}

function mergeSummaryMetrics(baseMetrics = [], overrideMetrics = []) {
  const merged = new Map();

  [...(baseMetrics || []), ...(overrideMetrics || [])].forEach((metric) => {
    const label = cleanText(metric?.label);

    if (!label) {
      return;
    }

    merged.set(label, metric);
  });

  return [...merged.values()];
}

function getParsingContextFiles(parsingContext = {}) {
  return [
    ...(Array.isArray(parsingContext.parsedFiles) ? parsingContext.parsedFiles : []),
    ...(Array.isArray(parsingContext.reviewFiles) ? parsingContext.reviewFiles : []),
  ].filter(Boolean);
}

function findRevenueParsingFile(parsingContext = {}) {
  return (
    getParsingContextFiles(parsingContext).find(
      (file) =>
        file?.structuredData?.kind === 'revenue-report' || file?.sourceGroupKey === 'revenue',
    ) || null
  );
}

function buildParsingReport(parsingContext = {}, reports = []) {
  const revenueFile = findRevenueParsingFile(parsingContext);

  if (!revenueFile?.structuredData || revenueFile.structuredData.kind !== 'revenue-report') {
    return null;
  }

  const storeToken =
    parsingContext.storeId || parsingContext.storeName || revenueFile.storeName || '';
  const store = resolveStore(storeToken) || resolveStoreFromReports(storeToken, reports);
  const period = normalizeParsingPeriod(parsingContext);
  const revenue = revenueFile.structuredData;
  const channels = {
    微信银联支付宝: roundNumber(revenue.channels?.walletChannel),
    现金: roundNumber(revenue.channels?.cashChannel),
    美团: roundNumber(revenue.channels?.meituanRevenue),
    抖音: roundNumber(revenue.channels?.douyinRevenue),
  };
  const channelTotal = Object.values(channels).reduce(
    (sum, value) => sum + Number(value || 0),
    0,
  );
  const platformRevenue = Number(channels['美团'] || 0) + Number(channels['抖音'] || 0);
  const recognizedRevenue = roundNumber(revenue.recognizedRevenue);
  const grossRevenue = roundNumber(revenue.grossRevenue || channelTotal);
  const customerCount = Number(revenue.customerCount || 0);
  const avgTicket = customerCount > 0 ? roundNumber(recognizedRevenue / customerCount) : 0;
  const periodLabel =
    parsingContext.periodLabel ||
    revenueFile.periodLabel ||
    (period ? formatPeriodLabelFromPeriod(period) : '未指定月份');

  const summary = {
    customerCount,
    recognizedRevenue,
    grossRevenue,
    savingsAmount: roundNumber(revenue.savingsAmount),
    avgTicket,
    newMembers: Number(revenue.newMembers || 0),
    projectRevenue: roundNumber(revenue.projectRevenue || recognizedRevenue),
    machineRevenue: roundNumber(revenue.machineRevenue),
    channels,
    platformRevenue: roundNumber(platformRevenue),
    platformRevenueShare: grossRevenue > 0 ? roundNumber(platformRevenue / grossRevenue, 4) : 0,
    channelTotal: roundNumber(channelTotal),
  };

  return {
    id: `parsing-${store?.id || cleanText(parsingContext.storeName || revenueFile.storeName || 'unknown')}-${period || 'current'}`,
    storeId: store?.id || '',
    storeName: store?.name || parsingContext.storeName || revenueFile.storeName || '当前门店',
    period: period || '',
    periodLabel,
    sheetName: revenueFile.metrics?.sheetName || '',
    sourceFileName: revenueFile.fileName || '',
    sourceRelativePath: '',
    summary,
    channels: buildChannelEntries({
      channels: Object.entries(channels).map(([name, value]) => ({ name, value })),
    }),
    summaryMetrics: buildParsingSummaryMetrics(summary),
    categories: [],
    parsingSourceFiles: getParsingContextFiles(parsingContext),
  };
}

function mergeParsingReportIntoReports(reports, parsingContext = {}) {
  const parsingReport = buildParsingReport(parsingContext, reports);

  if (!parsingReport) {
    return reports;
  }

  const mergedReports = Array.isArray(reports) ? [...reports] : [];
  const matchIndex = mergedReports.findIndex(
    (report) =>
      report.storeId === parsingReport.storeId &&
      report.period === parsingReport.period &&
      parsingReport.storeId &&
      parsingReport.period,
  );

  if (matchIndex === -1) {
    mergedReports.push(parsingReport);
    return mergedReports;
  }

  const current = mergedReports[matchIndex];
  mergedReports[matchIndex] = {
    ...current,
    ...parsingReport,
    summary: {
      ...(current.summary || {}),
      ...(parsingReport.summary || {}),
    },
    channels: parsingReport.channels?.length ? parsingReport.channels : current.channels,
    summaryMetrics: mergeSummaryMetrics(current.summaryMetrics, parsingReport.summaryMetrics),
    categories: current.categories || [],
    parsingSourceFiles: getParsingContextFiles(parsingContext),
  };

  return mergedReports;
}

function buildLookupDefaults(parsingContext = {}, reports = []) {
  const storeToken = parsingContext.storeId || parsingContext.storeName || '';

  return {
    store:
      resolveStore(storeToken) ||
      resolveStoreFromReports(storeToken, reports) ||
      null,
    period: normalizeParsingPeriod(parsingContext),
  };
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
  '门店宿舍 租金': ['租金总成本', '房租总成本', '租金支出', '房租支出', '房租成本', '宿舍租金', '店租'],
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

function asksForPriorityStore(question = '') {
  return /哪家店|哪一家店|最该|优先整改|先整改|先改哪家|先盯哪家|最值得优先|整改优先级/.test(
    String(question || ''),
  );
}

function asksForActionPlan(question = '') {
  const normalized = String(question || '')
    .replace(/\s+/g, '')
    .replace(/[？?！!。，“”"'':：;；,，]/g, '');

  if (!normalized) {
    return false;
  }

  return (
    normalized.includes('未来30天') ||
    normalized.includes('30天动作') ||
    normalized.includes('行动计划') ||
    normalized.includes('抓哪三件事') ||
    normalized.includes('优先抓') ||
    normalized.includes('先抓') ||
    normalized.includes('先做') ||
    normalized.includes('先推进什么') ||
    normalized.includes('整改') ||
    normalized.includes('改进计划')
  );
}

function asksForHeadTherapistWageEfficiency(question = '') {
  const normalized = String(question || '')
    .trim()
    .replace(/\s+/g, '');

  if (!normalized) {
    return false;
  }

  return /(?:\u5934\u7597\u5e08.*(?:\u5de5\u8d44|\u6548\u7387)|\u5de5\u8d44\u6548\u7387|\u7eaf\u624b\u5de5|\u6392\u73ed\u6548\u7387|\u5355\u4f4d\u670d\u52a1\u6210\u672c)/.test(
    normalized,
  );
}

function asksForPlatformStructureOptimization(question = '') {
  const normalized = String(question || '')
    .trim()
    .replace(/\s+/g, '');

  if (!normalized) {
    return false;
  }

  return (
    /(?:\u5e73\u53f0\u7ed3\u6784|\u6e20\u9053\u7ed3\u6784|\u5e73\u53f0\u8ba2\u5355)/.test(
      normalized,
    ) ||
    (/\u5e73\u53f0/.test(normalized) &&
      /(?:\u4f18\u5316|\u600e\u4e48\u4f18\u5316|\u600e\u4e48\u8c03|\u600e\u4e48\u6539|\u600e\u4e48\u505a|\u5148\u6293|\u62c6|\u590d\u76d8|\u8c03\u6574)/.test(
        normalized,
      ))
  );
}

function asksForProfitRepair(question = '') {
  const normalized = String(question || '')
    .trim()
    .replace(/\s+/g, '');

  if (!normalized) {
    return false;
  }

  return /(?:\u5229\u6da6\u4fee\u590d|\u4fee\u5229\u6da6|\u5229\u6da6\u600e\u4e48\u4fee|\u5229\u6da6\u600e\u4e48\u63d0|\u5229\u6da6\u6539\u5584|\u5229\u6da6\u4f18\u5316)/.test(
    normalized,
  );
}

function detectActionPlanSection(question = '') {
  const text = String(question || '').trim();

  if (!text) {
    return '';
  }

  if (/^(核心结论|结论)$/.test(text) || /核心结论/.test(text)) {
    return 'coreConclusion';
  }

  if (/^(先抓问题|问题)$/.test(text) || /先抓问题/.test(text)) {
    return 'issues';
  }

  if (/^(关键依据|依据|证据)$/.test(text) || /关键依据/.test(text)) {
    return 'evidence';
  }

  if (/^(30\s*天动作|动作|行动计划|行动)$/.test(text) || /30\s*天动作/.test(text)) {
    return 'actions';
  }

  if (/^(复盘指标|指标)$/.test(text) || /复盘指标/.test(text)) {
    return 'metrics';
  }

  if (/^(数据口径|口径)$/.test(text) || /数据口径/.test(text)) {
    return 'scope';
  }

  return '';
}

function historySuggestsActionPlan(history = []) {
  const text = (history || [])
    .slice(-8)
    .map((item) => String(item?.content || ''))
    .join('\n');

  if (!text.trim()) {
    return false;
  }

  return (
    asksForActionPlan(text) ||
    /核心结论|先抓问题|关键依据|30\s*天动作|复盘指标|数据口径/.test(text)
  );
}

function hasExplicitAnalysisScope(question = '') {
  const normalized = String(question || '')
    .trim()
    .replace(/\s+/g, '');

  if (!normalized) {
    return false;
  }

  const hasScope = /(?:\u6574\u4f53|\u603b\u4f53|\u5168\u76d8|\u516d\u5e97|6\u5e97|\u6240\u6709\u95e8\u5e97|\u5404\u5e97|\u5f53\u524d|\u672c\u6708|\u4eca\u6708|\u672a\u676530\u5929)/.test(
    normalized,
  );
  const hasMetric = /(?:\u5229\u6da6(?:\u7387)?|\u5e73\u53f0(?:\u5360\u6bd4|\u7ed3\u6784|\u4f9d\u8d56)?|\u5ba2\u5355\u4ef7|\u5355\u5ba2\u6210\u672c|\u5934\u7597\u5e08(?:\u5de5\u8d44)?|\u5de5\u8d44(?:\u6548\u7387)?|\u7eaf\u624b\u5de5|\u6210\u672c|\u5065\u5eb7\u5ea6|\u4eba\u6548|\u6392\u73ed|\u8ba2\u5355|\u590d\u8d2d|\u6e20\u9053)/.test(
    normalized,
  );

  return hasScope && hasMetric;
}

function hasStandaloneAnalysisTopic(question = '') {
  const normalized = String(question || '')
    .trim()
    .replace(/\s+/g, '');

  if (!normalized || normalized.length < 6) {
    return false;
  }

  return /(?:\u5934\u7597\u5e08\u5de5\u8d44|\u5de5\u8d44\u6548\u7387|\u7eaf\u624b\u5de5|\u5e73\u53f0\u7ed3\u6784|\u5e73\u53f0\u8ba2\u5355|\u5e73\u53f0\u5ba2\u5355\u4ef7|\u5e73\u53f0\u5355\u5ba2\u6210\u672c|\u9ad8\u4f63\u91d1\u8ba2\u5355|\u6392\u73ed\u6548\u7387|\u5355\u4f4d\u670d\u52a1\u6210\u672c|\u5229\u6da6\u4fee\u590d|\u6e20\u9053\u7ed3\u6784|\u5ba2\u6e90\u7ed3\u6784|\u79c1\u57df\u590d\u8d2d|\u4f1a\u5458\u50a8\u503c|\u8ba2\u5355\u7ed3\u6784|\u5de5\u8d44\u6295\u5165)/.test(
    normalized,
  );
}

function isContextDependentFollowUp(question = '', reports = []) {
  const normalized = String(question || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[\u3002\uff0c\uff01\uff1f,.!?:;\u3001\uff1a\uff1b'"`]/g, '');

  if (!normalized) {
    return false;
  }

  const resolvedStore =
    resolveStore(normalized) || resolveStoreFromReports(normalized, reports);

  if (resolvedStore || asksForAllStores(normalized)) {
    return false;
  }

  return /^(?:\u90a3|\u8fd9|\u90a3\u5bb6|\u8fd9\u5bb6|\u90a3\u4e2a|\u8fd9\u4e2a|\u90a3\u95e8\u5e97|\u8fd9\u95e8\u5e97|\u90a3\u5bb6\u5e97|\u8fd9\u5bb6\u5e97|\u5b83|\u8fd9\u5757|\u90a3\u5757|\u7ee7\u7eed|\u5c55\u5f00|\u8be6\u7ec6|\u8be6\u7ec6\u8bf4\u8bf4|\u518d\u8bf4|\u7136\u540e|\u63a5\u7740|\u8fd8\u6709|\u4e3a\u4ec0\u4e48|\u4e3a\u4f55|\u600e\u4e48|\u600e\u4e48\u770b|\u600e\u4e48\u505a|\u90a3\u4e3a\u4ec0\u4e48|\u8fd9\u4e2a\u4e3a\u4ec0\u4e48|\u90a3\u600e\u4e48|\u5229\u6da6\u5462|\u8fd9\u4e2a\u5462)$/.test(
    normalized,
  );

  return /^(那|那就|那这|那家|那店|那它|它|她|他|这家|这个|这一家|继续|展开|细说|详细|再说|然后|接着|还有|那为什么|那怎么|那利润呢|这个呢|那呢)/.test(
    normalized,
  );
}

function isSelfContainedQuestion(question = '', reports = []) {
  if (!String(question || '').trim()) {
    return false;
  }

  if (isContextDependentFollowUp(question, reports)) {
    return false;
  }

  return Boolean(
    resolveStore(question) ||
      resolveStoreFromReports(question, reports) ||
      asksForAllStores(question) ||
      inferPeriod(question) ||
      shouldUseDirectLookup(question) ||
      asksForActionPlan(question) ||
      asksForPriorityStore(question) ||
      hasExplicitAnalysisScope(question) ||
      hasStandaloneAnalysisTopic(question),
  );
}

function buildRelevantChatHistory(history = [], question = '', reports = []) {
  const entries = Array.isArray(history) ? history : [];

  if (!entries.length) {
    return [];
  }

  if (isSelfContainedQuestion(question, reports)) {
    return [];
  }

  return entries;
}

function findFollowUpAnchorQuestion(history = [], reports = []) {
  const entries = Array.isArray(history) ? history : [];

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const item = entries[index];

    if (item?.role !== 'user') {
      continue;
    }

    const content = String(item.content || '').trim();

    if (!content) {
      continue;
    }

    if (!isContextDependentFollowUp(content, reports)) {
      return content;
    }
  }

  return '';
}

function contextualizeFollowUpQuestion(question = '', history = [], reports = []) {
  const normalizedQuestion = String(question || '').trim();

  if (!normalizedQuestion || !isContextDependentFollowUp(normalizedQuestion, reports)) {
    return normalizedQuestion;
  }

  const anchorQuestion = findFollowUpAnchorQuestion(history, reports);

  if (!anchorQuestion) {
    return normalizedQuestion;
  }

  return `${anchorQuestion}。继续追问：${normalizedQuestion}`;
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

function findLookupReport(question, reports, defaults = {}) {
  const store = resolveQuestionStore(question, reports, defaults.store || null);

  if (!store) {
    return {
      store: null,
      report: null,
      requestedPeriod: inferPeriodFromQuestion(question, reports) || defaults.period || null,
      usedLatestPeriod: false,
    };
  }

  const requestedPeriod = inferPeriodFromQuestion(question, reports) || defaults.period || null;
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

  // 如果提问非常简短（如只说了店名），默认想看营收
  const isGenericStoreQuery = normalizedQuestion.length <= 6 && !isFactLookupQuestion(question) && !isAnalysisIntent(question);

  buildChannelEntries(report).forEach((channel) => {
    const denominator =
      Number(report.summary?.channelTotal || 0) ||
      Number(report.summary?.grossRevenue || 0) ||
      buildChannelEntries(report).reduce((sum, item) => sum + Number(item.value || 0), 0);
    const ratio = denominator > 0 ? roundNumber(Number(channel.value || 0) / denominator, 4) : 0;
    const aliases = buildAliasList(channel.name, [
      `${channel.name}收入`,
      `${channel.name}营收`,
      `${channel.name}渠道`,
      `${channel.name}金额`,
    ]);
    const matchScore = getLookupMatchScore(normalizedQuestion, aliases);

    if (!matchScore) {
      return;
    }

    candidates.push({
      kind: 'channel',
      label: `${channel.name}收入`,
      channelName: channel.name,
      aliases,
      matchScore,
      priority: 4,
      value: answerAsRatio ? ratio : channel.value,
      formattedValue: answerAsRatio ? percent(ratio) : exactCurrency(channel.value),
      formatter: answerAsRatio ? percent : exactCurrency,
      wantsRatio: answerAsRatio,
      valueForReport: (peerReport) => {
        const matchedChannel = findChannelEntry(peerReport, channel.name);

        if (!matchedChannel) {
          return null;
        }

        if (!answerAsRatio) {
          return matchedChannel.value;
        }

        const peerDenominator =
          Number(peerReport.summary?.channelTotal || 0) ||
          Number(peerReport.summary?.grossRevenue || 0) ||
          buildChannelEntries(peerReport).reduce(
            (sum, item) => sum + Number(item.value || 0),
            0,
          );

        return peerDenominator > 0
          ? roundNumber(Number(matchedChannel.value || 0) / peerDenominator, 4)
          : 0;
      },
    });
  });

  SUMMARY_LOOKUPS.forEach((metric) => {
    const aliases = buildAliasList(metric.label, metric.aliases);
    let matchScore = getLookupMatchScore(normalizedQuestion, aliases);

    // 默认兜底：如果只是问店名，给营收
    if (isGenericStoreQuery && metric.key === 'recognizedRevenue') {
      matchScore = 1; 
    }

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

  if (target.kind === 'channel') {
    facts.push('该指标属于渠道金额，不是自动换算出来的占比。');
  }

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

function buildParsingSourceFact(report = {}) {
  const sourceFile =
    (Array.isArray(report.parsingSourceFiles) ? report.parsingSourceFiles : []).find(
      (file) =>
        file?.structuredData?.kind === 'revenue-report' || file?.sourceGroupKey === 'revenue',
    ) || null;

  if (!sourceFile) {
    return '';
  }

  const sheetName = cleanText(sourceFile.metrics?.sheetName || report.sheetName || '');
  return `当前智能解析来源：${sourceFile.fileName || sourceFile.name || '营业报表.xlsx'}${
    sheetName ? ` / ${sheetName} 工作表` : ''
  }。`;
}

function buildChannelDerivationFacts(report = {}, target = {}) {
  if (target.kind !== 'channel') {
    return [];
  }

  const channelName = target.channelName || target.label.replace(/收入$/, '');
  const channels = report.summary?.channels || {};
  const grossRevenue = Number(report.summary?.grossRevenue || report.summary?.channelTotal || 0);
  const channelTotal = Number(report.summary?.channelTotal || grossRevenue || 0);
  const walletChannel = Number(channels['微信银联支付宝'] || 0);
  const cashChannel = Number(channels['现金'] || 0);
  const meituanRevenue = Number(channels['美团'] || 0);
  const douyinRevenue = Number(channels['抖音'] || 0);
  const targetAmount =
    channelName === '美团'
      ? meituanRevenue
      : channelName === '抖音'
        ? douyinRevenue
        : channelName === '现金'
          ? cashChannel
          : walletChannel;

  if (target.wantsRatio && channelTotal > 0) {
    return [
      `解析方式：先取 ${channelName}渠道金额，再除以当月全部渠道金额。`,
      `计算公式：${channelName}占比 = ${channelName}渠道金额 / 全部渠道金额。`,
      `代入当前值：${exactCurrency(targetAmount)} / ${exactCurrency(channelTotal)} = ${percent(
        targetAmount / channelTotal,
      )}。`,
    ];
  }

  if (channelName === '美团' && grossRevenue > 0) {
    return [
      '解析方式：先读取营业报表里的“合计”行，以及充值汇总区段，拿到总实收、微信银联支付宝、现金、抖音几个渠道值。',
      '计算公式：美团收入 = 总实收 - 微信银联支付宝 - 现金 - 抖音。',
      `代入当前值：${exactCurrency(grossRevenue)} - ${exactCurrency(walletChannel)} - ${exactCurrency(cashChannel)} - ${exactCurrency(douyinRevenue)} = ${exactCurrency(meituanRevenue)}。`,
    ];
  }

  if (channelName === '抖音') {
    return [
      '解析方式：直接读取营业报表“合计”行里的抖音渠道金额。',
      `当前值：抖音收入 = ${exactCurrency(douyinRevenue)}。`,
    ];
  }

  if (channelName === '现金') {
    return [
      '解析方式：现金渠道 = 合计行里的现金金额 + 充值汇总里的现金充值。',
      `当前值：现金收入 = ${exactCurrency(cashChannel)}。`,
    ];
  }

  if (channelName === '微信银联支付宝') {
    return [
      '解析方式：微信银联支付宝渠道 = 银联 + 微信 + 支付宝三个支付项合并。',
      `当前值：微信银联支付宝收入 = ${exactCurrency(walletChannel)}。`,
    ];
  }

  return [];
}

function buildParsingLookupReply({ report, target, question, usedLatestPeriod }) {
  const periodLabel = report.periodLabel || formatPeriodLabelFromPeriod(report.period);
  const derivationQuestion = isDerivationQuestion(question);
  const displayLabel = target.label || '核心指标';

  const lines = derivationQuestion
    ? [
        '## 这个数怎么来的',
        `先给结果：${report.storeName} ${periodLabel} 的 **${displayLabel}** 是 **${target.formattedValue}**。`,
        '这条回答只基于当前解析窗口里的单店单月文件，不会混入其他门店对比。',
      ]
    : [
        '## 查询结果',
        `先给你结果：${report.storeName} ${periodLabel} 的 **${displayLabel}** 是 **${target.formattedValue}**。`,
        '',
        '## 关键信息',
        `- 门店对象：${report.storeName}`,
        `- 归口月份：${periodLabel}`,
        `- 核心指标：${displayLabel}`,
        '- 数据范围：仅限当前智能解析窗口，口径是单店单月。',
      ];

  const sourceFact = buildParsingSourceFact(report);

  if (sourceFact) {
    lines.push('', '## 解析来源');
    lines.push(`- ${sourceFact}`);
    lines.push('- 该数据直接从上述源文件读取，确保了财务口径的真实性。');
  }

  const derivationFacts = buildChannelDerivationFacts(report, target);

  if (derivationFacts.length) {
    lines.push('', derivationQuestion ? '## 算法与逻辑' : '## 计算口径说明');
    derivationFacts.forEach((fact) => {
      lines.push(`- ${fact}`);
    });
  } else if (derivationQuestion) {
    lines.push('', '## 解析逻辑');
    lines.push('- 该值来自当前文件的结构化扫描结果，优先匹配源文件中的原生字段。');
  }

  if (target.kind === 'channel' && !target.wantsRatio) {
    lines.push('', '## 补充说明');
    lines.push('- 当前展示的是**渠道实收金额**。如需查看占比，请问“XX占比是多少”。');
  }

  if (usedLatestPeriod) {
    lines.push('', '## 提示');
    lines.push('- 由于提问未指定月份，系统已自动按当前解析的最匹配月份进行解答。');
  }

  return lines.join('\n');
}

function buildDirectLookupReply({ report, target, peerComparison, usedLatestPeriod }) {
  const periodLabel = report.periodLabel || formatPeriodLabelFromPeriod(report.period);
  const metricLabel = target.wantsRatio ? `${target.label}占总成本比例` : target.label;
  const lines = [
    '## 查询结果',
    `先给你结果：${report.storeName} ${periodLabel} 的 **${metricLabel}** 是 **${target.formattedValue}**。`,
    '',
    '## 关键明细',
    `- 门店：${report.storeName}`,
    `- 月份：${periodLabel}`,
    `- 指标：${metricLabel}`,
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
      `- 同月 ${peerComparison.count} 家门店里，${report.storeName} 处在第 ${peerComparison.higherRank} 高 / 第 ${peerComparison.lowerRank} 低的位置。`,
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
      `- 你没有指定月份，这里按该店最新月报 **${periodLabel}** 直接查询。`,
    );
  }

  lines.push('- 这条结果是直接查原始财务月报得出的，没有使用模型估算。');

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
    '## 已核验结果',
    `先把结果摊开看：**${periodLabel}** 共查询 **${rows.length} 家门店**，指标是 **${
      target.wantsRatio ? `${target.label}占总成本比例` : target.label
    }**。`,
    '',
    '## 查询口径',
    `- 月份：${periodLabel}`,
    `- 指标：${target.wantsRatio ? `${target.label}占总成本比例` : target.label}`,
    `- 排序：${target.wantsRatio ? '按比例从高到低' : '按金额从高到低'}`,
  ];

  if (target.kind === 'item' && target.categoryName) {
    lines.push(`- 归属科目：${target.categoryName}`);
  }

  lines.push('', '## 各门店明细');
  rankedRows.forEach((row, index) => {
    const valueText =
      row.value === null || row.value === undefined
        ? '未记录'
        : `**${target.formatter(row.value)}**`;

    if (row.value === null || row.value === undefined) {
      lines.push(`- ${row.storeName}：${valueText}`);
      return;
    }

    lines.push(`${index + 1}. ${row.storeName}：${valueText}`);
  });

  if (peerComparison && peerComparison.numericCount >= 2) {
    lines.push('', '## 同期摘要');
    lines.push(
      `- 最高：${peerComparison.highest.storeName} ${target.formatter(peerComparison.highest.value)}`,
    );
    lines.push(
      `- 最低：${peerComparison.lowest.storeName} ${target.formatter(peerComparison.lowest.value)}`,
    );
    lines.push(`- 均值：${target.formatter(peerComparison.average)}`);
  }

  lines.push('', '## 说明');

  if (usedLatestPeriod) {
    lines.push(
      `- 你没有指定月份，这里按已导入的最新月报 **${periodLabel}** 直接查询。`,
    );
  }

  lines.push(
    '- 以上结果都是直接查询原始财务月报明细得出，本条回答没有使用模型估算。',
  );
  lines.push(
    '- 如果你想继续看“哪家偏高、为什么高、先整改哪家”，可以直接基于这组真实数据往下追问。',
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
    `我已经去查 ${store.name} ${periodLabel} 的原始月报了，但你现在这句问法还不能唯一对应到某个真实指标或科目。`,
    '',
    '## 你可以这样问',
    '- `万象城店水电费是多少？`',
    '- `万象城店物业费是多少？`',
    '- `万象城店利润率是多少？`',
    '',
    '## 说明',
    '- 为了保证数据真实，没命中精确字段时，系统不会把这类问题再交给模型去猜。',
  ].join('\n');
}

function buildAllStoresLookupClarificationReply({ requestedPeriod }) {
  const periodLabel = requestedPeriod
    ? formatPeriodLabelFromPeriod(requestedPeriod)
    : '最新月报';

  return [
    '## 未找到精确字段',
    `我已经准备按全部门店去查 ${periodLabel} 的原始月报了，但你现在这句问法还不能唯一映射到某个真实指标或明细项。`,
    '',
    '## 你可以这样问',
    '- `分别列出所有门店的附加值产品花费`',
    '- `各门店水电费多少？`',
    '- `每个门店利润率是多少？`',
    '',
    '## 说明',
    '- 为了保证数据真实，这类问题在未命中精确字段时不会交给模型猜测。',
  ].join('\n');
}

function buildAllStoresMissingDataReply({ requestedPeriod }) {
  const periodLabel = requestedPeriod
    ? formatPeriodLabelFromPeriod(requestedPeriod)
    : '指定月份';

  return [
    '## 当前缺失',
    `当前还没有 ${periodLabel} 的全部门店月报数据，所以这次没法按全门店口径直接查数。`,
    '',
    '## 下一步建议',
    '- 先补齐这个月份的全部门店月报，再做逐店查询或横向比较。',
  ].join('\n');
}

function resolveDirectLookup(question, reports, defaults = {}, options = {}) {
  const lookupReport = findLookupReport(question, reports, defaults);

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

  const peerComparison = options.disablePeerComparison
    ? null
    : buildLookupPeerComparison({
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

function resolveAllStoresLookup(question, reports, options = {}) {
  if (options.disableAllStores) {
    return {
      shouldHandle: false,
      store: null,
      requestedPeriod: options.requestedPeriod || null,
      period: options.requestedPeriod || null,
      reportsForPeriod: [],
      usedLatestPeriod: false,
      target: null,
      rows: [],
      peerComparison: null,
      retrievedFacts: [],
    };
  }

  const store = resolveQuestionStore(question, reports);
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
  const resolvedStore = resolveQuestionStore(question, context?.reportSnapshots || []);

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
    '## 先说结论',
    `从 ${snapshot?.periodLabel || dashboard.overview.latestPeriod || '最新'} 数据看，${store.storeName} 利润率 ${percent(
      store.profitMargin,
    )}，${
      /为什么|为何|原因/.test(question)
        ? '利润承压核心集中在渠道结构偏重和成本效率承压。'
        : '当前经营财务状态需要重点盯利润率和渠道结构。'
    }`,
    '',
    '## 为什么会这样',
    ...reasons.slice(0, 3).map((line, index) => `${index + 1}. ${line}`),
    '',
    '## 关键依据',
    ...evidence.slice(0, 4).map((line) => `- ${line}`),
    '',
    '## 下一步怎么做',
    ...actions.slice(0, 3).map((line, index) => `${index + 1}. ${line}`),
    dashboard.trend.length < 2
      ? '## 补充说明\n- 当前仅有单月样本，趋势判断还受限；但不影响先做本月结构诊断。'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildHeadTherapistWageEfficiencyReply({ dashboard }) {
  const overview = dashboard?.overview || {};
  const periodLabel = formatPeriodLabelFromPeriod(overview.latestPeriod || '');
  const selectedStoreCount = Number(overview.selectedStoreCount || 0);
  const wageCategory = (dashboard?.costBreakdown || []).find((item) =>
    /\u5934\u7597\u5e08\u5de5\u8d44/.test(String(item?.name || '')),
  );
  const pureManualItem = (dashboard?.topCostItems || []).find((item) =>
    /\u7eaf\u624b\u5de5/.test(String(item?.name || '')),
  );

  if (!wageCategory) {
    return '';
  }

  const pureManualShare =
    pureManualItem && Number(wageCategory.value || 0) > 0
      ? Number(pureManualItem.value || 0) / Number(wageCategory.value || 1)
      : null;

  return [
    '## 🎯 先说结论',
    `从 ${periodLabel || '当前'} ${selectedStoreCount || ''}${selectedStoreCount ? '店' : ''}汇总看，头疗师工资已经是当前最值得优先复盘的人效成本项，重点不是单纯压工资，而是判断这笔人工投入有没有换来足够的客单价和利润承接。`,
    '',
    '## 🔍 为什么要先盯这项',
    `1. 头疗师工资合计 ${exactCurrency(wageCategory.value)}，占总成本 ${percent(wageCategory.ratio)}，已经是当前整体第一大成本项。`,
    pureManualItem
      ? `2. 其中“${pureManualItem.name}” ${exactCurrency(pureManualItem.value)}，约占头疗师工资 ${percent(
          pureManualShare,
        )}，说明主要压力集中在一线手工投入。`
      : '',
    `3. 当前整体客单价 ${currency(overview.avgTicket)}，单客成本 ${currency(overview.avgCustomerCost)}，如果排班效率和服务承接跟不上，人工投入会直接压缩利润空间。`,
    '',
    '## 📌 复盘重点',
    '- 先拆“纯手工”金额，看门店、人次和班次之间是否匹配。',
    '- 再看客单价承接，判断人工投入有没有换来更高客单或更高复购。',
    '- 同步看排班效率和单位服务成本，识别低产出时段、冗余工时和低效门店。',
    '',
    '## ✅ 下一步怎么做',
    '- 优先按门店拉出头疗师工资、纯手工金额、客单价、单客成本四张对照表。',
    '- 对纯手工占比高但利润率没有同步兑现的门店，优先复盘排班和服务结构。',
    '- 后续周复盘固定盯“工资占比、纯手工金额、单位服务成本”三组指标。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildStorePlatformOptimizationReply({ dashboard, context, storeId }) {
  const store = (dashboard?.storeComparison || []).find((item) => item.storeId === storeId);
  const snapshot = findSnapshotByStoreId(context, storeId);
  const focusVsAverage = context?.peerComparison?.focusVsAverage || null;
  const meituanChannel = findChannelEntry(snapshot, '美团');
  const douyinChannel = findChannelEntry(snapshot, '抖音');
  const privateShare = Math.max(0, 1 - Number(store?.platformRevenueShare || 0));
  const feeCategory = (snapshot?.topCostCategories || []).find((item) =>
    /\u624b\u7eed\u8d39/.test(String(item?.name || '')),
  );
  const feeItem = feeCategory?.topItems?.[0] || null;

  if (!store || !snapshot) {
    return '';
  }

  return [
    '## 🎯 先说结论',
    `从 ${snapshot.periodLabel || formatPeriodLabelFromPeriod(store.period)} 数据看，${store.storeName} 的平台结构优化重点不是继续放大平台单量，而是先把平台订单质量、佣金结构和复购承接拆清楚。`,
    '',
    '## 🔍 为什么要先抓平台结构',
    `1. 当前平台占比 ${percent(store.platformRevenueShare)}，${Math.abs(
      Number(focusVsAverage?.platformRevenueShareGap || 0),
    ) >= 0.03 ? `比门店均值高 ${percentPoint(Math.abs(focusVsAverage.platformRevenueShareGap || 0))}` : '已经明显偏高'}，渠道依赖偏重。`,
    meituanChannel && douyinChannel
      ? `2. 平台结构里，美团占 ${percent(meituanChannel.share)}，抖音占 ${percent(douyinChannel.share)}，私域和到店合计只占 ${percent(privateShare)}，说明外部平台仍是主要流量入口。`
      : `2. 当前私域和到店合计仅占 ${percent(privateShare)}，平台外承接能力偏弱。`,
    `3. 当前客单价 ${currency(store.avgTicket)}，单客成本 ${currency(store.avgCustomerCost)}，单客毛利只有 ${currency(
      Number(store.avgTicket || 0) - Number(store.avgCustomerCost || 0),
    )}，如果高佣金订单占比继续偏高，利润会被持续侵蚀。`,
    feeItem
      ? `4. 手续费相关支出里，当前最高的是“${feeItem.name}” ${exactCurrency(feeItem.amount)}，说明平台费用已经开始形成真实利润压力。`
      : '',
    '',
    '## 📌 优化时先拆什么',
    '- 先按平台拆订单结构，分别看美团、抖音的客单价、单客成本、复购率和佣金水平。',
    '- 再拆高佣金订单，看哪些订单只带来流水，没有带来真正利润。',
    '- 同步看平台引流后的会员、储值和私域转化，判断平台流量有没有沉淀成长期资产。',
    '',
    '## ✅ 下一步怎么做',
    '- 先把高频复购客从平台回流到会员、储值和私域，降低纯平台复购占比。',
    '- 对低客单、高佣金订单单独做筛查，必要时调整平台商品结构和投放节奏。',
    '- 周复盘固定盯“平台占比、平台客单价、平台单客成本、高佣金订单占比”四个指标。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildFleetPlatformOptimizationReply({ dashboard, context }) {
  const stores = [...(dashboard?.storeComparison || [])];
  const platformRiskStore = [...stores].sort(
    (left, right) => right.platformRevenueShare - left.platformRevenueShare,
  )[0];

  if (!platformRiskStore) {
    return '';
  }

  return [
    '## 🎯 先说结论',
    `从 ${formatPeriodLabelFromPeriod(dashboard?.overview?.latestPeriod)} ${dashboard?.overview?.selectedStoreCount || stores.length}店汇总看，平台结构优化应优先从 ${platformRiskStore.storeName} 开始，因为它当前的平台依赖最重。`,
    '',
    '## 🔍 为什么先抓这家',
    `1. 整体平台占比 ${percent(dashboard?.overview?.platformRevenueShare)}，但 ${platformRiskStore.storeName} 已经到 ${percent(platformRiskStore.platformRevenueShare)}。`,
    `2. ${platformRiskStore.storeName} 当前客单价 ${currency(platformRiskStore.avgTicket)}，单客成本 ${currency(platformRiskStore.avgCustomerCost)}，平台结构如果不优化，利润弹性会继续被压缩。`,
    '3. 平台结构问题本质不是有没有流量，而是平台订单质量、佣金水平和私域承接能力是否匹配。',
    '',
    '## ✅ 接下来怎么做',
    `- 先把 ${platformRiskStore.storeName} 的平台订单按美团、抖音、高佣金订单分层复盘。`,
    '- 再横向对比 6 店的平台客单价、平台单客成本和平台复购率，找出异常门店和异常订单结构。',
    '- 周复盘固定盯“平台占比、平台客单价、平台单客成本、高佣金订单占比、平台转私域率”。',
  ].join('\n');
}

function buildStoreProfitRepairReply({ dashboard, context, storeId }) {
  const store = (dashboard?.storeComparison || []).find((item) => item.storeId === storeId);
  const snapshot = findSnapshotByStoreId(context, storeId);
  const leader = context?.peerComparison?.leaders?.profitMarginLeader || null;
  const focusVsAverage = context?.peerComparison?.focusVsAverage || null;
  const topCategory = snapshot?.topCostCategories?.[0] || null;
  const topItem = snapshot?.topCostItems?.[0] || null;
  const unitMargin = Number(store?.avgTicket || 0) - Number(store?.avgCustomerCost || 0);

  if (!store || !snapshot) {
    return '';
  }

  return [
    '## 🎯 先说结论',
    `从 ${snapshot.periodLabel || formatPeriodLabelFromPeriod(store.period)} 数据看，${store.storeName} 的利润修复要优先从“平台占比偏高 + 单客利润垫偏窄 + 重点成本项承压”这三件事一起下手。`,
    '',
    '## 🔍 为什么利润会被压住',
    `1. 当前利润率 ${percent(store.profitMargin)}，健康度 ${store.healthScore} 分。`,
    Math.abs(Number(focusVsAverage?.platformRevenueShareGap || 0)) >= 0.03
      ? `2. 平台占比 ${percent(store.platformRevenueShare)}，比门店均值高 ${percentPoint(
          Math.abs(focusVsAverage.platformRevenueShareGap || 0),
        )}，平台费用对利润形成持续挤压。`
      : `2. 平台占比 ${percent(store.platformRevenueShare)}，渠道结构仍需继续优化。`,
    `3. 客单价 ${currency(store.avgTicket)}，单客成本 ${currency(store.avgCustomerCost)}，单客毛利只有 ${currency(unitMargin)}，利润垫偏窄。`,
    topCategory
      ? `4. 当前最大成本项是“${topCategory.name}” ${exactCurrency(topCategory.amount)}，占总成本 ${percent(topCategory.ratio)}。`
      : '',
    topItem
      ? `5. 重点成本项里，当前最需要盯的是“${topItem.name}” ${exactCurrency(topItem.amount)}。`
      : '',
    leader && leader.storeId !== store.storeId
      ? `6. 对标看，当前利润率领先门店是 ${leader.storeName}，利润率 ${percent(leader.profitMargin)}，说明还有修复空间。`
      : '',
    '',
    '## 📌 修复时先盯什么',
    '- 周复盘先盯利润率、平台占比、客单价、单客成本，判断利润修复到底卡在哪一段。',
    '- 再拆最大成本项和重点成本项，看有没有低效投放、冗余工时或无效支出。',
    '- 同步对标利润率领先门店，拆客单模型、渠道结构和重点成本差距。',
    '',
    '## ✅ 下一步怎么做',
    '- 先压平台依赖，把高频复购客转向会员、储值和私域复购。',
    '- 对单客毛利偏窄的项目和时段做专项复盘，优先修客单和服务结构。',
    '- 对重点成本项按周跟踪金额变化，确认利润修复有没有真正落到成本端。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildFleetProfitRepairReply({ dashboard, context }) {
  const priorityStore = selectPriorityStore(dashboard);

  if (!priorityStore) {
    return '';
  }

  return [
    '## 🎯 先说结论',
    `从 ${formatPeriodLabelFromPeriod(dashboard?.overview?.latestPeriod)} ${dashboard?.overview?.selectedStoreCount || (dashboard?.storeComparison || []).length}店汇总看，利润修复应优先从 ${priorityStore.storeName} 开始。`,
    '',
    '## 🔍 为什么先抓这家',
    `1. ${priorityStore.storeName} 当前健康度 ${priorityStore.healthScore} 分，利润率 ${percent(priorityStore.profitMargin)}。`,
    `2. 平台占比 ${percent(priorityStore.platformRevenueShare)}，客单价 ${currency(priorityStore.avgTicket)}，单客成本 ${currency(priorityStore.avgCustomerCost)}。`,
    '3. 这类利润修复不是单看利润率，而是要把渠道结构、单客模型和重点成本一起修。',
    '',
    '## ✅ 接下来怎么做',
    `- 先把 ${priorityStore.storeName} 拉成利润修复专项，按周跟踪利润率、平台占比、客单价、单客成本。`,
    '- 再拆最大成本项和重点成本项，确认有没有可以立刻止损的支出。',
    '- 同步对标利润率领先门店，逐项拆出利润差距来自哪里。',
  ].join('\n');
}

function buildOverallFinancialFallbackReply({ dashboard }) {
  const bestMarginStore = [...dashboard.storeComparison].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const watchStore = [...dashboard.storeComparison].sort(
    (left, right) => left.healthScore - right.healthScore,
  )[0];

  return [
    '## 先说结论',
    `当前整体营收 ${currency(dashboard.overview.revenue)}，净利润 ${currency(
      dashboard.overview.profit,
    )}，利润率 ${percent(dashboard.overview.profitMargin)}。`,
    '',
    '## 整体表现',
    `1. 平台收入占比 ${percent(dashboard.overview.platformRevenueShare)}，渠道结构仍然偏重平台。`,
    dashboard.costBreakdown[0]
      ? `2. 当前最大成本压力来自“${dashboard.costBreakdown[0].name}”，占总成本 ${percent(
          dashboard.costBreakdown[0].ratio,
        )}。`
      : '',
    '',
    '## 重点门店',
    bestMarginStore
      ? `- 当前利润率表现较好的门店是 ${bestMarginStore.storeName}，利润率 ${percent(
          bestMarginStore.profitMargin,
        )}。`
      : '',
    watchStore
      ? `- 当前最该优先盯的门店是 ${watchStore.storeName}，健康度 ${watchStore.healthScore} 分。`
      : '',
    '',
    '## 下一步',
    '- 如果你要，我可以继续按门店拆解原因、证据和 30 天整改动作。',
  ]
    .filter(Boolean)
    .join('\n');
}

function findSnapshotByStoreId(context = {}, storeId = '') {
  return (context.reportSnapshots || []).find((item) => item.storeId === storeId) || null;
}

function buildVerifiedSourceLine(scopeLabel, content) {
  if (!scopeLabel || !content) {
    return '';
  }

  return `从${scopeLabel}数据看，${content}`;
}

function buildFleetActionPlanSections({ dashboard, context }) {
  const stores = [...(dashboard.storeComparison || [])];

  if (!stores.length) {
    return null;
  }

  const periodLabel =
    context.analysisScope?.periodLabel ||
    context.reportSnapshots?.[0]?.periodLabel ||
    formatPeriodLabelFromPeriod(dashboard.overview.latestPeriod);
  const scopeLabel = `${periodLabel} ${stores.length}店汇总`;
  const priorityStore = selectPriorityStore(dashboard);
  const platformRiskStore = [...stores].sort(
    (left, right) => right.platformRevenueShare - left.platformRevenueShare,
  )[0];
  const bestMarginStore = [...stores].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const overallTopCategory = dashboard.costBreakdown?.[0] || null;
  const overallTopItem = dashboard.topCostItems?.[0] || null;
  const prioritySnapshot = priorityStore
    ? findSnapshotByStoreId(context, priorityStore.storeId)
    : null;
  const platformSnapshot = platformRiskStore
    ? findSnapshotByStoreId(context, platformRiskStore.storeId)
    : null;
  const priorityTopCategory = prioritySnapshot?.topCostCategories?.[0] || null;
  const priorityTopItem = prioritySnapshot?.topCostItems?.[0] || null;

  return {
    coreConclusion: [
      `未来 30 天如果只抓 3 件最重要的事，建议优先盯住：1. ${platformRiskStore.storeName} 平台结构优化；2. 整体“${
        overallTopCategory?.name || '重点成本项'
      }”效率复盘；3. ${priorityStore.storeName} 利润修复。`,
    ],
    issues: [
      `1. ${buildVerifiedSourceLine(
        `${platformRiskStore.storeName} ${platformSnapshot?.periodLabel || periodLabel}`,
        `平台占比 ${percent(platformRiskStore.platformRevenueShare)}，是当前 ${stores.length} 店最高，渠道依赖最重。`,
      )}`,
      `2. ${buildVerifiedSourceLine(
        scopeLabel,
        `${
          overallTopCategory?.name || '当前最大成本项'
        } 合计 ${exactCurrency(overallTopCategory?.value || 0)}，占总成本 ${percent(
          overallTopCategory?.ratio || 0,
        )}${overallTopItem ? `；重点成本项“${overallTopItem.name}”合计 ${exactCurrency(overallTopItem.value || overallTopItem.amount || 0)}` : ''}。`,
      )}`,
      `3. ${buildVerifiedSourceLine(
        `${priorityStore.storeName} ${prioritySnapshot?.periodLabel || periodLabel}`,
        `健康度 ${priorityStore.healthScore} 分，利润率 ${percent(
          priorityStore.profitMargin,
        )}，平台占比 ${percent(priorityStore.platformRevenueShare)}，所以它是当前最该优先修复的门店。`,
      )}`,
    ],
    evidence: [
      `- ${buildVerifiedSourceLine(
        scopeLabel,
        `整体利润率 ${percent(dashboard.overview.profitMargin)}，整体平台占比 ${percent(
          dashboard.overview.platformRevenueShare,
        )}。`,
      )}`,
      `- ${buildVerifiedSourceLine(
        `${platformRiskStore.storeName} ${platformSnapshot?.periodLabel || periodLabel}`,
        `利润率 ${percent(platformRiskStore.profitMargin)}，客单价 ${currency(
          platformRiskStore.avgTicket,
        )}，单客成本 ${currency(platformRiskStore.avgCustomerCost)}。`,
      )}`,
      `- ${buildVerifiedSourceLine(
        `${priorityStore.storeName} ${prioritySnapshot?.periodLabel || periodLabel}`,
        `${priorityTopCategory ? `${priorityTopCategory.name} ${exactCurrency(priorityTopCategory.amount)}，占总成本 ${percent(priorityTopCategory.ratio)}` : `利润率 ${percent(priorityStore.profitMargin)}`}${
          priorityTopItem ? `；重点成本项“${priorityTopItem.name}” ${exactCurrency(priorityTopItem.amount)}` : ''
        }。`,
      )}`,
      bestMarginStore
        ? `- ${buildVerifiedSourceLine(
            `${bestMarginStore.storeName} ${findSnapshotByStoreId(context, bestMarginStore.storeId)?.periodLabel || periodLabel}`,
            `利润率 ${percent(bestMarginStore.profitMargin)}，是当前对标门店。`,
          )}`
        : '',
    ].filter(Boolean),
    actions: [
      `1. 7 天内先拆 ${platformRiskStore.storeName} 的平台订单结构，逐单复盘平台客单价、平台单客成本、复购率和高佣金订单占比。`,
      `2. 14 天内复盘 ${scopeLabel} 的“${overallTopCategory?.name || '重点成本项'}”效率，重点看${
        overallTopItem ? `“${overallTopItem.name}”金额、` : ''
      }客单价承接、排班效率和单位服务成本。`,
      `3. 30 天内把 ${priorityStore.storeName} 作为利润修复专项，逐周跟踪利润率、平台占比、客单价、单客成本和${
        priorityTopItem ? `“${priorityTopItem.name}”` : '重点成本项'
      }变化。`,
    ],
    metrics: [
      `- ${platformRiskStore.storeName}：平台占比、平台客单价、平台单客成本、高佣金订单占比。`,
      `- ${scopeLabel}：${overallTopCategory?.name || '重点成本项'}占总成本比重${
        overallTopItem ? `、${overallTopItem.name}金额` : ''
      }、整体单客成本。`,
      `- ${priorityStore.storeName}：健康度、利润率、平台占比、客单价、单客成本。`,
    ],
    scope: [
      `- 整体成本项和整体占比均按 ${scopeLabel} 汇总计算，不对应单一门店。`,
      `- 如果引用门店数据，均已单独标明“门店 + 月份”；例如 ${priorityStore.storeName} 的成本口径与 ${platformRiskStore.storeName} 的渠道口径彼此独立。`,
    ],
  };
}

function renderFleetActionPlanReply(sections, section = '') {
  if (!sections) {
    return '';
  }

  const labels = {
    coreConclusion: '## 🎯 核心结论',
    issues: '## 🔍 先看问题',
    evidence: '## 📌 关键依据',
    actions: '## ✅ 接下来 30 天',
    metrics: '## 📈 复盘指标',
    scope: '## 🧾 数据口径',
  };
  const orderedKeys = [
    'coreConclusion',
    'issues',
    'evidence',
    'actions',
    'metrics',
    'scope',
  ];

  if (section && Array.isArray(sections[section]) && sections[section].length) {
    return [labels[section], ...sections[section]].join('\n');
  }

  return orderedKeys
    .flatMap((key) => (Array.isArray(sections[key]) && sections[key].length ? [labels[key], ...sections[key], ''] : []))
    .join('\n')
    .trim();
}

function buildFleetActionPlanReply({ dashboard, context, section = '' }) {
  return renderFleetActionPlanReply(
    buildFleetActionPlanSections({ dashboard, context }),
    section,
  );
}

function buildFinancialFallbackReply({ question, dashboard, context, history = [] }) {
  const actionPlanSection = detectActionPlanSection(question);
  const resolvedStore = resolveQuestionStore(question, context?.reportSnapshots || []);

  if (!resolvedStore && actionPlanSection && historySuggestsActionPlan(history)) {
    return buildFleetActionPlanReply({ dashboard, context, section: actionPlanSection });
  }

  if (!resolvedStore && asksForActionPlan(question)) {
    return buildFleetActionPlanReply({ dashboard, context });
  }

  return (
    buildStoreFocusedFallbackReply({ question, dashboard, context }) ||
    buildOverallFinancialFallbackReply({ dashboard })
  );
}

function rankBy(stores, storeId, selector, direction = 'desc') {
  const sorted = [...stores].sort((left, right) => {
    const leftValue = Number(selector(left) || 0);
    const rightValue = Number(selector(right) || 0);
    return direction === 'asc' ? leftValue - rightValue : rightValue - leftValue;
  });

  const index = sorted.findIndex((store) => store.storeId === storeId);
  return index === -1 ? null : index + 1;
}

function buildPriorityStoreReply({ dashboard, context }) {
  const stores = [...(dashboard.storeComparison || [])];

  if (!stores.length) {
    return '';
  }

  const priorityStore = [...stores].sort((left, right) => {
    if (left.healthScore !== right.healthScore) {
      return left.healthScore - right.healthScore;
    }

    if (left.profitMargin !== right.profitMargin) {
      return left.profitMargin - right.profitMargin;
    }

    return right.platformRevenueShare - left.platformRevenueShare;
  })[0];
  const bestMarginStore = [...stores].sort(
    (left, right) => right.profitMargin - left.profitMargin,
  )[0];
  const platformLeader = [...stores].sort(
    (left, right) => right.platformRevenueShare - left.platformRevenueShare,
  )[0];
  const snapshot =
    (context.reportSnapshots || []).find(
      (item) => item.storeId === priorityStore.storeId,
    ) || null;
  const topCategory = snapshot?.topCostCategories?.[0] || null;
  const topItem = snapshot?.topCostItems?.[0] || null;
  const privateShare = Math.max(0, 1 - Number(priorityStore.platformRevenueShare || 0));
  const unitMargin = roundNumber(
    Number(priorityStore.avgTicket || 0) - Number(priorityStore.avgCustomerCost || 0),
    2,
  );
  const platformRank = rankBy(
    stores,
    priorityStore.storeId,
    (store) => store.platformRevenueShare,
  );
  const marginRank = rankBy(
    stores,
    priorityStore.storeId,
    (store) => store.profitMargin,
    'asc',
  );

  return [
    '## 先说结论',
    `当前最值得优先整改的门店是 **${priorityStore.storeName}**。不是因为某一个指标单独失真，而是健康度、利润率和渠道结构一起承压。`,
    '',
    '## 为什么是它',
    `1. 健康度 ${priorityStore.healthScore} 分，在 ${stores.length} 家门店中最低。`,
    `2. 利润率 ${percent(priorityStore.profitMargin)}，低于当前整体 ${percent(
      dashboard.overview.profitMargin,
    )}，在 ${stores.length} 家门店中排第 ${marginRank}/${stores.length}。`,
    `3. 平台占比 ${percent(priorityStore.platformRevenueShare)}，在 ${stores.length} 家门店中排第 ${platformRank}/${stores.length}，显著高于当前整体 ${percent(
      dashboard.overview.platformRevenueShare,
    )}。`,
    `4. 客单价 ${currency(priorityStore.avgTicket)}，单客成本 ${currency(
      priorityStore.avgCustomerCost,
    )}，当前单客毛利只有 ${currency(unitMargin)}。`,
    '',
    '## 关键依据',
    bestMarginStore
      ? `- 与利润率最高的 ${bestMarginStore.storeName} 相比，${priorityStore.storeName} 利润率低 ${(
          (Number(bestMarginStore.profitMargin || 0) -
            Number(priorityStore.profitMargin || 0)) *
          100
        ).toFixed(1)} 个百分点，平台占比高 ${(
          (Number(priorityStore.platformRevenueShare || 0) -
            Number(bestMarginStore.platformRevenueShare || 0)) *
          100
        ).toFixed(1)} 个百分点。`
      : '',
    topCategory
      ? `- 成本结构里，${topCategory.name} 是第一大成本项，金额 ${exactCurrency(
          topCategory.amount,
        )}，占总成本 ${percent(topCategory.ratio)}。`
      : '',
    topItem
      ? `- 已核验重点成本项：${topItem.name} 金额 ${exactCurrency(topItem.amount)}。`
      : '',
    platformLeader && platformLeader.storeId !== priorityStore.storeId
      ? `- 渠道上，${priorityStore.storeName} 私域与非平台渠道合计占比 ${percent(
          privateShare,
        )}，而平台依赖最高的门店是 ${platformLeader.storeName} ${percent(
          platformLeader.platformRevenueShare,
        )}。`
      : `- 渠道上，${priorityStore.storeName} 私域与非平台渠道合计占比 ${percent(privateShare)}。`,
    '',
    '## 先抓动作',
    `1. 7 天内先拆 ${priorityStore.storeName} 的平台订单结构和私域转化，明确哪些订单拉低利润。`,
    topItem
      ? `2. 14 天内复盘 ${topItem.name}，当前金额 ${exactCurrency(
          topItem.amount,
        )}，核查效率、定价与排班匹配度。`
      : `2. 14 天内复盘第一大成本项 ${topCategory?.name || '成本结构'}，核查效率与定价匹配度。`,
    bestMarginStore
      ? `3. 30 天内对标 ${bestMarginStore.storeName}，逐周跟踪利润率、客单价、单客成本和平台占比差距。`
      : '3. 30 天内逐周跟踪利润率、客单价、单客成本和平台占比差距。',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildMetricAnalysisReplySafe({ report, target, peerComparison }) {
  if (!report || !target) {
    return '';
  }

  const periodLabel = report.periodLabel || formatPeriodLabelFromPeriod(report.period);
  const categorySnapshot = buildStoreCategorySnapshot(report);
  const categoryName = target.kind === 'category' ? target.label : target.categoryName;
  const focusCategory = categoryName
    ? categorySnapshot.find((item) => item.name === categoryName) || null
    : null;
  const categoryRank = focusCategory
    ? categorySnapshot.findIndex((item) => item.name === categoryName) + 1
    : 0;
  const categoryCount = categorySnapshot.length;
  const peerAverage =
    peerComparison && Number.isFinite(Number(peerComparison.average))
      ? Number(peerComparison.average)
      : null;
  const targetValue = Number(target.wantsRatio ? target.value : target.amount ?? target.value ?? 0);
  const gapFromAverage =
    peerAverage === null ? null : roundNumber(targetValue - peerAverage, target.wantsRatio ? 4 : 2);
  const breakdown =
    target.kind === 'category'
      ? (target.breakdown || []).map((item) => `${item.label} ${exactCurrency(item.amount)}`)
      : [];
  const itemShareInCategory =
    target.kind === 'item' && focusCategory?.amount
      ? percent(targetValue / Number(focusCategory.amount || 0))
      : null;

  const lines = [];
  lines.push('## 先说结论');
  lines.push(`先给你结果：${report.storeName}${periodLabel}的 **${target.label}** 是 **${target.formattedValue}**。`);

  if (peerComparison && peerAverage !== null) {
    lines.push(
      `- 同期 ${peerComparison.count} 家门店对比，${report.storeName}${gapFromAverage >= 0 ? '高于' : '低于'}均值 **${target.formatter(Math.abs(gapFromAverage))}**。`,
    );
  }

  lines.push('', '## 指标拆开看');

  if (focusCategory && categoryRank > 0) {
    lines.push(
      `1. ${categoryName}占门店总成本 **${percent(focusCategory.ratio)}**，在 ${categoryCount} 个成本大类里排第 ${categoryRank}。${
        categoryRank === 1 ? '它就是当前第一大成本项。' : '它不是门店当前第一大成本项。'
      }`,
    );
  }

  if (target.kind === 'category' && breakdown.length) {
    lines.push(`2. 这个科目的主要构成是：${breakdown.join('；')}。`);
  } else if (target.kind === 'item' && target.categoryName) {
    lines.push(
      `2. 该项目归属 **${target.categoryName}**，在本科目内占比 **${itemShareInCategory || '0.0%'}**。`,
    );
  }

  if (peerComparison && peerAverage !== null) {
    lines.push(
      `3. 横向看，最高是 ${peerComparison.highest.storeName} ${target.formatter(
        peerComparison.highest.value,
      )}，最低是 ${peerComparison.lowest.storeName} ${target.formatter(peerComparison.lowest.value)}。`,
    );
  }

  lines.push('', '## 关键依据');
  lines.push(`- 门店总成本：${exactCurrency(report.summary?.totalCost || 0)}`);

  if (focusCategory) {
    lines.push(`- ${focusCategory.name}金额：${exactCurrency(focusCategory.amount)}`);
  }

  if (peerComparison && peerAverage !== null) {
    lines.push(`- 同期均值：${target.formatter(peerAverage)}`);
  }

  lines.push('', '## 下一步怎么做');

  if (categoryRank === 1) {
    lines.push(`1. 先拆 ${target.label} 的构成、效率和排班/定价，优先处理第一大成本项。`);
  } else {
    lines.push(`1. 先盯更大的成本项，${target.label} 作为重点监控项持续跟踪。`);
  }

  if (target.kind === 'category' && target.breakdown?.[0]) {
    lines.push(`2. 先复盘 **${target.breakdown[0].label}**，它是这个科目里的最大构成。`);
  } else if (target.kind === 'item') {
    lines.push(`2. 结合门店客单价、单客成本和该项目金额，复盘是否存在低效支出。`);
  }

  lines.push('3. 以上结论全部基于已导入月报直接计算，没有使用模型估算。');

  return lines.join('\n');
}

function buildDeterministicFinancialPayload({
  question,
  history,
  dashboard,
  context,
  directLookup,
  allStoresLookup,
  requestResolution,
}) {
  const status = requestResolution?.status || '';
  const actionPlanSection = detectActionPlanSection(question);
  const resolvedStore = resolveQuestionStore(question, context?.reportSnapshots || []);
  let reply = '';

  if (!resolvedStore && actionPlanSection && historySuggestsActionPlan(history)) {
    reply = buildFleetActionPlanReply({ dashboard, context, section: actionPlanSection });
  } else if (resolvedStore && asksForPlatformStructureOptimization(question)) {
    reply = buildStorePlatformOptimizationReply({
      dashboard,
      context,
      storeId: resolvedStore.id,
    });
  } else if (resolvedStore && asksForProfitRepair(question)) {
    reply = buildStoreProfitRepairReply({
      dashboard,
      context,
      storeId: resolvedStore.id,
    });
  } else if (!resolvedStore && asksForHeadTherapistWageEfficiency(question)) {
    reply = buildHeadTherapistWageEfficiencyReply({ dashboard });
  } else if (!resolvedStore && asksForPlatformStructureOptimization(question)) {
    reply = buildFleetPlatformOptimizationReply({ dashboard, context });
  } else if (!resolvedStore && asksForProfitRepair(question)) {
    reply = buildFleetProfitRepairReply({ dashboard, context });
  } else if (status === 'exact_lookup' && directLookup.report && directLookup.target) {
    reply = buildDirectLookupReply({
      report: directLookup.report,
      target: directLookup.target,
      peerComparison: directLookup.peerComparison,
      usedLatestPeriod: directLookup.usedLatestPeriod,
    });
  } else if (status === 'all_stores_lookup' && allStoresLookup.target && allStoresLookup.rows.length) {
    reply = buildAllStoresLookupReply({
      periodLabel: allStoresLookup.periodLabel,
      target: allStoresLookup.target,
      rows: allStoresLookup.rows,
      peerComparison: allStoresLookup.peerComparison,
      usedLatestPeriod: allStoresLookup.usedLatestPeriod,
    });
  } else if (status === 'store_ambiguous_target' && directLookup.store) {
    reply = buildLookupClarificationReply({
      store: directLookup.store,
      requestedPeriod: directLookup.requestedPeriod,
    });
  } else if (status === 'all_stores_ambiguous_target') {
    reply = buildAllStoresLookupClarificationReply({
      requestedPeriod: allStoresLookup.requestedPeriod,
    });
  } else if (status === 'all_stores_missing_period') {
    reply = buildAllStoresMissingDataReply({
      requestedPeriod: allStoresLookup.requestedPeriod,
    });
  }

  if (!reply) {
    return null;
  }

  return {
    reply: polishFinancialReply(reply),
    agent: buildFinancialAgentMeta({
      mode: 'local',
      provider: 'local',
      note: '本条回复已按已核验财务月报直接生成，未使用模型估算。',
    }),
  };
}

function wantsStrictMarkdownFormat(question = '') {
  return /严格按照以下\s*Markdown\s*格式|排版风格/.test(String(question || ''));
}

function buildAnalysisFallbackPayload({
  question,
  history,
  dashboard,
  context,
  directLookup,
  requestResolution,
  note = '',
}) {
  let reply = '';

  if (asksForPriorityStore(question)) {
    reply = buildPriorityStoreReply({ dashboard, context });
  } else if (
    requestResolution?.status === 'metric_analysis' &&
    directLookup?.report &&
    directLookup?.target
  ) {
    reply = buildMetricAnalysisReplySafe({
      report: directLookup.report,
      target: directLookup.target,
      peerComparison: directLookup.peerComparison,
    });
  } else {
    reply = buildFinancialFallbackReply({ question, dashboard, context, history });
  }

  if (!reply) {
    return null;
  }

  return {
    reply: polishFinancialReply(reply),
    agent: buildFinancialAgentMeta({
      mode: 'local',
      provider: 'local',
      note:
        note ||
        '本条回复已回退到本地核验分析，数字直接来自已核验财务月报。',
    }),
  };
}

function selectPriorityStore(dashboard = {}) {
  const stores = [...(dashboard.storeComparison || [])];

  if (!stores.length) {
    return null;
  }

  return [...stores].sort((left, right) => {
    if (left.healthScore !== right.healthScore) {
      return left.healthScore - right.healthScore;
    }

    if (left.profitMargin !== right.profitMargin) {
      return left.profitMargin - right.profitMargin;
    }

    return right.platformRevenueShare - left.platformRevenueShare;
  })[0];
}

function renderGroundedChatReply({
  parsed,
  factCatalog,
  fallbackReply = '',
  forceAppendFallback = false,
  question = '',
  requestedStore = null,
}) {
  const lead = sanitizeGroundedText(parsed?.lead, factCatalog, '', {
    maxLength: 320,
  });
  const closing = sanitizeGroundedText(parsed?.closing, factCatalog, '', {
    maxLength: 200,
  });
  const lines = [];
  let totalBulletCount = 0;
  const resolvedStore = requestedStore;
  const mentionedStore =
    STORE_REGISTRY.find((store) => lead && lead.includes(store.name)) || null;
  const stalePriorityLead =
    lead &&
    !asksForPriorityStore(question) &&
    /(?:\u4f18\u5148\u4fee\u590d|\u4f18\u5148\u6574\u6539|\u6700\u8be5\u5148\u6293|\u6700\u503c\u5f97\u4f18\u5148)/.test(
      lead,
    ) &&
    /\u95e8\u5e97/.test(lead);
  const mismatchedStoreLead =
    lead &&
    resolvedStore &&
    mentionedStore &&
    mentionedStore.id !== resolvedStore.id;

  if (lead && !isMetaGuidanceLine(lead) && !stalePriorityLead && !mismatchedStoreLead) {
    lines.push(lead);
  }

  (Array.isArray(parsed?.sections) ? parsed.sections : [])
    .slice(0, 4)
    .forEach((section) => {
      const title = normalizeText(section?.title, 24);
      const bullets = sanitizeGroundedList(section?.bullets, factCatalog, [], {
        limit: 4,
        maxLength: 220,
      }).filter((bullet) => !isMetaGuidanceLine(bullet));

      if (!title || !bullets.length) {
        return;
      }

      totalBulletCount += bullets.length;
      lines.push('', `## ${title}`);
      bullets.forEach((bullet) => {
        lines.push(`- ${bullet}`);
      });
    });

  if (closing && !isMetaGuidanceLine(closing)) {
    lines.push('', closing);
  }

  if (forceAppendFallback) {
    const aiSummary = lines
      .filter((line) => line && !/^##\s+/.test(line) && !/^- /.test(line))
      .join('\n')
      .trim()
      .replace(/最值得优先整改的门店是\s+最值得优先整改的门店是/g, '最值得优先整改的门店是 ')
      .replace(/对\s+最值得优先整改的门店是\s+/g, '对 ')
      .replace(/[ \t]{2,}/g, ' ');

    return polishFinancialReply(fallbackReply || aiSummary);
  }

  const hasStructuredSections = lines.some((line) => /^##\s+/.test(line));
  const reply = lines
    .filter(Boolean)
    .join('\n')
    .replace(/最值得优先整改的门店是\s+最值得优先整改的门店是/g, '最值得优先整改的门店是 ')
    .replace(/对\s+最值得优先整改的门店是\s+/g, '对 ')
    .replace(/分\s+分/g, '分')
    .replace(/人\s+人/g, '人')
    .replace(/元\s+元/g, '元')
    .replace(/[ \t]{2,}/g, ' ');

  if ((forceAppendFallback || !hasStructuredSections || totalBulletCount < 3) && fallbackReply) {
    return polishFinancialReply([reply, fallbackReply].filter(Boolean).join('\n\n'));
  }

  return polishFinancialReply(reply || fallbackReply);
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
  chatScope = '',
  parsingContext = null,
}) {
  const parsingDefaults = buildLookupDefaults(parsingContext || {}, reports);
  const effectiveReports =
    chatScope === 'parsing'
      ? mergeParsingReportIntoReports(reports, parsingContext || {})
      : reports;
  const directLookup = resolveDirectLookup(message, effectiveReports, parsingDefaults, {
    disablePeerComparison: chatScope === 'parsing',
  });
  const allStoresLookup = resolveAllStoresLookup(message, effectiveReports, {
    disableAllStores: chatScope === 'parsing',
    requestedPeriod: parsingDefaults.period,
  });
  const filters =
    chatScope === 'parsing'
      ? inferQuestionFiltersWithDefaults(message, effectiveReports, parsingDefaults)
      : inferQuestionFilters(message, effectiveReports);
  const { dashboard, context } = buildFinancialContextBundle(effectiveReports, filters);
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
  if (chatScope !== 'parsing') {
    const deterministicPayload = buildDeterministicFinancialPayload({
      question: message,
      history,
      dashboard,
      context,
      directLookup,
      allStoresLookup,
      requestResolution,
    });

    if (deterministicPayload) {
      return {
        payload: deterministicPayload,
      };
    }
  }

  const prioritizedReportSnapshots = Array.isArray(context.reportSnapshots)
    ? [
        ...context.reportSnapshots.filter(
          (snapshot) =>
            snapshot?.storeId === requestResolution.storeId ||
            snapshot?.storeName === requestResolution.storeName,
        ),
        ...context.reportSnapshots.filter(
          (snapshot) =>
            snapshot?.storeId !== requestResolution.storeId &&
            snapshot?.storeName !== requestResolution.storeName,
        ),
      ]
    : [];
  const llmContext = {
    ...context,
    reportSnapshots: prioritizedReportSnapshots,
    retrievedFacts,
    requestResolution,
    chatScope,
    parsingContext:
      chatScope === 'parsing'
        ? {
            storeName: parsingContext?.storeName || directLookup.store?.name || '',
            period: parsingDefaults.period || '',
            periodLabel:
              parsingContext?.periodLabel ||
              directLookup.report?.periodLabel ||
              (parsingDefaults.period
                ? formatPeriodLabelFromPeriod(parsingDefaults.period)
                : ''),
            parsedFiles: getParsingContextFiles(parsingContext || {}).map((file) => ({
              fileName: file.fileName || file.name || '',
              sourceGroupKey: file.sourceGroupKey || '',
              parserMode: file.parserMode || '',
              sheetName: file.metrics?.sheetName || '',
              previewLines: (file.previewLines || []).slice(0, 4),
              bodySheetMappings: (file.bodySheetMappings || []).slice(0, 12).map((item) => ({
                sourceNames: (item.sourceNames || []).slice(0, 4),
                amount: item.amount,
                targetCategory: item.targetCategory || '',
                targetDetail: item.targetDetail || '',
                targetLabel: item.targetLabel || '',
                note: item.note || '',
              })),
              structuredData:
                file.structuredData?.kind === 'revenue-report'
                  ? {
                      kind: file.structuredData.kind,
                      grossRevenue: file.structuredData.grossRevenue,
                      recognizedRevenue: file.structuredData.recognizedRevenue,
                      customerCount: file.structuredData.customerCount,
                      newMembers: file.structuredData.newMembers,
                      channels: file.structuredData.channels || {},
                    }
                  : file.structuredData?.kind === 'expense-pdf'
                    ? {
                        kind: file.structuredData.kind,
                        totalAmount: file.structuredData.totalAmount,
                        topItems: (file.structuredData.topItems || file.structuredData.items || [])
                          .slice(0, 8)
                          .map((item) => ({
                            name: item.name,
                            amount: item.amount,
                          })),
                      }
                    : file.structuredData?.kind === 'inventory-register'
                      ? {
                          kind: file.structuredData.kind,
                          totalAmount: file.structuredData.totalAmount,
                          mainSheetName: file.structuredData.mainSheetName || '',
                          fixedAssetSheetName: file.structuredData.fixedAssetSheetName || '',
                          topOutboundItems: (file.structuredData.topOutboundItems || [])
                            .slice(0, 8)
                            .map((item) => ({
                              name: item.name,
                              outboundQuantity: item.outboundQuantity,
                              endingStock: item.endingStock,
                              spec: item.spec,
                              amount: item.amount,
                            })),
                          highValueAssets: (file.structuredData.highValueAssets || [])
                            .slice(0, 8)
                            .map((item) => ({
                              name: item.name,
                              endingStock: item.endingStock,
                              spec: item.spec,
                              unitPrice: item.unitPrice,
                            })),
                        }
                  : null,
            })),
          }
        : null,
  };

  if (chatScope === 'parsing') {
    llmContext.peerComparison = null;
    llmContext.storeBenchmarks = [];
    llmContext.rankingSnapshotCandidates = [];
    llmContext.anomalyCandidates = [];
    llmContext.thirtyDayPlanCandidates = [];
    llmContext.ownerBriefCandidate = '';
  }

  if (
    chatScope === 'parsing' &&
    directLookup.report &&
    directLookup.target &&
    (isDerivationQuestion(message) || shouldUseDirectLookup(message) || isParsingLookupIntent(message))
  ) {
    return {
      payload: {
        reply: polishFinancialReply(
          buildParsingLookupReply({
            report: directLookup.report,
            target: directLookup.target,
            question: message,
            usedLatestPeriod: directLookup.usedLatestPeriod,
          }),
        ),
        agent: buildFinancialAgentMeta({
          mode: 'local',
          provider: 'local',
          note: '智能解析窗口已按当前门店当前月份的解析结果直接取数，不再引入跨门店对比。',
        }),
      },
    };
  }

  return {
    dashboard,
    context,
    directLookup,
    allStoresLookup,
    history,
    llmContext,
    message,
    preferredModel: settings.zhipuModel,
    requestResolution,
    settings,
    chatScope,
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
  chatScope = '',
  parsingContext = null,
}) {
  const effectiveMessage = contextualizeFollowUpQuestion(message, history, reports);
  const executionContext = buildFinancialAgentExecutionContext({
    message: effectiveMessage,
    history,
    reports,
    settings,
    chatScope,
    parsingContext,
  });

  if (executionContext.payload) {
    return executionContext.payload;
  }

  const actionPlanSection = detectActionPlanSection(effectiveMessage);

  if (
    executionContext.chatScope !== 'parsing' &&
    !resolveQuestionStore(executionContext.message, executionContext.reports) &&
    actionPlanSection &&
    historySuggestsActionPlan(executionContext.history)
  ) {
    return {
      reply: buildFleetActionPlanReply({
        dashboard: executionContext.dashboard,
        context: executionContext.context,
        section: actionPlanSection,
      }),
      agent: buildFinancialAgentMeta({
        mode: 'local',
        provider: 'local',
        note: '本条回复已按上一轮行动方案章节从本地月报直接回填，未使用模型续写。',
      }),
    };
  }

  const fallbackPayload = buildAnalysisFallbackPayload({
    question: executionContext.message,
    history: executionContext.history,
    dashboard: executionContext.dashboard,
    context: executionContext.context,
    directLookup: executionContext.directLookup,
    requestResolution: executionContext.requestResolution,
  });

  if (executionContext.settings.llmProvider !== 'zhipu' || !executionContext.settings.zhipuApiKey) {
    if (fallbackPayload) {
      return {
        ...fallbackPayload,
        agent: buildFinancialAgentMeta({
          mode: 'local',
          provider: 'local',
          note: '当前未配置智谱 Key，已按本地核验规则生成回复。',
        }),
      };
    }

    return {
      reply: '当前未配置智谱 Key，且本地规则暂时无法覆盖这类问题。',
      agent: buildFinancialAgentMeta({
        mode: 'error',
        provider: 'local',
        note: '当前未配置智谱 Key，也没有命中可用的本地规则。',
      }),
    };
  }

  const forceAppendFallback = !!(
    actionPlanSection && historySuggestsActionPlan(executionContext.history)
  );
  const modelHistory = buildRelevantChatHistory(
    executionContext.history,
    executionContext.message,
    executionContext.reports,
  );
  const preferGroundedChat =
    executionContext.chatScope !== 'parsing' &&
    !wantsStrictMarkdownFormat(effectiveMessage) &&
    !shouldUseWebSearch(effectiveMessage, executionContext.llmContext);

  if (preferGroundedChat) {
    try {
      const requestedStore = resolveQuestionStore(
        executionContext.message,
        executionContext.reports,
      );
      const result = await runZhipuGroundedFinancialChatAgent({
        apiKey: executionContext.settings.zhipuApiKey,
        question: executionContext.message,
        history: modelHistory,
        context: executionContext.llmContext,
        preferredModel: executionContext.preferredModel,
      });
      const reply = renderGroundedChatReply({
        parsed: result.parsed,
        factCatalog: executionContext.llmContext.groundedFacts,
        fallbackReply: fallbackPayload?.reply || '',
        forceAppendFallback,
        question: executionContext.message,
        requestedStore,
      });
      const priorityStore = asksForPriorityStore(executionContext.message)
        ? selectPriorityStore(executionContext.dashboard)
        : null;

      if (!reply) {
        throw new Error('智谱结构化问答未返回有效内容。');
      }

      if (priorityStore && !reply.includes(priorityStore.storeName)) {
        throw new Error('优先整改门店与本地排序不一致。');
      }

      if (requestedStore && !reply.includes(requestedStore.name)) {
        throw new Error('Model reply missed the requested store.');
      }

      return {
        reply,
        reasoning: result.reasoningContent,
        agent: buildFinancialAgentMeta({
          mode: 'llm',
          model: result.model,
          note: `已使用智谱 ${result.model} 基于本地核验事实库生成分析，最终数字均来自本地月报。`,
        }),
      };
    } catch (error) {
      if (fallbackPayload) {
        return {
          ...fallbackPayload,
          agent: buildFinancialAgentMeta({
            mode: 'local',
            provider: 'local',
            note: `AI 结构化分析暂时不可用，已回退到本地核验分析：${normalizeText(
              error.message,
              120,
            )}`,
          }),
        };
      }
    }
  }

  try {
    const result = await runZhipuFinancialChatAgent({
      apiKey: executionContext.settings.zhipuApiKey,
      question: executionContext.message,
      history: modelHistory,
      context: executionContext.llmContext,
      preferredModel: executionContext.preferredModel,
    });
    const reply = polishFinancialReply(normalizeText(result.reply, 6000));

    if (!reply) {
      throw new Error('智谱返回空内容。');
    }

    return {
      reply,
      reasoning: result.reasoningContent,
      agent: buildFinancialAgentMeta({
        mode: 'llm',
        model: result.model,
        note: result.webSearchEnabled
          ? `已使用智谱 ${result.model} 联网搜索并结合当前财务数据完成问答。`
          : `已基于当前财务数据完成智谱 ${result.model} 实时问答。`,
      }),
    };
  } catch (error) {
    const errorText = normalizeText(error.message, 160);

    if (fallbackPayload) {
      return {
        ...fallbackPayload,
        agent: buildFinancialAgentMeta({
          mode: 'local',
          provider: 'local',
          note: `AI 问答失败，已回退到本地核验分析：${errorText || '未知错误'}`,
        }),
      };
    }

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
  chatScope = '',
  parsingContext = null,
}) {
  if (agentId === 'financial_analyst') {
    return buildFinancialAgentReply({
      message,
      history,
      reports,
      settings,
      chatScope,
      parsingContext,
    });
  }

  return buildGenericAgentReply(agentId, message);
}

module.exports = {
  buildFinancialAgentExecutionContext,
  buildWorkspaceAgentReply,
};
