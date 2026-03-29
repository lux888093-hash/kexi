const {
  buildFinancialAnalysisRewriteSystemPrompt,
  buildFinancialAnalysisRewriteUserPrompt,
  buildFinancialAnalystChatContextPrompt,
  buildFinancialAnalystGroundedChatContextPrompt,
  buildFinancialAnalystGroundedChatSystemPrompt,
  buildFinancialAnalystGroundedChatUserPrompt,
  buildFinancialAnalystChatStylePrompt,
  buildFinancialAnalystChatSystemPrompt,
  buildFinancialAnalystChatUserPrompt,
  buildFinancialAnalystSystemPrompt,
  buildFinancialAnalystUserPrompt,
  getZhipuModelCandidates,
} = require('./financialAgentPrompt');

const ZHIPU_API_URL =
  process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

function extractMessageText(content) {
  if (!content) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object') {
          return item.text || item.content || '';
        }

        return '';
      })
      .join('');
  }

  if (typeof content === 'object') {
    return content.text || content.content || JSON.stringify(content);
  }

  return String(content);
}

function stripCodeFence(text) {
  return String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function supportsThinkingMode(model = '') {
  return /^(glm-5|glm-4\.(7|6|5))/.test(String(model || '').trim());
}

function normalizeChatHistory(history = [], currentQuestion = '') {
  const normalizedQuestion = String(currentQuestion || '').trim();
  const entries = (history || [])
    .filter((item) => item && item.role && item.content)
    .map((item) => ({
      role: item.role === 'assistant' ? 'assistant' : 'user',
      content: String(item.content).trim(),
    }))
    .filter((item) => item.content)
    .slice(-8);

  if (
    entries.length &&
    entries[entries.length - 1].role === 'user' &&
    entries[entries.length - 1].content === normalizedQuestion
  ) {
    entries.pop();
  }

  return entries;
}

function getChatExecutionPlan(context = {}, preferredModel = '') {
  const requestStatus = context?.requestResolution?.status || '';
  const configuredModel = String(preferredModel || '').trim();
  const fastStatuses = new Set([
    'exact_lookup',
    'all_stores_lookup',
    'metric_analysis',
    'store_ambiguous_target',
    'all_stores_ambiguous_target',
    'store_missing_report',
    'all_stores_missing_period',
    'no_reports',
  ]);

  return {
    modelCandidates: fastStatuses.has(requestStatus)
      ? uniqueStrings([
          configuredModel,
          'glm-4-flash-250414',
          'glm-4.7-flash',
          ...getZhipuModelCandidates(),
        ])
      : uniqueStrings([
          configuredModel,
          ...getZhipuModelCandidates(),
          'glm-4.7-flash',
          'glm-4-flash-250414',
        ]),
    attemptConfigs: fastStatuses.has(requestStatus)
      ? [
          {
            maxTokens: 900,
            timeoutMs: 15000,
            enableThinking: false,
          },
          {
            maxTokens: 1400,
            timeoutMs: 25000,
            enableThinking: false,
          },
        ]
      : [
          {
            maxTokens: 1800,
            timeoutMs: 30000,
            enableThinking: true,
          },
          {
            maxTokens: 2600,
            timeoutMs: 40000,
            enableThinking: false,
          },
        ],
  };
}

const WEB_SEARCH_TRIGGER_PATTERNS = [
  /联网|上网|搜一下|搜索|查一下|查找|检索/u,
  /行业均值|行业平均|行业标准|行业阈值|行业水平|行业通用/u,
  /公开资料|公开信息|市场平均|市场情况|市场水平|竞品/u,
  /新闻|政策|监管|外部资料|外部信息/u,
  /一般来说|通常应该|通常水平|普遍情况/u,
];

const WEB_SEARCH_BLOCK_PATTERNS = [
  /不要联网|别联网|无需联网|不用联网/u,
  /不要搜索|别搜索|无需搜索|不用搜索/u,
  /只基于.*(数据|月报|报表|上下文|资料)/u,
];

function shouldUseWebSearch(question = '', context = {}) {
  const sourceText = [
    question,
    context?.requestResolution?.normalizedQuestion,
    context?.requestResolution?.message,
  ]
    .filter(Boolean)
    .join('\n');

  if (!sourceText.trim()) {
    return false;
  }

  if (WEB_SEARCH_BLOCK_PATTERNS.some((pattern) => pattern.test(sourceText))) {
    return false;
  }

  return WEB_SEARCH_TRIGGER_PATTERNS.some((pattern) => pattern.test(sourceText));
}

function buildWebSearchQuery(question = '', context = {}) {
  const parts = [];
  const storeName =
    context?.analysisScope?.storeName ||
    context?.requestResolution?.storeName ||
    context?.peerComparison?.focusStore?.storeName ||
    '';
  const periodLabel =
    context?.analysisScope?.periodLabel ||
    context?.requestResolution?.periodLabel ||
    context?.requestResolution?.period ||
    '';
  const brandName = context?.businessProfile?.brandName || '珂溪';
  const businessType = context?.businessProfile?.businessType || '门店经营';

  if (question) {
    parts.push(String(question).trim());
  }

  if (storeName) {
    parts.push(`${storeName} ${businessType}`);
  }

  if (periodLabel) {
    parts.push(periodLabel);
  }

  parts.push(`${brandName} 行业公开资料`);

  return uniqueStrings(parts).join(' ');
}

function buildWebSearchPlan(question = '', context = {}) {
  if (!shouldUseWebSearch(question, context)) {
    return {
      enabled: false,
      query: '',
      tools: null,
    };
  }

  const query = buildWebSearchQuery(question, context);

  return {
    enabled: true,
    query,
    tools: [
      {
        type: 'web_search',
        web_search: {
          search_query: query,
        },
      },
    ],
  };
}

function buildFinancialChatMessages({
  question,
  context,
  history = [],
  webSearchPlan = null,
}) {
  const messages = [
    {
      role: 'system',
      content: buildFinancialAnalystChatSystemPrompt(),
    },
    {
      role: 'system',
      content: buildFinancialAnalystChatContextPrompt(context, question),
    },
    {
      role: 'system',
      content: buildFinancialAnalystChatStylePrompt(),
    },
  ];

  if (webSearchPlan?.enabled) {
    messages.push({
      role: 'system',
      content: `本轮已启用联网搜索，可结合公开资料回答行业通用信息、公开政策、市场对比等问题。引用行业判断时，只能基于当前财务上下文或联网搜索返回的公开资料；如果没有检索到可靠结果，就明确说“暂未检索到可靠公开资料”，不要说自己无法上网。当前搜索词：${webSearchPlan.query}`,
    });
  } else {
    messages.push({
      role: 'system',
      content:
        '本轮未启用联网搜索。不要说自己无法浏览实时网络；如果用户追问行业通用信息、公开资料或明确要求联网搜索，先基于当前财务数据回答，再直接结合联网搜索结果补充。',
    });
  }

  return [
    ...messages,
    ...history,
    {
      role: 'user',
      content: buildFinancialAnalystChatUserPrompt({
        question,
        context,
      }),
    },
  ];
}

function extractJsonObject(text) {
  const source = stripCodeFence(text);

  if (!source) {
    throw new Error('智谱返回了空内容。');
  }

  try {
    return JSON.parse(source);
  } catch (_error) {
    // Fall through to bracket scanning.
  }

  const start = source.indexOf('{');

  if (start === -1) {
    throw new Error('智谱返回内容中未找到 JSON 对象。');
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }

  throw new Error('智谱返回了无法解析的 JSON 内容。');
}

function truncateText(value, maxLength = 80) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return '';
  }

  return text.slice(0, maxLength);
}

