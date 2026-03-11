const {
  buildFinancialAnalystChatContextPrompt,
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

async function runZhipuFinancialChatAgent({
  apiKey,
  question,
  history = [],
  context,
  preferredModel = '',
}) {
  const requestStatus = context?.requestResolution?.status || '';
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
  const modelCandidates = fastStatuses.has(requestStatus)
    ? uniqueStrings([
        'glm-4-flash-250414',
        'glm-4.7-flash',
        preferredModel,
        ...getZhipuModelCandidates(preferredModel),
      ])
    : uniqueStrings([
        'glm-4.7-flash',
        'glm-4-flash-250414',
        preferredModel,
        ...getZhipuModelCandidates(preferredModel),
      ]);
  const normalizedHistory = normalizeChatHistory(history, question);
  const attemptConfigs = fastStatuses.has(requestStatus)
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
          timeoutMs: 25000,
          enableThinking: false,
        },
        {
          maxTokens: 2600,
          timeoutMs: 40000,
          enableThinking: false,
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
          enableThinking: attempt.enableThinking,
          messages: [
            {
              role: 'system',
              content: buildFinancialAnalystChatSystemPrompt(),
            },
            {
              role: 'system',
              content: buildFinancialAnalystChatContextPrompt(context),
            },
            ...normalizedHistory,
            {
              role: 'user',
              content: buildFinancialAnalystChatUserPrompt({
                question,
                context,
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
            finishReason: result.finishReason,
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

module.exports = {
  runZhipuFinancialAgent,
  runZhipuFinancialChatAgent,
};
