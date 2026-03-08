import AppShell from '../components/AppShell';

const metrics = [
  { label: '今日预约', value: '12', detail: '已确认 9 单' },
  { label: '待确认', value: '3', detail: '建议 15 分钟内处理' },
  { label: '在岗技师', value: '8', detail: '晚班缺口 1 人' },
  { label: '门店负载', value: '82%', detail: '18:00 后接近满载' },
];

const appointments = [
  {
    time: '14:00 - 15:30',
    customer: '王小姐',
    service: '深层舒压头疗',
    therapist: 'Lily',
    status: '已签到',
    statusClassName: 'bg-emerald-50 text-emerald-600',
  },
  {
    time: '15:45 - 17:00',
    customer: '李先生',
    service: '中药蒸熏 SPA',
    therapist: 'Emma',
    status: '待到店',
    statusClassName: 'bg-amber-50 text-amber-600',
  },
  {
    time: '18:30 - 20:00',
    customer: '陈女士',
    service: '头皮养护护理',
    therapist: 'Sofia',
    status: '已确认',
    statusClassName: 'bg-primary/10 text-primary',
  },
];

const shifts = [
  { name: 'Lily', values: ['早班', '早班', '早班', '休', '中班', '全天', '全天'] },
  { name: 'Emma', values: ['全天', '请假', '中班', '早班', '早班', '休', '晚班'] },
  { name: 'Sofia', values: ['休', '晚班', '晚班', '全天', '全天', '早班', '早班'] },
  { name: 'Mia', values: ['早班', '中班', '中班', '晚班', '晚班', '全天', '休'] },
];

function shiftClassName(value) {
  if (value === '请假') {
    return 'bg-rose-50 text-rose-600';
  }

  if (value === '休') {
    return 'bg-slate-100 text-slate-400 dark:bg-slate-800';
  }

  return 'bg-primary/10 text-primary';
}

export default function Scheduling() {
  return (
    <AppShell
      title="排班管理"
      subtitle="保持和首页一致的布局与交互节奏，预约、班次和 AI 建议都在同一套界面里完成。"
      actions={
        <>
          <div className="relative min-w-[240px] flex-1 lg:w-80 lg:flex-none">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
              search
            </span>
            <input
              className="w-full rounded-2xl border border-primary/10 bg-white py-3 pl-11 pr-4 text-sm outline-none transition focus:border-primary/40 focus:ring-2 focus:ring-primary/10 dark:bg-slate-900"
              placeholder="搜索预约、技师或门店"
              type="text"
            />
          </div>
          <button className="rounded-2xl border border-primary/10 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:border-primary/30 hover:text-primary dark:bg-slate-900 dark:text-slate-200">
            AI 排班优化
          </button>
          <button className="rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-primary/90">
            新建预约
          </button>
        </>
      }
      toolbar={
        <div className="flex flex-wrap items-center gap-3">
          {['全部门店', '静安旗舰店', '徐汇中心店'].map((item, index) => (
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
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{metric.label}</p>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 dark:text-slate-100">
              {metric.value}
            </h2>
            <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[1.7fr_1fr]">
        <article className="overflow-hidden rounded-[32px] border border-primary/10 bg-white shadow-sm shadow-primary/5 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-primary/5 px-6 py-5">
            <div>
              <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
                今日预约
              </h2>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                优先处理临近到店订单，减少前台来回切换页面的成本。
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
                  <th className="px-6 py-4">时间</th>
                  <th className="px-6 py-4">客户</th>
                  <th className="px-6 py-4">项目</th>
                  <th className="px-6 py-4">技师</th>
                  <th className="px-6 py-4">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-primary/5 dark:divide-slate-800">
                {appointments.map((appointment) => (
                  <tr
                    key={`${appointment.time}-${appointment.customer}`}
                    className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                  >
                    <td className="px-6 py-4 font-semibold text-slate-900 dark:text-slate-100">
                      {appointment.time}
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                      {appointment.customer}
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                      {appointment.service}
                    </td>
                    <td className="px-6 py-4 text-slate-600 dark:text-slate-300">
                      {appointment.therapist}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`rounded-full px-3 py-1 text-xs font-bold ${appointment.statusClassName}`}>
                        {appointment.status}
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
            <h2 className="text-sm font-black uppercase tracking-[0.18em]">AI 排班诊断</h2>
          </div>

          <div className="mt-6 rounded-[28px] border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">高峰提醒</p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              周三 18:00 后预约量预计增加 30%，建议提前把 Lily 和 Sofia 的晚班向前顺延 30 分钟。
            </p>
          </div>

          <div className="mt-4 rounded-[28px] border border-white/10 bg-white/5 p-5">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-400">负载率</p>
            <div className="mt-3 flex items-end justify-between">
              <span className="text-4xl font-black text-white">82%</span>
              <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300">
                可控
              </span>
            </div>
            <div className="mt-4 h-2 rounded-full bg-white/10">
              <div className="h-full rounded-full bg-primary" style={{ width: '82%' }} />
            </div>
          </div>

          <button className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-white transition hover:bg-primary/90">
            一键优化班次
            <span className="material-symbols-outlined text-base">arrow_forward</span>
          </button>
        </article>
      </section>

      <section className="rounded-[32px] border border-primary/10 bg-white p-6 shadow-sm shadow-primary/5 dark:bg-slate-900">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
              本周班次总览
            </h2>
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              用统一表格看清技师排班、请假和高峰班次。
            </p>
          </div>
          <div className="flex gap-2 rounded-full bg-background-light p-1 dark:bg-slate-800">
            <button className="rounded-full bg-white px-4 py-2 text-xs font-bold text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100">
              本周
            </button>
            <button className="rounded-full px-4 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              下周
            </button>
          </div>
        </div>

        <div className="mt-6 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-4 py-4">人员</th>
                <th className="px-4 py-4">周一</th>
                <th className="px-4 py-4">周二</th>
                <th className="px-4 py-4">周三</th>
                <th className="px-4 py-4">周四</th>
                <th className="px-4 py-4">周五</th>
                <th className="px-4 py-4">周六</th>
                <th className="px-4 py-4">周日</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-primary/5 dark:divide-slate-800">
              {shifts.map((shift) => (
                <tr key={shift.name}>
                  <td className="px-4 py-4 font-semibold text-slate-900 dark:text-slate-100">
                    {shift.name}
                  </td>
                  {shift.values.map((value, index) => (
                    <td key={`${shift.name}-${index}`} className="px-4 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${shiftClassName(value)}`}
                      >
                        {value}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
