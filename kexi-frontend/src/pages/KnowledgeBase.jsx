import AppShell from '../components/AppShell';

const knowledgeMetrics = [
  { label: '知识条目', value: '258', detail: '本周新增 18 条' },
  { label: 'FAQ 覆盖率', value: '91%', detail: '高频问题已基本覆盖' },
  { label: '待审核内容', value: '12', detail: '优先处理客服对话沉淀' },
];

const categories = [
  {
    title: '头疗技术',
    description: '沉淀护理手法、疗程步骤、服务口径与客户禁忌说明。',
    count: '124 条',
    icon: 'spa',
    iconClassName: 'bg-primary/10 text-primary',
  },
  {
    title: '客户常见问题',
    description: '整合价格、效果、预约、过敏体质等常见问答模板。',
    count: '89 条',
    icon: 'quiz',
    iconClassName: 'bg-sky-50 text-sky-600',
  },
  {
    title: '产品手册',
    description: '维护精油、头皮仪器、套餐配套产品的使用说明与卖点。',
    count: '45 条',
    icon: 'inventory_2',
    iconClassName: 'bg-emerald-50 text-emerald-600',
  },
];

const syncItems = [
  {
    title: '客户咨询敏感头皮能否做精油护理',
    summary: '系统提取出“敏感头皮推荐低刺激精油”和“先做局部测试”的双重答复模板。',
    status: '已入库',
    statusClassName: 'bg-emerald-50 text-emerald-600',
    time: '今天 10:24',
  },
  {
    title: '客户询问指定理疗师与预约规则',
    summary: 'AI 已识别为高频预约场景，建议同步至前台 SOP 和排班管理话术。',
    status: '待审核',
    statusClassName: 'bg-primary/10 text-primary',
    time: '今天 09:15',
  },
  {
    title: '客户反馈按摩后睡眠改善',
    summary: '建议补充到疗效反馈案例库，供咨询转化和售后回访时引用。',
    status: '已入库',
    statusClassName: 'bg-emerald-50 text-emerald-600',
    time: '昨天 16:45',
  },
];

const reviewQueue = [
  {
    title: '新产品头皮喷雾使用说明',
    owner: '产品经理上传',
    priority: '高优先级',
  },
  {
    title: '疗程卡退款口径',
    owner: '客服团队同步',
    priority: '需要复核',
  },
  {
    title: '春节活动 FAQ',
    owner: '运营团队同步',
    priority: '本周上线',
  },
];

export default function KnowledgeBase() {
  return (
    <AppShell
      title="知识库"
      subtitle="保持与首页一致的外壳和滚动节奏，统一管理知识资产、FAQ 与对话沉淀。"
      actions={
        <>
          <div className="relative min-w-[240px] flex-1 lg:w-80 lg:flex-none">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              search
            </span>
            <input
              className="w-full rounded-2xl border border-primary/10 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/10 dark:bg-slate-900"
              placeholder="搜索知识点、文档或对话"
              type="text"
            />
          </div>
          <button className="rounded-2xl border border-primary/10 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-primary/30 hover:text-primary dark:bg-slate-900 dark:text-slate-200">
            批量整理
          </button>
          <button className="rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90">
            导入知识
          </button>
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          {['全部', '技术', 'FAQ', '产品', '对话沉淀'].map((item, index) => (
            <button
              key={item}
              className={
                index === 0
                  ? 'rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20'
                  : 'rounded-full border border-primary/10 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-primary/30 hover:text-primary dark:bg-slate-900 dark:text-slate-300'
              }
            >
              {item}
            </button>
          ))}
        </div>
      }
    >
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {knowledgeMetrics.map((metric) => (
          <article
            key={metric.label}
            className="rounded-[28px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900"
          >
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{metric.label}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              {metric.value}
            </h2>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="rounded-[32px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
              知识分类
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              让一线咨询、理疗师和运营都能在统一入口里找到同一套答案。
            </p>
          </div>
          <button className="text-sm font-bold text-primary transition hover:opacity-80">
            管理分类
          </button>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
          {categories.map((category) => (
            <article
              key={category.title}
              className="rounded-[28px] border border-primary/10 bg-background-light p-5 transition-transform duration-200 motion-reduce:transition-none motion-safe:hover:-translate-y-1 dark:bg-slate-800/80"
            >
              <div
                className={`flex size-12 items-center justify-center rounded-2xl ${category.iconClassName}`}
              >
                <span className="material-symbols-outlined">{category.icon}</span>
              </div>
              <h3 className="mt-5 text-lg font-bold text-slate-900 dark:text-slate-100">
                {category.title}
              </h3>
              <p className="mt-3 text-sm leading-6 text-slate-500 dark:text-slate-400">
                {category.description}
              </p>
              <div className="mt-6 flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {category.count}
                </span>
                <button className="text-sm font-bold text-primary">查看内容</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.7fr_1fr]">
        <article className="rounded-[32px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
                最近同步的对话知识
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                优先处理高频咨询内容，保证前台和 AI 回复保持一致。
              </p>
            </div>
            <button className="text-sm font-bold text-primary transition hover:opacity-80">
              查看全部
            </button>
          </div>

          <div className="mt-6 space-y-4">
            {syncItems.map((item) => (
              <article
                key={item.title}
                className="rounded-[28px] border border-primary/10 bg-background-light p-5 transition-colors hover:border-primary/30 dark:bg-slate-800/80"
              >
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {item.title}
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                      {item.summary}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className={`rounded-full px-3 py-1 text-xs font-bold ${item.statusClassName}`}>
                      {item.status}
                    </span>
                    <span className="text-xs font-medium text-slate-400">{item.time}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="rounded-[32px] border border-primary/10 bg-slate-900 p-6 text-white shadow-xl shadow-slate-900/10">
          <div className="flex items-center gap-2 text-primary">
            <span className="material-symbols-outlined">fact_check</span>
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">审核面板</h2>
          </div>

          <div className="mt-6 rounded-[28px] border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">知识健康度</p>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-4xl font-black text-white">91%</span>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                较上周 +6%
              </span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-primary" style={{ width: '91%' }} />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            {reviewQueue.map((item) => (
              <div key={item.title} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-bold text-white">{item.title}</h3>
                <p className="mt-1 text-sm text-slate-300">{item.owner}</p>
                <span className="mt-3 inline-flex rounded-full bg-primary/15 px-3 py-1 text-xs font-bold text-primary">
                  {item.priority}
                </span>
              </div>
            ))}
          </div>

          <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-primary/90">
            打开审核工作台
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </article>
      </section>
    </AppShell>
  );
}
