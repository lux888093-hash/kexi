import { buildApiUrl } from "../../lib/runtimeConfig";
import {
  DEFAULT_PARSING_SKILL_ID,
  buildSkillParsingContext,
  buildSkillWelcomeMessage,
  getParsingSkillById,
  mergeParsingSkillCatalog,
} from "../../lib/parsingSkills";

export const STORES = [
  "华创店",
  "佳兆业店",
  "德思勤店",
  "凯德壹店",
  "梅溪湖店",
  "万象城店",
];

export const MONTHS = ["2026年1月", "2026年2月", "2026年3月", "2026年4月"];

export const STORE_MAP = {
  华创店: "huachuang",
  佳兆业店: "jiazhaoye",
  德思勤店: "desiqin",
  凯德壹店: "kaideyi",
  梅溪湖店: "meixihu",
  万象城店: "wanxiangcheng",
};

export const PARSING_CONVERSATIONS_STORAGE_KEY = "kexi.parsing.conversations.v1";
export const DRAFT_CONVERSATION_ID = "__draft__";
const MAX_SAVED_CONVERSATIONS = 24;

export function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

export function getValidStore(storeName = "") {
  return STORES.includes(storeName) ? storeName : STORES[0];
}

export function getValidMonth(monthLabel = "") {
  return MONTHS.includes(monthLabel) ? monthLabel : MONTHS[0];
}

export function getPeriodId(monthLabel = "") {
  const match = monthLabel.match(/(\d{4})年(\d{1,2})月/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}`;
  }
  return "2026-01";
}

export function generateConversationId(prefix = "conversation") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function getParserModeLabel(mode = "") {
  if (mode === "image-vision") return "图片识别";
  if (mode === "pdf-text") return "PDF 文本解析";
  if (mode === "spreadsheet") return "表格直读";
  if (mode === "document") return "参考文档";
  if (mode === "error") return "解析失败";
  return "待处理";
}

export function buildFileMetaSummary(metrics = {}) {
  const items = [];
  if (metrics.sheetName) items.push(metrics.sheetName);
  if (metrics.rowCount) items.push(`${metrics.rowCount} 行`);
  if (metrics.pageCount) items.push(`${metrics.pageCount} 页`);
  if (metrics.listCount) items.push(`${metrics.listCount} 条列表记录`);
  if (metrics.charCount) items.push(`${metrics.charCount} 字`);
  if (typeof metrics.primaryAmount === "number" && Number.isFinite(metrics.primaryAmount)) {
    items.push(
      `主金额 ¥${metrics.primaryAmount.toLocaleString("zh-CN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`,
    );
  }
  if (typeof metrics.totalAmount === "number" && Number.isFinite(metrics.totalAmount)) {
    items.push(
      `总计 ¥${metrics.totalAmount.toLocaleString("zh-CN", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
      })}`,
    );
  }
  return items;
}

export function normalizeParsedFile(file = {}) {
  return {
    name: file.fileName || "",
    mode: getParserModeLabel(file.parserMode),
    note: file.note || "",
    bodySheetSection: file.bodySheetSection || null,
    parsedDataSummary: Array.isArray(file.parsedDataSummary) ? file.parsedDataSummary : [],
    previewLines: Array.isArray(file.previewLines) ? file.previewLines : [],
    metricsSummary: buildFileMetaSummary(file.metrics),
    sourceGroupKey: file.sourceGroupKey || "",
  };
}

export function normalizeReviewFile(file = {}) {
  return {
    name: file.fileName || "",
    mode: getParserModeLabel(file.parserMode),
    reason: file.reason || "当前需要人工复核。",
    bodySheetSection: file.bodySheetSection || null,
    parsedDataSummary: Array.isArray(file.parsedDataSummary) ? file.parsedDataSummary : [],
    previewLines: Array.isArray(file.previewLines) ? file.previewLines : [],
    metricsSummary: buildFileMetaSummary(file.metrics),
    sourceGroupKey: file.sourceGroupKey || "",
  };
}

export function mergeFilesByName(currentFiles = [], incomingFiles = []) {
  const merged = new Map();
  [...currentFiles, ...incomingFiles].forEach((file) => {
    const key = file?.fileName || file?.name || `${file?.sourceGroupKey || "file"}-${merged.size}`;
    merged.set(key, file);
  });
  return [...merged.values()];
}

