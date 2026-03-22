const { readSettings } = require('../appSettings');
const {
  SHUADAN_REQUIRED_SOURCE_GROUPS,
  aggregateShuadanFiles,
  formatCurrency,
  parseShuadanScreenshot,
} = require('./shuadanPacketParser');
const { createShuadanPacketPdf } = require('./shuadanPacketExporter');

const SHUADAN_PACKET_SKILL_ID = 'shuadan_packet_builder';

function hasParsingFiles(parsingContext = {}) {
  return ['parsedFiles', 'reviewFiles', 'failFiles'].some((key) =>
    Array.isArray(parsingContext?.[key]) && parsingContext[key].length > 0,
  );
}

function buildLocalReply(message = '', parsingContext = {}) {
  const aggregate = aggregateShuadanFiles(
    parsingContext.parsedFiles || [],
    parsingContext.reviewFiles || [],
  );

  if (!aggregate.screenshotCount) {
    return '当前技能还没有接收到可用于整理的截图。请先上传核销截图、转账截图或账单详情截图。';
  }

  const normalizedMessage = String(message || '').trim();
  const sectionMap = new Map(aggregate.sections.map((section) => [section.key, section]));
  const verification = sectionMap.get('verification');
  const transfer = sectionMap.get('transfer');
  const review = sectionMap.get('review');

  if (/转账|打款|报销|实付/.test(normalizedMessage)) {
    return [
      `转账截图共 ${transfer?.screenshotCount || 0} 张。`,
      `当前按 ${transfer?.totalRule || '可识别金额'} 统计的转账板块金额为 ${formatCurrency(aggregate.transferTotal)}。`,
      aggregate.duplicateTransfers.length
        ? `另外发现 ${aggregate.duplicateTransfers.length} 组疑似重复转账详情，建议先看最终 PDF 的审计页。`
        : '当前未发现明显重复的转账详情截图。',
    ].join('');
  }

  if (/核销|券码|平台/.test(normalizedMessage)) {
    return [
      `核销截图共 ${verification?.screenshotCount || 0} 张。`,
      `当前按 ${verification?.totalRule || '可识别金额'} 统计的核销板块金额为 ${formatCurrency(aggregate.verificationTotal)}。`,
      verification?.listCount
        ? `其中包含 ${verification.listCount} 张列表页，导出时会保留证据并优先使用详情页汇总。`
        : '当前核销板块以详情页为主。',
    ].join('');
  }

  if (/重复|审计|风险/.test(normalizedMessage)) {
    return [
      aggregate.duplicateTransfers.length
        ? `发现 ${aggregate.duplicateTransfers.length} 组疑似重复转账详情。`
        : '当前未发现明显重复的转账详情截图。',
      aggregate.repeatedAmountTime.length
        ? `另有 ${aggregate.repeatedAmountTime.length} 组“相同金额 + 相同时间”重复。`
        : '未发现明显重复的“金额 + 时间”组合。',
      review?.screenshotCount
        ? `还有 ${review.screenshotCount} 张待复核截图，会一起放进最终 PDF。`
        : '当前没有待复核截图。',
    ].join('');
  }

  return [
    `当前截图包已整理：核销 ${verification?.screenshotCount || 0} 张，转账 ${transfer?.screenshotCount || 0} 张，待复核 ${review?.screenshotCount || 0} 张。`,
    `核销板块合计 ${formatCurrency(aggregate.verificationTotal)}，转账板块合计 ${formatCurrency(aggregate.transferTotal)}，实际报销口径 ${formatCurrency(aggregate.actualReimbursementTotal)}。`,
    '如需继续确认重复项、某张截图归类或金额口径，可以直接追问。',
  ].join('');
}

const SHUADAN_PACKET_SKILL = {
  id: SHUADAN_PACKET_SKILL_ID,
  version: '1.0.0',
  status: 'live',
  icon: 'photo_library',
  label: '门店刷单整理',
  badge: '截图整理技能',
  summary: '解析核销截图与转账截图，自动生成《门店刷单整理-分板块版.pdf》。',
  description:
    '适用于门店刷单、核销、代付、账单详情等截图整理场景。上传 JPG、JPEG、PNG、WEBP 等截图后，技能会自动区分核销截图板块和转账截图板块，抽取金额、时间、券码、订单号等字段，并导出《门店刷单整理-分板块版.pdf》。',
  intro:
    '当前技能专门用于整理门店刷单相关截图。它会识别核销截图、转账截图、列表页与待复核截图，按分板块规则生成可下载的整理 PDF，并在最后追加审计页提示重复和风险。',
  placeholder: '上传核销截图、账单详情或代付截图，或直接追问当前截图包的金额与审计情况…',
  deliverableLabel: '门店刷单整理 PDF',
  deliverableActionLabel: '查看整理结果',
  previewPanel: '',
  acceptedFileTypes: ['.jpg', '.jpeg', '.png', '.webp'],
  suggestions: [
    '当前转账截图合计是多少？',
    '核销板块有没有列表页会重复计数？',
    '这批截图里有疑似重复转账吗？',
  ],
  responsibilities: [
    '识别截图属于核销板块、转账板块还是待复核板块。',
    '抽取可见金额、时间、券码、订单号等结构化字段。',
    '生成《门店刷单整理-分板块版.pdf》并附带审计页。',
  ],
  boundaries: [
    '只处理当前截图包，不替代跨门店或跨月份的经营分析。',
    '金额汇总会明确口径，但截图列表页仍建议人工复核一次。',
    '若智谱视觉接口不可用，会自动退回本地 OCR 兜底；仍无法识别的截图才进入待复核板块。',
  ],
  requiredSourceGroups: SHUADAN_REQUIRED_SOURCE_GROUPS,
  createContext({
    storeId = '',
    storeName = '',
    period = '',
    periodLabel = '',
  } = {}) {
    return {
      skillId: SHUADAN_PACKET_SKILL_ID,
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
    return parseShuadanScreenshot(filePath, options);
  },
  async exportDraft(payload = {}) {
    return createShuadanPacketPdf(payload);
  },
  async chat({
    message,
    parsingContext = null,
  }) {
    const effectiveContext = {
      ...(parsingContext && typeof parsingContext === 'object' ? parsingContext : {}),
      skillId: SHUADAN_PACKET_SKILL_ID,
      skillLabel: this.label,
      deliverableLabel: this.deliverableLabel,
    };

    if (!hasParsingFiles(effectiveContext)) {
      return {
        reply:
          '当前技能还没有可用截图。请先上传核销截图、账单详情截图或转账截图，我再根据当前截图包回答金额、板块和审计问题。',
        agent: {
          id: SHUADAN_PACKET_SKILL_ID,
          name: `${this.label}技能`,
          mode: 'local',
          provider: 'local',
          model: '',
          note: '当前技能优先在本地基于解析结果回答截图整理问题。',
        },
      };
    }

    return {
      reply: buildLocalReply(message, effectiveContext),
      agent: {
        id: SHUADAN_PACKET_SKILL_ID,
        name: `${this.label}技能`,
        mode: 'local',
        provider: readSettings().llmProvider || 'local',
        model: '',
        note: '当前回复基于已解析的截图包结构化结果与审计规则生成。',
      },
    };
  },
};

module.exports = {
  SHUADAN_PACKET_SKILL,
  SHUADAN_PACKET_SKILL_ID,
};
