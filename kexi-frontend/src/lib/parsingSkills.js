import { buildParsingInsightMarkdown } from "./parsingInsightReport";

export const DEFAULT_PARSING_SKILL_ID = "body_table_builder";
export const SHUADAN_PACKET_SKILL_ID = "shuadan_packet_builder";

const FALLBACK_BODY_TABLE_SKILL = {
  id: DEFAULT_PARSING_SKILL_ID,
  version: "1.0.0",
  status: "live",
  icon: "table_chart",
  label: "体质表生成",
  badge: "体质表技能",
  summary: "解析门店源文件并回填体质表草稿。",
  description:
    "适用于单店单月的营业报表、费用/报销、工资等资料解析，目标是生成可下载的体质表草稿与归口说明。",
  intro:
    "当前技能专门负责把营业报表、报销明细、工资表等资料解析成《体质表》草稿。它只处理当前门店、当前月份的文件，不会混入跨店对比或其他技能职责。",
  placeholder: "询问当前解析结果、归口逻辑，或直接上传新的源文件...",
  deliverableLabel: "体质表",
  deliverableActionLabel: "查看体质表",
  previewPanel: "physical_table",
  acceptedFileTypes: [".xls", ".xlsx", ".csv", ".pdf", ".doc", ".docx"],
  suggestions: [
    "这份营业报表会回填到体质表哪些位置？",
    "当前还缺哪些源文件？",
    "报销明细是怎么归口到体质表的？",
  ],
  responsibilities: [
    "解析当前门店当前月份的源文件并识别归口。",
    "补齐体质表草稿并生成下载文件。",
    "回答当前解析窗口内的来源、映射和计算问题。",
  ],
  boundaries: [
    "只处理单店单月解析，不做跨门店排名或经营对比。",
    "只围绕体质表生成链路回答，不接管排班、客服、培训等任务。",
    "没有源文件时只给解析准备建议，不臆造体质表结果。",
  ],
  requiredSourceGroups: [
    { key: "revenue", label: "营业报表.xlsx" },
    { key: "expense", label: "报销明细.pdf" },
    { key: "payroll", label: "员工工资明细表.xlsx" },
  ],
};

const FALLBACK_SHUADAN_PACKET_SKILL = {
  id: SHUADAN_PACKET_SKILL_ID,
  version: "1.0.0",
  status: "live",
  icon: "photo_library",
  label: "门店刷单整理",
  badge: "截图整理技能",
  summary: "解析核销截图与转账截图，自动生成《门店刷单整理-分板块版.pdf》。",
  description:
    "适用于门店刷单、核销、代付、账单详情等截图整理场景。上传 JPG、JPEG、PNG、WEBP 等截图后，技能会自动区分核销截图板块和转账截图板块，抽取金额、时间、券码、订单号等字段，并导出《门店刷单整理-分板块版.pdf》。",
  intro:
    "当前技能专门用于整理门店刷单相关截图。它会识别核销截图、转账截图、列表页与待复核截图，按分板块规则生成可下载的整理 PDF，并在最后追加审计页提示重复和风险。",
  placeholder: "上传核销截图、账单详情或代付截图，或直接追问当前截图包的金额与审计情况...",
  deliverableLabel: "门店刷单整理 PDF",
  deliverableActionLabel: "查看整理结果",
  previewPanel: "",
  acceptedFileTypes: [".jpg", ".jpeg", ".png", ".webp"],
  suggestions: [
    "当前转账截图合计是多少？",
    "核销板块有没有列表页会重复计数？",
    "这批截图里有疑似重复转账吗？",
  ],
  responsibilities: [
    "识别截图属于核销板块、转账板块还是待复核板块。",
    "抽取可见金额、时间、券码、订单号等结构化字段。",
    "生成《门店刷单整理-分板块版.pdf》并附带审计页。",
  ],
  boundaries: [
    "只处理当前截图包，不替代跨门店或跨月份的经营分析。",
    "金额汇总会明确口径，但截图列表页仍建议人工复核一次。",
    "若智谱视觉接口不可用，会自动退回本地 OCR 兜底；仍无法识别的截图才进入待复核板块。",
  ],
  requiredSourceGroups: [
    { key: "verification", label: "核销截图板块" },
    { key: "transfer", label: "转账截图板块" },
  ],
};

const FALLBACK_SKILL_MAP = {
  [DEFAULT_PARSING_SKILL_ID]: FALLBACK_BODY_TABLE_SKILL,
  [SHUADAN_PACKET_SKILL_ID]: FALLBACK_SHUADAN_PACKET_SKILL,
};

