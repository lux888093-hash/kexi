import { buildParsingInsightMarkdown } from "./parsingInsightReport";

export const DEFAULT_PARSING_SKILL_ID = "body_table_builder";

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

const CLIENT_SKILL_CONFIG = {
  [DEFAULT_PARSING_SKILL_ID]: {
    buildInsightMarkdown: buildParsingInsightMarkdown,
    previewPanel: "physical_table",
  },
};

export function getFallbackParsingSkillCatalog() {
  return {
    defaultSkillId: DEFAULT_PARSING_SKILL_ID,
    skills: [FALLBACK_BODY_TABLE_SKILL],
  };
}

export function normalizeParsingSkill(skill = {}) {
  return {
    ...FALLBACK_BODY_TABLE_SKILL,
    ...skill,
    acceptedFileTypes:
      Array.isArray(skill.acceptedFileTypes) && skill.acceptedFileTypes.length
        ? skill.acceptedFileTypes
        : FALLBACK_BODY_TABLE_SKILL.acceptedFileTypes,
    suggestions:
      Array.isArray(skill.suggestions) && skill.suggestions.length
        ? skill.suggestions
        : FALLBACK_BODY_TABLE_SKILL.suggestions,
    responsibilities:
      Array.isArray(skill.responsibilities) && skill.responsibilities.length
        ? skill.responsibilities
        : FALLBACK_BODY_TABLE_SKILL.responsibilities,
    boundaries:
      Array.isArray(skill.boundaries) && skill.boundaries.length
        ? skill.boundaries
        : FALLBACK_BODY_TABLE_SKILL.boundaries,
    requiredSourceGroups:
      Array.isArray(skill.requiredSourceGroups) && skill.requiredSourceGroups.length
        ? skill.requiredSourceGroups
        : FALLBACK_BODY_TABLE_SKILL.requiredSourceGroups,
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
  return (
    CLIENT_SKILL_CONFIG[skillId] ||
    CLIENT_SKILL_CONFIG[DEFAULT_PARSING_SKILL_ID]
  );
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
    deliverableLabel: skill.deliverableLabel || "体质表",
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
