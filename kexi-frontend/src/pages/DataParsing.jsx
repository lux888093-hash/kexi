import React, { useState, useRef, useEffect } from "react";
import AppShell from "../components/AppShell";
import PhysicalTablePanel from "../components/PhysicalTablePanel";
import { buildApiUrl } from "../lib/runtimeConfig";
import {
  DEFAULT_PARSING_SKILL_ID,
  buildSkillParsingContext,
  buildSkillWelcomeMessage,
  getFallbackParsingSkillCatalog,
  getParsingSkillById,
  getParsingSkillClientConfig,
  mergeParsingSkillCatalog,
} from "../lib/parsingSkills";

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

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

const getPeriodId = (monthLabel) => {
  const match = monthLabel.match(/(\d{4})年(\d{1,2})月/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}`;
  }
  return "2026-01";
};

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

function buildMatchedGroupKeys(parsedFiles = [], reviewFiles = []) {
  return new Set(
    [...parsedFiles, ...reviewFiles]
      .map((file) => file?.sourceGroupKey)
      .filter(Boolean),
  );
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
    <div onClick={onClick} className="inline-flex items-center gap-2.5 rounded-2xl bg-white/80 backdrop-blur-sm dark:bg-slate-800/80 border border-[#eadfd2]/50 px-4 py-2 text-xs font-bold text-slate-700 dark:text-slate-300 shadow-sm transition-all hover:border-[#b6860c]/40 hover:shadow-md cursor-pointer group">
      <span className={`material-symbols-outlined text-[18px] ${iconColor}`}>{icon}</span>
      <span className="max-w-[140px] truncate">{fileName}</span>
      {size && <span className="text-[10px] text-slate-400 font-medium">{size}</span>}
      {status === 'PARTIAL' && <span className="size-1.5 rounded-full bg-amber-400 animate-pulse"></span>}
    </div>
  );
}

function ThoughtProcess({ thought }) {
  const [isOpen, setIsOpen] = useState(false);
  if (!thought) return null;
  return (
    <div className="mb-5">
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:text-[#b6860c] transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">psychology</span>
        {isOpen ? '隐藏解析逻辑' : '查看解析逻辑'}
        <span className={cn("material-symbols-outlined text-[14px] transition-transform", isOpen ? "rotate-180" : "")}>expand_more</span>
      </button>
      {isOpen && (
        <div className="mt-2.5 rounded-[20px] bg-[#fbf6f1]/60 dark:bg-slate-800/50 border border-[#eadfd2]/40 p-5 text-xs leading-relaxed text-slate-600 dark:text-slate-400 font-medium animate-in fade-in slide-in-from-top-1">
          <div className="whitespace-pre-wrap">{thought}</div>
        </div>
      )}
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

function buildBatchSummary({ fileCount, matchedGroupKeys, requiredSourceGroups = [], storeName, periodLabel }) {
  const missingFiles = buildMissingSourceGroups(matchedGroupKeys, requiredSourceGroups);
  const coveredGroups = requiredSourceGroups.filter((group) => matchedGroupKeys.has(group.key)).map((group) => group.label.replace(/\.(xlsx|xls|csv|pdf)$/i, ""));
  const summary = [
    `**扫描汇总**：已完成 ${fileCount} 份源文件解析。`,
    coveredGroups.length ? `✅ **核心就绪**：${coveredGroups.join('、')}。` : "⚠️ **预警**：尚未识别到关键经营资料。",
    missingFiles.length ? `❌ **缺失提醒**：仍缺「${missingFiles.join('、')}」` : `✨ **链路闭合**：${storeName} ${periodLabel} 数据链路已完整接入。`,
  ];
  return summary.filter(Boolean).join("\n- ");
}

function buildMissingSourceGroups(matchedGroupKeys, requiredSourceGroups = []) {
  return requiredSourceGroups.filter((group) => !matchedGroupKeys.has(group.key)).map((group) => group.label);
}

function resolveDownloadUrl(downloadPath = "", downloadFileName = "") {
  if (!downloadPath) return "";
  const separator = downloadPath.includes("?") ? "&" : "?";
  const pathWithName = downloadFileName ? `${downloadPath}${separator}name=${encodeURIComponent(downloadFileName)}` : downloadPath;
  return buildApiUrl(pathWithName);
}

async function requestParsingSkills() {
  const response = await fetch(buildApiUrl("/api/parsing/skills"));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "解析技能列表加载失败。");
  return mergeParsingSkillCatalog(payload);
}

async function uploadSourceFiles(files, { skillId, storeName, periodLabel }) {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  formData.append("skillId", skillId);
  formData.append("storeName", storeName);
  formData.append("periodLabel", periodLabel);
  const response = await fetch(buildApiUrl("/api/parsing/upload"), { method: "POST", body: formData });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "源文件解析失败。");
  return payload;
}

async function exportParsingDraft({ skillId, storeName, periodLabel, parsedFiles, reviewFiles, failFiles, missingFiles }) {
  const response = await fetch(buildApiUrl("/api/parsing/export-draft"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillId, storeName, periodLabel, parsedFiles, reviewFiles, failFiles, missingFiles }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || "生成失败。");
  return payload;
}

function SkillCatalogModal({ catalog, activeSkillId, onSelect, onClose, storeName, periodLabel }) {
  const activeSkill = getParsingSkillById(catalog.skills, activeSkillId);
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#171412]/30 backdrop-blur-[12px] p-4 animate-in fade-in duration-700">
      <div className="bg-[#fcfaf7]/95 rounded-[56px] w-full max-w-[1200px] h-[85vh] flex flex-col shadow-[0_48px_160px_rgba(0,0,0,0.12)] overflow-hidden border border-white/60">
        
        <div className="flex-1 overflow-hidden flex">
          {/* Sidebar: Integrated & Minimal */}
          <div className="w-[340px] bg-[#fbf6f1]/60 p-10 overflow-y-auto custom-scrollbar flex flex-col gap-8">
            <div className="flex items-center gap-4 mb-4">
              <div className="size-11 rounded-2xl bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white flex items-center justify-center shadow-lg shadow-[#b6860c]/20">
                <span className="material-symbols-outlined text-[22px]">auto_awesome</span>
              </div>
              <h2 className="text-[20px] font-black tracking-tight text-[#171412]">技能百科</h2>
            </div>

            <nav className="flex flex-col gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.4em] text-[#b97a5f]/50 mb-4 px-4">Capability List</p>
              {catalog.skills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => onSelect(skill.id)}
                  className={`group flex items-center gap-4 p-4 rounded-[28px] text-left transition-all duration-500 ${
                    skill.id === activeSkillId 
                      ? "bg-white shadow-[0_12px_32px_rgba(182,134,12,0.08)] text-[#171412]" 
                      : "text-slate-500 hover:bg-white/50 hover:text-[#8f5138]"
                  }`}
                >
                  <div className={`flex size-10 shrink-0 items-center justify-center rounded-full transition-all duration-500 ${
                    skill.id === activeSkillId ? "bg-[#b6860c] text-white" : "bg-slate-200/50 text-slate-400 group-hover:bg-[#eadfd2]/50"
                  }`}>
                    <span className="material-symbols-outlined text-[18px]">{skill.icon}</span>
                  </div>
                  <span className="text-[14px] font-bold tracking-tight">{skill.label}</span>
                </button>
              ))}
            </nav>
          </div>

          {/* Main Content: Spacious & Breathable */}
          <div className="flex-1 p-16 overflow-y-auto custom-scrollbar bg-white/40 relative">
            <button onClick={onClose} className="absolute top-10 right-10 flex size-12 items-center justify-center rounded-full bg-slate-50 border border-slate-100 hover:bg-[#171412] hover:text-white transition-all duration-500 shadow-sm group">
              <span className="material-symbols-outlined text-[22px]">close</span>
            </button>

            <div className="max-w-[760px] animate-in fade-in slide-in-from-bottom-8 duration-700">
              <div className="flex items-center gap-4 mb-8">
                <span className="px-4 py-1.5 rounded-full bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase tracking-[0.25em] border border-emerald-100/50">Production Ready</span>
                <div className="h-1 w-1 rounded-full bg-slate-200"></div>
                <span className="text-[11px] font-bold text-slate-400 uppercase tracking-[0.3em]">{activeSkill.badge}</span>
              </div>

              <h3 className="text-[48px] font-black tracking-tighter text-[#171412] mb-8 leading-[1.1]">{activeSkill.label}</h3>
              <p className="text-[18px] leading-[1.8] text-slate-500 font-medium mb-12">{activeSkill.description}</p>

              <div className="flex flex-wrap gap-4 mb-20">
                <div className="bg-[#fbf7f2] rounded-3xl px-8 py-6 flex items-center gap-5 border border-[#eadfd2]/30">
                  <span className="material-symbols-outlined text-[#b6860c] text-[28px]">folder_special</span>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#b97a5f] mb-0.5">交付成果</p>
                    <p className="text-[16px] font-black text-[#171412]">{activeSkill.deliverableLabel || "正式报表"}</p>
                  </div>
                </div>
                <div className="bg-[#fbf7f2] rounded-3xl px-8 py-6 flex items-center gap-5 border border-[#eadfd2]/30">
                  <span className="material-symbols-outlined text-[#d96e42] text-[28px]">location_on</span>
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-[0.3em] text-[#b97a5f] mb-0.5">数据范围</p>
                    <p className="text-[16px] font-black text-[#171412]">{storeName} · {periodLabel}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-16">
                <section>
                  <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-[#171412]/30 mb-8">职责边界 / Scope</h4>
                  <div className="space-y-6">
                    {(activeSkill.boundaries || []).map((b, i) => (
                      <div key={i} className="flex items-start gap-6 group">
                        <div className="mt-1.5 size-2 rounded-full bg-[#b6860c]/40 group-hover:scale-150 group-hover:bg-[#b6860c] transition-all duration-500"></div>
                        <span className="text-[15px] leading-relaxed text-slate-600 font-semibold">{b}</span>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-[#171412]/30 mb-8">输入要求 / Inputs</h4>
                  <div className="flex flex-wrap gap-3">
                    {(activeSkill.requiredSourceGroups || []).map((g) => (
                      <div key={g.key} className="bg-slate-50 text-slate-500 border border-slate-100 rounded-2xl px-6 py-3.5 text-[13px] font-bold hover:bg-white hover:border-[#eadfd2] hover:text-[#8f5138] transition-all">
                        {g.label}
                      </div>
                    ))}
                  </div>
                </section>

                {activeSkill.suggestions && activeSkill.suggestions.length > 0 && (
                  <section className="pb-20">
                    <h4 className="text-[12px] font-black uppercase tracking-[0.4em] text-[#171412]/30 mb-8">推荐指令 / Prompts</h4>
                    <div className="flex flex-col gap-3">
                      {activeSkill.suggestions.map((s) => (
                        <button key={s} onClick={() => { onSelect(activeSkill.id); onClose(); }} className="w-fit rounded-2xl bg-white border border-[#eadfd2]/60 px-6 py-4 text-[14px] font-bold text-slate-700 text-left hover:border-[#b6860c] hover:shadow-lg hover:shadow-[#b6860c]/5 transition-all">
                          {s}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DataParsing() {
  const [selectedStore, setSelectedStore] = useState("华创店");
  const [selectedMonth, setSelectedMonth] = useState("2026年1月");
  const [skillCatalog, setSkillCatalog] = useState(() => getFallbackParsingSkillCatalog());
  const [activeSkillId, setActiveSkillId] = useState(DEFAULT_PARSING_SKILL_ID);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [isSkillSelectorOpen, setIsSkillSelectorOpen] = useState(false);
  const [chatParsingContext, setChatParsingContext] = useState(() =>
    buildSkillParsingContext({
      skill: getParsingSkillById(getFallbackParsingSkillCatalog().skills, DEFAULT_PARSING_SKILL_ID),
      storeId: STORE_MAP["华创店"],
      storeName: "华创店",
      period: getPeriodId("2026年1月"),
      periodLabel: "2026年1月",
    }),
  );
  const [messages, setMessages] = useState(() => {
    const initialSkill = getParsingSkillById(getFallbackParsingSkillCatalog().skills, DEFAULT_PARSING_SKILL_ID);
    return [buildSkillWelcomeMessage(initialSkill)];
  });
  const [isTyping, setIsTyping] = useState(false);
  const [inputText, setInputText] = useState("");
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);
  const skillSelectorRef = useRef(null);
  const activeSkill = getParsingSkillById(skillCatalog.skills, activeSkillId);
  const activeSkillClient = getParsingSkillClientConfig(activeSkill.id);
  const activePreviewPanel = activeSkill.previewPanel || activeSkillClient.previewPanel || "";
  const acceptedFileTypes = Array.isArray(activeSkill.acceptedFileTypes) && activeSkill.acceptedFileTypes.length
    ? activeSkill.acceptedFileTypes.join(",")
    : ".xls,.xlsx,.csv,.pdf,.doc,.docx";

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  useEffect(() => scrollToBottom(), [messages]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (skillSelectorRef.current && !skillSelectorRef.current.contains(event.target)) {
        setIsSkillSelectorOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;

    requestParsingSkills()
      .then((catalog) => {
        if (cancelled) return;
        setSkillCatalog(catalog);
        setActiveSkillId((previous) => (
          catalog.skills.some((skill) => skill.id === previous) ? previous : catalog.defaultSkillId
        ));
      })
      .catch(() => null);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const nextSkill = getParsingSkillById(skillCatalog.skills, activeSkillId);
    setChatParsingContext(buildSkillParsingContext({
      skill: nextSkill,
      storeId: STORE_MAP[selectedStore],
      storeName: selectedStore,
      period: getPeriodId(selectedMonth),
      periodLabel: selectedMonth,
    }));
    setMessages([buildSkillWelcomeMessage(nextSkill)]);
    setInputText("");
    setIsPanelOpen(false);
  }, [activeSkillId, selectedMonth, selectedStore, skillCatalog.skills]);

  const handleSkillSelect = (skillId) => {
    if (skillId === activeSkillId) return;
    setActiveSkillId(skillId);
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;
    const skillSnapshot = activeSkill;
    const skillClientSnapshot = activeSkillClient;
    const currentBatchId = `batch-${Date.now()}`;
    const userMsgId = `user-${Date.now()}`;

    setMessages((prev) => [...prev, { id: userMsgId, sender: "user", files: files.map((f) => ({ name: f.name, size: (f.size / 1024).toFixed(1) + ' KB' })) }, { id: currentBatchId, sender: "ai", text: `正在启动 **${skillSnapshot.label}**...`, loading: true, status: `待处理：${files.length} 份` }]);
    setIsTyping(true);
    const existingParsedFiles = Array.isArray(chatParsingContext.parsedFiles) ? chatParsingContext.parsedFiles : [];
    const existingReviewFiles = Array.isArray(chatParsingContext.reviewFiles) ? chatParsingContext.reviewFiles : [];
    const existingFailFiles = Array.isArray(chatParsingContext.failFiles) ? chatParsingContext.failFiles : [];
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
          const result = await uploadSourceFiles([file], { skillId: skillSnapshot.id, storeName: selectedStore, periodLabel: selectedMonth });
          const successFiles = (result.parsedFiles || []).map(normalizeParsedFile);
          const reviewFiles = (result.reviewFiles || []).map(normalizeReviewFile);
          const failFiles = (result.failFiles || []).map((parsedFile) => ({ name: parsedFile.fileName || file.name || "", reason: parsedFile.reason || "暂不支持解析。", bodySheetSection: parsedFile.bodySheetSection || null, parsedDataSummary: Array.isArray(parsedFile.parsedDataSummary) ? parsedFile.parsedDataSummary : [] }));
          parsedDraftFiles.push(...(result.parsedFiles || []));
          reviewDraftFiles.push(...(result.reviewFiles || []));
          failDraftFiles.push(...(result.failFiles || []));
          summaryItems.push(buildReportSummary({ report: { successFiles, reviewFiles, failFiles }, index: index + 1, total: files.length }));
          setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `## 📑 报表解析进度 (${index + 1}/${files.length})\n\n${summaryItems.join('\n\n')}` } : m));
        } catch (singleError) {
          summaryItems.push(`### ❌ ${file.name}\n> **异常**：${singleError.message || "内部解析失败"}`);
          setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `## 📑 报表解析进度 (${index + 1}/${files.length})\n\n${summaryItems.join('\n\n')}` } : m));
        }
      }
      const mergedParsedFiles = mergeFilesByName(existingParsedFiles, parsedDraftFiles);
      const mergedReviewFiles = mergeFilesByName(existingReviewFiles, reviewDraftFiles);
      const mergedFailFiles = mergeFilesByName(existingFailFiles, failDraftFiles);
      const matchedGroupKeys = buildMatchedGroupKeys(mergedParsedFiles, mergedReviewFiles);
      const missingFiles = buildMissingSourceGroups(matchedGroupKeys, skillSnapshot.requiredSourceGroups);
      const batchSummary = buildBatchSummary({ fileCount: files.length, matchedGroupKeys, requiredSourceGroups: skillSnapshot.requiredSourceGroups, storeName: selectedStore, periodLabel: selectedMonth });
      setChatParsingContext((previous) => ({ ...previous, skillId: skillSnapshot.id, skillLabel: skillSnapshot.label, deliverableLabel: skillSnapshot.deliverableLabel || "体质表", parsedFiles: mergedParsedFiles, reviewFiles: mergedReviewFiles, failFiles: mergedFailFiles, missingFiles }));
      let downloadSection = "";
      try {
        setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, status: `正在汇总${skillSnapshot.deliverableLabel || "输出文档"}...` } : m));
        const exportResult = await exportParsingDraft({ skillId: skillSnapshot.id, storeName: selectedStore, periodLabel: selectedMonth, parsedFiles: mergedParsedFiles, reviewFiles: mergedReviewFiles, failFiles: mergedFailFiles, missingFiles });
        const downloadUrl = resolveDownloadUrl(exportResult.downloadPath, exportResult.downloadFileName);
        downloadSection = `\n\n---\n\n✅ **解析已完成**：回填至《${exportResult.downloadFileName}》。\n\n[点击下载《${exportResult.downloadFileName}》](${downloadUrl})`;
      } catch {
        downloadSection = `\n\n---\n\n⚠️ **提示**：解析成功，但生成下载文件时出错。`;
      }
      setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `## 📊 解析报告完成\n\n${summaryItems.join('\n\n')}\n\n---\n\n${batchSummary}${downloadSection}`, status: "" } : m));
      if (typeof skillClientSnapshot.buildInsightMarkdown === "function") {
        const insightMarkdown = skillClientSnapshot.buildInsightMarkdown({
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
      } else {
        setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, loading: false, status: "" } : m));
      }
    } catch (error) { setMessages((prev) => prev.map(m => m.id === currentBatchId ? { ...m, text: `## ⚠️ 处理中断\n\n系统错误：${error.message}`, loading: false, status: "" } : m)); }
    finally { setIsTyping(false); if (fileInputRef.current) fileInputRef.current.value = ""; }
  };

  const handleSendMessage = async () => {
    if (!inputText.trim()) return;
    const currentInput = inputText;
    const skillSnapshot = activeSkill;
    const msgId = Date.now();
    const nextUserMessage = { id: msgId, sender: "user", text: currentInput };
    const historyMessages = [...messages, nextUserMessage];
    setMessages((prev) => [...prev, nextUserMessage]);
    setInputText("");
    setIsTyping(true);
    const aiMsgId = msgId + 1;
    setMessages((prev) => [...prev, { id: aiMsgId, sender: "ai", text: "", loading: true, status: "思考中..." }]);
    try {
      const response = await fetch(buildApiUrl("/api/parsing/chat"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ skillId: skillSnapshot.id, message: currentInput, history: historyMessages.filter((m) => m.sender === "ai" || m.sender === "user").map((m) => ({ role: m.sender === "ai" ? "assistant" : "user", content: m.text || "" })).slice(-10), parsingContext: { ...chatParsingContext, skillId: skillSnapshot.id, skillLabel: skillSnapshot.label, deliverableLabel: skillSnapshot.deliverableLabel || "体质表" } }) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "解析技能问答失败。");
      setMessages((prev) => prev.map(m => m.id === aiMsgId ? { ...m, text: payload.reply || "分析已完成。", reasoning: payload.reasoning, loading: false, status: "" } : m));
    } catch (error) { setMessages((prev) => prev.map(m => m.id === aiMsgId ? { ...m, text: error.message || "网络异常。", loading: false, status: "" } : m)); }
    finally { setIsTyping(false); }
  };

  const handleKeyDown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } };
  const triggerFileInput = () => fileInputRef.current?.click();

  return (
    <AppShell>
      <div className="-mx-4 -my-6 lg:-mx-8 lg:-my-6 flex h-[calc(100vh-100px)] flex-col relative font-sans bg-[#fbf7f2] overflow-hidden">
        {/* Transparent Header */}
        <div className="relative z-20 border-b border-[#eadfd2]/40 bg-[#fbf7f2]/80 px-6 py-4 backdrop-blur-xl lg:px-10">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white shadow-lg shadow-[#b6860c]/20">
                <span className="material-symbols-outlined text-[22px]">auto_awesome</span>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-[#b97a5f]">AI Intelligence</p>
                <h2 className="truncate text-xl font-black tracking-tight text-[#171412]">智能解析控制台</h2>
              </div>
            </div>
            
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => setIsSkillModalOpen(true)} className="px-5 py-2 rounded-full bg-white/60 border border-[#eadfd2] text-slate-600 text-[12px] font-bold hover:border-[#b6860c]/40 hover:bg-white transition-all flex items-center gap-2 shadow-sm">
                <span className="material-symbols-outlined text-[18px]">menu_book</span>
                技能百科
              </button>
              
              {activePreviewPanel === "physical_table" && (
                <button onClick={() => setIsPanelOpen(true)} className="px-5 py-2 rounded-full bg-[#b6860c]/10 text-[#b6860c] text-[12px] font-bold hover:bg-[#b6860c]/20 transition-all flex items-center gap-2 shadow-sm">
                  <span className="material-symbols-outlined text-[18px]">table_chart</span>
                  {activeSkill.deliverableActionLabel || "查看结果"}
                </button>
              )}
              
              <div className="h-6 w-[1px] bg-[#eadfd2] mx-2 hidden lg:block"></div>
              
              <div className="flex items-center gap-2 bg-white/40 p-1 rounded-full border border-[#eadfd2]/50">
                <div className="relative group">
                  <select value={selectedStore} onChange={(e) => setSelectedStore(e.target.value)} className="appearance-none bg-transparent text-xs font-bold text-slate-700 rounded-full pl-4 pr-8 py-1.5 cursor-pointer outline-none transition-all">
                    {STORES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 pointer-events-none group-hover:text-[#b6860c]">expand_more</span>
                </div>
                
                <div className="w-[1px] h-4 bg-[#eadfd2]"></div>
                
                <div className="relative group">
                  <select value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} className="appearance-none bg-transparent text-xs font-bold text-slate-700 rounded-full pl-4 pr-8 py-1.5 cursor-pointer outline-none transition-all">
                    {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <span className="material-symbols-outlined absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 pointer-events-none group-hover:text-[#b6860c]">expand_more</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Message Container */}
        <div className="relative z-10 flex-1 overflow-y-auto px-4 lg:px-0 custom-scrollbar pb-32 pt-8">
          <div className="mx-auto max-w-[720px] space-y-10">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex gap-4 w-full group animate-in fade-in slide-in-from-bottom-4 duration-500", msg.sender === "user" ? "flex-row-reverse" : "flex-row")}>
                {/* Refined Circular Avatars */}
                <div className={cn(
                  "size-10 rounded-full flex items-center justify-center shrink-0 shadow-sm transition-all duration-300", 
                  msg.sender === "user" 
                    ? "bg-slate-200 text-slate-500" 
                    : "bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white shadow-[#b6860c]/20"
                )}>
                  <span className="material-symbols-outlined text-[20px]">{msg.sender === "user" ? "person" : activeSkill.icon}</span>
                </div>
                
                <div className={cn("flex flex-col gap-2 max-w-[85%]", msg.sender === "user" ? "items-end text-right" : "items-start")}>
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400/80">{msg.sender === "user" ? "管理员" : `珂溪助手 · ${activeSkill.label}`}</span>
                    {msg.sender === "ai" && !msg.loading && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-600 border border-emerald-100/50">在线</span>}
                  </div>
                  
                  {msg.files && (<div className="flex flex-wrap gap-2 mb-2">{msg.files.map((f, i) => <FileChip key={i} fileName={f.name} size={f.size} />)}</div>)}

                  {(msg.text || msg.sender === "ai") && (
                    <div className={cn(
                      "rounded-2xl p-6 text-[14.5px] leading-relaxed shadow-sm border transition-all duration-300", 
                      msg.sender === "user" 
                        ? "bg-[#b6860c] text-white border-[#b6860c]/10 rounded-tr-none shadow-[#b6860c]/10" 
                        : "bg-white text-slate-800 border-[#eadfd2]/40 rounded-tl-none"
                    )}>
                      {msg.sender === "user" ? (
                        <div className="whitespace-pre-wrap font-medium tracking-tight">{msg.text}</div>
                      ) : (
                        <div className="w-full">
                          <ThoughtProcess thought={msg.reasoning} />
                          {msg.text && <MarkdownMessage content={msg.text} />}
                          {msg.loading && (
                            <div className="mt-4 flex flex-col gap-3">
                              <div className="flex gap-2 items-center">
                                <div className="size-1.5 rounded-full bg-[#b6860c]/40 animate-bounce"></div>
                                <div className="size-1.5 rounded-full bg-[#b6860c]/60 animate-bounce" style={{ animationDelay: "0.15s" }}></div>
                                <div className="size-1.5 rounded-full bg-[#b6860c]/80 animate-bounce" style={{ animationDelay: "0.3s" }}></div>
                                {msg.status && <span className="ml-2 text-[11px] font-bold text-[#b97a5f] uppercase tracking-[0.2em]">{msg.status}</span>}
                              </div>
                            </div>
                          )}
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

        {/* Floating Input Area (Gemini Style) */}
        <div className="absolute bottom-0 left-0 right-0 z-30 pb-10 px-6 pointer-events-none">
          <div className="mx-auto w-full max-w-[720px] pointer-events-auto">
            <div className="relative flex flex-col rounded-[32px] bg-white/95 border border-[#eadfd2] focus-within:border-[#b6860c]/40 focus-within:shadow-md transition-all p-2 shadow-sm backdrop-blur-xl group">
              <div className="flex items-start px-2">
                <input type="file" multiple className="hidden" ref={fileInputRef} onChange={handleFileUpload} accept={acceptedFileTypes} />
                <button 
                  onClick={triggerFileInput} 
                  className="mt-2 flex size-10 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-[#fff7f0] hover:text-[#b6860c] transition-all"
                >
                  <span className="material-symbols-outlined text-[24px]">add_circle</span>
                </button>
                <textarea 
                  value={inputText} 
                  onChange={(e) => setInputText(e.target.value)} 
                  onKeyDown={handleKeyDown} 
                  placeholder={activeSkill.placeholder || "输入指令或上传报表..."} 
                  className="w-full resize-none bg-transparent px-3 py-3 text-[14.5px] text-slate-900 placeholder:text-slate-400 outline-none max-h-[160px] min-h-[44px] font-medium leading-relaxed" 
                  rows="1" 
                />
              </div>
              
              <div className="flex items-center justify-between px-3 pb-1 pt-1 border-t border-[#eadfd2]/10 mt-1">
                <div className="relative" ref={skillSelectorRef}>
                  <button 
                    onClick={() => setIsSkillSelectorOpen(!isSkillSelectorOpen)} 
                    className="flex items-center gap-2 text-[11px] text-[#8b6720] bg-[#fbf7f2] hover:bg-[#f5f0e8] px-3 py-1.5 rounded-full font-bold transition-all border border-[#eadfd2]/40"
                  >
                    <span className="material-symbols-outlined text-[16px] text-[#b6860c]">{activeSkill.icon}</span>
                    {activeSkill.label}
                    <span className="material-symbols-outlined text-[14px] opacity-60 transition-transform" style={{ transform: isSkillSelectorOpen ? 'rotate(180deg)' : 'none' }}>expand_more</span>
                  </button>
                  
                  {isSkillSelectorOpen && (
                    <div className="absolute bottom-full left-0 mb-4 w-64 bg-white border border-[#eadfd2] rounded-[32px] shadow-[0_24px_64px_rgba(0,0,0,0.15)] z-50 py-3 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
                      <p className="px-5 py-3 text-[10px] font-bold text-[#b97a5f] uppercase tracking-[0.3em]">切换专业技能</p>
                      {skillCatalog.skills.map((skill) => (
                        <button 
                          key={skill.id} 
                          className={cn(
                            "w-full flex items-center gap-4 px-5 py-4 text-[14px] text-left transition-all hover:bg-[#fbf7f2]", 
                            skill.id === activeSkillId ? "text-[#b6860c] font-black bg-[#fbf7f2]/80" : "text-slate-600 font-bold"
                          )} 
                          onClick={() => { handleSkillSelect(skill.id); setIsSkillSelectorOpen(false); }}
                        >
                          <div className={cn("size-8 rounded-xl flex items-center justify-center transition-colors", skill.id === activeSkillId ? "bg-[#b6860c] text-white" : "bg-slate-100 text-slate-500")}>
                            <span className="material-symbols-outlined text-[18px]">{skill.icon}</span>
                          </div>
                          {skill.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="flex items-center gap-3">
                  <div className="text-[10px] font-bold text-slate-400 tracking-[0.1em] mr-2 uppercase hidden sm:block">
                    支持 {acceptedFileTypes.split(',').slice(0, 3).join(' / ')}
                  </div>
                  <button 
                    onClick={handleSendMessage} 
                    disabled={!inputText.trim() || isTyping} 
                    className={cn(
                      "flex size-11 shrink-0 items-center justify-center rounded-full transition-all duration-500", 
                      inputText.trim() && !isTyping 
                        ? "bg-[#171412] text-white shadow-xl hover:bg-[#b6860c] hover:scale-105 active:scale-95" 
                        : "bg-slate-100 text-slate-300 cursor-not-allowed"
                    )}
                  >
                    <span className="material-symbols-outlined text-[24px]">send</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modals */}
        {isSkillModalOpen && (
          <SkillCatalogModal 
            catalog={skillCatalog} 
            activeSkillId={activeSkillId} 
            onSelect={handleSkillSelect} 
            onClose={() => setIsSkillModalOpen(false)}
            storeName={selectedStore}
            periodLabel={selectedMonth}
          />
        )}
        
        {isPanelOpen && activePreviewPanel === "physical_table" && (
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
