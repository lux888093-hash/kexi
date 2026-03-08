import AppShell from '../components/AppShell';

const metrics = [
  {
    label: '本月收入',
    value: '128,500 元',
    detail: '门店收入同比增长 12.5%',
    toneClassName: 'bg-emerald-50 text-emerald-600',
    change: '+12.5%',
  },
  {
    label: '运营成本',
    value: '45,200 元',
    detail: '主要来自人工与房租水电',
    toneClassName: 'bg-rose-50 text-rose-600',
    change: '-2.3%',
  },
  {
    label: '净利润',
    value: '83,300 元',
    detail: '利润率保持在高位区间',
    toneClassName: 'bg-primary/10 text-primary',
    change: '+15.8%',
  },
  {
    label: '会员储值',
    value: '38,600 元',
    detail: '储值转化主要来自老客复购',
    toneClassName: 'bg-sky-50 text-sky-600',
    change: '+6.2%',
  },
];

const costBreakdown = [
  { name: '人工成本', value: '45%', width: '45%', color: 'bg-primary' },
  { name: '房租水电', value: '30%', width: '30%', color: 'bg-amber-400' },
  { name: '耗材采购', value: '15%', width: '15%', color: 'bg-sky-500' },
  { name: '市场投放', value: '10%', width: '10%', color: 'bg-slate-300' },
];

const transactions = [
  {
    date: '2026-03-08 14:20',
    category: '金牌头疗套餐',
    status: '已完成',
    statusClassName: 'bg-emerald-50 text-emerald-600',
    amount: '+398 元',
  },
  {
    date: '2026-03-08 11:05',
    category: '精油补货',
    status: '已完成',
    statusClassName: 'bg-emerald-50 text-emerald-600',
    amount: '-2,450 元',
    amountClassName: 'text-rose-600',
  },
  {
    date: '2026-03-07 18:45',
    category: '年度 VIP 储值',
    status: '处理中',
    statusClassName: 'bg-amber-50 text-amber-600',
    amount: '+5,000 元',
  },
];

const insights = [
  {
    title: '利润率继续改善',
    body: '头疗核心项目占比提升后，高毛利项目的拉动作用更加明显。',
  },
  {
    title: '成本控制仍有空间',
    body: '耗材采购可进一步集中到月度集中采购，降低零散补货频次。',
  },
  {
    title: '下月收入预测',
    body: '预计可达到 142,000 元，前提是周末高峰时段排班稳定。',
  },
];