export function buildMatchedGroupKeys(parsedFiles = [], reviewFiles = []) {
  return new Set(
    [...parsedFiles, ...reviewFiles].map((file) => file?.sourceGroupKey).filter(Boolean),
  );
}

function getPrimaryReportFile(report = {}) {
  return report.successFiles?.[0] || report.reviewFiles?.[0] || report.failFiles?.[0] || null;
}

export function buildReportSummary({ report, index, total }) {
  const primaryFile = getPrimaryReportFile(report);
  if (!primaryFile) {
    return `### 第 ${index}/${total} 份文件\n- 已完成基础处理。`;
  }
  if (report.failFiles?.length > 0) {
    return `### ${primaryFile.name}\n> **状态**：解析失败\n> **原因**：${primaryFile.reason || "格式暂不支持"}`;
  }

  const sectionLabel = primaryFile.bodySheetSection?.label || "财务数据";
  const target = primaryFile.bodySheetSection?.target || "财务明细区";
  const metrics = (primaryFile.metricsSummary || []).join(" | ");
  const details = primaryFile.parsedDataSummary || [];
  const detailList = details.length
    ? details.map((detail) => `- ${detail}`).join("\n")
    : "- 已提取基础文本与业务字段";

  return `### ${primaryFile.name}
- **基础属性**：${metrics || "常规文档"}
- **数据归口**：${sectionLabel} -> ${target}
- **解析详情**：
${detailList}
- **文档总结**：${primaryFile.note || "已完成高精度字段提取，并同步到草稿上下文。"}`;
}

export function buildMissingSourceGroups(matchedGroupKeys, requiredSourceGroups = []) {
  return requiredSourceGroups
    .filter((group) => !matchedGroupKeys.has(group.key))
    .map((group) => group.label);
}

export function buildBatchSummary({
  fileCount,
  matchedGroupKeys,
  requiredSourceGroups = [],
  storeName,
  periodLabel,
}) {
  const missingFiles = buildMissingSourceGroups(matchedGroupKeys, requiredSourceGroups);
  const coveredGroups = requiredSourceGroups
    .filter((group) => matchedGroupKeys.has(group.key))
    .map((group) => group.label.replace(/\.(xlsx|xls|csv|pdf)$/i, ""));
  const summary = [
    `已完成 ${fileCount} 份源文件解析。`,
    coveredGroups.length
      ? `核心资料已识别：${coveredGroups.join("、")}。`
      : "尚未识别到核心经营资料。",
    missingFiles.length
      ? `仍缺：${missingFiles.join("、")}。`
      : `${storeName} ${periodLabel} 数据链路已完整接入。`,
  ];
  return summary.map((item) => `- ${item}`).join("\n");
}

export function resolveDownloadUrl(downloadPath = "", downloadFileName = "") {
  if (!downloadPath) return "";
  const separator = downloadPath.includes("?") ? "&" : "?";
  const pathWithName = downloadFileName
    ? `${downloadPath}${separator}name=${encodeURIComponent(downloadFileName)}`
    : downloadPath;
  return buildApiUrl(pathWithName);
}

function resolvePreviewPath(previewPath = "", downloadPath = "", fileName = "") {
  const normalizedPreviewPath = String(previewPath || "").trim();
  if (normalizedPreviewPath) {
    return normalizedPreviewPath;
  }

  const normalizedDownloadPath = String(downloadPath || "").trim();
  if (/\.pdf$/i.test(String(fileName || "").trim()) && normalizedDownloadPath) {
    return normalizedDownloadPath.replace("/api/parsing/download/", "/api/parsing/view/");
  }

  return "";
}

