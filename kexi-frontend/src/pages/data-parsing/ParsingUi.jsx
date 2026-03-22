import { useState } from "react";
import { getParsingSkillById } from "../../lib/parsingSkills";
import { cn } from "./parsingUtils";

function renderInlineMarkdown(text) {
  const source = String(text || "");
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\[\^\d+\])/g;
  const parts = source.split(pattern).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong
          key={`${part}-${index}`}
          className="font-bold text-slate-900 dark:text-slate-100"
        >
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${part}-${index}`}
          className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.92em] text-slate-800"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    if (part.startsWith("[^") && part.endsWith("]")) {
      const num = part.slice(2, -1);
      return (
        <span
          key={`${part}-${index}`}
          className="ml-0.5 inline-flex size-4 cursor-help items-center justify-center rounded-full bg-primary/10 align-top text-[10px] font-bold text-primary transition-colors group-hover:bg-primary/20"
          title={`查看引用来源 [${num}]`}
        >
          {num}
        </span>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={`${part}-${index}`}
          className="font-semibold text-primary underline decoration-primary/30 underline-offset-4"
          href={linkMatch[2]}
          rel="noreferrer"
          target="_blank"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

export function MarkdownMessage({ content }) {
  const lines = String(content || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

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
      if (
        !candidate ||
        /^(#{1,3})\s+/.test(candidate) ||
        /^[-*]\s+/.test(candidate) ||
        /^\d+\.\s+/.test(candidate) ||
        /^>\s?/.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push({ type: "p", text: paragraph.join(" ") });
  }

  return (
    <div className="space-y-4">
      {blocks.map((block, blockIndex) => {
        if (block.type === "heading") {
          const headingClass =
            block.depth === 1
              ? "mt-8 mb-3 text-xl font-black tracking-tight text-slate-900"
              : block.depth === 2
                ? "mt-6 mb-2 text-lg font-black tracking-tight text-slate-900"
                : "mt-4 text-base font-bold text-slate-900";

          return (
            <h3 className={headingClass} key={`block-${blockIndex}`}>
              {renderInlineMarkdown(block.text)}
            </h3>
          );
        }

        if (block.type === "ul") {
          return (
            <ul
              className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-slate-700 marker:text-primary"
              key={`block-${blockIndex}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ul>
          );
        }

        if (block.type === "ol") {
          return (
            <ol
              className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-slate-700 marker:font-bold marker:text-primary"
              key={`block-${blockIndex}`}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`item-${itemIndex}`}>{renderInlineMarkdown(item)}</li>
              ))}
            </ol>
          );
        }

        if (block.type === "quote") {
          return (
            <blockquote
              className="rounded-2xl border-l-4 border-primary/30 bg-primary/5 px-5 py-3 text-sm leading-relaxed text-slate-600"
              key={`block-${blockIndex}`}
            >
              {renderInlineMarkdown(block.text)}
            </blockquote>
          );
        }

        return (
          <p className="text-sm leading-relaxed text-slate-700" key={`block-${blockIndex}`}>
            {renderInlineMarkdown(block.text)}
          </p>
        );
      })}
    </div>
  );
}

export function FileChip({ fileName, size, status }) {
  const isPdf = fileName.toLowerCase().endsWith(".pdf");
  const isExcel =
    fileName.toLowerCase().endsWith(".xlsx") || fileName.toLowerCase().endsWith(".xls");
  const icon = isPdf ? "picture_as_pdf" : isExcel ? "table_view" : "draft";
  const iconColor = isPdf ? "text-rose-500" : isExcel ? "text-emerald-500" : "text-amber-500";

  return (
    <div className="group flex cursor-pointer items-center gap-3 rounded-[20px] border border-white/60 bg-white/70 px-4 py-2.5 text-[13px] font-bold text-slate-700 shadow-sm transition-all hover:border-[#b6860c]/40 hover:bg-white hover:shadow-md">
      <div className={cn("flex size-8 items-center justify-center rounded-xl bg-slate-50 shadow-inner group-hover:bg-white transition-colors")}>
        <span className={`material-symbols-outlined text-[20px] ${iconColor}`}>{icon}</span>
      </div>
      <div className="flex flex-col">
        <span className="max-w-[160px] truncate leading-tight">{fileName}</span>
        {size ? <span className="text-[10px] font-medium text-slate-400 mt-0.5">{size}</span> : null}
      </div>
      {status === "PARTIAL" ? (
        <span className="ml-1 size-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
      ) : null}
    </div>
  );
}

