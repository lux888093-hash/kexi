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
  const isExcel = fileName.toLowerCase().endsWith(".xlsx") || fileName.toLowerCase().endsWith(".xls");
  const icon = isPdf ? "picture_as_pdf" : isExcel ? "table_view" : "draft";
  const iconColor = isPdf ? "text-rose-500" : isExcel ? "text-emerald-500" : "text-amber-500";

  return (
    <div className="group inline-flex cursor-pointer items-center gap-2.5 rounded-2xl border border-[#eadfd2]/50 bg-white/80 px-4 py-2 text-xs font-bold text-slate-700 shadow-sm transition-all hover:border-[#b6860c]/40 hover:shadow-md">
      <span className={`material-symbols-outlined text-[18px] ${iconColor}`}>{icon}</span>
      <span className="max-w-[140px] truncate">{fileName}</span>
      {size ? <span className="text-[10px] font-medium text-slate-400">{size}</span> : null}
      {status === "PARTIAL" ? <span className="size-1.5 rounded-full bg-amber-400 animate-pulse" /> : null}
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#171412]/30 p-4 backdrop-blur-[12px] animate-in fade-in duration-500">
      <div className="flex h-[80vh] w-full max-w-5xl flex-col overflow-hidden rounded-[40px] border border-white/60 bg-[#fcfaf7] shadow-[0_32px_128px_rgba(0,0,0,0.15)]">
        <div className="flex flex-1 overflow-hidden">
          <div className="flex w-72 flex-col border-r border-[#eadfd2]/40 bg-[#fbf6f1]/60">
            <div className="p-8 pb-4">
              <div className="mb-2 flex items-center gap-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white shadow-lg shadow-[#b6860c]/20">
                  <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
                </div>
                <h2 className="text-lg font-black tracking-tight text-[#171412]">技能百科</h2>
              </div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#b97a5f]/60">
                AI Capabilities
              </p>
            </div>

            <div className="custom-scrollbar flex-1 space-y-1 overflow-y-auto px-4 pb-6">
              <div className="mb-3 px-4 pt-4 text-[10px] font-black uppercase tracking-[0.3em] text-[#b97a5f]/40">
                解析能力清单
              </div>
              {catalog.skills.map((skill) => (
                <button
                  key={skill.id}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all duration-300",
                    skill.id === activeSkillId
                      ? "bg-white text-[#b6860c] shadow-[0_8px_24px_rgba(182,134,12,0.08)]"
                      : "text-slate-500 hover:bg-white/50 hover:text-[#8f5138]",
                  )}
                  onClick={() => onSelect(skill.id)}
                  type="button"
                >
                  <div
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors duration-300",
                      skill.id === activeSkillId
                        ? "bg-[#b6860c] text-white"
                        : "bg-[#eadfd2]/30 text-slate-400",
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px]">{skill.icon}</span>
                  </div>
                  <span className="text-[14px] font-bold tracking-tight">{skill.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex flex-1 flex-col bg-white/40">
            <div className="absolute right-8 top-8 z-10">
              <button
                className="flex size-10 items-center justify-center rounded-full border border-[#eadfd2]/50 bg-white text-[#171412] shadow-sm transition-all duration-500 hover:bg-[#171412] hover:text-white"
                onClick={onClose}
                type="button"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="custom-scrollbar flex-1 overflow-y-auto p-12">
              <div className="mx-auto max-w-3xl animate-in slide-in-from-bottom-6 duration-700">
                <div className="mb-8 flex items-center gap-3">
                  <span className="rounded-full border border-emerald-100/50 bg-emerald-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-emerald-600">
                    Production Ready
                  </span>
                  <div className="h-1 w-1 rounded-full bg-[#eadfd2]" />
                  <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#b97a5f]/50">
                    {activeSkill.badge}
                  </span>
                </div>

                <h3 className="mb-6 text-4xl font-black leading-tight tracking-tighter text-[#171412]">
                  {activeSkill.label}
                </h3>
                <p className="mb-12 text-[17px] font-medium leading-relaxed text-slate-500">
                  {activeSkill.description}
                </p>

                <div className="mb-16 grid grid-cols-2 gap-5">
                  <div className="flex items-center gap-5 rounded-3xl border border-[#eadfd2]/30 bg-[#fbf7f2] p-6">
                    <div className="flex size-12 items-center justify-center rounded-2xl border border-[#eadfd2]/20 bg-white shadow-sm">
                      <span className="material-symbols-outlined text-[24px] text-[#b6860c]">
                        folder_special
                      </span>
                    </div>
                    <div>
                      <p className="mb-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#b97a5f]">
                        交付成果
                      </p>
                      <p className="text-[15px] font-black text-[#171412]">
                        {activeSkill.deliverableLabel || "正式报表"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-5 rounded-3xl border border-[#eadfd2]/30 bg-[#fbf7f2] p-6">
                    <div className="flex size-12 items-center justify-center rounded-2xl border border-[#eadfd2]/20 bg-white shadow-sm">
                      <span className="material-symbols-outlined text-[24px] text-[#d96e42]">
                        location_on
                      </span>
                    </div>
                    <div>
                      <p className="mb-0.5 text-[10px] font-black uppercase tracking-[0.2em] text-[#b97a5f]">
                        数据范围
                      </p>
                      <p className="text-[15px] font-black text-[#171412]">
                        {storeName} · {periodLabel}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-12">
                  <section>
                    <h4 className="mb-8 flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.3em] text-[#171412]/30">
                      <span className="h-px w-6 bg-[#eadfd2]" />
                      职责边界 / Scope
                    </h4>
                    <div className="space-y-4">
                      {(activeSkill.boundaries || []).map((boundary, index) => (
                        <div className="group flex items-start gap-4" key={index}>
                          <div className="mt-2 size-1.5 shrink-0 rounded-full bg-[#b6860c]/40 transition-colors group-hover:bg-[#b6860c]" />
                          <span className="text-[15px] font-semibold leading-relaxed text-slate-600">
                            {boundary}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section>
                    <h4 className="mb-8 flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.3em] text-[#171412]/30">
                      <span className="h-px w-6 bg-[#eadfd2]" />
                      输入要求 / Inputs
                    </h4>
                    <div className="flex flex-wrap gap-3">
                      {(activeSkill.requiredSourceGroups || []).map((group) => (
                        <div
                          className="flex items-center gap-2 rounded-2xl border border-[#eadfd2]/60 bg-white px-5 py-3 text-[13px] font-bold text-slate-600 shadow-sm transition-colors hover:border-[#b6860c]/40"
                          key={group.key}
                        >
                          <span className="material-symbols-outlined text-[16px] text-[#b97a5f]">
                            description
                          </span>
                          {group.label}
                        </div>
                      ))}
                    </div>
                  </section>

                  {activeSkill.suggestions && activeSkill.suggestions.length > 0 ? (
                    <section className="pb-16">
                      <h4 className="mb-8 flex items-center gap-3 text-[11px] font-black uppercase tracking-[0.3em] text-[#171412]/30">
                        <span className="h-px w-6 bg-[#eadfd2]" />
                        推荐指令 / Prompts
                      </h4>
                      <div className="grid gap-3">
                        {activeSkill.suggestions.map((suggestion) => (
                          <button
                            className="group w-full rounded-[24px] border border-[#eadfd2]/40 bg-[#fbf7f2]/50 p-5 text-left text-[14px] font-bold text-slate-700 transition-all hover:border-[#b6860c]/60 hover:bg-white hover:shadow-xl hover:shadow-[#b6860c]/5"
                            key={suggestion}
                            onClick={() => {
                              onSelect(activeSkill.id);
                              onClose();
                            }}
                            type="button"
                          >
                            <div className="flex items-center justify-between">
                              <span className="leading-relaxed transition-colors group-hover:text-[#171412]">
                                {suggestion}
                              </span>
                              <div className="flex size-8 items-center justify-center rounded-full text-[#eadfd2] transition-all group-hover:bg-[#b6860c]/5 group-hover:text-[#b6860c]">
                                <span className="material-symbols-outlined text-[20px]">
                                  arrow_forward
                                </span>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
