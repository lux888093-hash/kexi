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
      return <strong key={`${part}-${index}`} className="font-bold text-slate-900 dark:text-slate-100">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${part}-${index}`} className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800 dark:text-slate-200">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("[^") && part.endsWith("]")) {
      const num = part.slice(2, -1);
      return <span key={`${part}-${index}`} className="inline-flex items-center justify-center size-4 rounded-full bg-primary/10 text-primary text-[10px] font-bold ml-0.5 align-top cursor-help group-hover:bg-primary/20 transition-colors" title={`查看引用来源 [${num}]`}>{num}</span>;
    }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return <a key={`${part}-${index}`} className="font-semibold text-primary underline decoration-primary/30 underline-offset-4" href={linkMatch[2]} rel="noreferrer" target="_blank">{linkMatch[1]}</a>;
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
          const headingClass = block.depth === 1 ? "text-xl font-black tracking-tight text-slate-900 dark:text-slate-100 mt-8 mb-3" : block.depth === 2 ? "text-lg font-black tracking-tight text-slate-900 dark:text-slate-100 mt-6 mb-2" : "text-base font-bold text-slate-900 dark:text-slate-100 mt-4";
          return <h3 className={headingClass} key={`block-${blockIndex}`}>{renderInlineMarkdown(block.text)}</h3>;
        }
        if (block.type === "ul") {
          return <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300 marker:text-primary" key={`block-${blockIndex}`}>{block.items.map((item, itemIndex) => (<li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>))}</ul>;
        }
        if (block.type === "ol") {
          return <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700 dark:text-slate-300 marker:font-bold marker:text-primary" key={`block-${blockIndex}`}>{block.items.map((item, itemIndex) => (<li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>))}</ol>;
        }
        if (block.type === "quote") {
          return <blockquote className="rounded-2xl border-l-4 border-primary/30 bg-primary/5 px-5 py-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400" key={`block-${blockIndex}`}>{renderInlineMarkdown(block.text)}</blockquote>;
        }
        return <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-300" key={`block-${blockIndex}`}>{renderInlineMarkdown(block.text)}</p>;
      })}
    </div>
  );
}

function FileChip({ fileName, size, onClick, status }) {
  const isPdf = fileName.toLowerCase().endsWith('.pdf');
  const isExcel = fileName.toLowerCase().endsWith('.xlsx') || fileName.toLowerCase().endsWith('.xls');
  const icon = isPdf ? 'picture_as_pdf' : (isExcel ? 'table_view' : 'draft');
  const iconColor = isPdf ? 'text-rose-500' : (isExcel ? 'text-emerald-500' : 'text-amber-500');
  return (
    <div onClick={onClick} className="inline-flex items-center gap-2 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 shadow-sm transition-all hover:border-primary/40 cursor-pointer group">
      <span className={`material-symbols-outlined text-base ${iconColor}`}>{icon}</span>
      <span className="max-w-[120px] truncate">{fileName}</span>
      {size && <span className="text-[10px] text-slate-400 font-medium">{size}</span>}
      {status === 'PARTIAL' && <span className="size-1.5 rounded-full bg-amber-400"></span>}
    </div>
  );
}

function ThoughtProcess({ thought }) {
  const [isOpen, setIsOpen] = useState(false);
  if (!thought) return null;
  return (
    <div className="mb-4">
      <button onClick={() => setIsOpen(!isOpen)} className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"><span className="material-symbols-outlined text-[16px]">temp_preferences_custom</span>{isOpen ? '隐藏思路' : '查看思路'}</button>
      {isOpen && <div className="mt-2 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-4 text-xs leading-relaxed text-slate-600 dark:text-slate-400 font-medium animate-in fade-in slide-in-from-top-1"><div className="whitespace-pre-wrap">{thought}</div></div>}
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
      <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-6 flex h-[calc(100vh-100px)] flex-col relative font-sans bg-slate-50 dark:bg-slate-950 overflow-hidden">
        <div className="relative z-20 flex items-center justify-between px-6 lg:px-10 py-4 border-b border-primary/10 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl">
          <div className="flex items-center gap-3">
             <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center"><span className="material-symbols-outlined text-[18px] text-primary">auto_awesome</span></div>
             <span className="text-base font-bold text-slate-900 dark:text-slate-100">智能解析</span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setIsPanelOpen(true)} className="px-4 py-1.5 rounded-full bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors mr-2 flex items-center gap-1">
              <span className="material-symbols-outlined text-[14px]">table_chart</span>
              查看体质表
            </button>
            <div className="relative group">
              <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="appearance-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary/40 focus:border-primary/60 text-xs font-bold text-slate-700 dark:text-slate-200 rounded-full px-4 py-1.5 pr-8 cursor-pointer outline-none transition-all shadow-sm">
                {STORES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 pointer-events-none transition-transform group-hover:text-primary">expand_more</span>
            </div>
            <div className="h-4 w-[1px] bg-slate-200 dark:bg-slate-700 mx-1"></div>
            <div className="relative group">
              <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="appearance-none bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary/40 focus:border-primary/60 text-xs font-bold text-slate-700 dark:text-slate-200 rounded-full px-4 py-1.5 pr-8 cursor-pointer outline-none transition-all shadow-sm">
                {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
              <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 pointer-events-none transition-transform group-hover:text-primary">expand_more</span>
            </div>
          </div>
        </div>
        
        <div className="relative z-10 flex-1 overflow-y-auto px-4 lg:px-0 custom-scrollbar pb-32">
          <div className="mx-auto max-w-[800px] pt-8 pb-12 space-y-8">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex gap-4 w-full ${msg.sender === "user" ? "justify-end" : "justify-start"}`}>
                {msg.sender === "ai" && (<div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary mt-1"><span className="material-symbols-outlined text-[18px]">auto_awesome</span></div>)}
                <div className={`flex flex-col gap-2 ${msg.sender === "user" ? "max-w-[80%] items-end" : "max-w-[85%] items-start"}`}>
                  {msg.files && (<div className="flex flex-wrap gap-2 mb-1">{msg.files.map((f, i) => <FileChip key={i} fileName={f.name} size={f.size} />)}</div>)}
                  
                  {msg.sender === "user" ? (
                    <div className="bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-[24px] rounded-br-sm px-5 py-3 shadow-sm text-sm">
                      {msg.text}
                    </div>
                  ) : (
                    <div className="w-full">
                      {msg.sender === "ai" && <ThoughtProcess thought={msg.reasoning} />}
                      {msg.text && <MarkdownMessage content={msg.text} />}
                      {msg.sender === "ai" && msg.loading && (
                        <div className="mt-4 flex flex-col gap-2">
                          <div className="flex gap-1.5 items-center">
                            <div className="size-1.5 rounded-full bg-primary/40 animate-bounce"></div>
                            <div className="size-1.5 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: "0.15s" }}></div>
                            <div className="size-1.5 rounded-full bg-primary/80 animate-bounce" style={{ animationDelay: "0.3s" }}></div>
                            {msg.status && <span className="ml-2 text-[12px] font-bold text-slate-500 dark:text-slate-400">{msg.status}</span>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>
        
        <div className="absolute bottom-0 left-0 right-0 z-30 pt-10 pb-6 px-4 bg-gradient-to-t from-slate-50 dark:from-slate-950 to-transparent">
          <div className="mx-auto w-full max-w-[800px] relative">
            <div className="relative flex items-end rounded-[32px] bg-slate-100 dark:bg-slate-800 border border-transparent focus-within:bg-white focus-within:dark:bg-slate-900 focus-within:border-primary/20 focus-within:shadow-sm transition-all p-1.5">
              <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileUpload} accept=".xls,.xlsx,.csv,.pdf,.doc,.docx" />
              <button onClick={triggerFileInput} className="flex size-11 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-0.5 ml-0.5"><span className="material-symbols-outlined text-[24px]">add</span></button>
              <textarea value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={handleKeyDown} placeholder="发送指令或上传报表..." className="w-full resize-none bg-transparent px-3 py-3.5 text-[15px] text-slate-900 dark:text-slate-100 placeholder:text-slate-500 outline-none max-h-[140px] min-h-[52px]" rows="1" />
              <button onClick={handleSendMessage} disabled={!inputText.trim() || isTyping} className={`flex size-11 shrink-0 items-center justify-center rounded-full transition-all duration-300 mb-0.5 mr-0.5 ${inputText.trim() && !isTyping ? "bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 shadow-sm hover:opacity-90" : "bg-slate-200 dark:bg-slate-700 text-slate-400 cursor-not-allowed"}`}><span className="material-symbols-outlined text-[20px]">arrow_upward</span></button>
            </div>
            <p className="text-center text-[12px] font-medium text-slate-400 mt-3">AI 经营洞察基于深度语义解析，建议结合体质表多维核对。</p>
          </div>
        </div>
        
        {isPanelOpen && (<PhysicalTablePanel storeId={STORE_MAP[selectedStore]} storeName={selectedStore} period={getPeriodId(selectedMonth)} periodLabel={selectedMonth} onClose={() => setIsPanelOpen(false)} />)}
      </div>
    </AppShell>
  );
}