function normalizeList(items = [], limit = 3, maxLength = 80) {
  return uniqueStrings(
    (items || [])
      .map((item) => truncateText(item, maxLength))
      .filter(Boolean),
  ).slice(0, limit);
}

function normalizePriority(value, fallback = 'medium') {
  const candidate = String(value || '')
    .trim()
    .toLowerCase();

  if (candidate === 'high' || candidate === 'medium' || candidate === 'low') {
    return candidate;
  }

  return fallback;
}

function includesForeignStoreName(text = '', targetStoreName = '', knownStoreNames = []) {
  const normalizedText = String(text || '');

  if (!normalizedText) {
    return false;
  }

  return (knownStoreNames || []).some(
    (storeName) => storeName && storeName !== targetStoreName && normalizedText.includes(storeName),
  );
}

function sanitizeStoreStageText(
  value,
  fallbackValue,
  targetStoreName,
  knownStoreNames = [],
  maxLength = 80,
) {
  const normalized = truncateText(value, maxLength);

  if (!normalized) {
    return fallbackValue;
  }

  if (includesForeignStoreName(normalized, targetStoreName, knownStoreNames)) {
    return fallbackValue;
  }

  return normalized;
}

function sanitizeStoreStageList(
  items,
  fallbackItems,
  targetStoreName,
  knownStoreNames = [],
  limit = 3,
  maxLength = 80,
) {
  const normalized = uniqueStrings(
    (items || [])
      .map((item) =>
        sanitizeStoreStageText(item, '', targetStoreName, knownStoreNames, maxLength),
      )
      .filter(Boolean),
  ).slice(0, limit);

  return normalized.length ? normalized : fallbackItems;
}

function compactSnapshot(snapshot = {}) {
  return {
    period: snapshot.period || '',
    periodLabel: snapshot.periodLabel || '',
    summary: snapshot.summary || {},
    channels: (snapshot.channels || []).slice(0, 4),
    topCostCategories: (snapshot.topCostCategories || []).slice(0, 4).map((category) => ({
      name: category.name,
      amount: category.amount,
      ratio: category.ratio,
      topItems: (category.topItems || []).slice(0, 2),
    })),
    topCostItems: (snapshot.topCostItems || []).slice(0, 4),
  };
}