export function WelcomeScreen({ activeSkill, onSuggestionClick }) {
  const suggestions = activeSkill.suggestions || [
    "分析本月营业额异常原因",
    "生成华创店体质趋势报告",
    "对比各店员工绩效表现",
  ];

  return (
    <div className="flex flex-col items-center justify-center pt-24 pb-12 text-center animate-in fade-in slide-in-from-bottom-8 duration-1000">
      <div className="relative mb-8">
        <div className="absolute -inset-4 rounded-full bg-gradient-to-r from-[#b6860c]/20 to-[#d96e42]/20 blur-2xl animate-pulse" />
        <div className="relative flex size-20 items-center justify-center rounded-[32px] bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white shadow-2xl shadow-[#b6860c]/30">
          <span className="material-symbols-outlined text-[40px] leading-none">auto_awesome</span>
        </div>
      </div>

      <h1 className="mb-4 text-4xl font-black tracking-tight text-[#171412]">
        您好，我是<span className="bg-gradient-to-r from-[#b6860c] via-[#d96e42] to-[#b6860c] bg-clip-text text-transparent animate-gradient-x">智能解析器</span>
      </h1>
      <p className="mb-12 max-w-md text-lg font-medium text-slate-500 leading-relaxed">
        今天我能帮您分析哪家门店的数据？你可以直接上传报表，或从下方建议开始。
      </p>

      <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {suggestions.slice(0, 3).map((text, i) => (
          <button
            key={i}
            onClick={() => onSuggestionClick(text)}
            className="group flex flex-col items-start rounded-[28px] border border-white bg-white/60 p-6 text-left shadow-sm transition-all hover:border-[#b6860c]/30 hover:bg-white hover:shadow-xl hover:shadow-[#b6860c]/5 animate-in fade-in slide-in-from-bottom-4 duration-700"
            style={{ animationDelay: `${i * 150}ms` }}
          >
            <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-[#fbf7f2] text-[#b6860c] transition-colors group-hover:bg-[#b6860c] group-hover:text-white">
              <span className="material-symbols-outlined text-[20px]">
                {i === 0 ? "insights" : i === 1 ? "analytics" : "auto_graph"}
              </span>
            </div>
            <p className="text-[15px] font-bold text-slate-700 group-hover:text-[#171412] leading-snug">
              {text}
            </p>
            <div className="mt-4 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-slate-400 group-hover:text-[#b6860c]">
              立即开始 <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThoughtProcess({ thought }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!thought) {
    return null;
  }

  return (
    <div className="mb-5">
      <button
        className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 transition-colors hover:text-[#b6860c]"
        onClick={() => setIsOpen((current) => !current)}
        type="button"
      >
        <span className="material-symbols-outlined text-[18px]">psychology</span>
        {isOpen ? "隐藏解析逻辑" : "查看解析逻辑"}
        <span
          className={cn(
            "material-symbols-outlined text-[14px] transition-transform",
            isOpen ? "rotate-180" : "",
          )}
        >
          expand_more
        </span>
      </button>
      {isOpen ? (
        <div className="mt-2.5 rounded-[20px] border border-[#eadfd2]/40 bg-[#fbf6f1]/60 p-5 text-xs font-medium leading-relaxed text-slate-600 animate-in fade-in slide-in-from-top-1">
          <div className="whitespace-pre-wrap">{thought}</div>
        </div>
      ) : null}
    </div>
  );
}

export function SkillCatalogModal({
  catalog,
  activeSkillId,
  onSelect,
  onClose,
  storeName,
  periodLabel,
}) {
  const activeSkill = getParsingSkillById(catalog.skills, activeSkillId);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#171412]/40 p-4 backdrop-blur-[20px] animate-in fade-in duration-500">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-[40px] border border-white/20 bg-[#fcfaf7] shadow-[0_32px_128px_rgba(0,0,0,0.2)]">
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="flex w-64 flex-col border-r border-[#eadfd2]/40 bg-[#fbf6f1]/80 backdrop-blur-md">
            <div className="p-6">
              <div className="mb-1 flex items-center gap-2">
                <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white shadow-md shadow-[#b6860c]/20">
                  <span className="material-symbols-outlined text-[16px]">auto_awesome</span>
                </div>
                <h2 className="text-sm font-black tracking-tight text-[#171412]">技能百科</h2>
              </div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#b97a5f]/60">Capabilities</p>
            </div>

            <div className="custom-scrollbar flex-1 space-y-0.5 overflow-y-auto px-2 pb-6">
              {catalog.skills.map((skill) => (
                <button
                  key={skill.id}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all duration-300",
                    skill.id === activeSkillId
                      ? "bg-white text-[#b6860c] shadow-sm"
                      : "text-slate-500 hover:bg-white/40 hover:text-[#8f5138]",
                  )}
                  onClick={() => onSelect(skill.id)}
                  type="button"
                >
                  <div
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors duration-300",
                      skill.id === activeSkillId
                        ? "bg-[#b6860c] text-white"
                        : "bg-[#eadfd2]/30 text-slate-400 group-hover:bg-[#eadfd2]/50",
                    )}
                  >
                    <span className="material-symbols-outlined text-[16px]">{skill.icon}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold tracking-tight">{skill.label}</span>
                  </div>
                  {skill.id === activeSkillId && (
                    <div className="size-1.5 rounded-full bg-[#b6860c]" />
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Content Area */}
          <div className="relative flex flex-1 flex-col bg-white/60 backdrop-blur-sm">
            <div className="absolute right-6 top-6 z-10">
              <button
                className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-400 shadow-sm transition-all duration-300 hover:bg-slate-900 hover:text-white backdrop-blur-md"
                onClick={onClose}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="custom-scrollbar flex-1 overflow-y-auto p-10 pb-20">
              <div className="mx-auto max-w-2xl animate-in slide-in-from-bottom-4 duration-500">
                {/* Header Meta */}
                <div className="mb-6 flex items-center gap-2">
                  <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-emerald-600">
                    Live Status
                  </span>
                  <span className="rounded-full bg-[#fff4e8] px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-[#b6860c]">
                    {activeSkill.badge}
                  </span>
                </div>

                <h3 className="mb-4 text-3xl font-black tracking-tighter text-[#171412]">
                  {activeSkill.label}
                </h3>
                <p className="mb-8 text-[15px] font-medium leading-relaxed text-slate-500">
                  {activeSkill.description}
                </p>

                {/* Streamlined Meta Bar */}
                <div className="mb-10 flex items-center gap-6 border-b border-[#eadfd2]/40 pb-8">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-[#fbf7f2] text-[#b6860c]">
                      <span className="material-symbols-outlined text-[20px]">inventory_2</span>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#b97a5f]/60">交付成果</p>
                      <p className="text-[13px] font-black text-[#171412]">{activeSkill.deliverableLabel || "正式报表"}</p>
                    </div>
                  </div>
                  <div className="h-8 w-px bg-[#eadfd2]/40" />
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-xl bg-[#fbf7f2] text-[#d96e42]">
                      <span className="material-symbols-outlined text-[20px]">monitoring</span>
                    </div>
                    <div>
                      <p className="text-[9px] font-black uppercase tracking-widest text-[#b97a5f]/60">数据上下文</p>
                      <p className="text-[13px] font-black text-[#171412]">{storeName} · {periodLabel}</p>
                    </div>
                  </div>
                </div>

                {/* Detail Sections - Compact */}
                <div className="grid gap-10">
                  <section>
                    <h4 className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                      <span className="h-px w-4 bg-slate-200" />
                      核心职责 / Responsibilities
                    </h4>
                    <div className="space-y-2.5">
                      {(activeSkill.responsibilities || []).map((text, idx) => (
                        <div className="group flex items-start gap-3" key={idx}>
                          <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-500">
                            <span className="material-symbols-outlined text-[13px]">check</span>
                          </div>
                          <span className="text-[14px] font-semibold leading-tight text-slate-600 group-hover:text-slate-900 transition-colors">
                            {text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                      <span className="h-px w-4 bg-slate-200" />
                      能力边界 / Boundaries
                    </h4>
                    <div className="space-y-2.5">
                      {(activeSkill.boundaries || []).map((text, idx) => (
                        <div className="group flex items-start gap-3" key={idx}>
                          <div className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-300">
                            <span className="material-symbols-outlined text-[13px]">block</span>
                          </div>
                          <span className="text-[14px] font-semibold leading-tight text-slate-500 group-hover:text-slate-700 transition-colors italic">
                            {text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                      <span className="h-px w-4 bg-slate-200" />
                      数据输入 / Requirements
                    </h4>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {(activeSkill.requiredSourceGroups || []).map((group) => (
                        <div
                          className="flex items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-1.5 text-[12px] font-bold text-slate-600"
                          key={group.key}
                        >
                          <span className="material-symbols-outlined text-[14px] text-slate-400">description</span>
                          {group.label}
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] font-medium text-slate-400">
                      支持格式：{(activeSkill.acceptedFileTypes || []).join(" / ")}
                    </p>
                  </section>

                  {activeSkill.suggestions && activeSkill.suggestions.length > 0 && (
                    <section className="mt-4 pt-10">
                      <h4 className="mb-4 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-[#b97a5f]/50">
                        <span className="h-px w-4 bg-[#b6860c]/30" />
                        推荐指令 / Prompts
                      </h4>
                      <div className="grid gap-1.5">
                        {activeSkill.suggestions.map((text) => (
                          <button
                            key={text}
                            className="group flex w-full items-center justify-between rounded-xl border border-transparent px-3 py-2.5 text-left transition-all duration-300 hover:border-[#b6860c]/10 hover:bg-[#b6860c]/5 hover:pl-4"
                            onClick={() => { onSelect(activeSkill.id); onClose(); }}
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="material-symbols-outlined text-[16px] text-[#b6860c]/40 group-hover:text-[#b6860c] transition-colors">
                                chat_bubble
                              </span>
                              <span className="truncate text-[13px] font-bold text-slate-600 group-hover:text-[#171412] transition-colors leading-none">
                                {text}
                              </span>
                            </div>
                            <span className="material-symbols-outlined text-[16px] text-slate-200 opacity-0 transition-all -translate-x-2 group-hover:translate-x-0 group-hover:text-[#b6860c] group-hover:opacity-100">
                              arrow_forward
                            </span>
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
    </div>
  );
}
