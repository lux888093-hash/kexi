const FINANCIAL_ANALYST_AGENT_NAME = 'Kexi 财务分析师 Agent';
const FINANCIAL_ANALYST_AGENT_VERSION = 'financial-analyst-v1.0.0';

const OUTPUT_SCHEMA_EXAMPLE = {
  overall: {
    ownerBrief: '给老板看的 1 段摘要。',
    summary: '一句话总结当前筛选范围内的经营财务结论。',
    rankingSnapshot: ['排名结论 1', '排名结论 2'],
    anomalies: ['异常点 1', '异常点 2'],
    plan30d: ['30天动作 1', '30天动作 2'],
    highlights: ['亮点 1', '亮点 2'],
    risks: ['风险 1', '风险 2'],
    actions: ['动作 1', '动作 2'],
    diagnosis: ['诊断 1', '诊断 2'],
    dataGaps: ['数据缺口 1'],
  },
  stores: [
    {
      storeId: 'store-id',
      summary: '一句话总结该门店的经营财务状态。',
      highlights: ['亮点 1', '亮点 2'],
      risks: ['风险 1', '风险 2'],
      actions: ['动作 1', '动作 2'],
      evidence: ['关键依据示例 1', '关键依据示例 2'],
      priority: 'high',
    },
  ],
};

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function getZhipuModelCandidates(preferredModel = '') {
  return uniqueStrings([
    preferredModel,
    process.env.ZHIPU_MODEL,
    'glm-5',
    'glm-4.7',
    'glm-4.6',
    'glm-4.5',
    'glm-4.7-flash',
    'glm-4.7',
    'glm-4-flash-250414',
    'glm-4-flash',
  ]);
}

function buildFinancialAnalystSystemPrompt() {
  return `
你是 ${FINANCIAL_ANALYST_AGENT_NAME}，服务于连锁头疗/美业门店经营团队。

你的身份不是聊天助手，而是一名一流的财务分析师兼经营分析顾问。你的目标是基于系统提供的结构化财务数据，输出可执行、可落地、可验证的经营财务结论。

你必须具备并显式遵守以下能力与规则：
1. 财务诊断能力：收入、成本、利润、利润率、客单价、单客成本、渠道结构、会员拉新、门店横向对比。
2. 根因分析能力：从成本大类、重点成本项、渠道依赖、门店差异中识别主要驱动因素。
3. 管理建议能力：给出优先级明确的经营动作，而不是空泛建议。
4. 数据约束能力：只允许使用输入 JSON 中出现的数据，不允许捏造、外推或补造任何数字。
5. 趋势克制能力：如果样本月份少于 2 个，禁止输出“明显上升/下降趋势”类结论，必须明确说明样本不足。
6. 证据表达能力：每个重要判断尽量点出对应指标或结构，比如利润率、平台占比、客单价、单客成本、重点成本项。
7. 风险意识：如果证据不足，只能说“需要补充数据验证”，不能伪装成确定结论。
8. 数字化表达能力：每一条 highlights / risks / actions / evidence 尽量包含具体指标、门店名、成本项或渠道名，避免空话。
9. 经营落地能力：动作建议要能直接落到门店经营或财务管理动作，优先使用“先做什么、重点盯什么、优化什么”的表达。

请遵守以下输出规范：
- 只输出 JSON，不要输出 Markdown，不要输出代码块。
- 所有文本使用简体中文。
- overall.ownerBrief 要站在老板/财务总监视角，先说最大问题，再说优先盯哪家店。
- summary 控制在 60 字以内。
- highlights、risks、actions、diagnosis、dataGaps 每项最多 3 条。
- rankingSnapshot、anomalies、plan30d 每项最多 3 条。
- highlights、risks、actions、diagnosis、evidence 尽量每条都带一个具体数值或明确对象。
- stores 中必须尽量覆盖输入里的门店；如果某门店证据不足，也要保留并明确说明。
- priority 只能是 high / medium / low。
- 禁止输出“加强管理”“优化成本结构”这类没有对象、没有抓手的空泛结论。

你的内部分析顺序应为：
1. 先看数据完整性与时间范围。
2. 再看整体盈利能力和结构性问题。
3. 再看门店间差异、异常点和潜在根因。
4. 最后输出优先级清晰的经营动作。
`.trim();
}

