import { NavLink } from 'react-router-dom';

const navItems = [
  { path: '/', icon: 'space_dashboard', label: '首页' },
  { path: '/dashboard', icon: 'dashboard', label: '经营看板' },
  { path: '/knowledge', icon: 'menu_book', label: '知识库' },
  { path: '/financials', icon: 'pie_chart', label: '财务数据' },
  { path: '/scheduling', icon: 'calendar_today', label: '排班管理' },
];

function navClassName(isActive) {
  return [
    'flex items-center gap-4 rounded-2xl px-3 py-3 text-sm transition-all duration-200',
    'motion-reduce:transition-none',
    isActive
      ? 'bg-primary/10 text-primary shadow-sm shadow-primary/10'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-primary/5 dark:hover:text-slate-100',
  ].join(' ');
}

export default function Sidebar1() {
  return (
    <aside className="flex w-20 shrink-0 flex-col border-r border-primary/10 bg-white p-4 transition-all dark:bg-background-dark/50 lg:w-64">
      <div className="mb-10 flex items-center gap-3 px-2">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-sm shadow-primary/30">
          <span className="material-symbols-outlined text-[22px]">spa</span>
        </div>
        <div className="hidden lg:block">
          <h2 className="text-lg font-black tracking-tight text-slate-900 dark:text-slate-100">
            Kexi AI
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">门店经营助手</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            end={item.path === '/'}
            to={item.path}
            className={({ isActive }) => navClassName(isActive)}
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="hidden lg:block">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto border-t border-primary/5 pt-4">
        <button className="flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-primary/5 dark:hover:text-slate-100">
          <span className="material-symbols-outlined">settings</span>
          <span className="hidden lg:block text-sm">系统设置</span>
        </button>
      </div>
    </aside>
  );
}
