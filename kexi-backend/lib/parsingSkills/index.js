const {
  BODY_TABLE_SKILL,
  BODY_TABLE_SKILL_ID,
} = require('./bodyTableSkill');

const PARSING_SKILLS = [BODY_TABLE_SKILL];
const DEFAULT_PARSING_SKILL_ID = BODY_TABLE_SKILL_ID;
const SKILL_MAP = new Map(PARSING_SKILLS.map((skill) => [skill.id, skill]));

function toPublicParsingSkill(skill) {
  return {
    id: skill.id,
    version: skill.version,
    status: skill.status,
    icon: skill.icon,
    label: skill.label,
    badge: skill.badge,
    summary: skill.summary,
    description: skill.description,
    intro: skill.intro,
    placeholder: skill.placeholder,
    deliverableLabel: skill.deliverableLabel,
    deliverableActionLabel: skill.deliverableActionLabel,
    previewPanel: skill.previewPanel || '',
    acceptedFileTypes: Array.isArray(skill.acceptedFileTypes) ? skill.acceptedFileTypes : [],
    suggestions: Array.isArray(skill.suggestions) ? skill.suggestions : [],
    responsibilities: Array.isArray(skill.responsibilities) ? skill.responsibilities : [],
    boundaries: Array.isArray(skill.boundaries) ? skill.boundaries : [],
    requiredSourceGroups: Array.isArray(skill.requiredSourceGroups)
      ? skill.requiredSourceGroups
      : [],
  };
}

function listParsingSkills() {
  return PARSING_SKILLS.map(toPublicParsingSkill);
}

function resolveParsingSkill(skillId = '') {
  const normalizedSkillId = String(skillId || '').trim();

  return (
    SKILL_MAP.get(normalizedSkillId) ||
    SKILL_MAP.get(DEFAULT_PARSING_SKILL_ID) ||
    PARSING_SKILLS[0]
  );
}

module.exports = {
  DEFAULT_PARSING_SKILL_ID,
  listParsingSkills,
  resolveParsingSkill,
  toPublicParsingSkill,
};