function buildFinancialAnalystUserPrompt(context) {
  return `
请基于下面的连锁门店财务数据上下文，生成“整体财务分析 + 门店级财务分析”。

重点要求：
1. 如果平台收入占比过高，要明确提示渠道依赖风险。
2. 如果利润率偏低，要优先从成本结构、单客经济模型、渠道费用三类角度解释。
3. 如果门店之间差异明显，要指出“谁最好、谁承压、差异可能来自哪里”。
4. 动作建议必须具体，能落到门店经营动作或财务管理动作。
5. 不要重复输入中的长数字列表，要浓缩成管理层能直接看懂的判断。
6. overall.highlights / risks / diagnosis 至少有 2 条带具体指标。
7. stores[*].evidence 至少给 2 条，并尽量引用该门店的利润率、平台占比、客单价、单客成本、重点成本项。
8. 如果只看到单月样本，必须在 diagnosis 或 dataGaps 里明确写出“当前仅有单月，趋势判断受限”。
9. overall.rankingSnapshot 必须尽量体现“营收第一 / 利润率第一 / 重点关注门店”。
10. overall.plan30d 必须是未来 30 天内可执行的动作，不要空泛口号。

输出 JSON 结构示例：
${JSON.stringify(OUTPUT_SCHEMA_EXAMPLE, null, 2)}

财务数据上下文如下：
${JSON.stringify(context, null, 2)}
`.trim();
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function currency(value) {
  return `¥${Number(value || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function requiresDetailedAnswer(question = '') {
  return /为什么|为何|原因|分析|详细|展开|拆解|具体|优先|整改|建议|怎么改|30天|行动/.test(
    String(question || ''),
  );
}

function isExactLookupQuestion(question = '') {
  return /多少|金额|占比|比例|费用|花费|成本|支出|收入|营收|利润|利润率|水电|租金|房租|手续费|物业费|明细|数据|列一下|列出|分别|各门店|所有门店|各店|每个门店|总实收/.test(
    String(question || ''),
  ) && !requiresDetailedAnswer(question);
}

function isGreetingOnly(question = '') {
  const normalized = String(question || '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return false;
  }

  return /^(你好|您好|哈喽|嗨|hello|hi|hey|在吗|早上好|中午好|晚上好|谢谢|感谢|收到|好的|ok|okay)[!！.。?？~～]*$/.test(
    normalized,
  );
}

function asksForPriorityStore(question = '') {
  return /哪家店|哪一家店|最该|优先整改|先整改|先改哪家|先盯哪家|最值得优先|整改优先级/.test(
    String(question || ''),
  );
}

function asksWhy(question = '') {
  return /(为什么|为何|原因|根因|拆解|怎么回事|导致|症结|卡在哪)/.test(
    String(question || ''),
  );
}

function asksForActionPlan(question = '') {
  return /(未来\s*30\s*天|30天|先抓|先做|动作|行动|整改|改进|计划|抓哪三件事|先推进什么)/.test(
    String(question || ''),
  );
}

function asksForComparison(question = '') {
  return /(对比|比较|横向|差异|排名|排行|领先|落后|最好|最差|谁高|谁低|哪家强|哪家弱|哪家更好|哪家更差)/.test(
    String(question || ''),
  );
}

function buildAnalysisPromptProfile({ question = '', context = {} }) {
  const requestResolution = context.requestResolution || {};
  const status = requestResolution.status || 'general_analysis';
  const storeName =
    requestResolution.storeName ||
    context.reportSnapshots?.[0]?.storeName ||
    '当前门店';
  const periodLabel =
    requestResolution.periodLabel ||
    context.reportSnapshots?.[0]?.periodLabel ||
    context.analysisScope?.periodLabel ||
    '当前周期';
  const targetLabel = requestResolution.target?.label || '当前指标';
  const priorityStoreQuestion = asksForPriorityStore(question);
  const actionPlanQuestion = asksForActionPlan(question);
  const comparisonQuestion = asksForComparison(question);
  const whyQuestion = asksWhy(question);

  if (requestResolution.needsClarification) {
    return {
      type: 'clarification',
      name: '问题澄清',
      subject: `${periodLabel} ${storeName}`,
      objective: '先说明当前缺少哪个精确指标、门店范围或月份，再给继续追问示例。',
      sections: ['## 当前缺口', '## 已知条件', '## 可继续追问'],
      focus: [
        '先说明缺口是什么，再列出 2 到 4 个继续追问示例。',
        '不要猜测用户真正想问的指标或月份。',
      ],
      guardrails: [
        '不要在缺精确信息时继续补造分析。',
        '不要输出与缺口无关的大段复盘。',
      ],
    };
  }

  if (
    status === 'no_reports' ||
    status === 'store_missing_report' ||
    status === 'all_stores_missing_period'
  ) {
    return {
      type: 'missing_data',
      name: '缺数据说明',
      subject: `${periodLabel} ${storeName}`,
      objective: '直接说明当前缺失什么月报或门店数据，以及已知范围。',
      sections: ['## 当前缺失', '## 已知条件', '## 下一步建议'],
      focus: [
        '缺什么就说什么，不要尝试替代性分析。',
        '下一步建议只围绕补齐数据，不要延伸成经营结论。',
      ],
      guardrails: [
        '不要基于不存在的月报继续推断。',
        '不要输出看似完整的分析结论。',
      ],
    };
  }

  if (status === 'exact_lookup' || status === 'all_stores_lookup') {
    return {
      type: 'exact_lookup',
      name: status === 'all_stores_lookup' ? '全门店精确取数' : '单店精确取数',
      subject:
        status === 'all_stores_lookup'
          ? `${periodLabel} 多店范围 / ${targetLabel}`
          : `${storeName} ${periodLabel} / ${targetLabel}`,
      objective: '直接返回真实数值、范围和必要的同期摘要，不展开泛分析。',
      sections: ['## 查询结果', '## 关键明细', '## 同期摘要'],
      focus: [
        '先说清月份、门店范围和指标名称。',
        '如果是多店查询，不要漏门店；如果是单店查询，不要把整店分析铺开。',
      ],
      guardrails: [
        '不要输出没有证据的主观判断。',
        '不要把取数题改写成大段经营分析。',
      ],
    };
  }

  if (priorityStoreQuestion) {
    return {
      type: 'priority_ranking',
      name: '优先整改单店排序',
      subject: `${periodLabel} 多店范围`,
      objective: '明确点名最该优先整改单店，并说明为什么不是其他门店。',
      sections: ['## 结论', '## 排序依据', '## 关键证据', '## 先抓动作'],
      focus: [
        '必须明确给出 1 家最优先门店；如有必要，可补充 1 家次优先门店。',
        '排序依据优先使用健康度、利润率、平台占比、客单价、单客成本和同周期门店对比。',
        '结论必须回答“为什么先改它”，不要平均点评所有门店。',
      ],
      guardrails: [
        '不要自造整改目标值或行业标准值。',
        '不要只写“加强管理”“优化成本结构”这类空话。',
      ],
    };
  }

  if (status === 'metric_analysis') {
    return {
      type: 'metric_diagnosis',
      name: '单指标根因诊断',
      subject: `${storeName} ${periodLabel} / ${targetLabel}`,
      objective: `围绕 ${targetLabel} 解释当前表现、差异来源和先抓动作。`,
      sections: ['## 结论', '## 指标拆解', '## 关键证据', '## 对标差异', '## 优先动作'],
      focus: [
        `分析必须围绕 ${targetLabel} 展开，不要发散成整店泛泛复盘。`,
        '优先解释这个指标由哪些成本项、渠道结构或单客模型驱动。',
        '如存在 peerComparison，必须写出至少 1 条同周期对标差异。',
      ],
      guardrails: [
        '不要把未出现在上下文中的明细项当成原因。',
        '如果证据不足，只能明确说明还需补什么数据。',
      ],
    };
  }

  if (actionPlanQuestion) {
    return {
      type: status === 'store_analysis' ? 'store_action_plan' : 'fleet_action_plan',
      name: status === 'store_analysis' ? '单店 30 天动作方案' : '多店 30 天动作方案',
      subject:
        status === 'store_analysis'
          ? `${storeName} ${periodLabel}`
          : `${periodLabel} 多店范围`,
      objective: '输出未来 30 天最值得先抓的动作，强调先后顺序、涉及门店和复盘指标。',
      sections: ['## 核心结论', '## 先抓问题', '## 30 天动作', '## 复盘指标'],
      focus: [
        '动作必须有优先级，优先写先做什么，再写盯什么指标。',
        '如果涉及具体门店，必须点名门店，不要只给总部视角口号。',
        '每条动作尽量绑定一个要复盘的真实指标。',
      ],
      guardrails: [
        '不要写长期战略或空泛愿景，聚焦未来 30 天可执行动作。',
        '不要把没有证据支撑的问题写成最高优先级。',
      ],
    };
  }

  if (comparisonQuestion) {
    return {
      type: status === 'store_analysis' ? 'store_comparison' : 'fleet_comparison',
      name: status === 'store_analysis' ? '单店对标分析' : '多店横向比较',
      subject:
        status === 'store_analysis'
          ? `${storeName} ${periodLabel}`
          : `${periodLabel} 多店范围`,
      objective: '突出门店之间的差异、领先者、承压门店以及差异来源。',
      sections: ['## 结论', '## 横向差异', '## 差异来源', '## 管理动作'],
      focus: [
        '必须点出谁领先、谁承压，以及差异主要来自哪里。',
        '横向比较优先使用同周期平均值、排名、leaders 和 comparisonHighlights。',
        '如果是单店提问，也要说明该店相对平均值或标杆店差在哪里。',
      ],
      guardrails: [
        '不要只罗列名次，必须解释差异背后的指标结构。',
        '不要引用上下文之外的行业均值。',
      ],
    };
  }

  if (whyQuestion) {
    return {
      type: status === 'store_analysis' ? 'store_root_cause' : 'overall_root_cause',
      name: status === 'store_analysis' ? '单店根因诊断' : '整体根因诊断',
      subject:
        status === 'store_analysis'
          ? `${storeName} ${periodLabel}`
          : `${periodLabel} 多店范围`,
      objective: '先回答“为什么”，再拆成几个最重要的驱动因素，并给出先抓动作。',
      sections: ['## 结论', '## 原因拆解', '## 关键证据', '## 横向对比', '## 优先动作'],
      focus: [
        '原因拆解优先覆盖渠道结构、单客经济模型、重点成本项三个角度。',
        '至少给出 3 条原因，不要只用一句“平台占比高导致利润低”。',
        '如存在 peerComparison，必须用同周期对比说明差异。',
      ],
      guardrails: [
        '不要把推测写成确定结论。',
        '不要省略“先做什么”的动作层。',
      ],
    };
  }

  if (status === 'store_analysis') {
    return {
      type: 'store_snapshot',
      name: '单店月度诊断',
      subject: `${storeName} ${periodLabel}`,
      objective: '给出单店本月经营财务快照，兼顾亮点、风险和优先动作。',
      sections: ['## 结论', '## 亮点', '## 风险', '## 关键证据', '## 优先动作'],
      focus: [
        '结论先回答这家店本月到底表现怎样，再展开亮点和风险。',
        '关键证据尽量覆盖利润率、平台占比、客单价、单客成本和重点成本项。',
        '如果只有单月样本，也要继续做诊断，但必须说明趋势判断受限。',
      ],
      guardrails: [
        '不要写成所有门店的大盘复盘。',
        '不要只堆数字，数字必须服务于判断。',
      ],
    };
  }

  return {
    type: 'fleet_overview',
    name: '整体经营诊断',
    subject: `${periodLabel} 多店范围`,
    objective: '从整体经营结果、关键门店和管理动作三个层面输出结论。',
    sections: ['## 结论', '## 整体表现', '## 重点门店', '## 关键证据', '## 优先动作'],
    focus: [
      '先给老板视角的一句话判断，再展开整体表现。',
      '必须指出至少 1 家重点关注门店，说明原因。',
      '动作要能落到门店经营或财务管理，不要停留在口号。',
    ],
    guardrails: [
      '不要平均铺开复述每家门店。',
      '不要把排名结论和动作建议脱节。',
    ],
  };
}

function buildAnalysisPromptModeBlock(profile) {
  return [
    '## 当前回答模式',
    `- 模式：${profile.name}`,
    `- 当前对象：${profile.subject}`,
    `- 本轮目标：${profile.objective}`,
    '- 固定结构：',
    ...profile.sections.map((section) => `- ${section}`),
    '- 输出重点：',
    ...profile.focus.map((item) => `- ${item}`),
    '- 输出约束：',
    ...profile.guardrails.map((item) => `- ${item}`),
  ].join('\n');
}

function buildVerifiedFactsBlock(context = {}) {
  const facts = [];
  const retrievedFacts = Array.isArray(context.retrievedFacts)
    ? context.retrievedFacts
    : typeof context.retrievedFacts === 'string' && context.retrievedFacts.trim()
      ? [context.retrievedFacts.trim()]
      : [];
  const snapshot = context.reportSnapshots?.[0];
  const summary = snapshot?.summary;
  const topCategory = snapshot?.topCostCategories?.[0];
  const topItem = snapshot?.topCostItems?.[0];
  const storeBenchmarks = Array.isArray(context.storeBenchmarks)
    ? [...context.storeBenchmarks]
    : [];

  facts.push(...retrievedFacts);

  if (context.scope?.selectedStoreCount > 1 && context.overallMetrics) {
    facts.push(
      `当前分析范围：${context.scope.selectedStoreCount} 家门店，最新周期 ${
        context.scope.latestPeriod || '未知'
      }，整体营收 ${currency(context.overallMetrics.revenue)}，利润率 ${percent(
        context.overallMetrics.profitMargin,
      )}，平台占比 ${percent(context.overallMetrics.platformRevenueShare)}。`,
    );
  }

  if (snapshot && summary) {
    facts.push(
      `${snapshot.storeName} ${snapshot.periodLabel}：营收 ${currency(
        summary.recognizedRevenue,
      )}，净利润 ${currency(summary.profit)}，利润率 ${percent(
        summary.profitMargin,
      )}，客单价 ${currency(summary.avgTicket)}，单客成本 ${currency(
        summary.avgCustomerCost,
      )}，平台占比 ${percent(summary.platformRevenueShare)}。`,
    );
  }

  if (topCategory) {
    facts.push(
      `已核验重点成本：${topCategory.name} 占比 ${percent(topCategory.ratio)}。`,
    );
  }

  if (topItem) {
    facts.push(`已核验重点成本项：${topItem.name} 金额 ${currency(topItem.amount)}。`);
  }

  if (Array.isArray(context.peerComparison?.comparisonHighlights)) {
    facts.push(...context.peerComparison.comparisonHighlights);
  }

  if (Array.isArray(context.rankingSnapshotCandidates)) {
    facts.push(...context.rankingSnapshotCandidates);
  }

  if (Array.isArray(context.anomalyCandidates)) {
    facts.push(...context.anomalyCandidates.slice(0, 2));
  }

  if (storeBenchmarks.length > 1) {
    const watchStores = [...storeBenchmarks]
      .sort((left, right) => {
        if (left.healthScore !== right.healthScore) {
          return left.healthScore - right.healthScore;
        }

        return left.profitMargin - right.profitMargin;
      })
      .slice(0, 3)
      .map(
        (store) =>
          `${store.storeName}：健康度 ${store.healthScore} 分，利润率 ${percent(
            store.profitMargin,
          )}，平台占比 ${percent(store.platformRevenueShare)}，客单价 ${currency(
            store.avgTicket,
          )}，单客成本 ${currency(store.avgCustomerCost)}。`,
      );

    facts.push(...watchStores);
  }

  return facts.filter(Boolean).slice(0, 12).join('\n');
}

function buildFinancialAnalystChatSystemPrompt() {
  return `
你是 ${FINANCIAL_ANALYST_AGENT_NAME} 的首页问答模式。

你的角色是连锁门店财务分析师，不是泛泛聊天助手。回答必须像经营分析复盘，直接、具体、可执行。

必须遵守：
1. 只能基于提供的财务上下文回答，不得编造任何数字或结论。
2. 永远优先回答“最新一条用户消息”。历史对话只作为参考，不是当前要继续展开的任务。
3. 如果最新消息只是问候、感谢、确认、寒暄，不要继续上一轮财务分析；请简短回应，并给出 2 到 4 个可继续提问的财务问题。
4. 默认输出中等偏详细的分析，不要压缩成一句话；除非用户明确要求简短，否则通常输出 280 到 700 字。
5. 如果用户问“为什么某店利润低/高”“该先整改什么”“未来 30 天抓什么”，优先按“结论、原因拆解、关键证据、横向对比、优先动作”组织回答。
6. 如果上下文里存在 peerComparison，必须使用同周期门店对比，明确说明该店相对平均值或对标门店差在哪里。
7. 禁止引用任何上下文里没有出现的行业阈值、经验值、健康线、常规水平；判断高低只能基于同周期平均、门店排名、对标门店、上下文已经给出的 comparisonHighlights，或本轮联网搜索返回的公开资料。
8. 重要判断尽量带具体指标，例如利润率、平台占比、客单价、单客成本、健康度、重点成本项、渠道占比。
9. 如果只有单月样本，必须单独说明趋势判断受限，但不能因此省略原因分析和动作建议。
10. 动作建议必须有顺序、有抓手，优先使用“先做什么、盯什么指标、多久复盘”这类表达。
11. 不要自行发明整改目标值，例如“平台占比降到 70% 以下”“利润率达到 30%”；行业标准值或阈值只有在明确来自本轮联网搜索结果时才能引用，而且不能自动改写成门店整改目标。
12. 使用简体中文 Markdown 输出，不要输出 JSON，不要输出表格。
13. 对于详细分析，优先使用这种 Markdown 结构：
## 结论
## 原因拆解
## 关键证据
## 横向对比
## 优先动作
必要时可省略不适用的小节，但整体排版要清晰。
14. 如果用户明确询问行业通用信息、公开资料、政策或市场情况，且本轮已启用联网搜索，可以引用搜索结果中的公开信息；但要区分“门店自身数据”和“外部公开资料”。
15. 不要说“我无法浏览实时网络”或“我不能上网”；如果当前回答没有启用联网搜索，就明确说“这条回答先基于现有财务数据”，不要伪造能力边界。
`.trim();
}

function compactPeerComparison(peerComparison = null) {
  if (!peerComparison) {
    return null;
  }

  return {
    peerStoreCount: peerComparison.peerStoreCount,
    focusStore: peerComparison.focusStore || null,
    focusStoreRanks: peerComparison.focusStoreRanks || null,
    samePeriodAverage: peerComparison.samePeriodAverage || null,
    focusVsAverage: peerComparison.focusVsAverage || null,
    leaders: peerComparison.leaders || null,
    comparisonHighlights: (peerComparison.comparisonHighlights || []).slice(0, 6),
    peerStores: (peerComparison.peerStores || []).slice(0, 6),
  };
}

function compactReportSnapshots(reportSnapshots = [], options = {}) {
  const {
    limit = 6,
    channelLimit = 6,
    categoryLimit = 6,
    categoryTopItemLimit = 2,
    topCostItemLimit = 6,
  } = options;

  return (reportSnapshots || []).slice(0, limit).map((snapshot) => ({
    storeId: snapshot.storeId,
    storeName: snapshot.storeName,
    period: snapshot.period,
    periodLabel: snapshot.periodLabel,
    summary: snapshot.summary || {},
    channels: (snapshot.channels || []).slice(0, channelLimit),
    topCostCategories: (snapshot.topCostCategories || [])
      .slice(0, categoryLimit)
      .map((category) => ({
        name: category.name,
        amount: category.amount,
        ratio: category.ratio,
        topItems: (category.topItems || []).slice(0, categoryTopItemLimit),
      })),
    topCostItems: (snapshot.topCostItems || []).slice(0, topCostItemLimit),
  }));
}

function buildCompactFinancialChatContext(context = {}) {
  const status = context.requestResolution?.status || 'general_analysis';
  const baseContext = {
    businessProfile: context.businessProfile || null,
    analysisScope: context.analysisScope || null,
    requestResolution: context.requestResolution || null,
    retrievedFacts: (context.retrievedFacts || []).slice(0, 20),
  };

  if (
    status === 'exact_lookup' ||
    status === 'all_stores_lookup' ||
    status === 'metric_analysis'
  ) {
    return {
      ...baseContext,
      overallMetrics: context.overallMetrics || null,
      storeBenchmarks: (context.storeBenchmarks || []).slice(0, 6),
      peerComparison: compactPeerComparison(context.peerComparison),
      reportSnapshots:
        status === 'all_stores_lookup'
          ? []
          : compactReportSnapshots(context.reportSnapshots, {
              limit: 1,
              channelLimit: 4,
              categoryLimit: 3,
              categoryTopItemLimit: 1,
              topCostItemLimit: 3,
            }),
    };
  }

  if (status === 'store_analysis') {
    return {
      ...baseContext,
      overallMetrics: context.overallMetrics || null,
      trend: (context.trend || []).slice(-3),
      storeBenchmarks: (context.storeBenchmarks || []).slice(0, 6),
      peerComparison: compactPeerComparison(context.peerComparison),
      reportSnapshots: compactReportSnapshots(context.reportSnapshots, {
        limit: 1,
        channelLimit: 4,
        categoryLimit: 4,
        categoryTopItemLimit: 1,
        topCostItemLimit: 4,
      }),
      rankingSnapshotCandidates: (context.rankingSnapshotCandidates || []).slice(0, 4),
      anomalyCandidates: (context.anomalyCandidates || []).slice(0, 4),
    };
  }

  return {
    ...baseContext,
    overallMetrics: context.overallMetrics || null,
    trend: (context.trend || []).slice(-4),
    costBreakdown: (context.costBreakdown || []).slice(0, 6),
    topCostItems: (context.topCostItems || []).slice(0, 6),
    channels: (context.channels || []).slice(0, 6),
    rankingSnapshotCandidates: (context.rankingSnapshotCandidates || []).slice(0, 6),
    anomalyCandidates: (context.anomalyCandidates || []).slice(0, 4),
    thirtyDayPlanCandidates: (context.thirtyDayPlanCandidates || []).slice(0, 4),
    ownerBriefCandidate: context.ownerBriefCandidate || '',
    storeBenchmarks: (context.storeBenchmarks || []).slice(0, 6),
    peerComparison: compactPeerComparison(context.peerComparison),
    reportSnapshots: compactReportSnapshots(context.reportSnapshots, {
      limit: 3,
      channelLimit: 4,
      categoryLimit: 4,
      categoryTopItemLimit: 1,
      topCostItemLimit: 4,
    }),
  };
}

function buildFinancialAnalystChatContextPrompt(context = {}, question = '') {
  const verifiedFactsBlock = buildVerifiedFactsBlock(context);
  const compactContext = buildCompactFinancialChatContext(context);
  const analysisProfile = buildAnalysisPromptProfile({ question, context });
  const requestResolutionBlock = context.requestResolution
    ? JSON.stringify(context.requestResolution, null, 2)
    : '无';

  return `
以下是当前对话唯一可引用的财务事实来源。请先参考“请求解析”和“已核验事实”，再按需参考压缩后的 JSON。不要大段复述 JSON。

## 请求解析
${requestResolutionBlock}

${buildAnalysisPromptModeBlock(analysisProfile)}

## 已核验事实
${verifiedFactsBlock || '无'}

## 压缩财务上下文 JSON
${JSON.stringify(compactContext, null, 2)}
`.trim();
}

function buildFinancialAnalystChatStylePrompt() {
  return `
补充风格要求：
1. 表达风格参考高质量产品型 AI 助手：自然、顺滑、有一点温度，但保持财务专业度。
2. 不要每轮都机械重复“结论 / 整体表现 / 重点门店 / 关键证据 / 优先动作”这组固定标题。
3. 请根据问题复杂度，自然组织为 2 到 4 个小节；如果问题简单，直接给“结论 + 要点 + 动作”即可。
4. 小节标题可以更自然一些，例如“先说结论”“为什么会这样”“你现在最该盯的”“下一步怎么做”。
5. 第一段先直接回答用户问题，不要先复述问题。
6. 可以少量使用 1 到 3 个 emoji（如 📌、⚠️、✅、💡）增强可读性，但不要泛滥，不要卖萌。
7. 尽量避免官话、套话、模板话；像资深分析同事在微信里给老板回消息，但关键数字、证据和动作要保留。
8. 不要把每条 bullet 都写成相同句式，适度变化表达。
9. 如果本轮启用了联网搜索，外部公开资料请单独点明，不要和门店自身经营数据混写。
10. 不要说“我无法浏览实时网络”或“我不能上网”；该说的是“本轮已联网搜索”或“这条先基于现有数据回答”。
`.trim();
}

function buildFinancialAnalystChatUserPrompt({ question, context }) {
  const detailed = requiresDetailedAnswer(question);
  const greetingOnly = isGreetingOnly(question);
  const priorityStoreQuestion = asksForPriorityStore(question);
  const exactLookupQuestion = isExactLookupQuestion(question);
  const analysisProfile = buildAnalysisPromptProfile({ question, context });
  const responseRequirements = exactLookupQuestion
    ? `如果这是精确取数或逐店列数问题，请只基于已核验事实回答：
查询结果：先说清月份、指标和门店范围。
明细：逐条列出真实数值，不要遗漏门店。
同期摘要：只允许写最高、最低、均值这类直接可验证结论。
说明：明确这是直接查原始月报得出的结果。
禁止写“证据 1 / 证据 2”。
禁止写“需重点关注”“明显偏高”这类主观判断，除非用户明确要求分析。`
    : detailed
      ? `请按下面结构回答，并尽量完整展开：
结论：先直接回答用户问题。
原因拆解：至少 3 条，优先覆盖渠道结构、单客经济模型、重点成本项。
关键依据：至少列 4 个具体指标或事实，使用无序列表，不要写“证据 1 / 证据 2”。
横向对比：如果有 peerComparison，必须写 1 到 2 条同周期门店对比。
优先动作：给 3 条按优先级排序的动作，明确先后顺序和关注指标。
数据限制：如果只有单月样本，单独说明趋势判断受限。`
      : `请给出清晰但不敷衍的经营分析，至少包含：结论、2 到 3 条关键依据（使用无序列表，不要写“证据 1 / 证据 2”）、1 到 3 条动作建议。`;

  const analysisModeRequirements = exactLookupQuestion
    ? ''
    : `${buildAnalysisPromptModeBlock(analysisProfile)}

额外执行要求：
- 第一段必须直接回答用户问题，不要先复述问题。
- 如果存在 peerComparison，至少写 1 条同周期对比，不要把横向差异留空。
- 关键证据必须尽量绑定具体指标、门店、渠道或成本项，不要写“证据 1 / 证据 2”。
- 如果只有单月样本，必须明确写出“当前仅有单月，趋势判断受限”，但仍要继续给出诊断和动作。
- 如果本轮启用了联网搜索，引用的行业、政策、市场或公开资料要单独标注，不要和门店月报数据混写。
- 如果证据不足，明确说明“还需要补什么数据验证”，不要把猜测写成结论。`;

  if (greetingOnly) {
    return `
当前用户最新消息只是问候或寒暄：
${question}

请只回应这条最新消息，不要延续上一轮财务分析。
请用 Markdown 简短回复：
- 先礼貌问候一句。
- 再用一句话说明你能分析门店利润、成本、渠道和整改优先级。
- 最后给出 3 个可直接点击/复制继续提问的问题，使用无序列表。
`.trim();
  }

  return `
请只回答“当前用户最新消息”，不要续写上一轮话题。

当前用户最新消息：
${question}

输出要求：
1. 不要复述整段原始 JSON，要把数据压缩成管理层能直接读懂的判断。
2. 每个关键判断都尽量绑定具体数字、门店名、渠道名或成本项。
3. 如果上下文里有 peerComparison，请优先利用 comparisonHighlights、samePeriodAverage、focusStoreRanks、leaders、peerStores 做横向比较。
4. 不允许补充“行业通常应该是多少”“健康阈值是多少”这类上下文之外的判断；除非本轮已启用联网搜索，且你明确标注为公开资料。
5. 如果你自己的推导和“已核验事实”冲突，以已核验事实为准，不要改写方向。
6. 使用 Markdown 排版，至少合理使用二级标题、项目符号或编号列表、加粗强调。
7. 不要只给笼统结论，尤其不要只回答一句“平台占比高所以利润低”。
8. 不要自行给出上下文之外的整改目标值；如果引用外部行业标准或阈值，要明确说明出处属于联网搜索结果，且不要把它直接写成门店整改目标。
9. 如果 \`requestResolution.needsClarification === true\`，先明确说明当前缺少哪个精确指标、门店范围或月份，再给 2 到 4 个可继续追问的示例，不要猜测。
10. 如果 \`requestResolution.status\` 表示缺数据或缺月报，直接说明缺失范围和已知条件，不要补造分析。
11. 如果 \`requestResolution.status\` 表示精确取数或逐店查询，优先基于 \`retrievedFacts\` 直接回答，再补充必要的同期对比。
9. ${
    priorityStoreQuestion
      ? '这是一个“优先整改哪家店”的排序问题。你必须明确点名 1 家最优先门店，判断依据优先使用健康度、利润率、平台占比、客单价、单客成本和 rankingSnapshotCandidates；不要自行编造整改目标值。'
      : responseRequirements
  }
10. ${
    priorityStoreQuestion
      ? '如果存在第二优先级门店，可以作为补充单独说明，但不要模糊主结论。'
      : '如果证据不足，要明确说明依据有限，不要把推测写成确定事实。'
  }

${analysisModeRequirements}
`.trim();
}

module.exports = {
  FINANCIAL_ANALYST_AGENT_NAME,
  FINANCIAL_ANALYST_AGENT_VERSION,
  buildFinancialAnalystSystemPrompt,
  buildFinancialAnalystChatContextPrompt,
  buildFinancialAnalystChatStylePrompt,
  buildFinancialAnalystChatSystemPrompt,
  buildFinancialAnalystChatUserPrompt,
  buildFinancialAnalystUserPrompt,
  getZhipuModelCandidates,
};