function compactStoreContext(context = {}) {
  return {
    businessProfile: context.businessProfile || null,
    analysisScope: context.analysisScope || null,
    scope: context.scope || null,
    overallMetrics: context.overallMetrics || null,
    trend: (context.trend || []).slice(-4),
    peerComparison: context.peerComparison
      ? {
          peerStoreCount: context.peerComparison.peerStoreCount,
          focusStore: context.peerComparison.focusStore,
          focusStoreRanks: context.peerComparison.focusStoreRanks,
          samePeriodAverage: context.peerComparison.samePeriodAverage,
          focusVsAverage: context.peerComparison.focusVsAverage,
          leaders: context.peerComparison.leaders,
          comparisonHighlights: (context.peerComparison.comparisonHighlights || []).slice(0, 3),
        }
      : null,
    reportSnapshots: (context.reportSnapshots || []).slice(-4).map(compactSnapshot),
  };
}

function buildStoreDigestMap(overallContext = {}) {
  const snapshotMap = new Map();

  (overallContext.reportSnapshots || []).forEach((snapshot) => {
    if (!snapshot?.storeId) {
      return;
    }

    const current = snapshotMap.get(snapshot.storeId);

    if (!current || String(snapshot.period || '').localeCompare(String(current.period || '')) > 0) {
      snapshotMap.set(snapshot.storeId, snapshot);
    }
  });

  const benchmarkMap = new Map(
    (overallContext.storeBenchmarks || [])
      .filter((store) => store?.storeId)
      .map((store) => [store.storeId, store]),
  );

  return {
    snapshotMap,
    benchmarkMap,
  };
}

function buildFleetSummaryContext(overallContext = {}, storeAnalyses = [], fallbackStores = []) {
  const { snapshotMap, benchmarkMap } = buildStoreDigestMap(overallContext);
  const fallbackStoreMap = new Map(
    (fallbackStores || [])
      .filter((store) => store?.storeId)
      .map((store) => [store.storeId, store]),
  );

  const storeDigests = [...benchmarkMap.values()].map((benchmark) => {
    const storeAnalysis =
      (storeAnalyses || []).find((item) => item?.storeId === benchmark.storeId) ||
      fallbackStoreMap.get(benchmark.storeId) ||
      {};
    const latestSnapshot = snapshotMap.get(benchmark.storeId);

    return {
      storeId: benchmark.storeId,
      storeName: benchmark.storeName,
      revenue: benchmark.revenue,
      profit: benchmark.profit,
      profitMargin: benchmark.profitMargin,
      customerCount: benchmark.customerCount,
      avgTicket: benchmark.avgTicket,
      avgCustomerCost: benchmark.avgCustomerCost,
      newMembers: benchmark.newMembers,
      platformRevenueShare: benchmark.platformRevenueShare,
      healthScore: benchmark.healthScore,
      priority: normalizePriority(storeAnalysis.priority, 'medium'),
      summary: truncateText(storeAnalysis.summary, 72),
      highlights: normalizeList(storeAnalysis.highlights, 2, 64),
      risks: normalizeList(storeAnalysis.risks, 2, 64),
      actions: normalizeList(storeAnalysis.actions, 2, 64),
      evidence: normalizeList(storeAnalysis.evidence, 2, 64),
      latestPeriod: latestSnapshot?.periodLabel || latestSnapshot?.period || '',
      topCostCategory: latestSnapshot?.topCostCategories?.[0]
        ? {
            name: latestSnapshot.topCostCategories[0].name,
            amount: latestSnapshot.topCostCategories[0].amount,
            ratio: latestSnapshot.topCostCategories[0].ratio,
          }
        : null,
      topCostItem: latestSnapshot?.topCostItems?.[0]
        ? {
            name: latestSnapshot.topCostItems[0].name,
            amount: latestSnapshot.topCostItems[0].amount,
            categoryName: latestSnapshot.topCostItems[0].categoryName,
          }
        : null,
    };
  });

  return {
    businessProfile: overallContext.businessProfile || null,
    analysisScope: overallContext.analysisScope || null,
    scope: overallContext.scope || null,
    overallMetrics: overallContext.overallMetrics || null,
    trend: (overallContext.trend || []).slice(-4),
    costBreakdown: (overallContext.costBreakdown || []).slice(0, 6),
    topCostItems: (overallContext.topCostItems || []).slice(0, 6),
    channels: (overallContext.channels || []).slice(0, 6),
    rankingSnapshotCandidates: (overallContext.rankingSnapshotCandidates || []).slice(0, 4),
    anomalyCandidates: (overallContext.anomalyCandidates || []).slice(0, 4),
    thirtyDayPlanCandidates: (overallContext.thirtyDayPlanCandidates || []).slice(0, 4),
    ownerBriefCandidate: overallContext.ownerBriefCandidate || '',
    storeDigests,
  };
}

