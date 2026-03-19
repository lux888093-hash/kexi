const { readSettings } = require('../appSettings');
const { buildWorkspaceAgentReply } = require('../agentChat');
const {
  REQUIRED_SOURCE_GROUPS,
  parseSourceFile,
} = require('../sourceFileParser');
const { createParsingDraftWorkbook } = require('../sourceFileWorkbook');

const BODY_TABLE_SKILL_ID = 'body_table_builder';

function hasParsingFiles(parsingContext = {}) {
  return ['parsedFiles', 'reviewFiles', 'failFiles'].some((key) =>
    Array.isArray(parsingContext?.[key]) && parsingContext[key].length > 0,
  );
}

const BODY_TABLE_SKILL = {
  id: BODY_TABLE_SKILL_ID,
  version: '1.0.0',
  status: 'live',
  icon: 'table_chart',
  label: '体质表生成',
  badge: '体质表技能',
  summary: '解析门店源文件并回填体质表草稿。',
  description:
    '适用于单店单月的营业报表、费用/报销、工资等资料解析，目标是生成可下载的体质表草稿与归口说明。',
  intro:
    '当前技能专门负责把营业报表、报销明细、工资表等资料解析成《体质表》草稿。它只处理当前门店、当前月份的文件，不会混入跨店对比或其他技能职责。',
  placeholder: '询问当前解析结果、归口逻辑，或直接上传新的源文件...',
  deliverableLabel: '体质表',
  deliverableActionLabel: '查看体质表',
  previewPanel: 'physical_table',
  acceptedFileTypes: ['.xls', '.xlsx', '.csv', '.pdf', '.doc', '.docx'],
  suggestions: [
    '这份营业报表会回填到体质表哪些位置？',
    '当前还缺哪些源文件？',
    '报销明细是怎么归口到体质表的？',
  ],
  responsibilities: [
    '解析当前门店当前月份的源文件并识别归口。',
    '补齐体质表草稿并生成下载文件。',
    '回答当前解析窗口内的来源、映射和计算问题。',
  ],
  boundaries: [
    '只处理单店单月解析，不做跨门店排名或经营对比。',
    '只围绕体质表生成链路回答，不接管排班、客服、培训等任务。',
    '没有源文件时只给解析准备建议，不臆造体质表结果。',
  ],
  requiredSourceGroups: REQUIRED_SOURCE_GROUPS.map((group) => ({
    key: group.key,
    label: group.label,
  })),
  createContext({
    storeId = '',
    storeName = '',
    period = '',
    periodLabel = '',
  } = {}) {
    return {
      skillId: BODY_TABLE_SKILL_ID,
      skillLabel: this.label,
      deliverableLabel: this.deliverableLabel,
      storeId,
      storeName,
      period,
      periodLabel,
      parsedFiles: [],
      reviewFiles: [],
      failFiles: [],
      missingFiles: [],
    };
  },
  async parseFile(filePath, options = {}) {
    return parseSourceFile(filePath, options);
  },
  async exportDraft(payload = {}) {
    return createParsingDraftWorkbook(payload);
  },
  async chat({
    message,
    history = [],
    reports = [],
    settings = readSettings(),
    parsingContext = null,
  }) {
    const normalizedMessage = String(message || '').trim();
    const effectiveContext = {
      ...(parsingContext && typeof parsingContext === 'object' ? parsingContext : {}),
      skillId: BODY_TABLE_SKILL_ID,
      skillLabel: this.label,
      deliverableLabel: this.deliverableLabel,
    };

    if (!hasParsingFiles(effectiveContext)) {
      return {
        reply:
          '当前技能还没有可用的解析文件。请先上传营业报表、报销明细、工资表等源文件，我再按体质表口径回答来源、归口和计算逻辑。',
        agent: {
          id: BODY_TABLE_SKILL_ID,
          name: `${this.label}技能`,
          mode: 'local',
          provider: 'local',
          model: '',
          note: '当前技能仅处理体质表生成链路，且尚未接收到可解析源文件。',
        },
      };
    }

    const payload = await buildWorkspaceAgentReply({
      agentId: 'financial_analyst',
      history: Array.isArray(history) ? history : [],
      message: normalizedMessage,
      reports,
      settings,
      chatScope: 'parsing',
      parsingContext: effectiveContext,
    });

    return {
      ...payload,
      agent: {
        ...(payload.agent || {}),
        skillId: BODY_TABLE_SKILL_ID,
        skillLabel: this.label,
        note: [
          payload.agent?.note,
          '当前技能职责：仅限当前门店当前月份的体质表生成与解析。',
        ]
          .filter(Boolean)
          .join(' '),
      },
    };
  },
};

module.exports = {
  BODY_TABLE_SKILL,
  BODY_TABLE_SKILL_ID,
};
