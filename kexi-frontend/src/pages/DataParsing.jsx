import React, { useState, useRef, useEffect } from "react";
import AppShell from "../components/AppShell";
import PhysicalTablePanel from "../components/PhysicalTablePanel";
import { buildParsingInsightMarkdown } from "../lib/parsingInsightReport";
import { buildApiUrl } from "../lib/runtimeConfig";

const STORES = ["华创店", "佳兆业店", "德思勤店", "凯德壹店", "梅溪湖店", "万象城店"];
const MONTHS = ["2026年1月", "2026年2月", "2026年3月", "2026年4月"];

const STORE_MAP = {
  "华创店": "huachuang",
  "佳兆业店": "jiazhaoye",
  "德思勤店": "desiqin",
  "凯德壹店": "kaideyi",
  "梅溪湖店": "meixihu",
  "万象城店": "wanxiangcheng"
};

const getPeriodId = (monthLabel) => {
  const match = monthLabel.match(/(\d{4})年(\d{1,2})月/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}`;
  }
  return "2026-01";
};

const REQUIRED_SOURCE_GROUPS = [
  { key: "revenue", label: "营业报表.xlsx" },
  { key: "expense", label: "报销明细.pdf" },
  { key: "payroll", label: "员工工资明细表.xlsx" },
];

function getParserModeLabel(mode = "") {
  if (mode === "pdf-text") return "PDF 文本解析";
  if (mode === "spreadsheet") return "表格直读";
  if (mode === "document") return "参考文本";
  if (mode === "error") return "解析失败";
  return "待处理";
}

function buildFileMetaSummary(metrics = {}) {
  const items = [];
  if (metrics.sheetName) items.push(metrics.sheetName);
  if (metrics.rowCount) items.push(`${metrics.rowCount} 行`);
  if (metrics.pageCount) items.push(`${metrics.pageCount} 页`);
  if (metrics.charCount) items.push(`${metrics.charCount} 字`);
  if (typeof metrics.totalAmount === "number" && Number.isFinite(metrics.totalAmount)) {
    items.push(`总计 ¥${metrics.totalAmount.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`);
  }
  return items;
}

function normalizeParsedFile(file = {}) {
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

function normalizeReviewFile(file = {}) {
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

function mergeFilesByName(currentFiles = [], incomingFiles = []) {
  const merged = new Map();
  [...currentFiles, ...incomingFiles].forEach((file) => {
    const key = file?.fileName || file?.name || `${file?.sourceGroupKey || "file"}-${merged.size}`;
    merged.set(key, file);
  });
  return [...merged.values()];
}

function renderInlineMarkdown(text) {
  const source = String(text || "");
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\[\^\d+\])/g;
  const parts = source.split(pattern).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${part}-${index}`} className="font-extrabold text-[#171412]">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`} className="rounded-md bg-[#f7efe7] px-1.5 py-0.5 font-mono text-[0.92em] text-[#8f5138]">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("[^") && part.endsWith("]")) {
      const num = part.slice(2, -1);
      return <span key={`${part}-${index}`} className="inline-flex items-center justify-center size-4 rounded-full bg-[#b6860c]/10 text-[#b6860c] text-[10px] font-bold ml-0.5 align-top cursor-help group-hover:bg-[#b6860c]/20 transition-colors" title={`查看引用来源 [${num}]`}>{num}</span>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return <a key={`${part}-${index}`} className="font-semibold text-[#b4542e] underline decoration-[#d96e42]/30 underline-offset-4" href={linkMatch[2]} rel="noreferrer" target="_blank">{linkMatch[1]}</a>;
    }
    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function MarkdownMessage({ content }) {
  const lines = String(content || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) { index += 1; continue; }
    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({ type: "heading", depth: headingMatch[1].length, text: headingMatch[2] });
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    if (/^\d+\.\s+/.test(trimmed)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(lines[index].trim().replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "ol", items });
      continue;
    }
    if (/^>\s?/.test(trimmed)) {
      const quotes = [];
      while (index < lines.length && /^>\s?/.test(lines[index].trim())) {
        quotes.push(lines[index].trim().replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quotes.join(" ") });
      continue;
    }
    const paragraph = [];
    while (index < lines.length) {
      const candidate = lines[index].trim();
      if (!candidate || /^(#{1,3})\s+/.test(candidate) || /^[-*]\s+/.test(candidate) || /^\d+\.\s+/.test(candidate) || /^>\s?/.test(candidate)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          const headingClass = block.depth === 1 ? "text-[22px] font-extrabold tracking-[-0.02em] text-[#171412] mt-8 mb-3" : block.depth === 2 ? "text-[18px] font-bold tracking-[-0.02em] text-[#171412] mt-6 mb-2" : "text-[16px] font-bold text-[#171412] mt-4";
          return <h3 className={headingClass} key={`block-${blockIndex}`}>{renderInlineMarkdown(block.text)}</h3>;
        }
        if (block.type === "ul") {
          return <ul className="list-disc space-y-3 pl-5 text-[15px] leading-relaxed text-[#3c3733] marker:text-[#b6860c]" key={`block-${blockIndex}`}>{block.items.map((item, itemIndex) => (<li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>))}</ul>;
        }
        if (block.type === "ol") {
          return <ol className="list-decimal space-y-3 pl-5 text-[15px] leading-relaxed text-[#3c3733] marker:font-bold marker:text-[#b6860c]" key={`block-${blockIndex}`}>{block.items.map((item, itemIndex) => (<li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>))}</ol>;
        }
        if (block.type === "quote") {
          return <blockquote className="rounded-2xl border-l-4 border-[#e8dcc4] bg-[#fcfaf7] px-5 py-3 text-[14px] leading-relaxed text-[#6a5647]" key={`block-${blockIndex}`}>{renderInlineMarkdown(block.text)}</blockquote>;
        }
        return <p className="text-[15px] leading-relaxed text-[#3c3733]" key={`block-${blockIndex}`}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

function FileChip({ fileName, size, onClick, status }) {
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls');
  const icon = isPdf ? 'picture_as_pdf' : (isExcel ? 'table_view' : 'draft');
  const iconColor = isPdf ? 'text-red-500' : (isExcel ? 'text-emerald-500' : 'text-amber-500');
  return (
    <div onClick={onClick} className="inline-flex items-center gap-2.5 rounded-2xl bg-white border border-[#e8dcc4]/60 px-3.5 py-2 text-[13px] font-bold text-[#171412] shadow-sm transition-all hover:bg-[#fcfaf7] hover:border-[#b6860c]/40 cursor-pointer group">
      <span className={`material-symbols-outlined text-[18px] ${iconColor}`}>{icon}</span>
      <span className="max-w-[120px] truncate">{fileName}</span>
      {size && <span className="text-[10px] text-[#8c8273] font-medium opacity-60">{size}</span>}
      {status === 'PARTIAL' && <span className="size-1.5 rounded-full bg-amber-400"></span>}
    </div>
  );
}

function ThoughtProcess({ thought }) {
  const [isOpen, setIsOpen] = useState(false);
  if (!thought) return null;
  return (
    <div className="mb-4">
      <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 text-[12px] font-bold text-[#b6860c] hover:text-[#d96e42] transition-colors"><span className="material-symbols-outlined text-[16px]">temp_preferences_custom</span>{isOpen ? '隐藏思路' : '查看思路'}</button>
      {isOpen && <div className="mt-2 rounded-2xl bg-[#fcfaf7] border border-[#e8dcc4]/40 p-4 text-[13px] leading-relaxed text-[#6a5647] font-medium animate-in fade-in slide-in-from-top-1"><div className="whitespace-pre-wrap">{thought}</div></div>}
    </div>
  );
}

function getPrimaryReportFile(report = {}) {
  return report.successFiles?.[0] || report.reviewFiles?.[0] || report.failFiles?.[0] || null;
}

function buildReportSummary({ report, index, total }) {
  const primaryFile = getPrimaryReportFile(report);
  if (!primaryFile) return `第 ${index}/${total} 份文件已处理。`;
  if (report.failFiles?.length > 0) return `### ❌ ${primaryFile.name}\n> **状态**：解析失败\n> **原因**：${primaryFile.reason || "格式暂不支持"}`;
  
  const sectionLabel = primaryFile.bodySheetSection?.label;
  const target = primaryFile.bodySheetSection?.target;
  const metrics = (primaryFile.metricsSummary || []).join(' | ');
  const details = (primaryFile.parsedDataSummary || []);
  
  const detailsList = details.length > 0 
    ? details.map(d => `  - ${d}`).join('\n')
    : "  - 基础文本及业务元数据";

  return `### 📄 ${primaryFile.name}
- **基础属性**：${metrics || '常规文档'}
- **数据归口**：已归类至「**${sectionLabel || '财务数据'}**」→ **${target || '财务明细区'}**
- **解析详情**：
${detailsList}
- **文档总结**：${primaryFile.note || '已完成高精度数据提取，相关指标已同步至体质表。'}`;
}

