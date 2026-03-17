import { startTransition, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
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

const KNOWN_GARBLED_NOTE_REPLACEMENTS = [
  {
    match: "姝ｅ湪鏁寸悊璐㈠姟涓婁笅鏂囧苟杩炴帴鏅鸿氨",
    replacement: "正在整理财务上下文并连接智谱，稍后开始生成。",
  },
  {
    match: "宸叉彁浜ゆ櫤璋辨ā鍨嬶紝姝ｅ湪绛夊緟棣栦釜 token 杩斿洖",
    replacement: "已提交智谱模型，正在等待首个 token 返回...",
  },
];

function normalizeAgentNote(note) {
  const text = String(note || "").trim();

  if (!text) {
    return "";
  }

  const matched = KNOWN_GARBLED_NOTE_REPLACEMENTS.find((item) =>
    text.includes(item.match),
  );

  return matched ? matched.replacement : text;
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

const WORKSPACE_CONVERSATIONS_STORAGE_KEY = "kexi.workspace.conversations.v1";
const DRAFT_CONVERSATION_ID = "__draft__";
const MAX_SAVED_CONVERSATIONS = 24;

function getAgentById(agentId) {
  return AGENTS.find((agent) => agent.id === agentId) || AGENTS[0];
}

function buildIntroMeta(agentId) {
  const agent = getAgentById(agentId);

  return {
    badge: agent.badge,
    intro: true,
    mode: agent.id === "financial_analyst" ? "live-ready" : "placeholder",
    note:
      agent.id === "financial_analyst"
        ? "已接通财务数据；真实模型回答时会显示具体模型名。"
        : "当前是占位智能体。",
  };
}

function buildConversationIntroMessage(agentId) {
  const agent = getAgentById(agentId);

  return {
    id: `${agent.id}-intro-${new Date().getTime()}`,
    role: "assistant",
    content: agent.intro,
    meta: buildIntroMeta(agentId),
  };
}

function buildConversation(agentId, overrides = {}) {
  return {
    id: overrides.id || `conversation-${new Date().getTime()}`,
    agentId: overrides.agentId || agentId || "financial_analyst",
    title: overrides.title || "",
    createdAt: Number(overrides.createdAt || Date.now()),
    updatedAt: Number(overrides.updatedAt || Date.now()),
    pending: Boolean(overrides.pending),
    messages:
      Array.isArray(overrides.messages) && overrides.messages.length
        ? overrides.messages
        : [buildConversationIntroMessage(overrides.agentId || agentId)],
  };
}

function clampSavedConversations(conversations = []) {
  return [...conversations]
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .slice(0, MAX_SAVED_CONVERSATIONS);
}

function buildConversationTitle(message = "") {
  const text = String(message || "").replace(/\s+/g, " ").trim();

  if (!text) {
    return "新对话";
  }

  return text.length > 22 ? `${text.slice(0, 22)}…` : text;
}

function buildConversationPreview(conversation) {
  const lastMessage = [...(conversation?.messages || [])]
    .reverse()
    .find((item) => !item.meta?.intro && String(item.content || "").trim());

  if (!lastMessage) {
    return "新对话默认不继承之前上下文。";
  }

  return String(lastMessage.content || "").replace(/\s+/g, " ").trim();
}

function hasUserMessages(conversation) {
  return (conversation?.messages || []).some((item) => item.role === "user");
}

function formatConversationTime(value) {
  const timestamp = Number(value || 0);

  if (!timestamp) {
    return "";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "numeric",
  }).format(new Date(timestamp));
}

function loadStoredConversations() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(WORKSPACE_CONVERSATIONS_STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return clampSavedConversations(
      parsed.map((item) =>
        buildConversation(item.agentId || "financial_analyst", {
          ...item,
          messages: Array.isArray(item.messages)
            ? item.messages.map((message) => ({
                id: message.id || `message-${Date.now()}`,
                role: message.role || "assistant",
                content: message.content || "",
                meta: message.meta || {},
              }))
            : null,
          pending: false,
        }),
      ),
    );
  } catch {
    return [];
  }
}

function serializeConversation(conversation) {
  return {
    id: conversation.id,
    agentId: conversation.agentId,
    title: conversation.title || "",
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    pending: false,
    messages: (conversation.messages || []).map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      meta: message.meta || {},
    })),
  };
}

