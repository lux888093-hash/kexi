import AppShell from '../components/AppShell';

const storeFilters = ['全部门店', '静安旗舰店', '徐汇中心店', '浦东嘉里店'];

const metrics = [
  {
    title: '今日预约',
    value: '42',
    detail: '到店率 88%，较昨日多 5 单',
    change: '+12%',
    changeClassName: 'bg-emerald-50 text-emerald-600',
    icon: 'event_available',
    iconClassName: 'bg-emerald-50 text-emerald-600',
  },
  {
    title: '今日营收',
    value: '15,280 元',
    detail: '客单价 364 元，目标完成 92%',
    change: '+8.4%',
    changeClassName: 'bg-primary/10 text-primary',
    icon: 'payments',
    iconClassName: 'bg-primary/10 text-primary',
  },
  {
    title: '新客占比',
    value: '24%',
    detail: '新客 14 人，复购客 44 人',
    change: '+3.2%',
    changeClassName: 'bg-sky-50 text-sky-600',
    icon: 'person_add',
    iconClassName: 'bg-sky-50 text-sky-600',
  },
  {
    title: '疗程转化率',
    value: '18.5%',
    detail: '高于本周均值 1.8 个点',
    change: '+1.8%',
    changeClassName: 'bg-violet-50 text-violet-600',
    icon: 'trending_up',
    iconClassName: 'bg-violet-50 text-violet-600',
  },
];

const serviceMix = [
  { name: '深层清洁头疗', value: '45%', width: '45%', color: 'bg-primary' },
  { name: '肩颈放松护理', value: '30%', width: '30%', color: 'bg-amber-400' },
  { name: '精油舒压疗程', value: '15%', width: '15%', color: 'bg-sky-500' },
  { name: '其他项目', value: '10%', width: '10%', color: 'bg-slate-300' },
];

const branchPerformance = [
  {
    name: '静安旗舰店',
    orders: '24 单',
    conversion: '18.5%',
    rating: '4.8',
    status: '超预期',
    statusClassName: 'bg-emerald-50 text-emerald-600',
  },
  {
    name: '徐汇中心店',
    orders: '18 单',
    conversion: '12.2%',
    rating: '4.6',
    status: '稳步增长',
    statusClassName: 'bg-primary/10 text-primary',
  },
  {
    name: '浦东嘉里店',
    orders: '16 单',
    conversion: '11.4%',
    rating: '4.5',
    status: '关注排班',
    statusClassName: 'bg-amber-50 text-amber-600',
  },
];

const aiInsights = [
  {
    title: '晚间时段还有增量空间',
    body: '18:00 后咨询量上涨，但徐汇中心店预约承接不足，建议优先补充一名技师晚班。',
  },
  {
    title: '深层清洁项目拉动明显',
    body: '该项目带来的营收贡献超过 45%，适合在首页快捷入口和知识库中同步强化推荐话术。',
  },
  {
    title: '会员转化可继续推进',
    body: '今日新客中有 6 人咨询疗程卡，前台可以在离店前触发二次跟进，提高成单率。',
  },
];

function MetricCard({ metric }) {
  return (
    <article className="rounded-[28px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 transition-transform duration-200 motion-reduce:transition-none motion-safe:hover:-translate-y-1 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{metric.title}</p>
          <h3 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">
            {metric.value}
          </h3>
        </div>

        <div
          className={`flex size-12 items-center justify-center rounded-2xl ${metric.iconClassName}`}
        >
          <span className="material-symbols-outlined">{metric.icon}</span>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500 dark:text-slate-400">{metric.detail}</p>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${metric.changeClassName}`}
        >
          {metric.change}
        </span>
      </div>
    </article>
  );
}