const STORE_STAGE_SCHEMA_EXAMPLE = {
  storeId: 'store-id',
  summary: '一句话总结这家门店当前经营财务状态',
  highlights: ['亮点 1', '亮点 2'],
  risks: ['风险 1', '风险 2'],
  actions: ['动作 1', '动作 2'],
  evidence: ['证据 1', '证据 2'],
  priority: 'medium',
};

const FLEET_STAGE_SCHEMA_EXAMPLE = {
  overall: {
    ownerBrief: '给老板看的 1 段摘要',
    summary: '一句话总结当前多店整体财务状态',
    rankingSnapshot: ['排名结论 1', '排名结论 2'],
    anomalies: ['异常点 1', '异常点 2'],
    plan30d: ['30 天动作 1', '30 天动作 2'],
    highlights: ['亮点 1', '亮点 2'],
    risks: ['风险 1', '风险 2'],
    actions: ['动作 1', '动作 2'],
    diagnosis: ['诊断 1', '诊断 2'],
    dataGaps: ['数据缺口 1'],
  },
};

function buildStoreStageSystemPrompt() {
  return `
You are the MAP stage of a hierarchical chain-store financial analysis workflow.

You are analyzing exactly one store. Another downstream step will summarize the whole fleet.

Rules:
- Use only the JSON provided by the system.
- Output exactly one JSON object. No markdown. No code fence.
- Respond in Simplified Chinese.
- Do not invent numbers, rankings, trends, or business facts.
- If fewer than 2 monthly snapshots exist, do not claim clear up/down trends.
- Focus on this store's own diagnosis. Avoid mentioning other store names unless strictly necessary.
- "summary" should be at most 60 Chinese characters.
- "highlights", "risks", "actions", "evidence" should each contain 1 to 3 concise items.
- Every "evidence" item should include a concrete metric, ratio, cost item, channel, or time reference.
- "priority" must be one of: high, medium, low.
- Prefer actionable operating or financial actions, not generic slogans.
`.trim();
}

function buildStoreStageUserPrompt(context = {}) {
  return `
Return JSON following this schema example:
${JSON.stringify(STORE_STAGE_SCHEMA_EXAMPLE, null, 2)}

Store context JSON:
${JSON.stringify(compactStoreContext(context), null, 2)}
`.trim();
}

function buildFleetStageSystemPrompt() {
  return `
You are the REDUCE stage of a hierarchical chain-store financial analysis workflow.

Upstream has already analyzed each store separately. Your job is to produce only the fleet-level overall summary.

Rules:
- Use only the provided fleet metrics and store digests.
- Output exactly one JSON object. No markdown. No code fence.
- Respond in Simplified Chinese.
- Do not invent numbers, rankings, trends, or store facts.
- "summary" should be at most 60 Chinese characters.
- "ownerBrief" should be at most 120 Chinese characters.
- "rankingSnapshot", "anomalies", "plan30d", "highlights", "risks", "actions", "diagnosis", "dataGaps" should each contain 0 to 3 items.
- Prioritize cross-store conclusions, top management risks, and the next 30-day actions.
- Do not restate every store in long form. Compress.
- If the sample period is too short, mention that in "dataGaps" instead of fabricating trend claims.
`.trim();
}

function buildFleetStageUserPrompt(context = {}) {
  return `
Return JSON following this schema example:
${JSON.stringify(FLEET_STAGE_SCHEMA_EXAMPLE, null, 2)}

Fleet summary context JSON:
${JSON.stringify(context, null, 2)}
`.trim();
}

