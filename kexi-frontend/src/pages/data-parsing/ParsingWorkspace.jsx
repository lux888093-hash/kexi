import { useEffect, useRef, useState } from "react";
import Sidebar1 from "../../components/Sidebar1";
import PhysicalTablePanel from "../../components/PhysicalTablePanel";
import { buildApiUrl } from "../../lib/runtimeConfig";
import {
  getFallbackParsingSkillCatalog,
  getParsingSkillById,
  getParsingSkillClientConfig,
} from "../../lib/parsingSkills";
import { FileChip, MarkdownMessage, SkillCatalogModal, ThoughtProcess } from "./ParsingUi";
import {
  DRAFT_CONVERSATION_ID,
  MONTHS,
  PARSING_CONVERSATIONS_STORAGE_KEY,
  STORE_MAP,
  STORES,
  buildBatchSummary,
  buildConversationTitle,
  buildConversationTitleFromInput,
  buildMatchedGroupKeys,
  buildMissingSourceGroups,
  buildParsingConversation,
  buildReportSummary,
  clampSavedConversations,
  cn,
  exportParsingDraft,
  generateConversationId,
  getPeriodId,
  hasConversationMessages,
  loadStoredParsingConversations,
  mergeFilesByName,
  normalizeParsedFile,
  normalizeParsingContext,
  normalizeReviewFile,
  requestParsingSkills,
  resolveDownloadUrl,
  serializeParsingConversation,
  uploadSourceFiles,
} from "./parsingUtils";