export default function Dashboard() {
  return (
    <AppShell
      title="经营看板"
      subtitle="沿用首页的统一壳层和节奏，稳定展示门店经营、营收趋势与 AI 建议。"
      actions={
        <>
          <div className="relative min-w-[240px] flex-1 lg:w-80 lg:flex-none">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              search
            </span>
            <input
              className="w-full rounded-2xl border border-primary/10 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/10 dark:bg-slate-900"
              placeholder="搜索门店、报表或项目"
              type="text"
            />
          </div>
          <button className="rounded-2xl border border-primary/10 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-primary/30 hover:text-primary dark:bg-slate-900 dark:text-slate-200">
            本周视图
          </button>
          <button className="rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90">
            导出周报
          </button>
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          {storeFilters.map((store, index) => (
            <button
              key={store}
              className={
                index === 0
                  ? 'rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20'
                  : 'rounded-full border border-primary/10 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-primary/30 hover:text-primary dark:bg-slate-900 dark:text-slate-300'
              }
            >
              {store}
            </button>
          ))}
        </div>
      }
    >
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <MetricCard key={metric.title} metric={metric} />
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.7fr_1fr]">
        <article className="rounded-[32px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
                近 7 日营收趋势
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                周五和周末出现明显峰值，说明晚间排班和节假日活动仍是主要拉动因素。
              </p>
            </div>
            <div className="flex gap-2 rounded-full bg-background-light p-1 dark:bg-slate-800">
              <button className="rounded-full bg-white px-4 py-2 text-xs font-bold text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100">
                按日
              </button>
              <button className="rounded-full px-4 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                按周
              </button>
            </div>
          </div>

          <div className="mt-8 h-72 rounded-[28px] bg-gradient-to-br from-primary/10 via-white to-white p-4 dark:from-primary/10 dark:via-slate-900 dark:to-slate-900">
            <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 900 280">
              <defs>
                <linearGradient id="dashboardRevenueGradient" x1="0%" x2="0%" y1="0%" y2="100%">
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
                d="M0,220 C90,215 140,190 210,180 C290,168 360,198 450,122 C540,45 630,58 720,96 C790,126 850,76 900,36 L900,280 L0,280 Z"
                fill="url(#dashboardRevenueGradient)"
              />
              <path
                d="M0,220 C90,215 140,190 210,180 C290,168 360,198 450,122 C540,45 630,58 720,96 C790,126 850,76 900,36"
                fill="none"
                stroke="#b6860c"
                strokeLinecap="round"
                strokeWidth="4"
              />
              <circle cx="210" cy="180" fill="#b6860c" r="5" />
              <circle cx="450" cy="122" fill="#b6860c" r="6" />
              <circle cx="720" cy="96" fill="#b6860c" r="5" />
              <circle cx="900" cy="36" fill="#b6860c" r="6" />
            </svg>

            <div className="mt-4 grid grid-cols-7 text-center text-xs font-semibold text-slate-400">
              <span>周一</span>
              <span>周二</span>
              <span>周三</span>
              <span>周四</span>
              <span>周五</span>
              <span>周六</span>
              <span>周日</span>
            </div>
          </div>
        </article>

        <article className="rounded-[32px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
                项目结构
              </h2>
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                头疗核心项目仍然贡献大部分收入。
              </p>
            </div>
            <div className="flex size-14 items-center justify-center rounded-full border-[10px] border-primary/15 text-sm font-black text-primary">
              45%
            </div>
          </div>

          <div className="mt-8 space-y-5">
            {serviceMix.map((item) => (
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
                门店表现
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                聚焦当日接待效率、转化率和用户满意度。
              </p>
            </div>
            <button className="text-sm font-bold text-primary transition hover:opacity-80">
              查看明细
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  <th className="px-6 py-4">门店</th>
                  <th className="px-6 py-4">今日单量</th>
                  <th className="px-6 py-4">转化率</th>
                  <th className="px-6 py-4">评分</th>
                  <th className="px-6 py-4">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/5 dark:divide-slate-800">
                {branchPerformance.map((branch) => (
                  <tr
                    key={branch.name}
                    className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      {branch.name}
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{branch.orders}</td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                      {branch.conversion}
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">{branch.rating}</td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${branch.statusClassName}`}>
                        {branch.status}
                      </span>
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
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">AI 建议</h2>
          </div>

          <div className="mt-6 space-y-4">
            {aiInsights.map((insight) => (
              <div key={insight.title} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                <h3 className="text-sm font-bold text-white">{insight.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-300">{insight.body}</p>
              </div>
            ))}
          </div>

          <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-primary/90">
            生成本周优化方案
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </article>
      </section>
    </AppShell>
  );
}