async function requestZhipuChat({
  apiKey,
  model,
  messages,
  responseFormat = null,
  tools = null,
  timeoutMs = 45000,
  maxTokens = 1200,
  enableThinking = false,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model,
      temperature: 0.1,
      top_p: 0.6,
      max_tokens: maxTokens,
      messages,
    };

    if (enableThinking && supportsThinkingMode(model)) {
      body.thinking = {
        type: 'enabled',
        clear_thinking: true,
      };
    }

    if (responseFormat) {
      body.response_format = responseFormat;
    }

    if (Array.isArray(tools) && tools.length) {
      body.tools = tools;
    }

    const response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(
        payload?.error?.message ||
          payload?.message ||
          `智谱接口调用失败（HTTP ${response.status}）。`,
      );
      error.status = response.status;
      throw error;
    }

    return {
      model,
      rawContent: extractMessageText(payload?.choices?.[0]?.message?.content),
      reasoningContent: extractMessageText(
        payload?.choices?.[0]?.message?.reasoning_content,
      ),
      finishReason: payload?.choices?.[0]?.finish_reason || '',
      payload,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestZhipuChatStream({
  apiKey,
  model,
  messages,
  tools = null,
  timeoutMs = 45000,
  maxTokens = 1200,
  enableThinking = false,
  onPayload = null,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body = {
      model,
      stream: true,
      temperature: 0.1,
      top_p: 0.6,
      max_tokens: maxTokens,
      messages,
    };

    if (enableThinking && supportsThinkingMode(model)) {
      body.thinking = {
        type: 'enabled',
        clear_thinking: true,
      };
    }

    if (Array.isArray(tools) && tools.length) {
      body.tools = tools;
    }

    const response = await fetch(ZHIPU_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const error = new Error(
        payload?.error?.message ||
          payload?.message ||
          `智谱接口调用失败（HTTP ${response.status}）。`,
      );
      error.status = response.status;
      throw error;
    }

    if (!response.body) {
      throw new Error('智谱流式响应体为空。');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      while (true) {
        const eventBoundary = buffer.indexOf('\n\n');

        if (eventBoundary === -1) {
          break;
        }

        const rawEvent = buffer.slice(0, eventBoundary);
        buffer = buffer.slice(eventBoundary + 2);
        const dataText = rawEvent
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');

        if (!dataText) {
          continue;
        }

        if (dataText === '[DONE]') {
          return {
            model,
            finishReason,
          };
        }

        const payload = JSON.parse(dataText);
        finishReason =
          payload?.choices?.[0]?.finish_reason || finishReason || '';

        if (onPayload) {
          await onPayload(payload);
        }
      }
    }

    return {
      model,
      finishReason,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function requestZhipuStructuredJsonPrompt({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  timeoutMs = 45000,
  maxTokens = 2200,
  enableThinking = true,
}) {
  const result = await requestZhipuChat({
    apiKey,
    model,
    timeoutMs,
    maxTokens,
    enableThinking,
    responseFormat: {
      type: 'json_object',
    },
    messages: [
      {
        role: 'system',
        content: systemPrompt,
      },
      {
        role: 'user',
        content: userPrompt,
      },
    ],
  });

  return {
    ...result,
    parsed: extractJsonObject(result.rawContent),
  };
}

async function requestZhipuStructuredFinancialAnalysis({
  apiKey,
  model,
  context,
  timeoutMs = 45000,
}) {
  return requestZhipuStructuredJsonPrompt({
    apiKey,
    model,
    timeoutMs,
    maxTokens: 2200,
    enableThinking: true,
    systemPrompt: buildFinancialAnalystSystemPrompt(),
    userPrompt: buildFinancialAnalystUserPrompt(context),
  });
}

function isFlashModel(model = '') {
  return /flash/i.test(String(model || '').trim());
}

function buildHierarchicalModelCandidates(preferredModel = '') {
  return uniqueStrings(
    isFlashModel(preferredModel)
      ? [
          preferredModel,
          'glm-4-flash-250414',
          'glm-4.7-flash',
          'glm-4-flash',
          'glm-4.7',
        ]
      : [
          'glm-4-flash-250414',
          'glm-4.7-flash',
          preferredModel,
          'glm-4-flash',
          'glm-4.7',
        ],
  );
}

async function executeStructuredPromptWithModelFallback({
  apiKey,
  preferredModel = '',
  modelCandidates = null,
  execute,
}) {
  const candidates =
    Array.isArray(modelCandidates) && modelCandidates.length
      ? uniqueStrings(modelCandidates)
      : getZhipuModelCandidates(preferredModel);
  let lastError = null;

  for (const model of candidates) {
    try {
      return await execute(model);
    } catch (error) {
      lastError = error;

      if (error?.status === 401 || error?.status === 403) {
        break;
      }
    }
  }

  throw lastError || new Error('Zhipu structured prompt request failed.');
}

async function mapWithConcurrency(items = [], limit = 2, worker) {
  const list = Array.isArray(items) ? items : [];
  const results = new Array(list.length);
  let nextIndex = 0;
  const concurrency = Math.max(1, Math.min(limit, list.length || 1));

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const currentIndex = nextIndex;
        nextIndex += 1;

        if (currentIndex >= list.length) {
          return;
        }

        results[currentIndex] = await worker(list[currentIndex], currentIndex);
      }
    }),
  );

  return results;
}

async function runZhipuFinancialAgentLegacy({ apiKey, context, preferredModel = '' }) {
  const modelCandidates = getZhipuModelCandidates(preferredModel);
  let lastError = null;

  for (const model of modelCandidates) {
    try {
      return await requestZhipuStructuredFinancialAnalysis({
        apiKey,
        model,
        context,
      });
    } catch (error) {
      lastError = error;

      if (error?.status === 401 || error?.status === 403) {
        break;
      }
    }
  }

  throw lastError || new Error('智谱财务分析调用失败。');
}

