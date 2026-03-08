import Sidebar1 from '../components/Sidebar1';

export default function Workspace() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background-light dark:bg-background-dark">
      <Sidebar1 />
      <main className="flex-1 flex flex-col relative bg-background-light dark:bg-background-dark overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between px-8 py-4 border-b border-primary/5 bg-background-light/80 dark:bg-background-dark/80 backdrop-blur-md">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">首页</span>
            <span className="material-symbols-outlined text-slate-300 text-xs">chevron_right</span>
            <span className="text-slate-900 dark:text-slate-100 text-sm font-medium">头疗专家</span>
          </div>
          <div className="flex items-center gap-4">
            <button className="size-10 flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <div className="h-10 w-10 rounded-full border-2 border-primary/20 p-0.5 overflow-hidden">
              <div className="w-full h-full bg-cover bg-center rounded-full" style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuDXfPueDVRR3a5zBvHciRFAQJo58ubmauIN8bfaMhomm6yoii37vbk8tqv1AYZx7eSxdJDUXDMa2Ct2IQ5Lu8THcJ18JuZfrteEnFhZliqnu1cXYQ8AnTPugbL8188EkNj3HYi52Ri9nmmjeF7U1dKO9FkW0Y6vy_nk-ZNctCnK8OZNA9mPwZF78fOYlwJROesX1cq7rsJy34gBFaIUqAusvyVyFhIyZnMkF7RvFWqBPw-WpxjZe3ZchieZeoHLTlhTpt3xGSczZoI')" }}></div>
            </div>
          </div>
        </header>

        {/* Agent Selector */}
        <div className="px-8 pt-6">
          <div className="flex items-center gap-3 overflow-x-auto no-scrollbar pb-2">
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-slate-800 border-2 border-primary shadow-sm flex-shrink-0 whitespace-nowrap group transition-all">
              <div className="size-6 rounded-full bg-primary/20 flex items-center justify-center text-primary">
                <span className="material-symbols-outlined text-[18px] fill-1">robot_2</span>
              </div>
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">默认智能体</span>
            </button>
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary/50 flex-shrink-0 transition-colors whitespace-nowrap font-medium">
              <div className="size-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                <span className="material-symbols-outlined text-[18px]">psychology</span>
              </div>
              <span className="text-sm text-slate-600 dark:text-slate-300 font-medium">头疗专家</span>
            </button>
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary/50 flex-shrink-0 transition-colors whitespace-nowrap">
              <div className="size-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                <span className="material-symbols-outlined text-[18px]">payments</span>
              </div>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">财务分析师</span>
            </button>
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary/50 flex-shrink-0 transition-colors whitespace-nowrap">
              <div className="size-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                <span className="material-symbols-outlined text-[18px]">calendar_month</span>
              </div>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">排班官</span>
            </button>
            <button className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary/50 flex-shrink-0 transition-colors whitespace-nowrap">
              <div className="size-6 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500">
                <span className="material-symbols-outlined text-[18px]">support_agent</span>
              </div>
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">客服助手</span>
            </button>
          </div>
        </div>

        {/* Chat Message History */}
        <div className="flex-1 overflow-y-auto px-4 lg:px-40 py-8 flex flex-col gap-8 custom-scrollbar">
          <div className="flex gap-4 max-w-4xl mx-auto w-full">
            <div className="size-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined">auto_awesome</span>
            </div>
            <div className="flex flex-col gap-1.5 pt-2">
              <span className="text-xs font-bold uppercase tracking-widest text-primary/70">柯溪 AI • 头疗专家</span>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl rounded-tl-none shadow-sm border border-primary/5 text-slate-800 dark:text-slate-200 leading-relaxed">
                您好！我是您的头疗专家。我在这里协助您管理心理健康和日常压力。您今天感觉如何？
              </div>
            </div>
          </div>

          <div className="flex flex-row-reverse gap-4 max-w-4xl mx-auto w-full">
            <div className="size-10 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-600 dark:text-slate-400 shrink-0">
              <span className="material-symbols-outlined">person</span>
            </div>
            <div className="flex flex-col items-end gap-1.5 pt-2">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">您</span>
              <div className="bg-primary text-white p-6 rounded-2xl rounded-tr-none shadow-md leading-relaxed">
                我最近工作压力大，脖子和肩膀感觉很紧。我们能看看有哪些快速缓解的练习吗？
              </div>
            </div>
          </div>

          <div className="flex gap-4 max-w-4xl mx-auto w-full">
            <div className="size-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary shrink-0">
              <span className="material-symbols-outlined">auto_awesome</span>
            </div>
            <div className="flex flex-col gap-1.5 pt-2">
              <span className="text-xs font-bold uppercase tracking-widest text-primary/70">柯溪 AI • 头疗专家</span>
              <div className="bg-white dark:bg-slate-800 p-6 rounded-2xl rounded-tl-none shadow-sm border border-primary/5 text-slate-800 dark:text-slate-200 leading-relaxed">
                很遗憾听到您感到不适。在高压下这很常见。让我们试试这三个简单的步骤：
                <ul className="list-disc ml-4 mt-4 space-y-2">
                  <li><strong>颈部倾斜:</strong> 轻轻将头倾向每一侧肩膀。</li>
                  <li><strong>转肩运动:</strong> 向后缓慢绕圈旋转肩膀10次。</li>
                  <li><strong>深呼吸:</strong> 吸气4秒，屏息4秒，呼气4秒。</li>
                </ul>
                您想让我引导您进行一次5分钟的练习吗？
              </div>
            </div>
          </div>
        </div>

        {/* Floating Input Bar */}
        <div className="px-4 lg:px-40 pb-8 pt-4 bg-gradient-to-t from-background-light dark:from-background-dark via-background-light/95 dark:via-background-dark/95 to-transparent">
          <div className="max-w-4xl mx-auto relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-primary/30 to-primary/10 rounded-2xl blur opacity-25 group-focus-within:opacity-50 transition duration-1000 group-focus-within:duration-200"></div>
            <div className="relative flex items-center bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-primary/10 px-4 py-3">
              <button className="p-2 text-slate-400 hover:text-primary transition-colors">
                <span className="material-symbols-outlined">add_circle</span>
              </button>
              <input className="flex-1 bg-transparent border-none focus:ring-0 text-slate-900 dark:text-slate-100 px-4 py-2 placeholder:text-slate-400 outline-none" placeholder="给柯溪头疗发消息..." type="text"/>
              <div className="flex items-center gap-2">
                <button className="p-2 text-slate-400 hover:text-primary transition-colors">
                  <span className="material-symbols-outlined">mic</span>
                </button>
                <button className="p-3 bg-primary text-white rounded-xl shadow-lg shadow-primary/30 hover:bg-primary/90 transition-all flex items-center justify-center">
                  <span className="material-symbols-outlined">send</span>
                </button>
              </div>
            </div>
            <p className="text-[10px] text-center mt-3 text-slate-400 uppercase tracking-widest font-bold">柯溪 AI 可能会提供不准确的信息，请核实重要信息。</p>
          </div>
        </div>
      </main>
    </div>
  );
}