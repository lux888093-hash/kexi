import Sidebar1 from './Sidebar1';

export default function AppShell({
  title,
  subtitle,
  actions,
  toolbar,
  children,
  breadcrumb = '首页',
}) {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-transparent text-slate-900">
      <Sidebar1 />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-transparent">
        <header className="relative z-50 shrink-0 border-b border-black/5 bg-[#f7f2ec]/80 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-6 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.24em] text-slate-400">
                <span>{breadcrumb}</span>
                <span className="material-symbols-outlined text-sm text-slate-300">
                  chevron_right
                </span>
                <span className="truncate text-[#d96e42]">{title}</span>
              </div>

              <div className="mt-2">
                <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[#171412] lg:text-[2rem]">
                  {title}
                </h1>
                {subtitle ? (
                  <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    {subtitle}
                  </p>
                ) : null}
              </div>
            </div>

            {actions ? (
              <div className="flex w-full flex-wrap items-center gap-3 lg:w-auto lg:justify-end">
                {actions}
              </div>
            ) : null}
          </div>

          {toolbar ? (
            <div className="border-t border-black/5">
              <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-6 py-4 lg:px-8">
                {toolbar}
              </div>
            </div>
          ) : null}
        </header>

        <div className="app-scroll-area min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 lg:px-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