function normalizeStoreStageResult({
  parsed,
  context,
  fallbackStore,
  knownStoreNames = [],
}) {
  const storeId =
    context?.analysisScope?.storeIds?.[0] ||
    context?.reportSnapshots?.[0]?.storeId ||
    fallbackStore?.storeId ||
    '';
  const storeName =
    context?.analysisScope?.storeName ||
    context?.reportSnapshots?.[0]?.storeName ||
    fallbackStore?.storeName ||
    '';

  return {
    storeId,
    summary: sanitizeStoreStageText(
      parsed?.summary,
      truncateText(fallbackStore?.summary, 72),
      storeName,
      knownStoreNames,
      72,
    ),
    highlights: sanitizeStoreStageList(
      parsed?.highlights,
      normalizeList(fallbackStore?.highlights, 3, 72),
      storeName,
      knownStoreNames,
      3,
      72,
    ),
    risks: sanitizeStoreStageList(
      parsed?.risks,
      normalizeList(fallbackStore?.risks, 3, 72),
      storeName,
      knownStoreNames,
      3,
      72,
    ),
    actions: sanitizeStoreStageList(
      parsed?.actions,
      normalizeList(fallbackStore?.actions, 3, 72),
      storeName,
      knownStoreNames,
      3,
      72,
    ),
    evidence: sanitizeStoreStageList(
      parsed?.evidence,
      normalizeList(fallbackStore?.evidence, 3, 72),
      storeName,
      knownStoreNames,
      3,
      72,
    ),
    priority: normalizePriority(parsed?.priority, fallbackStore?.priority || 'medium'),
  };
}

function normalizeFleetStageResult(parsed = {}) {
  const overall =
    parsed?.overall && typeof parsed.overall === 'object' ? parsed.overall : parsed;

  if (!overall || typeof overall !== 'object') {
    return null;
  }

  return {
    overall: {
      ownerBrief: truncateText(overall.ownerBrief, 120),
      summary: truncateText(overall.summary, 72),
      rankingSnapshot: normalizeList(overall.rankingSnapshot, 3, 72),
      anomalies: normalizeList(overall.anomalies, 3, 72),
      plan30d: normalizeList(overall.plan30d, 3, 72),
      highlights: normalizeList(overall.highlights, 3, 72),
      risks: normalizeList(overall.risks, 3, 72),
      actions: normalizeList(overall.actions, 3, 72),
      diagnosis: normalizeList(overall.diagnosis, 3, 72),
      dataGaps: normalizeList(overall.dataGaps, 3, 72),
    },
  };
}

async function requestZhipuStructuredStoreStageAnalysis({
  apiKey,
  model,
  context,
}) {
  return requestZhipuStructuredJsonPrompt({
    apiKey,
    model,
    timeoutMs: 20000,
    maxTokens: 1200,
    enableThinking: false,
    systemPrompt: buildStoreStageSystemPrompt(),
    userPrompt: buildStoreStageUserPrompt(context),
  });
}

async function requestZhipuStructuredFleetStageAnalysis({
  apiKey,
  model,
  context,
}) {
  return requestZhipuStructuredJsonPrompt({
    apiKey,
    model,
    timeoutMs: 25000,
    maxTokens: 1800,
    enableThinking: true,
    systemPrompt: buildFleetStageSystemPrompt(),
    userPrompt: buildFleetStageUserPrompt(context),
  });
}

async function runZhipuFinancialAgent({ apiKey, context, preferredModel = '' }) {
  return executeStructuredPromptWithModelFallback({
    apiKey,
    preferredModel,
    execute: (model) =>
      requestZhipuStructuredFinancialAnalysis({
        apiKey,
        model,
        context,
      }),
  });
}