function buildBatchSummary({ fileCount, matchedGroupKeys, storeName, periodLabel }) {
  const missingFiles = REQUIRED_SOURCE_GROUPS.filter((group) => !matchedGroupKeys.has(group.key)).map((group) => group.label);
  const coveredGroups = REQUIRED_SOURCE_GROUPS.filter((group) => matchedGroupKeys.has(group.key)).map((group) => group.label.replace(/\.(xlsx|xls|csv|pdf)$/i, ""));
  const summary = [
    `**本轮扫描汇总**：已完成 ${fileCount} 份源文件深度解析。`,
    coveredGroups.length ? `✅ **核心就绪**：${coveredGroups.join('、')}。` : "⚠️ **预警**：尚未识别到任何关键财务经营项。",
    missingFiles.length ? `❌ **缺失提醒**：仍缺「${missingFiles.join('、')}」，建议补齐以获得完整分析。` : `✨ **数据大满贯**：${storeName} ${periodLabel} 核心数据链条已完全闭合。`,
  ];
  return summary.filter(Boolean).join("\n- ");
}

function buildMissingSourceGroups(matchedGroupKeys) {
  return REQUIRED_SOURCE_GROUPS.filter((group) => !matchedGroupKeys.has(group.key)).map((group) => group.label);
}

