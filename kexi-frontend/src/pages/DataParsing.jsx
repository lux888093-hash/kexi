import React, { useState, useRef, useEffect } from "react";
import AppShell from "../components/AppShell";
import PhysicalTablePanel from "../components/PhysicalTablePanel";
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
  if (mode === "pdf-text") {
    return "PDF 文本解析";
  }

  if (mode === "spreadsheet") {
    return "表格直读";
  }

  if (mode === "document") {
    return "参考文本";
  }

  if (mode === "error") {
    return "解析失败";
  }

  return "待处理";
}

function buildFileMetaSummary(metrics = {}) {
  const items = [];

  if (metrics.sheetName) {
    items.push(metrics.sheetName);
  }

  if (metrics.rowCount) {
    items.push(`${metrics.rowCount} 行`);
  }

  if (metrics.pageCount) {
    items.push(`${metrics.pageCount} 页`);
  }

  if (metrics.charCount) {
    items.push(`${metrics.charCount} 字`);
  }

  if (typeof metrics.totalAmount === "number" && Number.isFinite(metrics.totalAmount)) {
    items.push(`总计 ¥${metrics.totalAmount.toLocaleString("zh-CN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })}`);
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

function getPrimaryReportFile(report = {}) {
  return (
    report.successFiles?.[0] ||
    report.reviewFiles?.[0] ||
    report.failFiles?.[0] ||
    null
  );
}

function buildReportSummary({ report, index, total }) {
  const primaryFile = getPrimaryReportFile(report);

  if (!primaryFile) {
    return `第 ${index}/${total} 份文件已处理完成，但当前还没有拿到可展示的解析结果。`;
  }

  if (report.failFiles?.length > 0) {
    return `第 ${index}/${total} 份文件《${primaryFile.name}》暂不支持解析，当前未纳入体质表，请替换成可识别格式后再试。`;
  }

  const sectionLabel = primaryFile.bodySheetSection?.label;
  const summary = (primaryFile.parsedDataSummary || []).slice(0, 3);
  const alreadyMentionedSection = sectionLabel
    ? summary.some((item) => String(item || "").includes(sectionLabel))
    : false;

  return [
    `第 ${index}/${total} 份文件《${primaryFile.name}》已完成解析。`,
    ...summary,
    sectionLabel && !alreadyMentionedSection ? `本次先纳入体质表「${sectionLabel}」。` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function buildBatchSummary({ fileCount, matchedGroupKeys, storeName, periodLabel }) {
  const missingFiles = REQUIRED_SOURCE_GROUPS.filter(
    (group) => !matchedGroupKeys.has(group.key),
  ).map((group) => group.label);

  const coveredGroups = REQUIRED_SOURCE_GROUPS.filter((group) =>
    matchedGroupKeys.has(group.key),
  ).map((group) => group.label.replace(/\.(xlsx|xls|csv|pdf)$/i, ""));

  const parts = [
    `本轮共完成 ${fileCount} 份源文件解析。`,
    coveredGroups.length
      ? `已补齐：${coveredGroups.join("、")}。`
      : "当前还没有补齐到可直接入表的核心来源。",
    missingFiles.length
      ? `仍缺：${missingFiles.join("、")}。`
      : `当前 ${storeName} ${periodLabel} 的核心源文件已基本补齐，可以进入体质表汇总。`,
  ];

  return parts.join(" ");
}

function buildMissingSourceGroups(matchedGroupKeys) {
  return REQUIRED_SOURCE_GROUPS.filter((group) => !matchedGroupKeys.has(group.key))
    .map((group) => group.label);
}

function resolveDownloadUrl(downloadPath = "", downloadFileName = "") {
  if (!downloadPath) {
    return "";
  }

  const separator = downloadPath.includes("?") ? "&" : "?";
  const pathWithName = downloadFileName
    ? `${downloadPath}${separator}name=${encodeURIComponent(downloadFileName)}`
    : downloadPath;

  return buildApiUrl(pathWithName);
}

async function uploadSourceFiles(files, { storeName, periodLabel }) {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append("files", file);
  });
  formData.append("storeName", storeName);
  formData.append("periodLabel", periodLabel);

  const response = await fetch(buildApiUrl("/api/parsing/upload"), {
    method: "POST",
    body: formData,
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "源文件解析失败，请稍后重试。");
  }

  return payload;
}

async function exportParsingDraft({
  storeName,
  periodLabel,
  parsedFiles,
  reviewFiles,
  failFiles,
  missingFiles,
}) {
  const response = await fetch(buildApiUrl("/api/parsing/export-draft"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
    throw new Error(payload.message || "体质表生成失败，请稍后重试。");
  }

  return payload;
}

export default function DataParsing() {
  const [selectedStore, setSelectedStore] = useState("华创店");
  const [selectedMonth, setSelectedMonth] = useState("2026年1月");
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [messages, setMessages] = useState([
    {
      id: "init-msg-1",
      sender: "ai",
      text: `您好！我是 **珂溪 AI 洞察助手**。

  请在右上角确认当前的**门店**和**月份**。您可以随时向我发送指令修改报表参数，或在下方点击 **"+"** 上传当月相关源文件（如营业报表、出入库登记表等），我将为您进行深度解析并生成《体质检测表》。`,
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [typingText, setTypingText] = useState("");
  const [inputText, setInputText] = useState("");
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const newMsg = {
      id: Date.now(),
      sender: "user",
      files: files.map((f) => f.name),
    };
    setMessages((prev) => [...prev, newMsg]);

    setIsTyping(true);
    const matchedGroupKeys = new Set();
    const parsedDraftFiles = [];
    const reviewDraftFiles = [];
    const failDraftFiles = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        setTypingText(`正在解析第 ${index + 1}/${files.length} 份：${file.name}`);

        try {
          const result = await uploadSourceFiles([file], {
            storeName: selectedStore,
            periodLabel: selectedMonth,
          });

          const successFiles = (result.parsedFiles || []).map(normalizeParsedFile);
          const reviewFiles = (result.reviewFiles || []).map(normalizeReviewFile);
          const failFiles = (result.failFiles || []).map((parsedFile) => ({
            name: parsedFile.fileName || file.name || "",
            reason: parsedFile.reason || "当前文件暂不支持解析。",
            bodySheetSection: parsedFile.bodySheetSection || null,
            parsedDataSummary: Array.isArray(parsedFile.parsedDataSummary)
              ? parsedFile.parsedDataSummary
              : [],
          }));

          parsedDraftFiles.push(...(result.parsedFiles || []));
          reviewDraftFiles.push(...(result.reviewFiles || []));
          failDraftFiles.push(...(result.failFiles || []));

          [...successFiles, ...reviewFiles].forEach((parsedFile) => {
            if (parsedFile.sourceGroupKey) {
              matchedGroupKeys.add(parsedFile.sourceGroupKey);
            }
          });

          const hasBlockingIssue = failFiles.length > 0;
          const needsFollowUp = reviewFiles.length > 0;
          const aiResponse = {
            id: Date.now() + index + 1,
            sender: "ai",
            type: "report",
            fileName: file.name,
            store: selectedStore,
            month: selectedMonth,
            summaryText: "",
            statusLabel: hasBlockingIssue
              ? "PARTIAL"
              : needsFollowUp
                ? "REVIEW"
                : "COMPLETED",
            successFiles,
            reviewFiles,
            failFiles,
            missingFiles: [],
            downloadUrl: "",
            downloadFileName: "",
          };

          aiResponse.summaryText = buildReportSummary({
            report: aiResponse,
            index: index + 1,
            total: files.length,
          });

          setMessages((prev) => [...prev, aiResponse]);
        } catch (singleError) {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + index + 1,
              sender: "ai",
              type: "report",
              fileName: file.name,
              store: selectedStore,
              month: selectedMonth,
              summaryText: `第 ${index + 1}/${files.length} 份文件《${file.name}》解析失败：${singleError.message || "请稍后重试。"}`,
              statusLabel: "PARTIAL",
              successFiles: [],
              reviewFiles: [],
              failFiles: [
                {
                  name: file.name,
                  reason: singleError.message || "请稍后重试。",
                  bodySheetSection: null,
                  parsedDataSummary: [],
                },
              ],
              missingFiles: [],
              downloadUrl: "",
              downloadFileName: "",
            },
          ]);
        }
      }

      const batchSummary = buildBatchSummary({
        fileCount: files.length,
        matchedGroupKeys,
        storeName: selectedStore,
        periodLabel: selectedMonth,
      });
      const missingFiles = buildMissingSourceGroups(matchedGroupKeys);

      setTypingText("正在按模板汇总体质表并生成下载文件...");

      try {
        const exportResult = await exportParsingDraft({
          storeName: selectedStore,
          periodLabel: selectedMonth,
          parsedFiles: parsedDraftFiles,
          reviewFiles: reviewDraftFiles,
          failFiles: failDraftFiles,
          missingFiles,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: `batch-summary-${Date.now()}`,
            sender: "ai",
            text: `${batchSummary} 我已按标准体质表模板完成回填，可直接下载。`,
            downloadUrl: resolveDownloadUrl(
              exportResult.downloadPath,
              exportResult.downloadFileName,
            ),
            downloadFileName: exportResult.downloadFileName || "",
          },
        ]);
      } catch (exportError) {
        setMessages((prev) => [
          ...prev,
          {
            id: `batch-summary-${Date.now()}`,
            sender: "ai",
            text: `${batchSummary} 但体质表生成失败：${exportError.message || "请稍后重试。"}`,
          },
        ]);
      }
    } catch (error) {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: "ai",
          text: `解析失败：${error.message || "请稍后重试。"}`,
        },
      ]);
    } finally {
      setIsTyping(false);
      setTypingText("");
    }

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;

    const currentInput = inputText;
    const newMsg = {
      id: Date.now(),
      sender: "user",
      text: currentInput,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputText("");
    setIsTyping(true);
    setTypingText("思考中...");

    try {
      const response = await fetch(buildApiUrl("/api/agents/chat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          agentId: "financial_analyst",
          message: `[用户当前选择的门店: ${selectedStore}, 月份: ${selectedMonth}] 请基于当前选择的门店和月份已经生成的体质表回答以下问题，如果用户提出的数据与已有体质表冲突，请务必提醒。问题：${currentInput}`,
          history: messages.map(m => ({ role: m.sender === 'ai' ? 'assistant' : 'user', content: m.text })).slice(-10)
        }),
      });
      
      const payload = await response.json();
      
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: "ai",
          text: payload.reply || "已收到，处理完成。",
        },
      ]);
    } catch {
      setIsTyping(false);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          sender: "ai",
          text: "网络请求失败，请检查服务是否正常。",
        },
      ]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <AppShell>
      <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-6 flex h-[calc(100vh-100px)] flex-col relative font-sans bg-[#fcfbf9] overflow-hidden">
        
        {/* Ambient Background Blur Elements for Depth */}
        <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-[-10%] left-[10%] w-[40vw] h-[40vh] rounded-full bg-[#d4a373]/10 blur-[100px]" />
          <div className="absolute bottom-[-10%] right-[10%] w-[40vw] h-[40vh] rounded-full bg-[#b6860c]/5 blur-[120px]" />
        </div>
        
        {/* Header: Selectors (Glassmorphic) */}
        <div className="relative z-20 flex items-center justify-between px-6 lg:px-10 py-5 border-b border-[#e8dcc4]/40 bg-white/60 backdrop-blur-xl shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#171412] to-[#2c2724] shadow-sm">
              <span className="material-symbols-outlined text-[20px] text-[#e8dcc4]">graphic_eq</span>
            </div>
            <div>
              <span className="text-[17px] font-extrabold tracking-tight text-[#171412]">数据洞察</span>
              <span className="ml-2 text-xs font-semibold uppercase tracking-wider text-[#b6860c] bg-[#b6860c]/10 px-2 py-0.5 rounded-full">AI Agent</span>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsPanelOpen(true)}
              className="group flex items-center gap-1.5 rounded-xl bg-white/80 border border-[#b6860c]/30 px-4 py-2 text-sm font-bold text-[#b6860c] shadow-sm transition-all hover:bg-[#b6860c]/10 hover:shadow-md backdrop-blur-md mr-2"
            >
              <span className="material-symbols-outlined text-[18px]">table_chart</span>
              查看体质表
            </button>
            <div className="relative group">
              <select
                value={selectedStore}
                onChange={(e) => setSelectedStore(e.target.value)}
                className="appearance-none rounded-xl bg-white/80 border border-[#e8dcc4]/60 px-4 py-2 pr-9 text-sm font-bold text-[#171412] shadow-sm outline-none transition-all hover:bg-white focus:ring-2 focus:ring-[#b6860c]/20 cursor-pointer backdrop-blur-md"
              >
                {STORES.map((store) => (
                  <option key={store} value={store}>{store}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[#a89b82] pointer-events-none text-[18px] group-hover:text-[#b6860c] transition-colors">
                unfold_more
              </span>
            </div>
            <div className="h-5 w-[1px] bg-[#e8dcc4]/60 mx-1"></div>
            <div className="relative group">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="appearance-none rounded-xl bg-white/80 border border-[#e8dcc4]/60 px-4 py-2 pr-9 text-sm font-bold text-[#171412] shadow-sm outline-none transition-all hover:bg-white focus:ring-2 focus:ring-[#b6860c]/20 cursor-pointer backdrop-blur-md"
              >
                {MONTHS.map((month) => (
                  <option key={month} value={month}>{month}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[#a89b82] pointer-events-none text-[18px] group-hover:text-[#b6860c] transition-colors">
                unfold_more
              </span>
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="relative z-10 flex-1 overflow-y-auto px-4 lg:px-0 custom-scrollbar">
          <div className="mx-auto max-w-[840px] pt-10 pb-40 space-y-10">
            
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-5 w-full ${msg.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                {/* AI Avatar */}
                {msg.sender === "ai" && (
                  <div className="relative flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-[#fffaf2] to-[#f5ebd9] border border-[#e8dcc4] shadow-sm mt-1">
                    <span className="material-symbols-outlined text-[20px] text-[#b6860c]">graphic_eq</span>
                    {/* Glowing dot */}
                    <div className="absolute -top-1 -right-1 size-2.5 rounded-full bg-[#d96e42] border-2 border-white"></div>
                  </div>
                )}

                {/* Message Content */}
                <div
                  className={`max-w-[85%] lg:max-w-[75%] ${
                    msg.sender === "user"
                      ? "bg-[#171412] text-white/95 rounded-[24px] rounded-br-sm px-6 py-4 shadow-md"
                      : "text-[#171412] pt-1"
                  }`}
                >
                  {msg.text && (
                    <div className={`text-[15px] leading-[1.7] whitespace-pre-wrap ${msg.sender === "ai" ? "font-medium" : "font-normal"}`}>
                      {/* Very basic markdown bold parsing for AI intro text */}
                      {msg.text.split('**').map((part, i) => i % 2 === 1 ? <strong key={i} className="font-extrabold text-[#b6860c]">{part}</strong> : part)}
                    </div>
                  )}

                  {/* User Uploaded Files */}
                  {msg.files && (
                    <div className="space-y-2.5 mt-3">
                      {msg.files.map((file, idx) => (
                        <div key={idx} className="flex items-center gap-3 rounded-xl bg-white/10 border border-white/10 px-4 py-3 text-sm backdrop-blur-sm shadow-sm">
                          <div className="flex size-8 items-center justify-center rounded-lg bg-white/20 text-white">
                            <span className="material-symbols-outlined text-[18px]">draft</span>
                          </div>
                          <span className="truncate font-medium">{file}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI Report Summary Card */}
                  {msg.type === "report" && (
                    <div className="mt-5 rounded-[20px] bg-white/80 backdrop-blur-xl border border-white/50 shadow-[0_8px_30px_-4px_rgba(0,0,0,0.05),inset_0_1px_0_rgba(255,255,255,0.6)] overflow-hidden relative">
                      {/* Gradient Decorative Top Bar */}
                      <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#b6860c] via-[#d4a373] to-[#e8dcc4]"></div>
                      
                      {/* Card Header */}
                      <div className="bg-gradient-to-b from-white/60 to-transparent border-b border-[#e8dcc4]/30 px-6 py-4 flex items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="flex size-9 items-center justify-center rounded-full bg-gradient-to-br from-[#fffaf2] to-[#f5ebd9] shadow-inner border border-white">
                            <span className="material-symbols-outlined text-[18px] text-[#b6860c]">auto_awesome</span>
                          </div>
                          <div>
                            <p className="text-[15px] font-extrabold text-[#171412] tracking-tight">
                              解析洞察 ✨ · <span className="text-[#8c8273] font-medium">{msg.fileName || `${msg.store} ${msg.month}`}</span>
                            </p>
                            <p className="text-[12px] text-[#b6860c] font-medium mt-0.5">AI Agent Analysis Complete</p>
                          </div>
                        </div>
                        <span className="shrink-0 flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-emerald-600 bg-emerald-50/80 border border-emerald-100/50 px-2.5 py-1.5 rounded-lg shadow-sm">
                          <span className="material-symbols-outlined text-[14px]">check_circle</span>
                          {msg.statusLabel || "COMPLETED"}
                        </span>
                      </div>
                      
                      {/* Card Body */}
                      <div className="p-6 space-y-5">
                        {msg.summaryText ? (
                          <div className="rounded-xl bg-gradient-to-br from-[#fcfaf7] to-white border border-[#e8dcc4]/40 px-5 py-4 shadow-[inset_0_1px_2px_rgba(255,255,255,0.8)]">
                            <p className="text-[14px] leading-[1.7] text-[#4a4036] flex items-start gap-3">
                              <span className="text-[16px] leading-tight pt-0.5">💡</span>
                              <span>{msg.summaryText}</span>
                            </p>
                          </div>
                        ) : null}

                        <div className="grid grid-cols-1 gap-4">
                          {msg.successFiles?.length > 0 && (
                            <div className="space-y-3">
                              <p className="text-[14px] font-extrabold text-[#171412] flex items-center gap-2">
                                📊 核心数据提取 <span className="text-[#8c8273] text-[12px] font-medium">({msg.successFiles.length} 份文件)</span>
                              </p>
                              <div className="space-y-3">
                                {msg.successFiles.map((file, i) => (
                                  <div
                                    key={`${file.name}-${i}`}
                                    className="rounded-2xl border border-[#e8dcc4]/50 bg-white p-4 shadow-sm hover:shadow-md transition-shadow duration-300 relative overflow-hidden"
                                  >
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-[#b6860c]/5 to-transparent rounded-bl-full pointer-events-none"></div>
                                    <div className="flex items-center justify-between gap-3 relative z-10">
                                      <div className="flex items-center gap-2">
                                        <span className="material-symbols-outlined text-[#b6860c] text-[18px]">dataset</span>
                                        <span className="truncate text-[14px] font-bold text-[#171412]">
                                          {file.name}
                                        </span>
                                      </div>
                                      <span className="shrink-0 rounded-lg bg-[#f5f2eb] border border-[#e8dcc4]/50 px-2 py-1 text-[11px] font-bold tracking-wide text-[#8c8273]">
                                        {file.mode === '表格直读' ? '🧮 ' : ''}{file.mode}
                                      </span>
                                    </div>
                                    <p className="mt-2 text-[13px] leading-relaxed text-[#5f5345] relative z-10">
                                      {file.note}
                                    </p>
                                    
                                    <div className="mt-4 flex flex-col sm:flex-row gap-3 relative z-10">
                                      {file.bodySheetSection ? (
                                        <div className="flex-1 rounded-xl bg-[#fcfaf7] border border-[#e8dcc4]/30 p-3">
                                          <p className="text-[11px] font-bold uppercase tracking-wider text-[#b6860c] mb-1.5 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">account_tree</span> 数据归口</p>
                                          <div className="flex flex-col gap-1">
                                            <span className="text-[13px] font-bold text-[#171412]">
                                              {file.bodySheetSection.label}
                                            </span>
                                            <span className="text-[12px] text-[#8c8273]">
                                              {file.bodySheetSection.target}
                                            </span>
                                          </div>
                                        </div>
                                      ) : null}

                                      {file.parsedDataSummary?.length > 0 ? (
                                        <div className="flex-[2] rounded-xl bg-[#fcfaf7] border border-[#e8dcc4]/30 p-3">
                                          <p className="text-[11px] font-bold uppercase tracking-wider text-[#b6860c] mb-1.5 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">donut_small</span> 本次纳入指标</p>
                                          <ul className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[12px] font-medium text-[#4a4036]">
                                            {file.parsedDataSummary.map((item) => (
                                              <li key={`${file.name}-${item}`} className="flex items-center gap-1.5 truncate">
                                                <div className="size-1 rounded-full bg-[#b6860c]/60 shrink-0"></div>
                                                <span className="truncate">{item}</span>
                                              </li>
                                            ))}
                                          </ul>
                                        </div>
                                      ) : null}
                                    </div>

                                    {file.metricsSummary?.length > 0 ? (
                                      <div className="mt-3 flex flex-wrap gap-2 relative z-10">
                                        {file.metricsSummary.map((item) => (
                                          <span
                                            key={`${file.name}-${item}`}
                                            className="rounded-lg bg-[#b6860c]/5 border border-[#b6860c]/20 px-2.5 py-1 text-[12px] font-semibold text-[#8f6b35] flex items-center gap-1"
                                          >
                                            <span className="text-[10px]">💰</span> {item}
                                          </span>
                                        ))}
                                      </div>
                                    ) : null}
                                    
                                    {file.previewLines?.length > 0 ? (
                                      <div className="mt-3 rounded-lg bg-[#171412]/5 border border-[#171412]/10 px-3.5 py-2.5 relative z-10">
                                        {file.previewLines.map((line, index) => (
                                          <p key={`${file.name}-preview-${index}`} className="truncate text-[12px] font-mono leading-relaxed text-[#5f5345]">
                                            {line}
                                          </p>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {(msg.reviewFiles?.length > 0 || msg.failFiles?.length > 0 || msg.missingFiles?.length > 0) && (
                            <div className="mt-2 flex flex-col gap-3">
                              {msg.reviewFiles?.length > 0 && (
                                <div className="rounded-xl border border-sky-200/60 bg-gradient-to-br from-sky-50/50 to-white p-4 shadow-sm">
                                  <p className="mb-3 text-[14px] font-bold text-sky-800 flex items-center gap-2">
                                    <span className="text-[16px]">🧐</span>
                                    待人工复核 <span className="text-sky-600/70 text-[12px] font-medium">({msg.reviewFiles.length})</span>
                                  </p>
                                  <div className="space-y-2.5">
                                    {msg.reviewFiles.map((file, i) => (
                                      <div key={`${file.name}-${i}`} className="rounded-xl bg-white px-4 py-3 text-[13px] text-sky-900 border border-sky-100 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                                        <div className="flex items-center justify-between gap-3">
                                          <span className="truncate font-bold">{file.name}</span>
                                          <span className="shrink-0 rounded-lg bg-sky-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-sky-700 border border-sky-100/50">
                                            {file.mode}
                                          </span>
                                        </div>
                                        <p className="mt-1.5 text-sky-700/80 leading-relaxed text-[12px]">{file.reason}</p>
                                        {file.bodySheetSection ? (
                                          <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                            <span className="rounded-md bg-sky-50 px-2 py-1.5 text-[11px] font-bold text-sky-700 border border-sky-100">
                                              建议归入：{file.bodySheetSection.label}
                                            </span>
                                            <span className="text-[11px] font-medium text-sky-900/60">
                                              {file.bodySheetSection.target}
                                            </span>
                                          </div>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {msg.failFiles?.length > 0 && (
                                <div className="rounded-xl border border-rose-200/60 bg-gradient-to-br from-rose-50/50 to-white p-4 shadow-sm">
                                  <p className="mb-3 text-[14px] font-bold text-rose-800 flex items-center gap-2">
                                    <span className="text-[16px]">⚠️</span>
                                    格式暂不支持 <span className="text-rose-600/70 text-[12px] font-medium">({msg.failFiles.length})</span>
                                  </p>
                                  <div className="space-y-2">
                                    {msg.failFiles.map((file, i) => (
                                      <div key={`${file.name}-${i}`} className="rounded-xl bg-white px-4 py-2.5 text-[13px] text-rose-900 border border-rose-100">
                                        <p className="truncate font-bold">{file.name}</p>
                                        <p className="mt-1 text-rose-700/80 leading-relaxed text-[12px]">{file.reason}</p>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {msg.missingFiles?.length > 0 && (
                                <div className="rounded-xl border border-amber-200/60 bg-gradient-to-br from-amber-50/50 to-white p-4 shadow-sm">
                                  <p className="mb-2.5 text-[14px] font-bold text-amber-800 flex items-center gap-2">
                                    <span className="text-[16px]">📌</span>
                                    温馨提示：待补齐资料
                                  </p>
                                  <ul className="grid grid-cols-2 gap-2 text-amber-800/80 text-[12px] font-medium mt-2">
                                    {msg.missingFiles.map((f, i) => (
                                      <li key={i} className="flex items-center gap-1.5 truncate">
                                         <div className="size-1.5 rounded-full bg-amber-400 shrink-0"></div>
                                         <span className="truncate">{f}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer (Download) */}
                      <div className="bg-gradient-to-t from-[#fcfbf9] to-white border-t border-[#e8dcc4]/40 px-6 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-0.5 size-7 rounded-full bg-[#e8dcc4]/30 flex items-center justify-center shrink-0">
                            <span className="material-symbols-outlined text-[16px] text-[#8c8273]">task_alt</span>
                          </div>
                          <div>
                            <p className="text-[13px] font-bold text-[#171412]">解析节点已完成</p>
                            <p className="text-[12px] text-[#8c8273] mt-0.5">
                              点击上方「查看体质表」或继续上传补充文件
                            </p>
                          </div>
                        </div>
                        {msg.downloadUrl ? (
                          <a
                            href={msg.downloadUrl}
                            download={msg.downloadFileName || undefined}
                            className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#b6860c] to-[#99700a] px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(182,134,12,0.3)] transition-all hover:scale-[1.02] hover:shadow-[0_6px_16px_rgba(182,134,12,0.4)]"
                          >
                            <span className="material-symbols-outlined text-[18px]">download</span>
                            点击下载
                          </a>
                        ) : (
                          <div className="rounded-xl border border-[#e8dcc4] bg-white px-4 py-2 text-[12px] font-semibold text-[#8c8273]">
                            当前卡片展示的是单文件解析结果；整轮完成后会自动生成标准体质表供下载。
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* General Download button for text responses */}
                  {msg.downloadFileName && msg.type !== "report" && (
                    <div className="mt-4">
                        <a
                          href={msg.downloadUrl}
                          download={msg.downloadFileName || undefined}
                          className="group inline-flex items-center gap-2.5 rounded-xl border border-[#e8dcc4] bg-white px-5 py-3 text-[14px] font-bold text-[#171412] shadow-sm transition-all hover:border-[#b6860c]/50 hover:shadow-md"
                        >
                          <div className="flex size-7 items-center justify-center rounded-lg bg-[#b6860c]/10 text-[#b6860c]">
                            <span className="material-symbols-outlined text-[18px]">table_view</span>
                          </div>
                          {msg.downloadFileName}
                          <span className="material-symbols-outlined text-[18px] text-[#a89b82] group-hover:text-[#b6860c] transition-colors ml-2">download</span>
                        </a>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex gap-5 w-full justify-start">
                <div className="relative flex size-10 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-b from-[#fffaf2] to-[#f5ebd9] border border-[#e8dcc4] shadow-sm mt-1">
                  <span className="material-symbols-outlined text-[20px] text-[#b6860c] animate-pulse">graphic_eq</span>
                </div>
                <div className="pt-3 flex items-center gap-1.5">
                  <div className="size-2 rounded-full bg-[#b6860c]/40 animate-bounce"></div>
                  <div className="size-2 rounded-full bg-[#b6860c]/60 animate-bounce" style={{ animationDelay: "0.15s" }}></div>
                  <div className="size-2 rounded-full bg-[#b6860c]/80 animate-bounce" style={{ animationDelay: "0.3s" }}></div>
                  {typingText ? (
                    <span className="ml-3 text-[13px] font-medium text-[#8c8273]">
                      {typingText}
                    </span>
                  ) : null}
                </div>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area (Premium Glassmorphic floating bar) */}
        <div className="absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-[#fcfbf9] via-[#fcfbf9]/95 to-transparent pt-16 pb-8 px-4">
          <div className="mx-auto w-full max-w-[800px] relative">
            
            <div className="group relative flex items-end rounded-[28px] bg-white/80 backdrop-blur-2xl border border-white/80 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-2 transition-all focus-within:bg-white focus-within:shadow-[0_8px_30px_rgb(182,134,12,0.08)] focus-within:border-[#b6860c]/30">
              
              <input
                type="file"
                multiple
                className="hidden"
                ref={fileInputRef}
                onChange={handleFileUpload}
                accept=".xls,.xlsx,.csv,.pdf,.doc,.docx"
              />
              
              <button
                onClick={triggerFileInput}
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[#f5f2eb] text-[#8c8273] hover:bg-[#e8dcc4] hover:text-[#171412] transition-colors mb-1 ml-1"
                title="上传文件"
              >
                <span className="material-symbols-outlined text-[22px]">add</span>
              </button>

              <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="发送指令修改数据，或点击左侧上传文件..."
                className="w-full resize-none bg-transparent px-4 py-3.5 text-[15px] font-medium text-[#171412] placeholder:text-[#a89b82] outline-none max-h-[140px] min-h-[52px]"
                rows="1"
              />
              
              <div className="flex shrink-0 items-center gap-1 mb-1 mr-1">
                <button
                  className="flex size-11 items-center justify-center rounded-full text-[#8c8273] hover:bg-[#f5f2eb] hover:text-[#171412] transition-colors hidden sm:flex"
                  title="语音输入"
                >
                  <span className="material-symbols-outlined text-[22px]">mic</span>
                </button>
                <button
                  onClick={handleSendMessage}
                  disabled={!inputText.trim()}
                  className={`flex size-11 items-center justify-center rounded-full transition-all duration-300 ${
                    inputText.trim() 
                      ? "bg-[#171412] text-white shadow-md hover:bg-[#b6860c] hover:shadow-lg hover:-translate-y-0.5" 
                      : "bg-[#f5f2eb] text-[#d1c8b8] cursor-not-allowed"
                  }`}
                >
                  <span className="material-symbols-outlined text-[20px] ml-0.5">arrow_upward</span>
                </button>
              </div>
            </div>
            
            <p className="text-center text-[12px] font-medium text-[#a89b82] mt-4">
              基于大语言模型分析，报表下发前请注意人工复核重点数据。
            </p>
          </div>
        </div>

        {isPanelOpen && (
          <PhysicalTablePanel
            storeId={STORE_MAP[selectedStore]}
            storeName={selectedStore}
            period={getPeriodId(selectedMonth)}
            periodLabel={selectedMonth}
            onClose={() => setIsPanelOpen(false)}
          />
        )}

      </div>
    </AppShell>
  );
}