async function runZhipuHierarchicalFinancialAgent({
  apiKey,
  overallContext,
  storeContexts = [],
  fallbackStores = [],
  preferredModel = '',
}) {
  const knownStoreNames = (overallContext?.storeBenchmarks || [])
    .map((store) => store?.storeName)
    .filter(Boolean);
  const fallbackStoreMap = new Map(
    (fallbackStores || [])
      .filter((store) => store?.storeId)
      .map((store) => [store.storeId, store]),
  );
  const hierarchicalModelCandidates = buildHierarchicalModelCandidates(preferredModel);
  const storeStageResults = await mapWithConcurrency(
    storeContexts,
    Math.min(2, storeContexts.length || 1),
    async (storeContext) => {
      const storeId =
        storeContext?.analysisScope?.storeIds?.[0] ||
        storeContext?.reportSnapshots?.[0]?.storeId ||
        '';
      const fallbackStore = fallbackStoreMap.get(storeId) || null;

      try {
        const storeResult = await executeStructuredPromptWithModelFallback({
          apiKey,
          preferredModel,
          modelCandidates: hierarchicalModelCandidates,
          execute: (model) =>
            requestZhipuStructuredStoreStageAnalysis({
              apiKey,
              model,
              context: storeContext,
            }),
        });

        return {
          failed: false,
          model: storeResult.model,
          store: normalizeStoreStageResult({
            parsed: storeResult.parsed,
            context: storeContext,
            fallbackStore,
            knownStoreNames,
          }),
        };
      } catch (_error) {
        return {
          failed: true,
          model: '',
          store: fallbackStore
            ? normalizeStoreStageResult({
                parsed: null,
                context: storeContext,
                fallbackStore,
                knownStoreNames,
              })
            : null,
        };
      }
    },
  );
  const usedModels = storeStageResults
    .map((item) => item?.model)
    .filter(Boolean);
  const failedStoreCount = storeStageResults.filter((item) => item?.failed).length;
  const storeResults = storeStageResults
    .map((item) => item?.store)
    .filter(Boolean);

  const fleetSummaryContext = buildFleetSummaryContext(
    overallContext,
    storeResults,
    fallbackStores,
  );
  let fleetResult = null;
  let fleetModel = usedModels[usedModels.length - 1] || '';

  try {
    const summaryResult = await executeStructuredPromptWithModelFallback({
      apiKey,
      preferredModel,
      modelCandidates: hierarchicalModelCandidates,
      execute: (model) =>
        requestZhipuStructuredFleetStageAnalysis({
          apiKey,
          model,
          context: fleetSummaryContext,
        }),
    });

    fleetModel = summaryResult.model;
    fleetResult = normalizeFleetStageResult(summaryResult.parsed);
  } catch (_error) {
    fleetResult = null;
  }

  return {
    model: fleetModel,
    strategy: 'hierarchical',
    storeCount: storeContexts.length,
    failedStoreCount,
    parsed: {
      overall: fleetResult?.overall || null,
      stores: storeResults,
    },
  };
}

async function requestZhipuStructuredFinancialChatAnalysis({
  apiKey,
  model,
  question,
  history = [],
  context,
  timeoutMs = 30000,
  maxTokens = 2200,
}) {
  const normalizedHistory = normalizeChatHistory(history, question);
  const result = await requestZhipuChat({
    apiKey,
    model,
    timeoutMs,
    maxTokens,
    enableThinking: true,
    responseFormat: {
      type: 'json_object',
    },
    messages: [
      {
        role: 'system',
        content: buildFinancialAnalystGroundedChatSystemPrompt(),
      },
      {
        role: 'system',
        content: buildFinancialAnalystGroundedChatContextPrompt(context, question),
      },
      ...normalizedHistory,
      {
        role: 'user',
        content: buildFinancialAnalystGroundedChatUserPrompt({
          question,
          context,
        }),
      },
    ],
  });

  return {
    ...result,
    parsed: extractJsonObject(result.rawContent),
  };
}

async function runZhipuGroundedFinancialChatAgent({
  apiKey,
  question,
  history = [],
  context,
  preferredModel = '',
}) {
  const { modelCandidates, attemptConfigs } = getChatExecutionPlan(
    context,
    preferredModel,
  );
  let lastError = null;

  for (const model of modelCandidates) {
    for (const attempt of attemptConfigs) {
      try {
        return await requestZhipuStructuredFinancialChatAnalysis({
          apiKey,
          model,
          question,
          history,
          context,
          timeoutMs: attempt.timeoutMs,
          maxTokens: Math.max(attempt.maxTokens, 1800),
        });
      } catch (error) {
        lastError = error;

        if (error?.status === 401 || error?.status === 403) {
          break;
        }
      }
    }
  }

  throw lastError || new Error('智谱财务结构化问答调用失败。');
}

async function runZhipuFinancialChatAgent({
  apiKey,
  question,
  history = [],
  context,
  preferredModel = '',
}) {
  const { modelCandidates, attemptConfigs } = getChatExecutionPlan(
    context,
    preferredModel,
  );
  const normalizedHistory = normalizeChatHistory(history, question);
  const webSearchPlan = buildWebSearchPlan(question, context);
  const resolvedModelCandidates = webSearchPlan.enabled
    ? uniqueStrings([preferredModel, 'glm-5', ...modelCandidates])
    : modelCandidates;
  let lastError = null;

  for (const model of resolvedModelCandidates) {
    for (const attempt of attemptConfigs) {
      try {
        const result = await requestZhipuChat({
          apiKey,
          model,
          maxTokens: attempt.maxTokens,
          timeoutMs: attempt.timeoutMs,
          enableThinking: attempt.enableThinking,
          tools: webSearchPlan.tools,
          messages: buildFinancialChatMessages({
            question,
            context,
            history: normalizedHistory,
            webSearchPlan,
          }),
        });
        const reply = stripCodeFence(result.rawContent);

        if (reply) {
          return {
            model,
            reply,
            rawContent: result.rawContent,
            reasoningContent: result.reasoningContent,
            finishReason: result.finishReason,
            webSearchEnabled: webSearchPlan.enabled,
            webSearchQuery: webSearchPlan.query,
          };
        }

        lastError = new Error(
          `智谱返回空内容（model=${model}, finish_reason=${result.finishReason || 'unknown'}）。`,
        );
      } catch (error) {
        lastError = error;

        if (error?.status === 401 || error?.status === 403) {
          break;
        }
      }
    }
  }

  throw lastError || new Error('智谱财务问答调用失败。');
}

