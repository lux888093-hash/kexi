import { useEffect, useRef, useState } from "react";
import Sidebar1 from "../components/Sidebar1";
import { buildApiUrl, getApiBaseUrl } from "../lib/runtimeConfig";

const AGENTS = [
  {
    id: "default",
    icon: "robot_2",
    label: "默认智能体",
    badge: "Kexi AI",
    placeholder: "给珂溪 AI 发送消息...",
    intro:
      "首页现在已经支持真实智能体对话。当前最先打通的是财务分析师，你可以直接切换过去问门店利润、成本和整改优先级。",
    suggestions: ["切到财务分析师", "财务页现在接的是实时分析吗？"],
  },
  {
    id: "scalp_expert",
    icon: "psychology",
    label: "头疗专家",
    badge: "头疗专家",
    placeholder: "问头疗专家一个问题...",
    intro:
      "头疗专家的首页问答还没接专属知识库。当前已经打通真实数据的是财务分析师。",
    suggestions: ["财务分析师能回答什么？", "切到财务分析师"],
  },
  {
    id: "financial_analyst",
    icon: "payments",
    label: "财务分析师",
    badge: "财务分析师",
    placeholder: "直接问门店利润、成本、渠道和整改动作...",
    intro:
      "财务分析师已经接通财务月报和门店对比；如果系统已配置智谱 Key，会直接走实时模型问答。你可以直接问：为什么万象城店利润低？哪家店最该优先整改？",
    suggestions: [
      "请分析万象城一月数据",
      "为什么万象城店利润低？",
      "哪家店最值得优先整改？",
      "未来30天先抓哪三件事？",
    ],
  },
  {
    id: "scheduling",
    icon: "calendar_month",
    label: "排班管家",
    badge: "排班管家",
    placeholder: "问排班和预约问题...",
    intro:
      "排班管家首页问答还没接入真实排班数据。等排班模块打通后，这里会直接回答时段和空位问题。",
    suggestions: ["排班模块还差什么数据？"],
  },
  {
    id: "customer_service",
    icon: "support_agent",
    label: "客服助手",
    badge: "客服助手",
    placeholder: "问客服流程或客户沟通问题...",
    intro:
      "客服助手当前还是占位状态。现在已经真正接通数据和模型能力的是财务分析师。",
    suggestions: ["切到财务分析师"],
  },
];

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

