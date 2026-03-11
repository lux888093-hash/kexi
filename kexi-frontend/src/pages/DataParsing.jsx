import React, { useState, useRef, useEffect } from "react";
import AppShell from "../components/AppShell";

const STORES = ["华创店", "佳兆业店", "德思勤店", "凯德壹店", "梅溪湖店", "万象城店"];
const MONTHS = ["2026年1月", "2026年2月", "2026年3月", "2026年4月"];

export default function DataParsing() {
  const [selectedStore, setSelectedStore] = useState("华创店");
  const [selectedMonth, setSelectedMonth] = useState("2026年1月");
  const [messages, setMessages] = useState([
    {
      id: "init-msg-1",
      sender: "ai",
      text: `您好！我是 **珂溪 AI 洞察助手**。

  请在右上角确认当前的**门店**和**月份**。您可以随时向我发送指令修改报表参数，或在下方点击 **"+"** 上传当月相关源文件（如营业报表、出入库登记表等），我将为您进行深度解析并生成《体质检测表》。`,
    }
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [inputText, setInputText] = useState("");
  const fileInputRef = useRef(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleFileUpload = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const newMsg = {
      id: Date.now(),
      sender: "user",
      files: files.map((f) => f.name),
    };
    setMessages((prev) => [...prev, newMsg]);

    setIsTyping(true);
    setTimeout(() => {
      setIsTyping(false);
      
      const successFiles = files.filter(f => !f.name.endsWith('.pdf'));
      const failFiles = files.filter(f => f.name.endsWith('.pdf'));
      const missingFiles = ["员工工资明细表.xlsx"];

      const aiResponse = {
        id: Date.now() + 1,
        sender: "ai",
        type: "report",
        store: selectedStore,
        month: selectedMonth,
        successFiles: successFiles.map(f => f.name),
        failFiles: failFiles.map(f => f.name),
        missingFiles: missingFiles,
        downloadUrl: "#", 
        downloadFileName: `${selectedMonth}${selectedStore}体质表.xlsx`
      };
      
      setMessages((prev) => [...prev, aiResponse]);
    }, 2500);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;

    const newMsg = {
      id: Date.now(),
      sender: "user",
      text: inputText,
    };
    setMessages((prev) => [...prev, newMsg]);
    setInputText("");
    setIsTyping(true);

    setTimeout(() => {
      setIsTyping(false);
      const aiResponse = {
        id: Date.now() + 1,
        sender: "ai",
        text: "没问题。我已经根据您的要求对核心数据指标进行了重新核算与校准。调整后的报表已生成，请在此处下载查看：",
        downloadUrl: "#",
        downloadFileName: `${selectedMonth}${selectedStore}体质表_更新v2.xlsx`
      };
      setMessages((prev) => [...prev, aiResponse]);
    }, 1500);
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
          
          <div className="flex items-center gap-2.5">
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
                    <div className="mt-5 rounded-2xl bg-white border border-[#e8dcc4]/60 shadow-[0_4px_20px_-4px_rgba(0,0,0,0.05)] overflow-hidden">
                      {/* Card Header */}
                      <div className="bg-[#fcfaf7] border-b border-[#e8dcc4]/40 px-5 py-3.5 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-[20px] text-[#b6860c]">insights</span>
                          <p className="text-[15px] font-extrabold text-[#171412]">
                            解析报告 · {msg.store} {msg.month}
                          </p>
                        </div>
                        <span className="text-[11px] font-bold tracking-wider text-[#d96e42] bg-[#d96e42]/10 px-2 py-1 rounded-md">COMPLETED</span>
                      </div>
                      
                      {/* Card Body */}
                      <div className="p-5 space-y-4">
                        <div className="grid grid-cols-1 gap-3">
                          {msg.successFiles?.length > 0 && (
                            <div className="rounded-xl border border-emerald-100 bg-emerald-50/30 p-3.5">
                              <p className="mb-2.5 text-[13px] font-bold text-emerald-700 flex items-center gap-1.5 uppercase tracking-wide">
                                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                成功解析 ({msg.successFiles.length})
                              </p>
                              <div className="flex flex-wrap gap-2">
                                {msg.successFiles.map((f, i) => (
                                  <span key={i} className="inline-flex items-center rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-100 shadow-sm">
                                    {f}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {(msg.failFiles?.length > 0 || msg.missingFiles?.length > 0) && (
                            <div className="flex flex-col sm:flex-row gap-3">
                              {msg.failFiles?.length > 0 && (
                                <div className="flex-1 rounded-xl border border-rose-100 bg-rose-50/30 p-3.5">
                                  <p className="mb-2 text-[13px] font-bold text-rose-700 flex items-center gap-1.5 uppercase tracking-wide">
                                    <span className="material-symbols-outlined text-[16px]">error</span>
                                    格式异常
                                  </p>
                                  <ul className="list-inside list-disc space-y-1 text-rose-600/80 text-[13px] font-medium">
                                    {msg.failFiles.map((f, i) => <li key={i} className="truncate">{f}</li>)}
                                  </ul>
                                </div>
                              )}

                              {msg.missingFiles?.length > 0 && (
                                <div className="flex-1 rounded-xl border border-amber-200/60 bg-amber-50/30 p-3.5">
                                  <p className="mb-2 text-[13px] font-bold text-amber-700 flex items-center gap-1.5 uppercase tracking-wide">
                                    <span className="material-symbols-outlined text-[16px]">warning</span>
                                    缺失数据源
                                  </p>
                                  <ul className="list-inside list-disc space-y-1 text-amber-700/80 text-[13px] font-medium">
                                    {msg.missingFiles.map((f, i) => <li key={i} className="truncate">{f}</li>)}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Card Footer (Download) */}
                      <div className="bg-[#fcfaf7] border-t border-[#e8dcc4]/40 p-5 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-bold text-[#171412]">报表生成完毕</p>
                          <p className="text-[12px] text-[#8c8273] mt-0.5">您可以直接下载，或继续提问调整</p>
                        </div>
                        <a
                          href={msg.downloadUrl}
                          className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-b from-[#b6860c] to-[#99700a] px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_12px_rgba(182,134,12,0.3)] transition-all hover:scale-[1.02] hover:shadow-[0_6px_16px_rgba(182,134,12,0.4)]"
                          onClick={(e) => { e.preventDefault(); alert("演示：文件下载触发"); }}
                        >
                          <span className="material-symbols-outlined text-[18px]">download</span>
                          点击下载
                        </a>
                      </div>
                    </div>
                  )}

                  {/* General Download button for text responses */}
                  {msg.downloadFileName && msg.type !== "report" && (
                    <div className="mt-4">
                        <a
                          href={msg.downloadUrl}
                          className="group inline-flex items-center gap-2.5 rounded-xl border border-[#e8dcc4] bg-white px-5 py-3 text-[14px] font-bold text-[#171412] shadow-sm transition-all hover:border-[#b6860c]/50 hover:shadow-md"
                          onClick={(e) => { e.preventDefault(); alert("演示：文件下载触发"); }}
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

      </div>
    </AppShell>
  );
}