async function runZhipuFinancialRewriteAgent({
  apiKey,
  question,
  sourceReply,
  preferredModel = '',
}) {
  const modelCandidates = uniqueStrings([
    preferredModel,
    'glm-4.7-flash',
    'glm-4-flash-250414',
    ...getZhipuModelCandidates(),
  ]);
  const attemptConfigs = [
    {
      maxTokens: 1800,
      timeoutMs: 15000,
    },
    {
      maxTokens: 2600,
      timeoutMs: 25000,
    },
  ];
  let lastError = null;

  for (const model of modelCandidates) {
    for (const attempt of attemptConfigs) {
      try {
        const result = await requestZhipuChat({
          apiKey,
          model,
          maxTokens: attempt.maxTokens,
          timeoutMs: attempt.timeoutMs,
          enableThinking: false,
          messages: [
            {
              role: 'system',
              content: buildFinancialAnalysisRewriteSystemPrompt(),
            },
            {
              role: 'user',
              content: buildFinancialAnalysisRewriteUserPrompt({
                question,
                sourceReply,
              }),
            },
          ],
        });
        const reply = stripCodeFence(result.rawContent);

        if (reply) {
          return {
            model,
            reply,
            rawContent: result.rawContent,
            reasoningContent: result.reasoningContent,
            finishReason: result.finishReason,
          };
        }

        lastError = new Error(
          `智谱润色返回空内容（model=${model}, finish_reason=${result.finishReason || 'unknown'}）。`,
        );
      } catch (error) {
        lastError = error;

        if (error?.status === 401 || error?.status === 403) {
          break;
        }
      }
    }
  }

  throw lastError || new Error('智谱财务文风润色调用失败。');
}

async function streamZhipuFinancialChatAgent({
  apiKey,
  question,
  history = [],
  context,
  preferredModel = '',
  onStart = null,
  onDelta = null,
}) {
  const { modelCandidates, attemptConfigs } = getChatExecutionPlan(
    context,
    preferredModel,
  );
  const normalizedHistory = normalizeChatHistory(history, question);
  const webSearchPlan = buildWebSearchPlan(question, context);
  const resolvedModelCandidates = webSearchPlan.enabled
    ? uniqueStrings([preferredModel, 'glm-5', ...modelCandidates])
    : modelCandidates;
  let lastError = null;

  for (const model of resolvedModelCandidates) {
    for (const attempt of attemptConfigs) {
      let reply = '';
      let started = false;

      try {
        const result = await requestZhipuChatStream({
          apiKey,
          model,
          maxTokens: attempt.maxTokens,
          timeoutMs: attempt.timeoutMs,
          enableThinking: attempt.enableThinking,
          tools: webSearchPlan.tools,
          messages: buildFinancialChatMessages({
            question,
            context,
            history: normalizedHistory,
            webSearchPlan,
          }),
          onPayload: async (payload) => {
            const delta = extractMessageText(
              payload?.choices?.[0]?.delta?.content,
            );

            if (!delta) {
              return;
            }

            if (!started) {
              started = true;

              if (onStart) {
                await onStart({
                  model,
                  webSearchEnabled: webSearchPlan.enabled,
                  webSearchQuery: webSearchPlan.query,
                });
              }
            }

            reply += delta;

            if (onDelta) {
              await onDelta(delta);
            }
          },
        });

        if (reply) {
          return {
            model,
            reply: stripCodeFence(reply),
            finishReason: result.finishReason,
            webSearchEnabled: webSearchPlan.enabled,
            webSearchQuery: webSearchPlan.query,
          };
        }

        lastError = new Error(
          `智谱流式返回空内容（model=${model}, finish_reason=${result.finishReason || 'unknown'}）。`,
        );
      } catch (error) {
        lastError = error;

        if (started) {
          throw error;
        }

        if (error?.status === 401 || error?.status === 403) {
          break;
        }
      }
    }
  }

  throw lastError || new Error('智谱财务流式问答调用失败。');
}

module.exports = {
  getChatExecutionPlan,
  shouldUseWebSearch,
  runZhipuFinancialAgent,
  runZhipuHierarchicalFinancialAgent,
  runZhipuFinancialChatAgent,
  runZhipuFinancialRewriteAgent,
  runZhipuGroundedFinancialChatAgent,
  streamZhipuFinancialChatAgent,
};