function ConversationHistoryItem({
  active = false,
  conversation,
  draft = false,
  onClick,
}) {
  const agent = getAgentById(conversation.agentId);
  const title = draft
    ? "新对话"
    : conversation.title || buildConversationTitle(buildConversationPreview(conversation));
  const preview = buildConversationPreview(conversation);

  return (
    <button
      className={cn(
        "w-full rounded-2xl border px-4 py-3 text-left transition-all",
        active
          ? "border-[#d96e42]/30 bg-[#fff5ee] shadow-sm"
          : "border-[#eadfd5] bg-white/85 hover:border-[#d96e42]/20 hover:bg-white",
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-full bg-[#fff1e7] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#b4542e]">
          {draft ? "Fresh" : agent.badge}
        </span>
        <span className="text-[11px] font-semibold text-slate-400">
          {draft ? "空白上下文" : formatConversationTime(conversation.updatedAt)}
        </span>
      </div>
      <p className="mt-3 line-clamp-2 text-sm font-semibold leading-6 text-[#171412]">
        {title}
      </p>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">
        {preview}
      </p>
    </button>
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

function buildConnectionError() {
  const apiBaseUrl = getApiBaseUrl();
  const localhostHint = apiBaseUrl.includes("localhost")
      ? " 如果你不是在部署机本地打开页面，请把系统设置里的服务地址改成部署机 IP 或域名。"
    : "";

  return new Error(
      `无法连接到智能体服务，请检查系统设置中的服务地址。当前地址：${apiBaseUrl}${localhostHint}`,
  );
}

function parseSseEventBlock(block) {
  const lines = String(block || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  let event = "message";
  const dataLines = [];

  lines.forEach((line) => {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim() || "message";
      return;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  });

  if (!dataLines.length) {
    return null;
  }

  const rawData = dataLines.join("\n");

  if (rawData === "[DONE]") {
    return { event, data: rawData };
  }

  try {
    return {
      event,
      data: JSON.parse(rawData),
    };
  } catch {
    return {
      event,
      data: rawData,
    };
  }
}

async function requestAgentStream(path, options, handlers = {}) {
  let response;

  try {
    response = await fetch(buildApiUrl(path), options);
  } catch {
    throw buildConnectionError();
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      payload.message ||
        `无法连接到智能体服务，请检查系统设置中的服务地址。当前地址：${getApiBaseUrl()}`,
    );
  }

  if (!response.body) {
    throw new Error("当前浏览器不支持流式响应。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");

      if (boundary === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseEventBlock(rawEvent);

      if (!parsed) {
        continue;
      }

      if (parsed.event === "meta") {
        handlers.onMeta?.(parsed.data);
        continue;
      }

      if (parsed.event === "delta") {
        handlers.onDelta?.(parsed.data);
        continue;
      }

      if (parsed.event === "done") {
        handlers.onDone?.(parsed.data);
        return;
      }

      if (parsed.event === "error") {
        throw new Error(parsed.data?.message || "流式回复失败。");
      }
    }
  }

  handlers.onDone?.(null);
}

function AgentMessage({ message, agent, currentModel = "", currentProvider = "" }) {
  const isUser = message.role === "user";
  const meta = message.meta || {};
  const normalizedNote = normalizeAgentNote(meta.note);
  const live =
    meta.mode === "llm" ||
    meta.mode === "live-ready" ||
    meta.mode === "live" ||
    meta.mode === "streaming";
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
              {meta.mode === "llm"
                ? "Live AI"
                : meta.mode === "streaming"
                  ? "Streaming"
                  : "Fallback"}
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
          ) : meta.mode === "streaming" && !String(message.content || "").trim() ? (
            <div className="text-[15px] leading-7 text-slate-400">正在生成...</div>
          ) : (
            <MarkdownMessage content={message.content} />
          )}
        </div>
        {!isUser && normalizedNote ? (
          <p className="max-w-[860px] text-xs leading-5 text-slate-400">
            {normalizedNote}
          </p>
        ) : null}
      </div>
    </div>
  );
}

const generateMessageId = () => new Date().getTime() + Math.random().toString(36).substring(2, 6);

export default function Workspace() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState(() => loadStoredConversations());
  const [draftConversation, setDraftConversation] = useState(() =>
    buildConversation("financial_analyst"),
  );
  const [activeConversationId, setActiveConversationId] = useState(DRAFT_CONVERSATION_ID);
  const [inputValue, setInputValue] = useState("");
  const [runtimeModel, setRuntimeModel] = useState("");
  const [runtimeProvider, setRuntimeProvider] = useState("");
  const scrollRef = useRef(null);

  const activeConversation =
    activeConversationId === DRAFT_CONVERSATION_ID
      ? draftConversation
      : conversations.find((item) => item.id === activeConversationId) || draftConversation;
  const activeAgent = getAgentById(activeConversation.agentId);
  const showWelcomeCard = !hasUserMessages(activeConversation);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      WORKSPACE_CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(conversations.map(serializeConversation)),
    );
  }, [conversations]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }

    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [
    activeConversationId,
    activeConversation.messages.length,
    activeConversation.pending,
    activeConversation.messages[activeConversation.messages.length - 1]?.content,
  ]);

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

  function upsertConversation(conversation) {
    setConversations((current) =>
      clampSavedConversations([
        conversation,
        ...current.filter((item) => item.id !== conversation.id),
      ]),
    );
  }

  function startFreshConversation(agentId = activeAgent.id) {
    setDraftConversation(buildConversation(agentId));
    setActiveConversationId(DRAFT_CONVERSATION_ID);
    setInputValue("");
  }

  function openConversation(conversationId) {
    setActiveConversationId(conversationId);
    setInputValue("");
  }

  function handleAgentChange(agentId) {
    if (activeConversationId === DRAFT_CONVERSATION_ID && !hasUserMessages(draftConversation)) {
      setDraftConversation(buildConversation(agentId));
      return;
    }

    if (agentId === activeAgent.id && activeConversationId !== DRAFT_CONVERSATION_ID) {
      return;
    }

    startFreshConversation(agentId);
  }

  async function sendMessage(prefill = "") {
    const message = String(prefill || inputValue).trim();

    if (!message || activeConversation.pending) {
      return;
    }

    const agentSnapshot = activeAgent;
    const conversationSnapshot = activeConversation;
    const conversationId =
      activeConversationId === DRAFT_CONVERSATION_ID
        ? `conversation-${generateMessageId()}`
        : conversationSnapshot.id;
    const timestampId = generateMessageId();
    const userMessage = {
      id: `${conversationId}-user-${timestampId}`,
      role: "user",
      content: message,
    };
    const assistantMessageId = `${conversationId}-assistant-${generateMessageId()}`;
    const historyPayload = conversationSnapshot.messages
      .filter((item) => !item.meta?.intro)
      .slice(-8)
      .map((item) => ({
        role: item.role,
        content: item.content,
      }));
    let streamedContent = "";
    let latestMeta = {
      badge: agentSnapshot.badge,
      mode: "streaming",
      model: "",
      provider: "",
      note: "AI 正在生成中...",
    };
    let flushTimer = null;
    const pendingConversation = {
      ...conversationSnapshot,
      id: conversationId,
      agentId: agentSnapshot.id,
      title: conversationSnapshot.title || buildConversationTitle(message),
      updatedAt: Date.now(),
      messages: [
        ...conversationSnapshot.messages,
        userMessage,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "",
          meta: latestMeta,
        },
      ],
      pending: true,
    };

    upsertConversation(pendingConversation);
    setActiveConversationId(conversationId);
    if (activeConversationId === DRAFT_CONVERSATION_ID) {
      setDraftConversation(buildConversation(agentSnapshot.id));
    }
    setInputValue("");

    const updateAssistantMessage = ({
      content = streamedContent,
      meta = latestMeta,
      pending = true,
    } = {}) => {
      startTransition(() => {
        setConversations((current) =>
          clampSavedConversations(
            current.map((item) =>
              item.id === conversationId
                ? {
                    ...item,
                    messages: item.messages.map((messageItem) =>
                      messageItem.id === assistantMessageId
                        ? {
                            ...messageItem,
                            content,
                            meta,
                          }
                        : messageItem,
                    ),
                    pending,
                    updatedAt: Date.now(),
                  }
                : item,
            ),
          ),
        );
      });
    };

    const scheduleAssistantFlush = () => {
      if (flushTimer) {
        return;
      }

      flushTimer = window.setTimeout(() => {
        flushTimer = null;
        updateAssistantMessage();
      }, 40);
    };

    try {
      await requestAgentStream(
        "/api/agents/chat/stream",
        {
          body: JSON.stringify({
            agentId: agentSnapshot.id,
            history: historyPayload,
            message,
          }),
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          method: "POST",
        },
        {
          onMeta: (payload) => {
            latestMeta = {
              badge: agentSnapshot.badge,
              mode: payload.agent?.mode || "streaming",
              model: payload.agent?.model || "",
              provider: payload.agent?.provider || "",
              note: normalizeAgentNote(payload.agent?.note),
            };

            if (payload.agent?.mode === "llm" && payload.agent?.provider === "zhipu") {
              setRuntimeProvider("zhipu");
              setRuntimeModel(payload.agent?.model || runtimeModel);
            }

            updateAssistantMessage();
          },
          onDelta: (payload) => {
            streamedContent += payload.delta || "";
            scheduleAssistantFlush();
          },
          onDone: (payload) => {
            if (flushTimer) {
              window.clearTimeout(flushTimer);
              flushTimer = null;
            }

            if (payload?.agent) {
              latestMeta = {
                badge: agentSnapshot.badge,
                mode: payload.agent.mode || "fallback",
                model: payload.agent.model || "",
                provider: payload.agent.provider || "",
                note: normalizeAgentNote(payload.agent.note),
              };
            } else {
              latestMeta = {
                ...latestMeta,
                badge: agentSnapshot.badge,
                mode: latestMeta.mode === "streaming" ? "fallback" : latestMeta.mode,
              };
            }

            if (payload?.reply) {
              streamedContent = payload.reply;
            }

            if (latestMeta.mode === "llm" && latestMeta.provider === "zhipu") {
              setRuntimeProvider("zhipu");
              setRuntimeModel(latestMeta.model || runtimeModel);
            }

            updateAssistantMessage({
              content:
                streamedContent ||
                latestMeta.note ||
                "AI 暂时没有返回正文，请重试；如果持续出现，请检查后端服务和模型配置。",
              meta: latestMeta,
              pending: false,
            });
          },
        },
      );
    } catch (error) {
      if (flushTimer) {
        window.clearTimeout(flushTimer);
      }

      updateAssistantMessage({
        content: error.message,
        meta: {
          badge: agentSnapshot.badge,
          mode: "fallback",
          note: "当前没有成功连接到后端服务。",
        },
        pending: false,
      });
    }
  }

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#fbf7f2] font-sans text-slate-900">
      {/* 恢复主侧边栏 */}
      <Sidebar1 />
      
      <main className="flex-1 flex overflow-hidden relative bg-transparent">
        {/* Gemini风格的隐藏历史栏 */}
        <aside className={cn("flex flex-col bg-[#f8f1ea]/88 backdrop-blur-md transition-all duration-300 h-full shrink-0 border-r border-[#eadfd5]", isSidebarOpen ? "w-[280px]" : "w-[68px]")}>
          <div className="p-3 pt-4">
            <button
              className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-white/60 text-slate-600 transition"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            >
              <span className="material-symbols-outlined text-[24px]">menu</span>
            </button>
          </div>
          
          <div className="px-3 pb-4 pt-2">
            <button
              className={cn(
                "flex items-center gap-2 bg-[#d96e42] hover:bg-[#c25c34] shadow-sm rounded-full text-xs font-medium transition-all text-white",
                isSidebarOpen ? "px-3.5 py-2 w-[fit-content]" : "w-8 h-8 justify-center p-0"
              )}
              onClick={() => startFreshConversation(activeAgent.id)}
            >
              <span className="material-symbols-outlined text-[18px]">add</span>
              {isSidebarOpen && <span>发起新对话</span>}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col px-3">
            {isSidebarOpen && (
               <div className="mt-2">
                 <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">历史会话</div>
                 <div className="flex flex-col gap-0.5">
                   {conversations.slice(0, 20).map(conv => (
                     <button key={conv.id} onClick={() => openConversation(conv.id)} className={cn("flex items-center gap-3 px-3 py-2 rounded-2xl hover:bg-white text-sm text-left truncate transition-colors", conv.id === activeConversationId ? "bg-[#fff5ee] text-[#b4542e] shadow-sm" : "text-slate-600")}>
                        <span className="material-symbols-outlined text-[16px] shrink-0">chat_bubble</span>
                        <span className="truncate">{conv.title || buildConversationTitle(buildConversationPreview(conv))}</span>
                     </button>
                   ))}
                   {conversations.length === 0 && (
                     <div className="px-3 py-4 text-xs text-slate-500 leading-5">
                        还没有历史会话。发出第一条消息后，它会显示在这里。
                     </div>
                   )}
                 </div>
               </div>
            )}
          </div>
        </aside>

        {/* 聊天主内容区 */}
        <section className="flex-1 flex flex-col relative min-w-0">

          {/* 智能体选择 */}
          <div className="w-full flex justify-center pt-6 pb-2 px-8 z-10 pointer-events-auto">
            <div className="flex items-center justify-start sm:justify-center gap-3 overflow-x-auto scrollbar-hide w-full max-w-4xl px-2">
              {AGENTS.map((agent) => {
                const active = agent.id === activeAgent.id;

                return (
                  <button
                    key={agent.id}
                    className={cn(
                      "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-5 py-2.5 transition-all shadow-sm",
                      active
                        ? "border-[#b6860c]/40 bg-white"
                        : "border-[#eadfd5] bg-white/85 hover:border-[#b6860c]/20"
                    )}
                    onClick={() => handleAgentChange(agent.id)}
                    type="button"
                  >
                    <div
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full",
                        active
                          ? "bg-[#b6860c]/12 text-[#b6860c]"
                          : "bg-[#f2ece4] text-slate-500"
                      )}
                    >
                      <span className="material-symbols-outlined text-[18px]">
                        {agent.icon}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "text-sm font-medium",
                        active ? "text-[#171412]" : "text-slate-600"
                      )}
                    >
                      {agent.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Header (Top right) */}
          <header className="absolute top-0 w-full p-4 flex justify-between items-center pointer-events-none z-10">
            <div className="flex items-center pointer-events-auto">
              <span className="text-xl font-bold text-[#171412] pl-2">珂溪智能</span>
            </div>
            <div className="flex items-center gap-4 pointer-events-auto pr-2">
              <div className="bg-white/80 border border-[#b6860c]/20 text-[#b6860c] text-xs font-bold uppercase tracking-widest px-3 py-1.5 rounded-full flex items-center gap-1 cursor-pointer hover:bg-white transition shadow-sm">
                PRO
              </div>
              <div className="w-9 h-9 rounded-full bg-[#b6860c] text-white flex items-center justify-center font-bold text-lg cursor-pointer shadow-sm">
                X
              </div>
            </div>
          </header>

          {showWelcomeCard ? (
            <div className="flex-1 flex flex-col min-h-0 items-center justify-center px-4 overflow-y-auto">
               <div className="w-full max-w-[830px] pt-[8vh] pb-[4vh]">
                  <div className="mb-10 pl-2 text-center">
                     <h1 className="text-[42px] sm:text-[52px] font-extrabold leading-tight tracking-tight mb-2" style={{ background: 'linear-gradient(74deg, #b6860c 0, #d96e42 40%, #171412 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                       ✨ Xingz，你好
                     </h1>
                     <h2 className="text-[42px] sm:text-[52px] font-bold leading-tight tracking-tight text-slate-300">
                       今天需要分析些什么？
                     </h2>
                     <p className="mt-4 text-sm text-slate-500 max-w-2xl mx-auto">{activeAgent.intro}</p>
                  </div>

                  <div className="relative w-full border border-[#d96e42]/15 shadow-sm bg-white/90 hover:bg-white transition-colors rounded-[24px] p-2 flex flex-col group focus-within:bg-white focus-within:border-[#d96e42]/30 focus-within:shadow-md">
                     <div className="flex items-start px-2 pt-2 pb-1">
                        <button className="p-3 text-slate-500 hover:bg-[#fff7f0] rounded-full mt-1 shrink-0 transition" onClick={() => startFreshConversation(activeAgent.id)}>
                           <span className="material-symbols-outlined text-[24px]">add</span>
                        </button>
                        <textarea
                          className="flex-1 min-h-[56px] max-h-[200px] bg-transparent resize-none outline-none text-slate-900 text-[15px] p-3 placeholder:text-slate-400 pt-4"
                          placeholder="给珂溪智能发送消息..."
                          value={inputValue}
                          onChange={(e) => setInputValue(e.target.value)}
                          onKeyDown={handleKeyDown}
                        />
                     </div>
                     <div className="flex items-center justify-between px-4 pb-2">
                        <button className="flex items-center gap-2 text-sm text-slate-500 hover:bg-[#fff7f0] px-3 py-2 rounded-full font-medium transition">
                           <span className="material-symbols-outlined text-[20px]">build</span>
                           工具
                        </button>
                        <div className="flex items-center gap-2">
                           <button className="flex items-center gap-1 text-sm text-slate-500 hover:bg-[#fff7f0] px-3 py-2 rounded-full font-medium transition">
                              Pro
                              <span className="material-symbols-outlined text-[18px]">expand_more</span>
                           </button>
                           <button className="p-2 text-slate-500 hover:bg-[#fff7f0] rounded-full transition">
                              <span className="material-symbols-outlined text-[24px]">mic</span>
                           </button>
                           {inputValue.trim() && (
                              <button
                                className="p-2 text-white bg-[#b6860c] hover:bg-[#a3780a] shadow-md shadow-[#b6860c]/20 rounded-full transition ml-1"
                                onClick={() => sendMessage()}
                              >
                                 <span className="material-symbols-outlined text-[24px]">send</span>
                              </button>
                           )}
                        </div>
                     </div>
                  </div>

                  
                  <div className="flex flex-wrap justify-center gap-3 mt-8 max-w-2xl mx-auto">
                     {activeAgent.suggestions.map((suggestion) => (
                       <button key={suggestion} onClick={() => sendMessage(suggestion)} className="bg-[#fff7f0] border border-[#d96e42]/15 hover:border-[#d96e42]/30 hover:bg-[#fff2e8] text-[#b4542e] text-[13px] font-semibold px-4 py-2.5 rounded-full shadow-sm transition flex items-center gap-2">
                          <span className="material-symbols-outlined text-[16px]">chat_bubble</span> {suggestion}
                       </button>
                     ))}
                  </div>
               </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-h-0 pt-16">
               <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 pb-6 custom-scrollbar">
                  <div className="flex flex-col gap-6 max-w-[830px] mx-auto w-full">
                    {activeConversation.messages.map((message) => (
                      <AgentMessage
                        key={message.id}
                        agent={activeAgent}
                        currentModel={runtimeModel}
                        currentProvider={runtimeProvider}
                        message={message}
                      />
                    ))}
                  </div>
               </div>
               
               <div className="w-full pb-6 px-4 bg-gradient-to-t from-[#fbf7f2] via-[#fbf7f2]/95 to-transparent pt-4">
                  <div className="max-w-[830px] mx-auto">
                    <div className="relative w-full border border-[#d96e42]/15 shadow-sm bg-white/90 hover:bg-white transition-colors rounded-[24px] p-2 flex flex-col group focus-within:bg-white focus-within:border-[#d96e42]/30 focus-within:shadow-md">
                       <div className="flex items-start px-2 pt-2 pb-1">
                          <button className="p-3 text-slate-500 hover:bg-[#fff7f0] rounded-full mt-1 shrink-0 transition" onClick={() => startFreshConversation(activeAgent.id)}>
                             <span className="material-symbols-outlined text-[24px]">add</span>
                          </button>
                          <textarea
                            className="flex-1 min-h-[56px] max-h-[200px] bg-transparent resize-none outline-none text-slate-900 text-[15px] p-3 placeholder:text-slate-400 pt-4"
                            placeholder="给珂溪智能发送消息..."
                            value={inputValue}
                            onChange={(e) => setInputValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                          />
                          <div className="flex items-center gap-1 self-end mb-2 mr-2">
                             {!inputValue.trim() ? (
                               <button className="p-2 text-slate-500 hover:bg-[#fff7f0] rounded-full transition">
                                  <span className="material-symbols-outlined text-[24px]">mic</span>
                               </button>
                             ) : (
                               <button
                                 className="p-2 text-slate-500 hover:bg-[#fff7f0] rounded-full transition"
                                 onClick={() => sendMessage()}
                               >
                                 <span className="material-symbols-outlined text-[24px] text-[#b6860c]">send</span>
                               </button>
                             )}
                          </div>
                       </div>
                    </div>
                    <p className="text-center text-[11px] font-medium text-slate-400 mt-3 tracking-wide">珂溪智能助理已接通财务数据；当前消息只会携带本会话历史。</p>
                  </div>
               </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