export default function Financials() {
  return (
    <AppShell
      title="财务数据"
      subtitle="统一到首页的框架下，减少切换抖动，同时保留财务分析所需的信息密度。"
      actions={
        <>
          <div className="relative min-w-[240px] flex-1 lg:w-80 lg:flex-none">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              search
            </span>
            <input
              className="w-full rounded-2xl border border-primary/10 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/10 dark:bg-slate-900"
              placeholder="搜索报表、流水或科目"
              type="text"
            />
          </div>
          <button className="rounded-2xl border border-primary/10 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-primary/30 hover:text-primary dark:bg-slate-900 dark:text-slate-200">
            本月
          </button>
          <button className="rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90">
            导出报表
          </button>
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          {['总览', '收入', '支出', '利润', 'AI 洞察'].map((item, index) => (
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
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className="rounded-[28px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                  {metric.label}
                </p>
                <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">
                  {metric.value}
                </h2>
              </div>
              <span className={`rounded-full px-3 py-1 text-xs font-bold ${metric.toneClassName}`}>
                {metric.change}
              </span>
            </div>
            <p className="mt-5 text-sm text-slate-500 dark:text-slate-400">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.7fr_1fr]">
        <article className="rounded-[32px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
                月度营收走势
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                过去 6 个月营收保持增长，假日营销与会员复购带来的拉动明显。
              </p>
            </div>
            <div className="flex gap-2 rounded-full bg-background-light p-1 dark:bg-slate-800">
              <button className="rounded-full bg-white px-4 py-2 text-xs font-bold text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100">
                按月
              </button>
              <button className="rounded-full px-4 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                按季
              </button>
            </div>
          </div>

          <div className="mt-8 h-72 rounded-[28px] bg-gradient-to-br from-primary/10 via-white to-white p-4 dark:from-primary/10 dark:via-slate-900 dark:to-slate-900">
            <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 900 280">
              <defs>
                <linearGradient id="financialRevenueGradient" x1="0%" x2="0%" y1="0%" y2="100%">
                  <stop offset="0%" stopColor="rgba(182, 134, 12, 0.25)" />
                  <stop offset="100%" stopColor="rgba(182, 134, 12, 0)" />
                </linearGradient>
              </defs>
              <g stroke="#e2e8f0" strokeDasharray="5 7">
                <line x1="0" x2="900" y1="230" y2="230" />
                <line x1="0" x2="900" y1="170" y2="170" />
                <line x1="0" x2="900" y1="110" y2="110" />
                <line x1="0" x2="900" y1="50" y2="50" />
              </g>
              <path
                d="M0,225 C120,200 200,215 300,160 C390,112 470,76 560,88 C650,100 760,62 900,28 L900,280 L0,280 Z"
                fill="url(#financialRevenueGradient)"
              />
              <path
                d="M0,225 C120,200 200,215 300,160 C390,112 470,76 560,88 C650,100 760,62 900,28"
                fill="none"
                stroke="#b6860c"
                strokeLinecap="round"
                strokeWidth="4"
              />
            </svg>

            <div className="mt-4 grid grid-cols-6 text-center text-xs font-semibold text-slate-400">
              <span>10 月</span>
              <span>11 月</span>
              <span>12 月</span>
              <span>1 月</span>
              <span>2 月</span>
              <span>3 月</span>
            </div>
          </div>
        </article>

        <article className="rounded-[32px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900">
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
              成本结构
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              支出集中在人工与固定成本，材料采购波动相对可控。
            </p>
          </div>

          <div className="mt-8 space-y-5">
            {costBreakdown.map((item) => (
              <div key={item.name} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`h-3 w-3 rounded-full ${item.color}`} />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      {item.name}
                    </span>
                  </div>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {item.value}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.7fr_1fr]">
        <article className="overflow-hidden rounded-[32px] border border-primary/10 bg-white shadow-sm shadow-primary/5 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-primary/5 px-6 py-5">
            <div>
              <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
                最近流水
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                快速查看收入、采购与储值变化，减少切页后重新适应布局的成本。
              </p>
            </div>
            <button className="text-sm font-bold text-primary transition hover:opacity-80">
              查看全部
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-4">日期</th>
                  <th className="px-6 py-4">项目</th>
                  <th className="px-6 py-4">状态</th>
                  <th className="px-6 py-4 text-right">金额</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/5 dark:divide-slate-800">
                {transactions.map((transaction) => (
                  <tr
                    key={`${transaction.date}-${transaction.category}`}
                    className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{transaction.date}</td>
                    <td className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      {transaction.category}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold ${transaction.statusClassName}`}
                      >
                        {transaction.status}
                      </span>
                    </td>
                    <td
                      className={`px-6 py-4 text-right font-bold ${
                        transaction.amountClassName || 'text-slate-900 dark:text-slate-100'
                      }`}
                    >
                      {transaction.amount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="rounded-[32px] border border-primary/10 bg-slate-900 p-6 text-white shadow-xl shadow-slate-900/10">
          <div className="flex items-center gap-2 text-primary">
            <span className="material-symbols-outlined">auto_awesome</span>
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">AI 财务洞察</h2>
          </div>

          <div className="mt-6 space-y-4">
            {insights.map((insight) => (
              <div key={insight.title} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-bold text-white">{insight.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{insight.body}</p>
              </div>
            ))}
          </div>

          <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-primary/90">
            生成详细优化方案
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </article>
      </section>
    </AppShell>
  );
}