function extractPdfFileName(label = "", href = "") {
  const normalizedLabel = String(label || "").trim();
  const normalizedHref = String(href || "").trim();
  const labelMatch =
    normalizedLabel.match(/《([^》]+\.pdf)》/i) ||
    normalizedLabel.match(/([^\s]+\.pdf)/i);

  if (labelMatch?.[1]) {
    return labelMatch[1].trim();
  }

  const nameMatch = normalizedHref.match(/[?&]name=([^&]+)/i);
  if (nameMatch?.[1]) {
    try {
      return decodeURIComponent(nameMatch[1]).trim();
    } catch {
      return nameMatch[1].trim();
    }
  }

  const pathMatch = normalizedHref.match(/\/([^/?#]+\.pdf)(?:[?#]|$)/i);
  if (pathMatch?.[1]) {
    try {
      return decodeURIComponent(pathMatch[1]).trim();
    } catch {
      return pathMatch[1].trim();
    }
  }

  return "";
}

function normalizePdfPreviewUrl(href = "") {
  const normalizedHref = String(href || "").trim();
  if (!normalizedHref || !/\/api\/parsing\/(?:download|view)\//i.test(normalizedHref)) {
    return "";
  }

  const previewHref = normalizedHref.replace("/api/parsing/download/", "/api/parsing/view/");

  if (/^https?:\/\//i.test(previewHref)) {
    return previewHref;
  }

  if (previewHref.startsWith("/")) {
    return buildApiUrl(previewHref);
  }

  return buildApiUrl(`/${previewHref.replace(/^\/+/, "")}`);
}

export function normalizeGeneratedDeliverable(deliverable = {}) {
  const source = deliverable && typeof deliverable === "object" ? deliverable : {};
  const fileName = String(
    source.fileName || source.downloadFileName || "",
  ).trim();
  const downloadPath = String(source.downloadPath || "").trim();
  const previewPath = resolvePreviewPath(
    source.previewPath,
    downloadPath,
    fileName,
  );
  const downloadUrl = String(
    source.downloadUrl || resolveDownloadUrl(downloadPath, fileName),
  ).trim();
  const previewUrl = String(
    source.previewUrl || resolveDownloadUrl(previewPath, fileName),
  ).trim();

  if (!fileName && !downloadPath && !previewPath && !downloadUrl && !previewUrl) {
    return null;
  }

  return {
    fileName,
    downloadPath,
    previewPath,
    downloadUrl,
    previewUrl,
    generatedAt: Number(source.generatedAt || Date.now()),
  };
}

export function resolveConversationPdfDeliverable(conversation = {}) {
  const contextDeliverable = normalizeGeneratedDeliverable(
    conversation?.chatParsingContext?.generatedDeliverable,
  );

  if (/\.pdf$/i.test(contextDeliverable?.fileName || "") && contextDeliverable?.previewUrl) {
    return contextDeliverable;
  }

  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message?.sender !== "ai" || typeof message?.text !== "string") {
      continue;
    }

    const matches = [...message.text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)];

    for (let linkIndex = matches.length - 1; linkIndex >= 0; linkIndex -= 1) {
      const [, label = "", href = ""] = matches[linkIndex] || [];
      const previewUrl = normalizePdfPreviewUrl(href);
      const fileName = extractPdfFileName(label, href);

      if (!previewUrl || !/\.pdf$/i.test(fileName || href)) {
        continue;
      }

      return normalizeGeneratedDeliverable({
        fileName,
        previewUrl,
        downloadUrl: String(href || "").trim(),
      });
    }
  }

  return contextDeliverable && /\.pdf$/i.test(contextDeliverable.fileName || "")
    ? contextDeliverable
    : null;
}

export function normalizeParsingMessage(message = {}) {
  return {
    ...message,
    id: message.id || generateConversationId("message"),
    sender: message.sender === "user" ? "user" : "ai",
    text: typeof message.text === "string" ? message.text : "",
    reasoning: typeof message.reasoning === "string" ? message.reasoning : "",
    status: "",
    loading: false,
    files: Array.isArray(message.files)
      ? message.files.map((file) => ({
          name: file?.name || "",
          size: file?.size || "",
        }))
      : undefined,
  };
}

export function normalizeParsingContext(context = {}, skill, selectedStore, selectedMonth) {
  const baseContext = buildSkillParsingContext({
    skill,
    storeId: STORE_MAP[selectedStore],
    storeName: selectedStore,
    period: getPeriodId(selectedMonth),
    periodLabel: selectedMonth,
  });
  return {
    ...baseContext,
    ...context,
    skillId: skill.id,
    skillLabel: skill.label,
    deliverableLabel: skill.deliverableLabel || "体质表",
    storeId: STORE_MAP[selectedStore],
    storeName: selectedStore,
    period: getPeriodId(selectedMonth),
    periodLabel: selectedMonth,
    parsedFiles: Array.isArray(context.parsedFiles) ? context.parsedFiles : [],
    reviewFiles: Array.isArray(context.reviewFiles) ? context.reviewFiles : [],
    failFiles: Array.isArray(context.failFiles) ? context.failFiles : [],
    missingFiles: Array.isArray(context.missingFiles) ? context.missingFiles : [],
    generatedDeliverable: normalizeGeneratedDeliverable(context.generatedDeliverable),
  };
}