function renderInlineMarkdown(text) {
  const source = String(text || "");
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  const parts = source.split(pattern).filter(Boolean);

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${part}-${index}`} className="font-bold text-[#171412]">
          {part.slice(2, -2)}
        </strong>
      );
    }

    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={`${part}-${index}`}
          className="rounded-md bg-[#f7efe7] px-1.5 py-0.5 font-mono text-[0.92em] text-[#8f5138]"
        >
          {part.slice(1, -1)}
        </code>
      );
    }

    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);

    if (linkMatch) {
      return (
        <a
          key={`${part}-${index}`}
          className="font-semibold text-[#b4542e] underline decoration-[#d96e42]/30 underline-offset-4"
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

function MarkdownMessage({ content }) {
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
      blocks.push({
        type: "heading",
        depth: headingMatch[1].length,
        text: headingMatch[2],
      });
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
              ? "text-xl font-extrabold tracking-[-0.04em] text-[#171412]"
              : block.depth === 2
                ? "text-sm font-bold uppercase tracking-[0.24em] text-[#d96e42]"
                : "text-sm font-bold text-[#171412]";

          return (
            <h3 className={headingClass} key={`block-${blockIndex}`}>
              {renderInlineMarkdown(block.text)}
            </h3>
          );
        }

        if (block.type === "ul") {
          return (
            <ul
              className="list-disc space-y-2 pl-5 text-[15px] leading-7 marker:text-[#d96e42]"
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
              className="list-decimal space-y-2 pl-5 text-[15px] leading-7 marker:font-bold marker:text-[#b4542e]"
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
              className="rounded-2xl border-l-4 border-[#d96e42]/35 bg-[#fcf5ef] px-4 py-3 text-[14px] leading-7 text-slate-600"
              key={`block-${blockIndex}`}
            >
              {renderInlineMarkdown(block.text)}
            </blockquote>
          );
        }

        return (
          <p
            className="text-[15px] leading-7 text-slate-700"
            key={`block-${blockIndex}`}
          >
            {renderInlineMarkdown(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function buildInitialThreads() {
  return Object.fromEntries(
    AGENTS.map((agent) => [
      agent.id,
      {
        messages: [
          {
            id: `${agent.id}-intro`,
            role: "assistant",
            content: agent.intro,
            meta: {
              badge: agent.badge,
              mode: agent.id === "financial_analyst" ? "live-ready" : "placeholder",
              note:
                agent.id === "financial_analyst"
                  ? "已接通财务数据；真实模型回答时会显示具体模型名。"
                  : "当前是占位智能体。",
            },
          },
        ],
        pending: false,
      },
    ]),
  );
}

async function requestJson(path, options) {
  let response;

  try {
    response = await fetch(buildApiUrl(path), options);
  } catch {
    const apiBaseUrl = getApiBaseUrl();
    const localhostHint = apiBaseUrl.includes("localhost")
      ? " 如果你不是在部署机本地打开页面，请把系统设置里的服务地址改成部署机 IP 或域名。"
      : "";
    throw new Error(
      `无法连接到智能体服务，请检查系统设置中的服务地址。当前地址：${apiBaseUrl}${localhostHint}`,
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      payload.message ||
        `无法连接到智能体服务，请检查系统设置中的服务地址。当前地址：${getApiBaseUrl()}`,
    );
  }

  return payload;
}

function AgentMessage({ message, agent, currentModel = "", currentProvider = "" }) {
  const isUser = message.role === "user";
  const meta = message.meta || {};
  const live =
    meta.mode === "llm" || meta.mode === "live-ready" || meta.mode === "live";
  const providerLabel =
    meta.provider === "zhipu" ? "智谱" : meta.provider || currentProvider || "Model";
  const currentModelHint =
    !isUser &&
    currentModel &&
    meta.model &&
    meta.model !== currentModel &&
    meta.mode === "llm"
      ? ` · 当前配置 ${currentModel}`
      : "";

  return (
    <div
      className={cn(
        "flex gap-4 max-w-4xl mx-auto w-full",
        isUser ? "flex-row-reverse" : "",
      )}
    >
      <div
        className={cn(
          "size-10 rounded-xl flex items-center justify-center shrink-0",
          isUser
            ? "bg-slate-200 text-slate-600"
            : "bg-primary/20 text-primary",
        )}
      >
        <span className="material-symbols-outlined">
          {isUser ? "person" : agent.icon}
        </span>
      </div>
      <div
        className={cn(
          "flex flex-col gap-1.5 pt-2",
          isUser ? "items-end" : "items-start",
        )}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "text-xs font-bold uppercase tracking-widest",
              isUser ? "text-slate-400" : "text-primary/70",
            )}
          >
            {isUser ? "你" : `珂溪 AI · ${meta.badge || agent.badge}`}
          </span>
          {!isUser && meta.mode ? (
            <span
              className={cn(
                "rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
                live
                  ? "bg-[#fff3ec] text-[#b4542e]"
                  : "bg-[#f4eee6] text-[#6b5a4d]",
              )}
            >
              {meta.mode === "llm" ? "Live AI" : "Fallback"}
            </span>
          ) : null}
          {!isUser && meta.model ? (
            <span className="rounded-full border border-primary/10 bg-white px-2 py-1 text-[10px] font-semibold text-slate-500">
              {`本条回复 · ${providerLabel} / ${meta.model}${currentModelHint}`}
            </span>
          ) : null}
        </div>
        <div
          className={cn(
            "max-w-[860px] rounded-2xl p-6 shadow-sm border leading-relaxed",
            isUser
              ? "bg-primary text-white rounded-tr-none border-primary/10 shadow-md"
              : "bg-white rounded-tl-none border-primary/5 text-slate-800",
          )}
        >
          {isUser ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : (
            <MarkdownMessage content={message.content} />
          )}
        </div>
        {!isUser && meta.note ? (
          <p className="max-w-[860px] text-xs leading-5 text-slate-400">
            {meta.note}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const generateMessageId = () => new Date().getTime() + Math.random().toString(36).substring(2, 6);

export default function Workspace() {
  const [activeAgentId, setActiveAgentId] = useState("financial_analyst");
  const [threads, setThreads] = useState(() => buildInitialThreads());
  const [inputValue, setInputValue] = useState("");
  const [runtimeModel, setRuntimeModel] = useState("");
  const [runtimeProvider, setRuntimeProvider] = useState("");
  const scrollRef = useRef(null);

  const activeAgent =
    AGENTS.find((agent) => agent.id === activeAgentId) || AGENTS[0];
  const activeThread = threads[activeAgentId] || {
    messages: [],
    pending: false,
  };

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeAgentId, activeThread.messages.length, activeThread.pending]);

  useEffect(() => {
    let cancelled = false;

    async function loadRuntimeSettings() {
      try {
        const settings = await requestJson("/api/system/settings");

        if (cancelled) {
          return;
        }

        setRuntimeProvider(settings.llmProvider || "");
        setRuntimeModel(settings.zhipuModel || "");
      } catch {
        if (cancelled) {
          return;
        }

        setRuntimeProvider("");
        setRuntimeModel("");
      }
    }

    void loadRuntimeSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  async function sendMessage(prefill = "") {
    const message = String(prefill || inputValue).trim();

    if (!message || activeThread.pending) {
      return;
    }

    const timestampId = generateMessageId();

    const userMessage = {
      id: `${activeAgentId}-user-${timestampId}`,
      role: "user",
      content: message,
    };

    const nextMessages = [...activeThread.messages, userMessage];

    setThreads((current) => ({
      ...current,
      [activeAgentId]: {
        ...current[activeAgentId],
        messages: nextMessages,
        pending: true,
      },
    }));
    setInputValue("");

    try {
      const result = await requestJson("/api/agents/chat", {
        body: JSON.stringify({
          agentId: activeAgentId,
          history: nextMessages.slice(-8).map((item) => ({
            role: item.role,
            content: item.content,
          })),
          message,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const assistantMessage = {
        id: `${activeAgentId}-assistant-${generateMessageId()}`,
        role: "assistant",
        content: result.reply || "当前没有返回可展示的内容。",
        meta: {
          badge: activeAgent.badge,
          mode: result.agent?.mode || "fallback",
          model: result.agent?.model || "",
          provider: result.agent?.provider || "",
          note: result.agent?.note || "",
        },
      };

      if (result.agent?.mode === "llm" && result.agent?.provider === "zhipu") {
        setRuntimeProvider("zhipu");
        setRuntimeModel(result.agent?.model || runtimeModel);
      }

      setThreads((current) => ({
        ...current,
        [activeAgentId]: {
          ...current[activeAgentId],
          messages: [...current[activeAgentId].messages, assistantMessage],
          pending: false,
        },
      }));
    } catch (error) {
      const assistantMessage = {
        id: `${activeAgentId}-assistant-error-${generateMessageId()}`,
        role: "assistant",
        content: error.message,
        meta: {
          badge: activeAgent.badge,
          mode: "fallback",
          note: "当前没有成功连接到后端服务。",
        },
      };

      setThreads((current) => ({
        ...current,
        [activeAgentId]: {
          ...current[activeAgentId],
          messages: [...current[activeAgentId].messages, assistantMessage],
          pending: false,
        },
      }));
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background-light dark:bg-background-dark">
      <Sidebar1 />
      <main className="relative flex flex-1 flex-col overflow-hidden bg-background-light dark:bg-background-dark">
        <header className="flex items-center justify-between border-b border-primary/5 bg-background-light/80 px-8 py-4 backdrop-blur-md dark:bg-background-dark/80">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-400">首页</span>
            <span className="material-symbols-outlined text-xs text-slate-300">
              chevron_right
            </span>
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              智能体工作台
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div className="rounded-full border border-primary/10 bg-white/70 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              {activeAgent.badge}
            </div>
            {activeAgentId === "financial_analyst" && runtimeModel ? (
              <div className="rounded-full border border-[#d96e42]/15 bg-[#fff7f0] px-3 py-1 text-xs font-semibold text-[#b4542e]">
                {`当前配置：${runtimeProvider === "zhipu" ? "智谱" : runtimeProvider || "Model"} / ${runtimeModel}`}
              </div>
            ) : null}
          </div>
        </header>

        <div className="px-8 pt-6 w-full flex justify-center">
          <div className="flex items-center justify-start sm:justify-center gap-3 overflow-x-auto pb-2 scrollbar-hide w-full max-w-4xl px-2">
            {AGENTS.map((agent) => {
              const active = agent.id === activeAgentId;

              return (
                <button
                  key={agent.id}
                  className={cn(
                    "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-5 py-2.5 transition-all",
                    active
                      ? "border-primary bg-white shadow-sm"
                      : "border-slate-200 bg-white hover:border-primary/40",
                  )}
                  onClick={() => setActiveAgentId(agent.id)}
                  type="button"
                >
                  <div
                    className={cn(
                      "flex size-6 items-center justify-center rounded-full",
                      active
                        ? "bg-primary/20 text-primary"
                        : "bg-slate-100 text-slate-500",
                    )}
                  >
                    <span className="material-symbols-outlined text-[18px]">
                      {agent.icon}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-medium",
                      active ? "text-slate-900" : "text-slate-600",
                    )}
                  >
                    {agent.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-4 pt-4 lg:px-40">
          <div className="mx-auto max-w-4xl rounded-[28px] border border-primary/10 bg-white/80 px-5 py-4 shadow-sm">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#d96e42]">
              {activeAgent.badge}
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {activeAgent.intro}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {activeAgent.suggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  className="rounded-full border border-primary/10 bg-[#fff7f0] px-3 py-2 text-xs font-semibold text-[#b4542e] transition hover:border-primary/30 hover:bg-[#fff2e8]"
                  onClick={() => sendMessage(suggestion)}
                  type="button"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="custom-scrollbar flex-1 overflow-y-auto px-4 py-8 lg:px-40"
        >
          <div className="flex flex-col gap-8">
            {activeThread.messages.map((message) => (
              <AgentMessage
                key={message.id}
                agent={activeAgent}
                currentModel={runtimeModel}
                currentProvider={runtimeProvider}
                message={message}
              />
            ))}
            {activeThread.pending ? (
              <div className="mx-auto flex max-w-4xl w-full gap-4">
                <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
                  <span className="material-symbols-outlined">
                    {activeAgent.icon}
                  </span>
                </div>
                <div className="rounded-2xl rounded-tl-none border border-primary/5 bg-white px-5 py-4 text-sm text-slate-500 shadow-sm">
                  正在分析当前问题...
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="bg-gradient-to-t from-background-light via-background-light/95 to-transparent px-4 pb-8 pt-4 lg:px-40 dark:from-background-dark dark:via-background-dark/95">
          <div className="group relative mx-auto max-w-4xl">
            <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-primary/30 to-primary/10 opacity-25 blur transition duration-1000 group-focus-within:opacity-50 group-focus-within:duration-200" />
            <div className="relative flex items-end rounded-2xl border border-primary/10 bg-white px-4 py-3 shadow-xl">
              <button
                className="p-2 text-slate-400 transition-colors hover:text-primary"
                type="button"
              >
                <span className="material-symbols-outlined">add_circle</span>
              </button>
              <textarea
                className="max-h-36 min-h-[48px] flex-1 resize-none bg-transparent px-4 py-2 text-slate-900 outline-none placeholder:text-slate-400"
                onChange={(event) => setInputValue(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={activeAgent.placeholder}
                value={inputValue}
              />
              <div className="flex items-center gap-2">
                <button
                  className="flex items-center justify-center rounded-xl bg-primary p-3 text-white shadow-lg shadow-primary/30 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={activeThread.pending || !inputValue.trim()}
                  onClick={() => sendMessage()}
                  type="button"
                >
                  <span className="material-symbols-outlined">send</span>
                </button>
              </div>
            </div>
            <p className="mt-3 text-center text-[10px] font-bold uppercase tracking-widest text-slate-400">
              财务分析师已接通财务数据；命中实时模型时会展示具体模型名，其他智能体仍在逐步打通专属数据链路。
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
