import { useEffect, useRef, useState } from "react";
import Sidebar1 from "../../components/Sidebar1";
import PhysicalTablePanel from "../../components/PhysicalTablePanel";
import { buildApiUrl } from "../../lib/runtimeConfig";
import {
  getFallbackParsingSkillCatalog,
  getParsingSkillById,
  getParsingSkillClientConfig,
  SHUADAN_PACKET_SKILL_ID,
} from "../../lib/parsingSkills";
import { FileChip, MarkdownMessage, SkillCatalogModal, ThoughtProcess, WelcomeScreen } from "./ParsingUi";
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
  normalizeGeneratedDeliverable,
  normalizeParsedFile,
  normalizeParsingContext,
  normalizeReviewFile,
  requestParsingSkills,
  resolveConversationPdfDeliverable,
  resolveDownloadUrl,
  serializeParsingConversation,
  uploadSourceFiles,
} from "./parsingUtils";

function buildHeaderDeliverableMeta(skill = {}, acceptedFileTypes = "") {
  const outputLabel = skill.deliverableLabel || "输出文件";
  const actionLabel = skill.deliverableActionLabel || "查看结果";
  const isPdfOutput = /pdf/i.test(outputLabel);

  return {
    icon: isPdfOutput ? "picture_as_pdf" : "draft",
    eyebrow: skill.previewPanel === "physical_table" ? actionLabel : isPdfOutput ? "" : "当前输出",
    label: isPdfOutput ? "查看PDF文件" : outputLabel,
    hint: acceptedFileTypes
      ? `支持 ${acceptedFileTypes.replace(/,/g, " / ")}`
      : "按当前技能生成对应结果",
  };
}

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
  const headerDeliverableMeta = buildHeaderDeliverableMeta(activeSkill, acceptedFileTypes);
  const lastMessage = activeConversation.messages[activeConversation.messages.length - 1];
  const activeGeneratedDeliverable =
    normalizeGeneratedDeliverable(activeConversation.chatParsingContext?.generatedDeliverable) ||
    resolveConversationPdfDeliverable(activeConversation);
  const activeDeliverableUrl =
    activeGeneratedDeliverable?.previewUrl || activeGeneratedDeliverable?.downloadUrl || "";

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

  useEffect(() => {
    if (!isSkillModalOpen && !isSkillSelectorOpen) {
      return;
    }

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
  }, [isSkillModalOpen, isSkillSelectorOpen]);

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

  function handleOpenGeneratedDeliverable() {
    if (!activeDeliverableUrl) {
      window.alert("当前对话还没有生成可查看的结果文件，请先在本对话中完成一次生成。");
      return;
    }

    window.open(activeDeliverableUrl, "_blank", "noopener,noreferrer");
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
            conversationId,
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
      let generatedDeliverable = normalizeGeneratedDeliverable(
        conversationSnapshot.chatParsingContext?.generatedDeliverable,
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
          conversationId,
        });
        const downloadUrl = resolveDownloadUrl(
          exportResult.downloadPath,
          exportResult.downloadFileName,
        );
        generatedDeliverable = normalizeGeneratedDeliverable({
          fileName: exportResult.downloadFileName,
          downloadPath: exportResult.downloadPath,
          previewPath: exportResult.previewPath,
          downloadUrl,
          generatedAt: Date.now(),
        });
        const resolvedPreviewUrl = generatedDeliverable?.previewUrl || "";
        downloadSection = resolvedPreviewUrl
          ? `\n\n---\n\n**解析已完成**：已回填到《${exportResult.downloadFileName}》。\n\n[点击预览《${exportResult.downloadFileName}》](${resolvedPreviewUrl})`
          : `\n\n---\n\n**解析已完成**：已回填到《${exportResult.downloadFileName}》。\n\n[点击下载《${exportResult.downloadFileName}》](${downloadUrl})`;
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

      const nextParsingContext = normalizeParsingContext(
        {
          ...conversationSnapshot.chatParsingContext,
          parsedFiles: mergedParsedFiles,
          reviewFiles: mergedReviewFiles,
          failFiles: mergedFailFiles,
          missingFiles,
          generatedDeliverable,
        },
        skillSnapshot,
        conversationSnapshot.selectedStore,
        conversationSnapshot.selectedMonth,
      );

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
    <div className="flex h-screen w-full overflow-hidden bg-[#fbf7f2] font-sans text-slate-900 relative">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] right-[-5%] size-[600px] rounded-full bg-gradient-to-br from-[#b6860c]/5 to-transparent blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[10%] size-[500px] rounded-full bg-gradient-to-tr from-[#d96e42]/5 to-transparent blur-[100px] pointer-events-none" />

      <Sidebar1 />

      <main className="flex flex-1 overflow-hidden bg-transparent relative z-10">
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
          <header className="pointer-events-none absolute top-0 z-20 flex w-full items-center justify-between p-6">
            <div className="pointer-events-auto flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white shadow-lg shadow-[#b6860c]/20">
                <span className="material-symbols-outlined text-[24px]">auto_awesome</span>
              </div>
              <span className="text-2xl font-black tracking-tight bg-gradient-to-r from-[#171412] to-[#171412]/60 bg-clip-text text-transparent">
                智能解析器
              </span>
            </div>
            <div className="pointer-events-auto flex items-center gap-4 pr-2">
              <button
                className="flex items-center gap-1.5 rounded-full border border-[#b6860c]/20 bg-white/80 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-[#b6860c] shadow-sm transition hover:bg-white hover:border-[#b6860c]/40"
                onClick={() => setIsSkillModalOpen(true)}
                type="button"
              >
                <span className="material-symbols-outlined text-[16px]">menu_book</span>
                <span>技能百科</span>
              </button>
              <div className="flex cursor-pointer items-center gap-1 rounded-full border border-[#b6860c]/20 bg-white/80 px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-[#b6860c] shadow-sm transition hover:bg-white">
                PRO
              </div>
              <div className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full bg-[#b6860c] text-lg font-bold text-white shadow-sm">
                X
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col pt-20">
            <div ref={scrollRef} className="custom-scrollbar flex-1 overflow-y-auto px-4 pb-6">
              <div className="mx-auto flex w-full max-w-[720px] flex-col gap-8">
                {activeConversation.messages.length === 0 ? (
                  <WelcomeScreen
                    activeSkill={activeSkill}
                    onSuggestionClick={(text) => {
                      setInputText(text);
                    }}
                  />
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-center gap-2 pt-1 animate-in fade-in slide-in-from-top-4 duration-500">
                      <div className="flex shrink-0 items-center gap-2 rounded-full border border-white bg-white/60 px-4 py-2 text-[12px] font-bold text-[#8b6720] shadow-sm backdrop-blur-md">
                        <span className="material-symbols-outlined text-[18px] text-[#b6860c]">
                          {activeSkill.icon}
                        </span>
                        <span className="whitespace-nowrap">{activeSkill.label}</span>
                      </div>

                      {activeSkill.id !== SHUADAN_PACKET_SKILL_ID && (
                        <>
                          <div className="group relative shrink-0">
                            <select
                              className="appearance-none rounded-full border border-white bg-white/60 py-2 pl-4 pr-8 text-[12px] font-bold text-slate-700 shadow-sm outline-none transition hover:border-[#b6860c]/40 backdrop-blur-md"
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

                          <div className="group relative shrink-0">
                            <select
                              className="appearance-none rounded-full border border-white bg-white/60 py-2 pl-4 pr-8 text-[12px] font-bold text-slate-700 shadow-sm outline-none transition hover:border-[#b6860c]/40 backdrop-blur-md"
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
                        </>
                      )}

                      {activePreviewPanel === "physical_table" ? (
                        <button
                          className="flex h-[40px] shrink-0 items-center gap-2 rounded-full border border-[#b6860c]/20 bg-[#fff7ef]/80 px-4 text-[12px] font-bold text-[#b6860c] shadow-sm transition hover:bg-[#fff1e6] backdrop-blur-md"
                          onClick={() => setIsPanelOpen(true)}
                          title={
                            activeGeneratedDeliverable?.fileName
                              ? `查看当前会话对应的体质表，最新生成文件：${activeGeneratedDeliverable.fileName}`
                              : "查看当前会话对应的体质表"
                          }
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px]">table_chart</span>
                          <span className="whitespace-nowrap">
                            {activeSkill.deliverableActionLabel || "查看结果"}
                          </span>
                        </button>
                      ) : activeDeliverableUrl ? (
                        <button
                          className="flex h-[40px] shrink-0 items-center gap-2 rounded-full border border-[#b6860c]/20 bg-[#fff7ef]/80 px-4 text-[12px] font-bold text-[#b6860c] shadow-sm transition hover:bg-[#fff1e6] backdrop-blur-md"
                          onClick={handleOpenGeneratedDeliverable}
                          title={
                            activeDeliverableUrl
                              ? `查看当前会话生成的 ${
                                  activeGeneratedDeliverable?.fileName || headerDeliverableMeta.label
                                }`
                              : "当前对话还没有生成结果文件"
                          }
                          type="button"
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {headerDeliverableMeta.icon}
                          </span>
                          <span className="whitespace-nowrap">
                            {headerDeliverableMeta.label}
                          </span>
                        </button>
                      ) : activeSkill.deliverableLabel ? (
                        <div
                          className="flex h-[40px] shrink-0 items-center gap-2 rounded-full border border-[#b6860c]/20 bg-[#fff7ef]/80 px-4 text-[12px] font-bold text-[#b6860c] shadow-sm backdrop-blur-md"
                          title={headerDeliverableMeta.hint}
                        >
                          <span className="material-symbols-outlined text-[18px]">
                            {headerDeliverableMeta.icon}
                          </span>
                          <span className="whitespace-nowrap">
                            {headerDeliverableMeta.label}
                          </span>
                        </div>
                      ) : null}

                      {activeConversation.pending ? (
                        <div className="shrink-0 rounded-full bg-[#fff1e7] px-3 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[#b4542e] animate-pulse">
                          正在思考...
                        </div>
                      ) : null}
                    </div>

                    {activeConversation.messages.map((message) => (
                      <div
                        key={message.id}
                        className={cn(
                          "group flex w-full gap-4 animate-in fade-in slide-in-from-bottom-6 duration-700",
                          message.sender === "user" ? "flex-row-reverse" : "flex-row",
                        )}
                      >
                        <div
                          className={cn(
                            "flex size-10 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-all duration-500",
                            message.sender === "user"
                              ? "bg-white border border-slate-200 text-slate-500"
                              : "bg-gradient-to-br from-[#b6860c] to-[#d96e42] text-white shadow-xl shadow-[#b6860c]/10",
                          )}
                        >
                          <span className="material-symbols-outlined text-[22px]">
                            {message.sender === "user" ? "person" : activeSkill.icon}
                          </span>
                        </div>

                        <div
                          className={cn(
                            "flex max-w-[85%] flex-col gap-2",
                            message.sender === "user" ? "items-end text-right" : "items-start",
                          )}
                        >
                          <div className="flex items-center gap-2 px-1">
                            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-slate-400">
                              {message.sender === "user" ? "管理员" : `智能解析器 · ${activeSkill.label}`}
                            </span>
                          </div>

                          {message.files ? (
                            <div className="mb-2 flex flex-wrap gap-3">
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
                                "rounded-[32px] border text-[15px] leading-[1.7] shadow-[0_16px_48px_-12px_rgba(15,23,42,0.06)] transition-all duration-500",
                                message.sender === "user"
                                  ? "border-white bg-white/80 px-5 py-4 text-slate-800 backdrop-blur-sm"
                                  : "border-white bg-white px-6 py-5 text-slate-800",
                              )}
                            >
                              {message.sender === "user" ? (
                                <div className="whitespace-pre-wrap font-semibold text-slate-700">
                                  {message.text}
                                </div>
                              ) : (
                                <div className="w-full">
                                  <ThoughtProcess thought={message.reasoning} />
                                  {message.text ? <MarkdownMessage content={message.text} /> : null}
                                  {message.loading ? (
                                    <div className="mt-6 flex flex-col gap-4">
                                      <div className="flex items-center gap-3">
                                        <div className="flex gap-1.5">
                                          <div className="size-2 animate-bounce rounded-full bg-[#b6860c]/30" />
                                          <div
                                            className="size-2 animate-bounce rounded-full bg-[#b6860c]/60"
                                            style={{ animationDelay: "0.2s" }}
                                          />
                                          <div
                                            className="size-2 animate-bounce rounded-full bg-[#b6860c]"
                                            style={{ animationDelay: "0.4s" }}
                                          />
                                        </div>
                                        {message.status ? (
                                          <span className="text-[11px] font-black uppercase tracking-[0.2em] text-[#b97a5f] animate-pulse">
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
                  </>
                )}
              </div>
            </div>

            <div className="w-full bg-gradient-to-t from-[#fbf7f2] via-[#fbf7f2]/80 to-transparent px-4 pb-8 pt-4">
              <div className="mx-auto max-w-[720px]">
                <div className="group relative flex w-full flex-col rounded-[32px] border border-white bg-white/70 p-1.5 shadow-xl shadow-slate-200/40 transition-all hover:bg-white focus-within:bg-white focus-within:shadow-2xl focus-within:shadow-[#b6860c]/10 backdrop-blur-xl">
                  <div className="flex items-end px-3 pb-1 pt-2">
                    <input
                      accept={acceptedFileTypes}
                      className="hidden"
                      multiple
                      onChange={handleFileUpload}
                      ref={fileInputRef}
                      type="file"
                    />
                    <button
                      className="mb-1 shrink-0 rounded-full p-2.5 text-slate-400 transition hover:bg-[#fbf7f2] hover:text-[#b6860c]"
                      onClick={() => fileInputRef.current?.click()}
                      type="button"
                    >
                      <span className="material-symbols-outlined text-[24px]">add_circle</span>
                    </button>
                    <textarea
                      className="max-h-[200px] min-h-[48px] flex-1 resize-none bg-transparent p-3 text-[15px] font-medium text-slate-900 outline-none placeholder:text-slate-400 placeholder:font-normal"
                      onChange={(event) => setInputText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void handleSendMessage();
                        }
                      }}
                      placeholder={activeSkill.placeholder || "输入指令、上传报表，开启智能解析..."}
                      rows="1"
                      value={inputText}
                    />
                    <div className="mb-1 mr-1 flex items-center gap-1">
                      <button
                        className={cn(
                          "flex size-10 items-center justify-center rounded-full transition-all duration-500",
                          inputText.trim() && !activeConversation.pending
                            ? "bg-gradient-to-tr from-[#b6860c] to-[#d96e42] text-white shadow-lg shadow-[#b6860c]/25 hover:scale-105 active:scale-95"
                            : "bg-slate-100 text-slate-300 cursor-not-allowed",
                        )}
                        disabled={!inputText.trim() || activeConversation.pending}
                        onClick={() => void handleSendMessage()}
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[22px]">
                          send
                        </span>
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-50 px-5 pb-2 pt-2">
                    <div className="relative" ref={skillSelectorRef}>
                      <button
                        aria-expanded={isSkillSelectorOpen}
                        aria-haspopup="listbox"
                        aria-label={`选择解析技能，当前为${activeSkill.label}`}
                        className="flex items-center gap-2 text-[12px] text-[#b6860c] bg-[#b6860c]/5 hover:bg-[#b6860c]/10 px-2.5 py-1.5 rounded-full font-bold transition"
                        onClick={() => setIsSkillSelectorOpen((current) => !current)}
                        type="button"
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {activeSkill.icon}
                        </span>
                        <span>{activeSkill.label}</span>
                        <span className="material-symbols-outlined text-[16px]">
                          expand_more
                        </span>
                      </button>

                      {isSkillSelectorOpen ? (
                        <div
                          aria-label="解析技能列表"
                          className="absolute bottom-full left-0 z-50 mb-2 w-52 overflow-hidden rounded-2xl border border-[#eadfd5] bg-white py-2 shadow-xl animate-in fade-in slide-in-from-bottom-2 duration-200"
                          role="listbox"
                        >
                          {skillCatalog.skills.map((skill) => (
                            <button
                              aria-selected={skill.id === activeConversation.activeSkillId}
                              key={skill.id}
                              className={cn(
                                "flex w-full items-center gap-3 px-4 py-2.5 text-sm text-left transition-colors hover:bg-[#fff7f0]",
                                skill.id === activeConversation.activeSkillId
                                  ? "bg-[#fff7f0] text-[#b6860c] font-bold"
                                  : "text-slate-600",
                              )}
                              onClick={() => handleSkillSelect(skill.id)}
                              role="option"
                              type="button"
                            >
                              <span className="material-symbols-outlined text-[18px]">
                                {skill.icon}
                              </span>
                              <span>{skill.label}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="text-[11px] font-medium tracking-wide text-slate-400">
                      智能解析助理 · {activeSkill.badge || "通用"}
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
              conversationId={activeConversation.id}
              generatedDeliverable={activeGeneratedDeliverable}
              onClose={() => setIsPanelOpen(false)}
              period={getPeriodId(activeConversation.selectedMonth)}
              periodLabel={activeConversation.selectedMonth}
              reportScope="conversation"
              skillId={activeConversation.activeSkillId}
              storeId={STORE_MAP[activeConversation.selectedStore]}
              storeName={activeConversation.selectedStore}
            />
          ) : null}
        </section>
      </main>
    </div>
  );
}
