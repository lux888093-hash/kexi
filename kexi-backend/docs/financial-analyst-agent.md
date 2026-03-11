# Financial Analyst Agent

## Role

`Kexi 财务分析师 Agent` 面向连锁头疗/美业门店的经营财务分析场景，负责基于结构化月报数据输出：

- 整体财务健康判断
- 门店横向对比
- 成本结构诊断
- 渠道依赖风险识别
- 单客经济模型分析
- 会员拉新与复购线索
- 可执行的经营动作建议

## Core Skills

1. 盈利能力分析：营收、成本、利润、利润率。
2. 单客模型分析：客单价、单客成本、单客毛利空间。
3. 渠道结构分析：平台收入占比、私域转化空间、平台抽成压力。
4. 成本结构分析：最大成本项、重点成本细项、跨店成本差异。
5. 门店对标分析：最佳门店、承压门店、差异化原因。
6. 趋势审慎分析：当月份不足时明确指出样本不足，不伪造趋势。
7. 管理动作输出：给出优先级明确的经营动作和财务动作。

## Guardrails

- 只允许使用系统提供的 JSON 数据。
- 禁止编造数值、趋势和业务事实。
- 重大判断必须尽量绑定指标或成本项。
- 数据不足时必须显式提示“需要补充数据验证”。
- 输出必须是稳定 JSON，便于前端直接消费。

## Output Contract

Agent 输出结构分为两层：

- `overall`：整体结论、亮点、风险、动作、诊断、数据缺口。
- `stores`：门店级 summary / highlights / risks / actions / evidence / priority。

数值指标如 `healthScore`、`profitMargin` 等继续由本地规则层稳定提供，LLM 负责更高质量的诊断与建议文本。

## Runtime Strategy

1. 后端先计算确定性的财务指标与对比结果。
2. 再把浓缩后的结构化上下文送给智谱模型。
3. 若智谱成功返回 JSON，则用其 narrative 覆盖规则文案。
4. 若智谱未配置、失败或超时，则自动回退到规则兜底分析。

## Prompt Design References

本项目的 agent prompt 结构主要借鉴了以下公开案例中的有效模式：

- 证据优先、结构化输出、校验清单：
  https://github.com/The-AI-Alliance/deep-research-agent-for-applications/blob/main/dra-apps/finance/templates/financial_research_agent.md
- 多角色迭代中的 analyst / reviewer / inspector 思路：
  https://github.com/denniszielke/ai-financial-report-agents
- 智谱结构化输出能力：
  https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5
  https://docs.bigmodel.cn/cn/guide/structured_output/structured_output
