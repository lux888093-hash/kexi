import { NavLink } from "react-router-dom";

const navItems = [
  { path: "/", icon: "space_dashboard", label: "首页" },
  { path: "/parsing", icon: "document_scanner", label: "智能解析" },
  { path: "/dashboard", icon: "dashboard", label: "经营看板" },
  { path: "/knowledge", icon: "menu_book", label: "知识库" },
  { path: "/financials", icon: "pie_chart", label: "财务数据" },
  { path: "/scheduling", icon: "calendar_today", label: "排班管理" },
];

function navClassName(isActive) {
  return [
    "flex cursor-pointer items-center gap-4 rounded-2xl px-3 py-3 text-sm transition-all duration-200",
    "motion-reduce:transition-none",
    isActive
      ? "bg-[#b6860c]/12 text-[#b6860c] shadow-sm shadow-[#b6860c]/10"
      : "text-slate-600 hover:bg-[#f2ece4] hover:text-[#8b6720]",
  ].join(" ");
}

export default function Sidebar1() {
  return (
    <aside className="flex w-20 shrink-0 flex-col border-r border-black/5 bg-[#fbf7f2] p-4 lg:w-64">
      <div className="mb-10 flex items-center gap-3 px-2 pt-1">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-[#b6860c] text-white shadow-sm shadow-[#b6860c]/30">
          <span className="material-symbols-outlined text-[22px]">spa</span>
        </div>
        <div className="hidden lg:block">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#d96e42]">
            Admetrics
          </p>
          <h2 className="mt-1 text-lg font-extrabold tracking-[-0.03em] text-[#171412]">
            珂溪头疗
          </h2>
          <p className="text-xs text-slate-500">连锁经营中控台</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-2">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            end={item.path === "/"}
            to={item.path}
            className={({ isActive }) => navClassName(isActive)}
          >
            <span className="material-symbols-outlined text-[21px]">
              {item.icon}
            </span>
            <span className="hidden lg:block font-semibold">{item.label}</span>
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto rounded-[28px] border border-black/5 bg-white/80 p-4 shadow-sm shadow-black/5">
        <p className="hidden text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400 lg:block">
          Workspace
        </p>
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            [
              "mt-2 flex w-full items-center gap-4 rounded-2xl px-3 py-3 text-left transition-colors",
              isActive
                ? "bg-[#b6860c]/12 text-[#b6860c] shadow-sm shadow-[#b6860c]/10"
                : "text-slate-600 hover:bg-[#f2ece4] hover:text-[#8b6720]",
            ].join(" ")
          }
        >
          <span className="material-symbols-outlined">settings</span>
          <span className="hidden lg:block text-sm font-semibold">
            系统设置
          </span>
        </NavLink>
      </div>
    </aside>
  );
}