export function buildParsingConversation(skillCatalog, overrides = {}) {
  const selectedStore = getValidStore(overrides.selectedStore);
  const selectedMonth = getValidMonth(overrides.selectedMonth);
  const skill = getParsingSkillById(
    skillCatalog.skills,
    overrides.activeSkillId || DEFAULT_PARSING_SKILL_ID,
  );

  return {
    id: overrides.id || generateConversationId("parsing-conversation"),
    title: overrides.title || "",
    createdAt: Number(overrides.createdAt || Date.now()),
    updatedAt: Number(overrides.updatedAt || Date.now()),
    pending: Boolean(overrides.pending),
    selectedStore,
    selectedMonth,
    activeSkillId: skill.id,
    chatParsingContext: normalizeParsingContext(
      overrides.chatParsingContext || {},
      skill,
      selectedStore,
      selectedMonth,
    ),
    messages:
      Array.isArray(overrides.messages) && overrides.messages.length
        ? overrides.messages.map(normalizeParsingMessage)
        : [buildSkillWelcomeMessage(skill)],
  };
}

export function clampSavedConversations(conversations = []) {
  return [...conversations]
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, MAX_SAVED_CONVERSATIONS);
}

export function serializeParsingConversation(conversation = {}) {
  return {
    id: conversation.id,
    title: conversation.title || "",
    createdAt: Number(conversation.createdAt || Date.now()),
    updatedAt: Number(conversation.updatedAt || Date.now()),
    pending: false,
    selectedStore: getValidStore(conversation.selectedStore),
    selectedMonth: getValidMonth(conversation.selectedMonth),
    activeSkillId: conversation.activeSkillId || DEFAULT_PARSING_SKILL_ID,
    chatParsingContext: conversation.chatParsingContext || {},
    messages: Array.isArray(conversation.messages)
      ? conversation.messages.map((message) => ({
          ...normalizeParsingMessage(message),
          loading: false,
          status: "",
        }))
      : [],
  };
}

export function loadStoredParsingConversations(skillCatalog) {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(PARSING_CONVERSATIONS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return clampSavedConversations(
      parsed.map((conversation) => buildParsingConversation(skillCatalog, conversation)),
    );
  } catch {
    return [];
  }
}

export function buildConversationTitleFromInput({ text = "", files = [] } = {}) {
  const fileTitle = Array.isArray(files)
    ? files.map((file) => file?.name).filter(Boolean).join("、")
    : "";
  const source = String(text || "").trim() || fileTitle;
  if (!source) {
    return "新会话";
  }
  return source.length > 22 ? `${source.slice(0, 22)}...` : source;
}

export function buildConversationTitle(conversation) {
  const firstUserMessage = (conversation?.messages || []).find(
    (message) =>
      message.sender === "user" &&
      (String(message.text || "").trim() || (Array.isArray(message.files) && message.files.length)),
  );
  return (
    conversation?.title ||
    buildConversationTitleFromInput({
      text: firstUserMessage?.text,
      files: firstUserMessage?.files,
    })
  );
}

export function hasConversationMessages(conversation) {
  return (conversation?.messages || []).some(
    (message) =>
      message.sender === "user" &&
      (String(message.text || "").trim() || (Array.isArray(message.files) && message.files.length)),
  );
}

export async function requestParsingSkills() {
  const response = await fetch(buildApiUrl("/api/parsing/skills"));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "解析技能列表加载失败。");
  }
  return mergeParsingSkillCatalog(payload);
}

export async function uploadSourceFiles(files, { skillId, storeName, periodLabel }) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  formData.append("skillId", skillId);
  formData.append("storeName", storeName);
  formData.append("periodLabel", periodLabel);
  const response = await fetch(buildApiUrl("/api/parsing/upload"), {
    method: "POST",
    body: formData,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "源文件解析失败。");
  }
  return payload;
}

export async function exportParsingDraft({
  skillId,
  storeName,
  periodLabel,
  parsedFiles,
  reviewFiles,
  failFiles,
  missingFiles,
}) {
  const response = await fetch(buildApiUrl("/api/parsing/export-draft"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      skillId,
      storeName,
      periodLabel,
      parsedFiles,
      reviewFiles,
      failFiles,
      missingFiles,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || "生成失败。");
  }
  return payload;
}