function resolveDownloadUrl(downloadPath = "", downloadFileName = "") {
  if (!downloadPath) return "";
  const separator = downloadPath.includes("?") ? "&" : "?";
  const pathWithName = downloadFileName ? `${downloadPath}${separator}name=${encodeURIComponent(downloadFileName)}` : downloadPath;
  return buildApiUrl(pathWithName);
}

async function uploadSourceFiles(files, { storeName, periodLabel }) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  formData.append("storeName", storeName);
  formData.append("periodLabel", periodLabel);
  const response = await fetch(buildApiUrl("/api/parsing/upload"), { method: "POST", body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "源文件解析失败。");
  return payload;
}

async function exportParsingDraft({ storeName, periodLabel, parsedFiles, reviewFiles, failFiles, missingFiles }) {
  const response = await fetch(buildApiUrl("/api/parsing/export-draft"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeName, periodLabel, parsedFiles, reviewFiles, failFiles, missingFiles }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "生成失败。");
  return payload;
}

export default function DataParsing() {
  const [selectedStore, setSelectedStore] = useState("华创店");
  const [selectedMonth, setSelectedMonth] = useState("2026年1月");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [chatParsingContext, setChatParsingContext] = useState(() => ({
    storeId: STORE_MAP["华创店"], storeName: "华创店", periodLabel: "2026年1月", period: getPeriodId("2026年1月"),
    parsedFiles: [], reviewFiles: [], failFiles: [], missingFiles: [],
  }));
  const [messages, setMessages] = useState([{ id: "init-msg-1", sender: "ai", text: `您好！我是 **珂溪 AI 洞察助手**。\n\n请在上方确认当前的门店和月份。点击下方 **"+"** 上传报表，我将为您进行深度解析并自动补齐《体质检测表》。` }]);
  const [isTyping, setIsTyping] = useState(false);
  const [inputText, setInputText] = useState("");
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(() => scrollToBottom(), [messages]);

  useEffect(() => {
    setChatParsingContext((previous) => {
      if (previous.storeName === selectedStore && previous.periodLabel === selectedMonth) return previous;
      return { storeId: STORE_MAP[selectedStore], storeName: selectedStore, periodLabel: selectedMonth, period: getPeriodId(selectedMonth), parsedFiles: [], reviewFiles: [], failFiles: [], missingFiles: [] };
    });
  }, [selectedMonth, selectedStore]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const currentBatchId = `batch-${Date.now()}`;
    const userMsgId = `user-${Date.now()}`;
    
    setMessages((prev) => [...prev, { id: userMsgId, sender: "user", files: files.map((f) => ({ name: f.name, size: (f.size / 1024).toFixed(1) + ' KB' })) }, { id: currentBatchId, sender: "ai", text: "正在启动报表深度解析程序...", loading: true, status: `待处理：${files.length} 份` }]);
    setIsTyping(true);
    const matchedGroupKeys = new Set();
    const parsedDraftFiles = [];
    const reviewDraftFiles = [];
    const failDraftFiles = [];
    const summaryItems = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const currentStatus = `正在提取 (${index + 1}/${files.length})：${file.name}`;
        setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, status: currentStatus } : m));
        try {
          const result = await uploadSourceFiles([file], { storeName: selectedStore, periodLabel: selectedMonth });
          const successFiles = (result.parsedFiles || []).map(normalizeParsedFile);
          const reviewFiles = (result.reviewFiles || []).map(normalizeReviewFile);
          const failFiles = (result.failFiles || []).map((parsedFile) => ({ name: parsedFile.fileName || file.name || "", reason: parsedFile.reason || "暂不支持解析。", bodySheetSection: parsedFile.bodySheetSection || null, parsedDataSummary: Array.isArray(parsedFile.parsedDataSummary) ? parsedFile.parsedDataSummary : [] }));
          parsedDraftFiles.push(...(result.parsedFiles || []));
          reviewDraftFiles.push(...(result.reviewFiles || []));
          failDraftFiles.push(...(result.failFiles || []));
          [...successFiles, ...reviewFiles].forEach((parsedFile) => { if (parsedFile.sourceGroupKey) matchedGroupKeys.add(parsedFile.sourceGroupKey); });
          summaryItems.push(buildReportSummary({ report: { successFiles, reviewFiles, failFiles }, index: index + 1, total: files.length }));
          setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `## 📑 报表解析进度 (${index + 1}/${files.length})\n\n${summaryItems.join('\n\n')}` } : m));
        } catch (singleError) {
          summaryItems.push(`### ❌ ${file.name}\n> **异常**：${singleError.message || "内部解析失败"}`);
          setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `## 📑 报表解析进度 (${index + 1}/${files.length})\n\n${summaryItems.join('\n\n')}` } : m));
        }
      }
      const batchSummary = buildBatchSummary({ fileCount: files.length, matchedGroupKeys, storeName: selectedStore, periodLabel: selectedMonth });
      const missingFiles = buildMissingSourceGroups(matchedGroupKeys);
      const mergedParsedFiles = mergeFilesByName(chatParsingContext.parsedFiles, parsedDraftFiles);
      const mergedReviewFiles = mergeFilesByName(chatParsingContext.reviewFiles, reviewDraftFiles);
      const mergedFailFiles = mergeFilesByName(chatParsingContext.failFiles, failDraftFiles);
      setChatParsingContext((previous) => ({ ...previous, parsedFiles: mergedParsedFiles, reviewFiles: mergedReviewFiles, failFiles: mergedFailFiles, missingFiles }));
      let downloadSection = "";
      try {
        setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, status: "正在汇汇总体质表..." } : m));
        const exportResult = await exportParsingDraft({ storeName: selectedStore, periodLabel: selectedMonth, parsedFiles: parsedDraftFiles, reviewFiles: reviewDraftFiles, failFiles: failDraftFiles, missingFiles });
        const downloadUrl = resolveDownloadUrl(exportResult.downloadPath, exportResult.downloadFileName);
        downloadSection = `\n\n---\n\n✅ **解析已完成**：所有识别数据已按规口回填至体质表。\n\n[点击下载《${exportResult.downloadFileName}》](${downloadUrl})`;
      } catch (exportError) {
        downloadSection = `\n\n---\n\n⚠️ **提示**：解析成功，但生成下载文件时出错。请点击右上角查阅。`;
      }
      setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `## 📊 解析报告完成\n\n${summaryItems.join('\n\n')}\n\n---\n\n${batchSummary}${downloadSection}`, status: "" } : m));
      const insightMarkdown = buildParsingInsightMarkdown({
        storeName: selectedStore,
        periodLabel: selectedMonth,
        parsedFiles: mergedParsedFiles,
        reviewFiles: mergedReviewFiles,
        failFiles: mergedFailFiles,
        missingFiles,
      });
      setMessages((prev) => prev.map(m => m.id === currentBatchId ? {
        ...m,
        text: `${m.text}\n\n---\n\n## 数据洞察\n\n${insightMarkdown}`,
        reasoning: "",
        loading: false,
        status: "",
      } : m));
      if (false && (parsedDraftFiles.length > 0 || reviewDraftFiles.length > 0)) {
        setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, status: "正在进行全量数据深度洞察..." } : m));
        try {
          const autoAnalysisResponse = await fetch(buildApiUrl("/api/agents/chat"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: "financial_analyst", message: `请针对刚才上传的文件及体质表背景数据做深度的经营洞察。请务必**严格按照以下 Markdown 格式和排版风格**输出，不要省略任何换行和列表符号（-）：

这两份文档（或这些文档）分别记录了门店在日常经营中的[一句话简述核心内容]。

将这类手工记账的表格和零散的报销单据进行结构化，是实现多门店数据看板和自动化AI分析的基础。以下是文档的详细数据梳理与总结：

### 1. 《[文件名]》数据详情
这份文档主要记录了[简述文档内容]，数据可拆分为以下几个核心模块：

- **[模块名称1]**：
  - [具体明细数据1]
  - [具体明细数据2]

- **[模块名称2]**：
  - [具体明细数据1]

### 2. 《[文件名]》数据详情
[简述该表维度等]：

**表A：[表名]**
[简述追踪内容]：
- **[分类名称1]**：[具体明细]
- **[分类名称2]**：[具体明细]

---

### 数据综合总结

1. **[总结要点1标题]**：[总结内容解释，包含具体发现]
2. **[总结要点2标题]**：[总结内容解释，如核心业务聚焦等]
3. **底层数据函待规范化及体质表归口说明**：目前的 Excel 记录方式依赖人工每日盘点... 
   **(此处必须详细列出：以上解析出的各项具体数据，分别应当归类、回填到《体质检测表》中的哪个具体 Sheet 页（例如：收银核对表、日营业报表、总开支、各岗位工资提成表等）以及对应的行/列或模块中。)**
4. **缺失预警**：[明确指出缺失了哪些关键报表（如月报）对洞察的限制]

请严格根据上述 Markdown 模板填充实际解析出来的数据，确保格式完全一致，必须包含黑体加粗、无序列表和有序列表。`, history: [], chatScope: "parsing", parsingContext: { storeId: STORE_MAP[selectedStore], storeName: selectedStore, periodLabel: selectedMonth, period: getPeriodId(selectedMonth), parsedFiles: mergeFilesByName(chatParsingContext.parsedFiles, parsedDraftFiles), reviewFiles: mergeFilesByName(chatParsingContext.reviewFiles, reviewDraftFiles), failFiles: mergeFilesByName(chatParsingContext.failFiles, failDraftFiles), missingFiles: buildMissingSourceGroups(matchedGroupKeys) } }) });
          const autoPayload = await autoAnalysisResponse.json();
          if (autoPayload.reply) setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `${m.text}\n\n---\n\n## 💡 AI 经营深度洞察\n\n${autoPayload.reply}`, reasoning: autoPayload.reasoning, loading: false, status: "" } : m));
        } catch { setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, loading: false, status: "" } : m)); }
      } else { setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, loading: false, status: "" } : m)); }
    } catch (error) { setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `## ⚠️ 处理中断\n\n系统错误：${error.message}`, loading: false, status: "" } : m)); }
    finally { setIsTyping(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    const currentInput = inputText;
    const msgId = Date.now();
    setMessages((prev) => [...prev, { id: msgId, sender: "user", text: currentInput }]);
    setInputText("");
    setIsTyping(true);
    const aiMsgId = msgId + 1;
    setMessages((prev) => [...prev, { id: aiMsgId, sender: "ai", text: "", loading: true, status: "思考中..." }]);
    try {
      const response = await fetch(buildApiUrl("/api/agents/chat"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentId: "financial_analyst", message: currentInput, history: messages.map((m) => ({ role: m.sender === "ai" ? "assistant" : "user", content: m.text })).slice(-10), chatScope: "parsing", parsingContext: chatParsingContext }) });
      const payload = await response.json();
      setMessages((prev) => prev.map(m => m.id === aiMsgId ? { ...m, text: payload.reply || "分析已完成。", reasoning: payload.reasoning, loading: false, status: "" } : m));
    } catch { setMessages((prev) => prev.map(m => m.id === aiMsgId ? { ...m, text: "网络异常。", loading: false, status: "" } : m)); }
    finally { setIsTyping(false); }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } };
  const triggerFileInput = () => fileInputRef.current?.click();

  return (
    <AppShell>
      <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-6 flex h-[calc(100vh-100px)] flex-col relative font-sans bg-[#fcfbf9] overflow-hidden">
        <div className="relative z-20 flex items-center justify-between px-6 lg:px-10 py-4 border-b border-[#e8dcc4]/30 bg-white/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
             <div className="size-8 rounded-lg bg-[#171412] flex items-center justify-center"><span className="material-symbols-outlined text-[18px] text-[#e8dcc4]">graphic_eq</span></div>
             <span className="text-[16px] font-bold text-[#171412]">数据洞察</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setIsPanelOpen(true)} className="px-3 py-1.5 rounded-xl border border-[#b6860c]/40 text-[#b6860c] text-[13px] font-bold hover:bg-[#b6860c]/5 transition-colors mr-2">查看体质表</button>
            <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="appearance-none bg-transparent border-none text-[13px] font-bold text-[#171412] focus:ring-0 cursor-pointer outline-none">{STORES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
            <div className="h-3 w-[1px] bg-[#e8dcc4] mx-1"></div>
            <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="appearance-none bg-transparent border-none text-[13px] font-bold text-[#171412] focus:ring-0 cursor-pointer outline-none">{MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          </div>
        </div>
        <div className="relative z-10 flex-1 overflow-y-auto px-4 lg:px-0 custom-scrollbar">
          <div className="mx-auto max-w-[760px] pt-12 pb-48 space-y-12">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-5 w-full ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                {msg.sender === "ai" && (<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#fffaf2] border border-[#e8dcc4] text-[#b6860c] mt-1"><span className="material-symbols-outlined text-[18px]">graphic_eq</span></div>)}
                <div className={`flex flex-col gap-3 ${msg.sender === "user" ? "max-w-[85%] items-end" : "w-full items-start"}`}>
                  {msg.files && (<div className="flex flex-wrap gap-2 mb-1">{msg.files.map((f, i) => <FileChip key={i} fileName={f.name} size={f.size} />)}</div>)}
                  <div className={`${msg.sender === "user" ? "bg-[#171412] text-white/95 rounded-[22px] rounded-br-sm px-5 py-3 shadow-md" : "w-full rounded-[32px] border border-[#eadfcb] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(252,248,242,0.92))] px-6 py-6 shadow-[0_24px_80px_rgba(95,73,56,0.08)] backdrop-blur-sm"}`}>
                    {msg.sender === "ai" && <ThoughtProcess thought={msg.reasoning} />}
                    {msg.text && <MarkdownMessage content={msg.text} />}
                    {msg.sender === "ai" && msg.loading && (
                      <div className="mt-4 flex flex-col gap-2">
                        <div className="flex gap-1.5 items-center">
                          <div className="size-1.5 rounded-full bg-[#b6860c]/40 animate-bounce"></div>
                          <div className="size-1.5 rounded-full bg-[#b6860c]/60 animate-bounce" style={{ animationDelay: "0.15s" }}></div>
                          <div className="size-1.5 rounded-full bg-[#b6860c]/80 animate-bounce" style={{ animationDelay: "0.3s" }}></div>
                          {msg.status && <span className="ml-2 text-[12px] font-bold text-[#8c8273] uppercase tracking-wider">{msg.status}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 z-30 pt-16 pb-10 px-4 bg-gradient-to-t from-[#fcfbf9] to-transparent">
          <div className="mx-auto w-full max-w-[760px] relative">
            <div className="relative flex items-end rounded-[26px] bg-white border border-[#e8dcc4]/60 shadow-[0_4px_24px_rgba(0,0,0,0.03)] p-1.5 transition-all focus-within:border-[#b6860c]/40 focus-within:shadow-[0_4px_32px_rgba(182,134,12,0.08)]">
              <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileUpload} accept=".xls,.xlsx,.csv,.pdf,.doc,.docx" />
              <button onClick={triggerFileInput} className="flex size-10 shrink-0 items-center justify-center rounded-full text-[#8c8273] hover:bg-[#f5f2eb] hover:text-[#171412] transition-colors mb-0.5 ml-0.5"><span className="material-symbols-outlined text-[22px]">add</span></button>
              <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} placeholder="发送指令或上传报表..." className="w-full resize-none bg-transparent px-3 py-3 text-[15px] font-medium text-[#171412] placeholder:text-[#a89b82] outline-none max-h-[140px] min-h-[48px]" rows="1" />
              <button onClick={handleSendMessage} disabled={!inputText.trim() || isTyping} className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-all duration-300 mb-0.5 mr-0.5 ${inputText.trim() && !isTyping ? "bg-[#171412] text-white" : "bg-[#f5f2eb] text-[#d1c8b8] cursor-not-allowed"}`}><span className="material-symbols-outlined text-[18px]">arrow_upward</span></button>
            </div>
            <p className="text-center text-[11px] font-medium text-[#a89b82] mt-3">AI 经营洞察基于深度语义解析，建议结合体质表多维核对。</p>
          </div>
        </div>
        {isPanelOpen && (<PhysicalTablePanel storeId={STORE_MAP[selectedStore]} storeName={selectedStore} period={getPeriodId(selectedMonth)} periodLabel={selectedMonth} onClose={() => setIsPanelOpen(false)} />)}
      </div>
    </AppShell>
  );
}