export default function ParsingWorkspace() {
  const fallbackCatalog = getFallbackParsingSkillCatalog();
  const [skillCatalog, setSkillCatalog] = useState(() => fallbackCatalog);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState(() =>
    loadStoredParsingConversations(fallbackCatalog),
  );
  const [draftConversation, setDraftConversation] = useState(() =>
    buildParsingConversation(fallbackCatalog, {
      activeSkillId: fallbackCatalog.defaultSkillId,
      selectedStore: STORES[0],
      selectedMonth: MONTHS[0],
    }),
  );
  const [activeConversationId, setActiveConversationId] = useState(DRAFT_CONVERSATION_ID);
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isSkillModalOpen, setIsSkillModalOpen] = useState(false);
  const [isSkillSelectorOpen, setIsSkillSelectorOpen] = useState(false);
  const [inputText, setInputText] = useState("");
  const fileInputRef = useRef(null);
  const scrollRef = useRef(null);
  const skillSelectorRef = useRef(null);

  const activeConversation =
    activeConversationId === DRAFT_CONVERSATION_ID
      ? draftConversation
      : conversations.find((item) => item.id === activeConversationId) || draftConversation;
  const activeSkill = getParsingSkillById(skillCatalog.skills, activeConversation.activeSkillId);
  const activeSkillClient = getParsingSkillClientConfig(activeSkill.id);
  const activePreviewPanel = activeSkill.previewPanel || activeSkillClient.previewPanel || "";
  const acceptedFileTypes =
    Array.isArray(activeSkill.acceptedFileTypes) && activeSkill.acceptedFileTypes.length
      ? activeSkill.acceptedFileTypes.join(",")
      : ".xls,.xlsx,.csv,.pdf,.doc,.docx";
  const lastMessage = activeConversation.messages[activeConversation.messages.length - 1];

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
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      PARSING_CONVERSATIONS_STORAGE_KEY,
      JSON.stringify(conversations.map(serializeParsingConversation)),
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
    lastMessage?.text,
    lastMessage?.status,
  ]);

  useEffect(() => {
    let cancelled = false;

    requestParsingSkills()
      .then((catalog) => {
        if (cancelled) {
          return;
        }

        setSkillCatalog(catalog);
        setConversations((current) =>
          clampSavedConversations(
            current.map((conversation) => buildParsingConversation(catalog, conversation)),
          ),
        );
        setDraftConversation((current) => buildParsingConversation(catalog, current));
      })
      .catch(() => null);

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

  function updatePersistedConversation(conversationId, updater) {
    setConversations((current) => {
      const targetConversation = current.find((item) => item.id === conversationId);
      if (!targetConversation) {
        return current;
      }

      const nextConversation = updater(targetConversation);
      return clampSavedConversations([
        nextConversation,
        ...current.filter((item) => item.id !== conversationId),
      ]);
    });
  }

  function buildFreshDraft(overrides = {}) {
    return buildParsingConversation(skillCatalog, {
      selectedStore: overrides.selectedStore || activeConversation.selectedStore,
      selectedMonth: overrides.selectedMonth || activeConversation.selectedMonth,
      activeSkillId: overrides.activeSkillId || activeConversation.activeSkillId,
    });
  }

  function startFreshConversation(overrides = {}) {
    setDraftConversation(buildFreshDraft(overrides));
    setActiveConversationId(DRAFT_CONVERSATION_ID);
    setInputText("");
    setIsPanelOpen(false);
    setIsSkillSelectorOpen(false);
  }

  function openConversation(conversationId) {
    setActiveConversationId(conversationId);
    setInputText("");
    setIsPanelOpen(false);
    setIsSkillSelectorOpen(false);
  }

  function resetConversationContext(overrides = {}) {
    const nextContext = {
      selectedStore: overrides.selectedStore || activeConversation.selectedStore,
      selectedMonth: overrides.selectedMonth || activeConversation.selectedMonth,
      activeSkillId: overrides.activeSkillId || activeConversation.activeSkillId,
    };

    if (
      activeConversationId === DRAFT_CONVERSATION_ID &&
      !hasConversationMessages(draftConversation)
    ) {
      setDraftConversation(buildParsingConversation(skillCatalog, nextContext));
      return;
    }

    startFreshConversation(nextContext);
  }

  function handleSkillSelect(skillId) {
    setIsSkillSelectorOpen(false);
    if (skillId === activeConversation.activeSkillId) {
      return;
    }
    resetConversationContext({ activeSkillId: skillId });
  }

  async function handleSendMessage() {
    if (!inputText.trim() || activeConversation.pending) {
      return;
    }

    const currentInput = inputText.trim();
    const conversationSnapshot = activeConversation;
    const conversationId =
      activeConversationId === DRAFT_CONVERSATION_ID
        ? generateConversationId("parsing-conversation")
        : conversationSnapshot.id;
    const messageId = generateConversationId("message");
    const assistantMessageId = `${messageId}-assistant`;
    const pendingConversation = {
      ...conversationSnapshot,
      id: conversationId,
      title: conversationSnapshot.title || buildConversationTitleFromInput({ text: currentInput }),
      updatedAt: Date.now(),
      pending: true,
      messages: [
        ...conversationSnapshot.messages,
        { id: `${messageId}-user`, sender: "user", text: currentInput },
        { id: assistantMessageId, sender: "ai", text: "", loading: true, status: "思考中..." },
      ],
    };

    upsertConversation(pendingConversation);
    setActiveConversationId(conversationId);
    setInputText("");

    if (activeConversationId === DRAFT_CONVERSATION_ID) {
      setDraftConversation(
        buildParsingConversation(skillCatalog, {
          selectedStore: conversationSnapshot.selectedStore,
          selectedMonth: conversationSnapshot.selectedMonth,
          activeSkillId: conversationSnapshot.activeSkillId,
        }),
      );
    }

    try {
      const response = await fetch(buildApiUrl("/api/parsing/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skillId: activeSkill.id,
          message: currentInput,
          history: pendingConversation.messages
            .filter((message) => message.sender === "ai" || message.sender === "user")
            .map((message) => ({
              role: message.sender === "ai" ? "assistant" : "user",
              content: message.text || "",
            }))
            .slice(-10),
          parsingContext: normalizeParsingContext(
            conversationSnapshot.chatParsingContext,
            activeSkill,
            conversationSnapshot.selectedStore,
            conversationSnapshot.selectedMonth,
          ),
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(payload.message || "解析技能问答失败。");
      }

      updatePersistedConversation(conversationId, (conversation) => ({
        ...conversation,
        updatedAt: Date.now(),
        pending: false,
        messages: conversation.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                text: payload.reply || "分析已完成。",
                reasoning: payload.reasoning,
                loading: false,
                status: "",
              }
            : message,
        ),
      }));
    } catch (error) {
      updatePersistedConversation(conversationId, (conversation) => ({
        ...conversation,
        updatedAt: Date.now(),
        pending: false,
        messages: conversation.messages.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                text: error.message || "网络异常。",
                loading: false,
                status: "",
              }
            : message,
        ),
      }));
    }
  }

  async function handleFileUpload(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0 || activeConversation.pending) {
      return;
    }
    const conversationSnapshot = activeConversation;
    const skillSnapshot = activeSkill;
    const skillClientSnapshot = activeSkillClient;
    const conversationId =
      activeConversationId === DRAFT_CONVERSATION_ID
        ? generateConversationId("parsing-conversation")
        : conversationSnapshot.id;
    const currentBatchId = generateConversationId("batch");
    const userMsgId = generateConversationId("upload");
    const uploadFiles = files.map((file) => ({
      name: file.name,
      size: `${(file.size / 1024).toFixed(1)} KB`,
    }));

    upsertConversation({
      ...conversationSnapshot,
      id: conversationId,
      title: conversationSnapshot.title || buildConversationTitleFromInput({ files: uploadFiles }),
      updatedAt: Date.now(),
      pending: true,
      messages: [
        ...conversationSnapshot.messages,
        { id: userMsgId, sender: "user", files: uploadFiles },
        {
          id: currentBatchId,
          sender: "ai",
          text: `正在启动 **${skillSnapshot.label}**...`,
          loading: true,
          status: `待处理：${files.length} 份文件`,
        },
      ],
    });
    setActiveConversationId(conversationId);
    setInputText("");

    if (activeConversationId === DRAFT_CONVERSATION_ID) {
      setDraftConversation(
        buildParsingConversation(skillCatalog, {
          selectedStore: conversationSnapshot.selectedStore,
          selectedMonth: conversationSnapshot.selectedMonth,
          activeSkillId: conversationSnapshot.activeSkillId,
        }),
      );
    }

    const existingParsedFiles = Array.isArray(conversationSnapshot.chatParsingContext.parsedFiles)
      ? conversationSnapshot.chatParsingContext.parsedFiles
      : [];
    const existingReviewFiles = Array.isArray(conversationSnapshot.chatParsingContext.reviewFiles)
      ? conversationSnapshot.chatParsingContext.reviewFiles
      : [];
    const existingFailFiles = Array.isArray(conversationSnapshot.chatParsingContext.failFiles)
      ? conversationSnapshot.chatParsingContext.failFiles
      : [];
    const parsedDraftFiles = [];
    const reviewDraftFiles = [];
    const failDraftFiles = [];
    const summaryItems = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const currentStatus = `正在提取 (${index + 1}/${files.length})：${file.name}`;

        updatePersistedConversation(conversationId, (conversation) => ({
          ...conversation,
          updatedAt: Date.now(),
          messages: conversation.messages.map((message) =>
            message.id === currentBatchId ? { ...message, status: currentStatus } : message,
          ),
        }));

        try {
          const result = await uploadSourceFiles([file], {
            skillId: skillSnapshot.id,
            storeName: conversationSnapshot.selectedStore,
            periodLabel: conversationSnapshot.selectedMonth,
          });
          parsedDraftFiles.push(...(result.parsedFiles || []));
          reviewDraftFiles.push(...(result.reviewFiles || []));
          failDraftFiles.push(...(result.failFiles || []));
          summaryItems.push(
            buildReportSummary({
              report: {
                successFiles: (result.parsedFiles || []).map(normalizeParsedFile),
                reviewFiles: (result.reviewFiles || []).map(normalizeReviewFile),
                failFiles: (result.failFiles || []).map((parsedFile) => ({
                  name: parsedFile.fileName || file.name || "",
                  reason: parsedFile.reason || "暂不支持解析。",
                  bodySheetSection: parsedFile.bodySheetSection || null,
                  parsedDataSummary: Array.isArray(parsedFile.parsedDataSummary)
                    ? parsedFile.parsedDataSummary
                    : [],
                })),
              },
              index: index + 1,
              total: files.length,
            }),
          );
        } catch (singleError) {
          summaryItems.push(
            `### ${file.name}\n> **异常**：${singleError.message || "内部解析失败"}`,
          );
        }

        updatePersistedConversation(conversationId, (conversation) => ({
          ...conversation,
          updatedAt: Date.now(),
          messages: conversation.messages.map((message) =>
            message.id === currentBatchId
              ? {
                  ...message,
                  text: `## 报表解析进度 (${index + 1}/${files.length})\n\n${summaryItems.join("\n\n")}`,
                }
              : message,
          ),
        }));
      }

      const mergedParsedFiles = mergeFilesByName(existingParsedFiles, parsedDraftFiles);
      const mergedReviewFiles = mergeFilesByName(existingReviewFiles, reviewDraftFiles);
      const mergedFailFiles = mergeFilesByName(existingFailFiles, failDraftFiles);
      const matchedGroupKeys = buildMatchedGroupKeys(mergedParsedFiles, mergedReviewFiles);
      const missingFiles = buildMissingSourceGroups(
        matchedGroupKeys,
        skillSnapshot.requiredSourceGroups,
      );
      const nextParsingContext = normalizeParsingContext(
        {
          ...conversationSnapshot.chatParsingContext,
          parsedFiles: mergedParsedFiles,
          reviewFiles: mergedReviewFiles,
          failFiles: mergedFailFiles,
          missingFiles,
        },
        skillSnapshot,
        conversationSnapshot.selectedStore,
        conversationSnapshot.selectedMonth,
      );

      let downloadSection = "";
      try {
        updatePersistedConversation(conversationId, (conversation) => ({
          ...conversation,
          updatedAt: Date.now(),
          messages: conversation.messages.map((message) =>
            message.id === currentBatchId
              ? {
                  ...message,
                  status: `正在生成${skillSnapshot.deliverableLabel || "输出文件"}...`,
                }
              : message,
          ),
        }));

        const exportResult = await exportParsingDraft({
          skillId: skillSnapshot.id,
          storeName: conversationSnapshot.selectedStore,
          periodLabel: conversationSnapshot.selectedMonth,
          parsedFiles: mergedParsedFiles,
          reviewFiles: mergedReviewFiles,
          failFiles: mergedFailFiles,
          missingFiles,
        });
        const downloadUrl = resolveDownloadUrl(
          exportResult.downloadPath,
          exportResult.downloadFileName,
        );
        downloadSection = `\n\n---\n\n**解析已完成**：已回填到《${exportResult.downloadFileName}》。\n\n[点击下载《${exportResult.downloadFileName}》](${downloadUrl})`;
      } catch {
        downloadSection = "\n\n---\n\n**提示**：解析成功，但生成下载文件时出错。";
      }

      let finalText = `## 解析报告完成\n\n${summaryItems.join("\n\n")}\n\n---\n\n${buildBatchSummary({
        fileCount: files.length,
        matchedGroupKeys,
        requiredSourceGroups: skillSnapshot.requiredSourceGroups,
        storeName: conversationSnapshot.selectedStore,
        periodLabel: conversationSnapshot.selectedMonth,
      })}${downloadSection}`;

      if (typeof skillClientSnapshot.buildInsightMarkdown === "function") {
        finalText = `${finalText}\n\n---\n\n## 数据洞察\n\n${skillClientSnapshot.buildInsightMarkdown({
          storeName: conversationSnapshot.selectedStore,
          periodLabel: conversationSnapshot.selectedMonth,
          parsedFiles: mergedParsedFiles,
          reviewFiles: mergedReviewFiles,
          failFiles: mergedFailFiles,
          missingFiles,
        })}`;
      }

      updatePersistedConversation(conversationId, (conversation) => ({
        ...conversation,
        updatedAt: Date.now(),
        pending: false,
        chatParsingContext: nextParsingContext,
        messages: conversation.messages.map((message) =>
          message.id === currentBatchId
            ? { ...message, text: finalText, reasoning: "", loading: false, status: "" }
            : message,
        ),
      }));
    } catch (error) {
      updatePersistedConversation(conversationId, (conversation) => ({
        ...conversation,
        updatedAt: Date.now(),
        pending: false,
        messages: conversation.messages.map((message) =>
          message.id === currentBatchId
            ? {
                ...message,
                text: `## 处理中断\n\n系统错误：${error.message}`,
                loading: false,
                status: "",
              }
            : message,
        ),
      }));
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[#fbf7f2] font-sans text-slate-900">
      <Sidebar1 />

      <main className="flex flex-1 overflow-hidden bg-transparent">
        <aside
          className={cn(
            "flex h-full shrink-0 flex-col border-r border-[#eadfd5] bg-[#f8f1ea]/88 backdrop-blur-md transition-all duration-300",
            isSidebarOpen ? "w-[280px]" : "w-[68px]",
          )}
        >
          <div className="p-3 pt-4">
            <button
              className="flex h-10 w-10 items-center justify-center rounded-full text-slate-600 transition hover:bg-white/60"
              onClick={() => setIsSidebarOpen((current) => !current)}
              type="button"
            >
              <span className="material-symbols-outlined text-[24px]">menu</span>
            </button>
          </div>

          <div className="flex items-center px-3 pb-4 pt-2">
            <button
              className={cn(
                "group relative flex items-center overflow-hidden rounded-full bg-[#d96e42] text-white shadow-sm transition-all duration-300 ease-in-out hover:bg-[#c25c34]",
                isSidebarOpen ? "w-32 px-3.5" : "w-8 justify-center px-0",
              )}
              onClick={() =>
                startFreshConversation({
                  selectedStore: activeConversation.selectedStore,
                  selectedMonth: activeConversation.selectedMonth,
                  activeSkillId: activeConversation.activeSkillId,
                })
              }
              style={{ height: "32px" }}
              type="button"
            >
              <span className="material-symbols-outlined shrink-0 text-[18px]">add</span>
              <span
                className={cn(
                  "ml-2 whitespace-nowrap text-xs font-medium transition-all duration-300 ease-in-out",
                  isSidebarOpen
                    ? "translate-x-0 opacity-100"
                    : "pointer-events-none absolute left-8 -translate-x-4 opacity-0",
                )}
              >
                发起新会话
              </span>
            </button>
          </div>

          <div className="custom-scrollbar flex flex-1 flex-col overflow-y-auto px-3">
            {isSidebarOpen ? (
              <div className="mt-2">
                <div className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                  历史会话
                </div>
                <div className="flex flex-col gap-0.5">
                  {conversations.slice(0, 20).map((conversation) => (
                    <button
                      key={conversation.id}
                      className={cn(
                        "flex items-center gap-3 truncate rounded-2xl px-3 py-2 text-left text-sm transition-colors hover:bg-white",
                        conversation.id === activeConversationId
                          ? "bg-[#fff5ee] text-[#b4542e] shadow-sm"
                          : "text-slate-600",
                      )}
                      onClick={() => openConversation(conversation.id)}
                      type="button"
                    >
                      <span className="material-symbols-outlined shrink-0 text-[16px]">
                        chat_bubble
                      </span>
                      <span className="truncate">{buildConversationTitle(conversation)}</span>
                    </button>
                  ))}
                  {conversations.length === 0 ? (
                    <div className="px-3 py-4 text-xs leading-5 text-slate-500">
                      还没有历史会话。上传文件或发出第一条消息后，它会显示在这里。
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col">
          <header className="pointer-events-none absolute top-0 z-20 flex w-full items-center justify-between p-4">
            <div className="pointer-events-auto flex items-center">
              <span className="pl-2 text-xl font-bold text-[#171412]">珂溪智能</span>
            </div>
            <div className="pointer-events-auto flex items-center gap-4 pr-2">
              <div className="flex cursor-pointer items-center gap-1 rounded-full border border-[#b6860c]/20 bg-white/80 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-[#b6860c] shadow-sm transition hover:bg-white">
                PRO
              </div>
              <div className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[#b6860c] text-lg font-bold text-white shadow-sm">
                X
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col pt-16">
            <div ref={scrollRef} className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-6">
              <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6">
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <div className="flex items-center gap-2 rounded-full border border-[#eadfd2]/70 bg-white/80 px-4 py-2 text-[12px] font-bold text-[#8b6720] shadow-sm">
                    <span className="material-symbols-outlined text-[18px] text-[#b6860c]">
                      {activeSkill.icon}
                    </span>
                    {activeSkill.label}
                  </div>

                  <div className="group relative">
                    <select
                      className="appearance-none rounded-full border border-[#eadfd2]/70 bg-white/80 py-2 pl-4 pr-8 text-[12px] font-bold text-slate-700 shadow-sm outline-none transition hover:border-[#b6860c]/40"
                      onChange={(event) =>
                        resetConversationContext({ selectedStore: event.target.value })
                      }
                      value={activeConversation.selectedStore}
                    >
                      {STORES.map((store) => (
                        <option key={store} value={store}>
                          {store}
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 group-hover:text-[#b6860c]">
                      expand_more
                    </span>
                  </div>

                  <div className="group relative">
                    <select
                      className="appearance-none rounded-full border border-[#eadfd2]/70 bg-white/80 py-2 pl-4 pr-8 text-[12px] font-bold text-slate-700 shadow-sm outline-none transition hover:border-[#b6860c]/40"
                      onChange={(event) =>
                        resetConversationContext({ selectedMonth: event.target.value })
                      }
                      value={activeConversation.selectedMonth}
                    >
                      {MONTHS.map((month) => (
                        <option key={month} value={month}>
                          {month}
                        </option>
                      ))}
                    </select>
                    <span className="material-symbols-outlined pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[16px] text-slate-400 group-hover:text-[#b6860c]">
                      expand_more
                    </span>
                  </div>

                  <button
                    className="flex items-center gap-2 rounded-full border border-[#eadfd2]/70 bg-white/80 px-4 py-2 text-[12px] font-bold text-slate-600 shadow-sm transition hover:border-[#b6860c]/40 hover:text-[#8f5138]"
                    onClick={() => setIsSkillModalOpen(true)}
                    type="button"
                  >
                    <span className="material-symbols-outlined text-[18px]">menu_book</span>
                    技能百科
                  </button>

                  {activePreviewPanel === "physical_table" ? (
                    <button
                      className="flex items-center gap-2 rounded-full border border-[#b6860c]/20 bg-[#fff7ef] px-4 py-2 text-[12px] font-bold text-[#b6860c] shadow-sm transition hover:bg-[#fff1e6]"
                      onClick={() => setIsPanelOpen(true)}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[18px]">table_chart</span>
                      {activeSkill.deliverableActionLabel || "查看结果"}
                    </button>
                  ) : null}

                  {activeConversation.pending ? (
                    <div className="rounded-full bg-[#fff1e7] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#b4542e]">
                      处理中
                    </div>
                  ) : null}
                </div>

                {activeConversation.messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      "group flex w-full gap-3 animate-in fade-in slide-in-from-bottom-4 duration-500",
                      message.sender === "user" ? "flex-row-reverse" : "flex-row",
                    )}
                  >
                    <div
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-full shadow-sm transition-all duration-300",
                        message.sender === "user"
                          ? "bg-slate-200 text-slate-500"
                          : "bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white shadow-[#b6860c]/20",
                      )}
                    >
                      <span className="material-symbols-outlined text-[20px]">
                        {message.sender === "user" ? "person" : activeSkill.icon}
                      </span>
                    </div>

                    <div
                      className={cn(
                        "flex max-w-[85%] flex-col gap-1.5",
                        message.sender === "user" ? "items-end text-right" : "items-start",
                      )}
                    >
                      <div className="mb-0.5 flex items-center gap-2 px-1">
                        <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400/80">
                          {message.sender === "user" ? "管理台" : `珂溪助手 · ${activeSkill.label}`}
                        </span>
                        {message.sender === "ai" && !message.loading ? (
                          <span className="rounded-full border border-emerald-100/50 bg-emerald-50 px-2 py-0.5 text-[9px] font-bold text-emerald-600">
                            在线
                          </span>
                        ) : null}
                      </div>

                      {message.files ? (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {message.files.map((file, index) => (
                            <FileChip
                              key={`${message.id}-${index}`}
                              fileName={file.name}
                              size={file.size}
                            />
                          ))}
                        </div>
                      ) : null}

                      {message.text || message.sender === "ai" ? (
                        <div
                          className={cn(
                            "rounded-[24px] border text-[14.5px] leading-[1.65] shadow-[0_10px_30px_rgba(15,23,42,0.04)] transition-all duration-300",
                            message.sender === "user"
                              ? "border-[#eadfd2]/70 bg-white px-4 py-3 text-slate-800"
                              : "border-[#eadfd2]/70 bg-white px-5 py-4 text-slate-800",
                          )}
                        >
                          {message.sender === "user" ? (
                            <div className="whitespace-pre-wrap font-medium">{message.text}</div>
                          ) : (
                            <div className="w-full">
                              <ThoughtProcess thought={message.reasoning} />
                              {message.text ? <MarkdownMessage content={message.text} /> : null}
                              {message.loading ? (
                                <div className="mt-4 flex flex-col gap-3">
                                  <div className="flex items-center gap-2">
                                    <div className="size-1.5 animate-bounce rounded-full bg-[#b6860c]/40" />
                                    <div
                                      className="size-1.5 animate-bounce rounded-full bg-[#b6860c]/60"
                                      style={{ animationDelay: "0.15s" }}
                                    />
                                    <div
                                      className="size-1.5 animate-bounce rounded-full bg-[#b6860c]/80"
                                      style={{ animationDelay: "0.3s" }}
                                    />
                                    {message.status ? (
                                      <span className="ml-2 text-[11px] font-bold uppercase tracking-[0.2em] text-[#b97a5f]">
                                        {message.status}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="w-full bg-gradient-to-t from-[#fbf7f2] via-[#fbf7f2]/95 to-transparent px-4 pb-6 pt-4">
              <div className="mx-auto max-w-[720px]">
                <div className="group relative flex w-full flex-col rounded-[32px] border border-[#d96e42]/15 bg-white/90 p-1.5 shadow-sm transition-colors hover:bg-white focus-within:border-[#d96e42]/30 focus-within:bg-white focus-within:shadow-md">
                  <div className="flex items-start px-2 pb-0 pt-1">
                    <input
                      accept={acceptedFileTypes}
                      className="hidden"
                      multiple
                      onChange={handleFileUpload}
                      ref={fileInputRef}
                      type="file"
                    />
                    <button
                      className="mt-1.5 shrink-0 rounded-full p-2 text-slate-400 transition hover:bg-[#fff7f0]"
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[22px]">add</span>
                    </button>
                    <textarea
                      className="max-h-[180px] min-h-[44px] flex-1 resize-none bg-transparent p-2.5 pt-3.5 text-[14.5px] text-slate-900 outline-none placeholder:text-slate-400"
                      onChange={(event) => setInputText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                      placeholder={activeSkill.placeholder || "输入指令或上传报表..."}
                      rows="1"
                      value={inputText}
                    />
                    <div className="mb-2 mr-2 flex items-center gap-1 self-end">
                      <button
                        className={cn(
                          "rounded-full p-1.5 transition",
                          inputText.trim() && !activeConversation.pending
                            ? "text-slate-400 hover:bg-[#fff7f0]"
                            : "cursor-not-allowed text-slate-300",
                        )}
                        disabled={!inputText.trim() || activeConversation.pending}
                        onClick={() => void handleSendMessage()}
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[22px] text-[#b6860c]">
                          send
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-[#d96e42]/5 px-4 pb-1.5 pt-1.5">
                    <div className="relative" ref={skillSelectorRef}>
                      <button
                        className="flex items-center gap-2 rounded-full bg-[#b6860c]/5 px-2.5 py-1 text-[12px] font-bold text-[#b6860c] transition hover:bg-[#b6860c]/10"
                        onClick={() => setIsSkillSelectorOpen((current) => !current)}
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {activeSkill.icon}
                        </span>
                        {activeSkill.label}
                        <span className="material-symbols-outlined text-[14px]">expand_more</span>
                      </button>

                      {isSkillSelectorOpen ? (
                        <div className="absolute bottom-full left-0 z-50 mb-2 w-64 overflow-hidden rounded-[28px] border border-[#eadfd2] bg-white py-2 shadow-[0_24px_64px_rgba(0,0,0,0.15)] animate-in fade-in slide-in-from-bottom-2 duration-200">
                          <p className="px-5 py-2 text-[10px] font-bold uppercase tracking-[0.3em] text-[#b97a5f]">
                            切换专业技能
                          </p>
                          {skillCatalog.skills.map((skill) => (
                            <button
                              key={skill.id}
                              className={cn(
                                "flex w-full items-center gap-4 px-5 py-4 text-left text-[14px] transition-all hover:bg-[#fbf7f2]",
                                skill.id === activeConversation.activeSkillId
                                  ? "bg-[#fbf7f2]/80 font-black text-[#b6860c]"
                                  : "font-bold text-slate-600",
                              )}
                              onClick={() => handleSkillSelect(skill.id)}
                              type="button"
                            >
                              <div
                                className={cn(
                                  "flex size-8 items-center justify-center rounded-xl transition-colors",
                                  skill.id === activeConversation.activeSkillId
                                    ? "bg-[#b6860c] text-white"
                                    : "bg-slate-100 text-slate-500",
                                )}
                              >
                                <span className="material-symbols-outlined text-[18px]">
                                  {skill.icon}
                                </span>
                              </div>
                              {skill.label}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="text-[11px] font-medium tracking-wide text-slate-400">
                      智能解析 · {activeConversation.selectedStore} · {activeConversation.selectedMonth}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {isSkillModalOpen ? (
            <SkillCatalogModal
              activeSkillId={activeConversation.activeSkillId}
              catalog={skillCatalog}
              onClose={() => setIsSkillModalOpen(false)}
              onSelect={handleSkillSelect}
              periodLabel={activeConversation.selectedMonth}
              storeName={activeConversation.selectedStore}
            />
          ) : null}

          {isPanelOpen && activePreviewPanel === "physical_table" ? (
            <PhysicalTablePanel
              onClose={() => setIsPanelOpen(false)}
              period={getPeriodId(activeConversation.selectedMonth)}
              periodLabel={activeConversation.selectedMonth}
              storeId={STORE_MAP[activeConversation.selectedStore]}
              storeName={activeConversation.selectedStore}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