function formatCurrency(amount = 0) {
  return `¥${Number(amount || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function buildShuadanInsightMarkdown({ parsedFiles = [], reviewFiles = [] } = {}) {
  const items = [...parsedFiles, ...reviewFiles]
    .map((file) => ({
      sectionKey: file?.structuredData?.sectionKey || "",
      isListPage: Boolean(file?.structuredData?.isListPage),
      amount: Number(file?.structuredData?.primaryAmount || 0) || 0,
    }))
    .filter((item) => item.sectionKey);

  const sections = {
    verification: items.filter((item) => item.sectionKey === "verification"),
    transfer: items.filter((item) => item.sectionKey === "transfer"),
    review: items.filter((item) => item.sectionKey === "review"),
  };

  const sumSection = (sectionItems = []) => {
    const detailTotal = Number(
      sectionItems
        .filter((item) => !item.isListPage && item.amount > 0)
        .reduce((sum, item) => sum + item.amount, 0)
        .toFixed(2),
    );

    if (detailTotal > 0) {
      return detailTotal;
    }

    return Number(
      sectionItems
        .reduce((sum, item) => sum + (item.amount > 0 ? item.amount : 0), 0)
        .toFixed(2),
    );
  };

  const verificationTotal = sumSection(sections.verification);
  const transferTotal = sumSection(sections.transfer);
  const auditLines = [];

  if (sections.transfer.some((item) => item.isListPage)) {
    auditLines.push("转账板块包含列表页，汇总时应优先以详情页为准。");
  }

  if (sections.verification.some((item) => item.isListPage)) {
    auditLines.push("核销板块包含列表页，可能存在与详情页重复展示。");
  }

  if (sections.review.length) {
    auditLines.push(`仍有 ${sections.review.length} 张截图进入待复核板块。`);
  }

  return [
    `- 核销截图：${sections.verification.length} 张，当前汇总 ${formatCurrency(verificationTotal)}`,
    `- 转账截图：${sections.transfer.length} 张，当前汇总 ${formatCurrency(transferTotal)}`,
    `- 实际报销口径：默认参考转账板块 ${formatCurrency(transferTotal)}`,
    `- 待复核截图：${sections.review.length} 张`,
    ...(auditLines.length ? auditLines.map((line) => `- ${line}`) : ["- 当前未触发额外审计提醒"]),
  ].join("\n");
}

const CLIENT_SKILL_CONFIG = {
  [DEFAULT_PARSING_SKILL_ID]: {
    buildInsightMarkdown: buildParsingInsightMarkdown,
    previewPanel: "physical_table",
  },
  [SHUADAN_PACKET_SKILL_ID]: {
    buildInsightMarkdown: buildShuadanInsightMarkdown,
    previewPanel: "",
  },
};

function resolveSkillFallback(skillId = "") {
  return FALLBACK_SKILL_MAP[skillId] || FALLBACK_BODY_TABLE_SKILL;
}

export function getFallbackParsingSkillCatalog() {
  return {
    defaultSkillId: DEFAULT_PARSING_SKILL_ID,
    skills: [FALLBACK_BODY_TABLE_SKILL, FALLBACK_SHUADAN_PACKET_SKILL],
  };
}

export function normalizeParsingSkill(skill = {}) {
  const fallback = resolveSkillFallback(skill.id);

  return {
    ...fallback,
    ...skill,
    acceptedFileTypes:
      Array.isArray(skill.acceptedFileTypes) && skill.acceptedFileTypes.length
        ? skill.acceptedFileTypes
        : fallback.acceptedFileTypes,
    suggestions:
      Array.isArray(skill.suggestions) && skill.suggestions.length
        ? skill.suggestions
        : fallback.suggestions,
    responsibilities:
      Array.isArray(skill.responsibilities) && skill.responsibilities.length
        ? skill.responsibilities
        : fallback.responsibilities,
    boundaries:
      Array.isArray(skill.boundaries) && skill.boundaries.length
        ? skill.boundaries
        : fallback.boundaries,
    requiredSourceGroups:
      Array.isArray(skill.requiredSourceGroups) && skill.requiredSourceGroups.length
        ? skill.requiredSourceGroups
        : fallback.requiredSourceGroups,
  };
}

export function mergeParsingSkillCatalog(payload = {}) {
  const fallbackCatalog = getFallbackParsingSkillCatalog();
  const rawSkills =
    Array.isArray(payload.skills) && payload.skills.length
      ? payload.skills
      : fallbackCatalog.skills;
  const skills = rawSkills.map(normalizeParsingSkill);
  const defaultSkillId = skills.some((skill) => skill.id === payload.defaultSkillId)
    ? payload.defaultSkillId
    : skills[0]?.id || fallbackCatalog.defaultSkillId;

  return {
    defaultSkillId,
    skills,
  };
}

export function getParsingSkillById(skills = [], skillId = "") {
  return (
    skills.find((skill) => skill.id === skillId) ||
    skills[0] ||
    normalizeParsingSkill(FALLBACK_BODY_TABLE_SKILL)
  );
}

export function getParsingSkillClientConfig(skillId = "") {
  return CLIENT_SKILL_CONFIG[skillId] || { previewPanel: "", buildInsightMarkdown: null };
}

export function buildSkillParsingContext({
  skill,
  storeId = "",
  storeName = "",
  period = "",
  periodLabel = "",
}) {
  return {
    skillId: skill.id,
    skillLabel: skill.label,
    deliverableLabel: skill.deliverableLabel || "输出文件",
    storeId,
    storeName,
    period,
    periodLabel,
    parsedFiles: [],
    reviewFiles: [],
    failFiles: [],
    missingFiles: [],
  };
}

export function buildSkillWelcomeMessage(skill) {
  return {
    id: `${skill.id}-intro-${Date.now()}`,
    sender: "ai",
    text: `您好！我是 **${skill.label}**。\n\n${skill.intro}\n\n请先确认当前门店和月份，然后上传源文件。我会按这个技能的职责执行。`,
  };
}
