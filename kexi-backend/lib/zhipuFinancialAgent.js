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

async function requestZhipuStructuredFinancialAnalysis({
  apiKey,
  model,
  context,
  timeoutMs = 45000,
}) {
  const result = await requestZhipuChat({
    apiKey,
    model,
    timeoutMs,
    maxTokens: 2200,
    enableThinking: true,
    responseFormat: {
      type: 'json_object',
    },
    messages: [
      {
        role: 'system',
        content: buildFinancialAnalystSystemPrompt(),
      },
      {
        role: 'user',
        content: buildFinancialAnalystUserPrompt(context),
      },
    ],
  });

  return {
    ...result,
    parsed: extractJsonObject(result.rawContent),
  };
}

async function runZhipuFinancialAgent({ apiKey, context, preferredModel = '' }) {
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
  runZhipuFinancialChatAgent,
  runZhipuFinancialRewriteAgent,
  runZhipuGroundedFinancialChatAgent,
  streamZhipuFinancialChatAgent,
};
