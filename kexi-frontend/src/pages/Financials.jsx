import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from "react";
import AppShell from "../components/AppShell";
import { buildApiUrl, getApiBaseUrl } from "../lib/runtimeConfig";
import StoreComparisonCharts from "../components/StoreComparisonCharts";
import FlexibleChartAnalysis from "../components/FlexibleChartAnalysis";

const currencyFormatter = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 0,
});

const integerFormatter = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});

const gaugePalette = [
  "#8a7667",
  "#d96e42",
  "#e3b04b",
  "#8aa2b3",
  "#be7a61",
  "#93a086",
];

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

function formatCurrency(value) {
  return currencyFormatter.format(Number(value || 0));
}

function formatShortCurrency(value) {
  const numeric = Number(value || 0);

  if (Math.abs(numeric) >= 10000) {
    return `¥${(numeric / 10000).toFixed(1)}万`;
  }

  return formatCurrency(numeric);
}

function formatNumber(value) {
  return integerFormatter.format(Number(value || 0));
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function formatStoreAxisLabel(name) {
  return String(name || "").replace(/店$/, "");
}

async function fetchJson(path, options = {}) {
  const { timeoutMs = 0, ...fetchOptions } = options;
  let response;
  let timeoutId = null;

  if (timeoutMs > 0) {
    const controller = new AbortController();
    fetchOptions.signal = controller.signal;
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  try {
    response = await fetch(buildApiUrl(path), fetchOptions);
  } catch (error) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (error?.name === "AbortError") {
      throw new Error("AI 分析请求超时，请重试。全部门店分析通常需要 1 到 2 分钟。");
    }

    const apiBaseUrl = getApiBaseUrl();
    const localhostHint = apiBaseUrl.includes("localhost")
      ? " 如果你不是在部署机本地打开页面，请把系统设置里的服务地址改成部署机 IP 或域名。"
      : "";
    throw new Error(
      `无法连接到财务服务，请检查系统设置中的服务地址。当前地址：${apiBaseUrl}${localhostHint}`,
    );
  }

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    throw new Error(
      payload.message ||
        `无法连接到财务服务，请检查系统设置中的服务地址。当前地址：${getApiBaseUrl()}`,
    );
  }

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  return payload;
}

function buildQueryString({ storeIds, periodStart, periodEnd }) {
  const params = new URLSearchParams();

  if (storeIds.length) {
    params.set("storeIds", storeIds.join(","));
  }

  if (periodStart === "all" || periodEnd === "all") {
    params.set("periodStart", "all");
    params.set("periodEnd", "all");
    return params.toString();
  }

  if (periodStart) {
    params.set("periodStart", periodStart);
  }

  if (periodEnd) {
    params.set("periodEnd", periodEnd);
  }

  return params.toString();
}

function GaugeDial({
  score,
  size = 128,
  accent = "#d96e42",
  caption = "健康度",
}) {
  const clamped = Math.max(0, Math.min(Number(score || 0), 100));
  const radius = 46;
  const strokeWidth = 12;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-3">
      <svg height={size} viewBox="0 0 120 120" width={size}>
        <circle
          cx="60"
          cy="60"
          fill="none"
          r={radius}
          stroke="rgba(23,20,18,0.08)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="60"
          cy="60"
          fill="none"
          r={radius}
          stroke={accent}
          strokeDasharray={`${dash} ${circumference - dash}`}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          style={{ transform: "rotate(-90deg)", transformOrigin: "60px 60px" }}
        />
        <circle cx="60" cy="60" fill="#fff9f4" r="37" />
        <text
          className="tabular-nums"
          fill="#6d5c4f"
          fontFamily="IBM Plex Sans, Manrope, sans-serif"
          fontSize="24"
          fontWeight="700"
          textAnchor="middle"
          x="60"
          y="58"
        >
          {Math.round(clamped)}
        </text>
        <text
          fill="#7a756e"
          fontSize="11"
          fontWeight="600"
          textAnchor="middle"
          x="60"
          y="74"
        >
          SCORE
        </text>
      </svg>
      <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
        {caption}
      </span>
    </div>
  );
}

function getStoreHealthMeta(score) {
  const numeric = Math.max(0, Math.min(Number(score || 0), 100));

  if (numeric >= 82) {
    return {
      accent: "#d96e42",
      label: "优势",
      soft: "rgba(253, 239, 232, 0.92)",
      track: "rgba(217, 110, 66, 0.16)",
    };
  }

  if (numeric >= 65) {
    return {
      accent: "#b78a34",
      label: "平稳",
      soft: "rgba(251, 244, 223, 0.96)",
      track: "rgba(227, 176, 75, 0.24)",
    };
  }

  return {
    accent: "#8a7667",
    label: "承压",
    soft: "rgba(243, 236, 227, 0.96)",
    track: "rgba(138, 118, 103, 0.18)",
  };
}

function MetricCard({ label, value, detail, accent, note }) {
  return (
    <article className="relative overflow-hidden rounded-[22px] border border-black/5 bg-[rgba(255,251,246,0.92)] px-3.5 py-3 shadow-[0_10px_24px_rgba(22,20,18,0.05)] backdrop-blur">
      <div
        className="absolute bottom-3 left-0 top-3 w-[3px] rounded-full"
        style={{ backgroundColor: accent }}
      />
      <div className="pl-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {label}
          </p>
          <span
            className="shrink-0 rounded-full border border-black/5 px-2 py-0.5 text-[9px] font-bold tracking-[0.14em]"
            style={{ backgroundColor: `${accent}12`, color: accent }}
          >
            {note}
          </span>
        </div>
        <h2 className="mt-2 tabular-nums text-[1.45rem] font-bold tracking-[-0.05em] text-[#171412] lg:text-[1.58rem]">
          {value}
        </h2>
        <p
          className="mt-2 text-[11px] leading-[1.35] text-slate-500"
          style={{
            display: "-webkit-box",
            overflow: "hidden",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {detail}
        </p>
      </div>
    </article>
  );
}

function SectionCard({
  eyebrow,
  title,
  subtitle,
  actions,
  className,
  children,
  tone = "light",
}) {
  const eyebrowClass = tone === "dark" ? "text-[#f3a87b]" : "text-[#d96e42]";
  const titleClass = tone === "dark" ? "text-white" : "text-[#171412]";
  const subtitleClass = tone === "dark" ? "text-slate-300" : "text-slate-500";

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-[34px] border border-black/5 bg-[rgba(255,251,246,0.88)] p-6 shadow-[0_18px_60px_rgba(27,22,19,0.08)] backdrop-blur",
        className,
      )}
    >
      {(eyebrow || title || actions) && (
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            {eyebrow ? (
              <p
                className={cn(
                  "text-[11px] font-bold uppercase tracking-[0.28em]",
                  eyebrowClass,
                )}
              >
                {eyebrow}
              </p>
            ) : null}
            {title ? (
              <h2
                className={cn(
                  "mt-2 text-xl font-extrabold tracking-[-0.04em]",
                  titleClass,
                )}
              >
                {title}
              </h2>
            ) : null}
            {subtitle ? (
              <p className={cn("mt-2 text-sm leading-6", subtitleClass)}>
                {subtitle}
              </p>
            ) : null}
          </div>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      )}
      <div className={cn(title || eyebrow ? "mt-6" : "")}>{children}</div>
    </article>
  );
}

function buildSeriesPoints(trend, key, width, height, padding, maxValue) {
  if (!trend.length) {
    return [];
  }

  return trend.map((point, index) => {
    const usableWidth = width - padding * 2;
    const usableHeight = height - padding * 2;
    const x =
      trend.length === 1
        ? width / 2
        : padding + (usableWidth * index) / (trend.length - 1);
    const y = height - padding - ((point[key] || 0) / maxValue) * usableHeight;

    return {
      x,
      y,
      label: point.label,
    };
  });
}

function toPolyline(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function toArea(points, height, padding) {
  if (!points.length) {
    return "";
  }

  const first = points[0];
  const last = points[points.length - 1];

  return [
    `M ${first.x} ${height - padding}`,
    `L ${first.x} ${first.y}`,
    ...points.slice(1).map((point) => `L ${point.x} ${point.y}`),
    `L ${last.x} ${height - padding}`,
    "Z",
  ].join(" ");
}





function TrendChart({ trend }) {
  if (!trend.length) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-[28px] bg-[#f4ede5] text-sm text-slate-500">
        当前还没有可展示的趋势数据。
      </div>
    );
  }

  if (trend.length === 1) {
    const point = trend[0];
    const snapshotItems = [
      { color: "#8a7667", label: "营收", value: point.revenue },
      { color: "#d96e42", label: "成本", value: point.cost },
      { color: "#8aa2b3", label: "净利润", value: point.profit },
    ];
    const maxValue = Math.max(...snapshotItems.map((item) => item.value), 1);

    return (
      <div className="rounded-[30px] bg-[#f8f2eb] p-4">
        <div className="rounded-[24px] border border-black/5 bg-white/78 px-4 py-4">
          <p className="text-sm leading-6 text-slate-500">
            当前只导入了 {point.label}
            ，还不能形成跨月趋势线，先展示这一个月的经营快照。继续补充 2025 年
            12 月、2026 年 2 月等历史月报后，这里会自动切回趋势图。
          </p>
        </div>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[26px] bg-[linear-gradient(180deg,rgba(255,255,255,0.68),rgba(255,248,242,0.94))] p-4">
            <div className="flex h-[250px] items-end justify-between gap-4">
              {snapshotItems.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-1 flex-col items-center justify-end gap-3"
                >
                  <p className="tabular-nums text-xs font-bold text-slate-500">
                    {formatShortCurrency(item.value)}
                  </p>
                  <div className="flex h-[180px] w-full items-end justify-center rounded-[22px] bg-white/70 px-3 py-3">
                    <div
                      className="w-full rounded-[18px] transition-all"
                      style={{
                        backgroundColor: item.color,
                        height: `${Math.max((item.value / maxValue) * 100, 10)}%`,
                      }}
                    />
                  </div>
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {snapshotItems.map((item) => (
              <div
                key={item.label}
                className="rounded-[24px] bg-white/78 px-4 py-4"
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  {item.label}
                </p>
                <p className="mt-2 text-xl font-bold tracking-[-0.03em] text-[#171412]">
                  {formatCurrency(item.value)}
                </p>
                <div className="mt-3 h-2 rounded-full bg-[#f3ece3]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(item.value / maxValue) * 100}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>
            ))}

            <div className="rounded-[24px] bg-[#fff7f0] px-4 py-4 text-sm leading-6 text-slate-500">
              已识别月份：{point.label}
              。现在显示的是单月结构快照，不是跨月趋势。
            </div>
          </div>
        </div>
      </div>
    );
  }

  const width = 720;
  const height = 280;
  const padding = 28;
  const maxValue = Math.max(
    ...trend.flatMap((point) => [point.revenue, point.cost, point.profit]),
    1,
  );
  const revenuePoints = buildSeriesPoints(
    trend,
    "revenue",
    width,
    height,
    padding,
    maxValue,
  );
  const costPoints = buildSeriesPoints(
    trend,
    "cost",
    width,
    height,
    padding,
    maxValue,
  );
  const profitPoints = buildSeriesPoints(
    trend,
    "profit",
    width,
    height,
    padding,
    maxValue,
  );

  return (
    <div className="rounded-[30px] bg-[#f8f2eb] p-4">
      <svg
        className="h-[260px] w-full"
        preserveAspectRatio="none"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = height - padding - (height - padding * 2) * ratio;

          return (
            <line
              key={ratio}
              stroke="rgba(23,20,18,0.08)"
              strokeDasharray="6 10"
              x1="0"
              x2={width}
              y1={y}
              y2={y}
            />
          );
        })}

        <path
          d={toArea(revenuePoints, height, padding)}
          fill="rgba(217, 110, 66, 0.14)"
        />
        <polyline
          fill="none"
          points={toPolyline(revenuePoints)}
          stroke="#8a7667"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="4"
        />
        <polyline
          fill="none"
          points={toPolyline(costPoints)}
          stroke="#d96e42"
          strokeDasharray="8 10"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <polyline
          fill="none"
          points={toPolyline(profitPoints)}
          stroke="#8aa2b3"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />

        {revenuePoints.map((point, index) => (
          <g key={`${point.label}-${index}`}>
            <circle cx={point.x} cy={point.y} fill="#8a7667" r="4.5" />
            <circle cx={point.x} cy={point.y} fill="#fff8f2" r="2" />
          </g>
        ))}
      </svg>

      <div className="mt-4 grid grid-cols-3 gap-3 text-xs font-semibold text-slate-500 md:grid-cols-6">
        {trend.map((point) => (
          <div
            key={point.period}
            className="rounded-2xl bg-white/70 px-3 py-2 text-center"
          >
            {point.label}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs font-bold uppercase tracking-[0.2em] text-slate-400">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#8a7667]" />
          营收
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#d96e42]" />
          成本
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#8aa2b3]" />
          净利润
        </span>
      </div>
    </div>
  );
}

function DonutChart({ items }) {
  const positiveItems = items.filter((item) => item.value > 0);
  const total = positiveItems.reduce((sum, item) => sum + item.value, 0);
  const displayItems = (() => {
    const baseItems =
      positiveItems.length > 5
        ? [
            ...positiveItems.slice(0, 5),
            {
              name: "其他",
              value: positiveItems
                .slice(5)
                .reduce((sum, item) => sum + item.value, 0),
            },
          ]
        : positiveItems;

    return baseItems
      .filter((item) => item.value > 0)
      .map((item) => ({
        ...item,
        ratio: total > 0 ? item.value / total : 0,
      }));
  })();
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const segments = displayItems.reduce((collection, item, index) => {
    const ratio = total > 0 ? item.value / total : 0;
    const dash = ratio * circumference;
    const previousOffset = collection.length
      ? collection[collection.length - 1].offset +
        collection[collection.length - 1].dash
      : 0;

    collection.push({
      color: gaugePalette[index % gaugePalette.length],
      dash,
      item,
      offset: previousOffset,
    });

    return collection;
  }, []);

  return (
    <div className="grid gap-5 lg:grid-cols-[200px_1fr] lg:items-center">
      <div className="mx-auto">
        <svg height="170" viewBox="0 0 180 180" width="170">
          <circle
            cx="90"
            cy="90"
            fill="none"
            r={radius}
            stroke="rgba(23,20,18,0.08)"
            strokeWidth="18"
          />
          {segments.map((segment) => (
            <circle
              key={segment.item.name}
              cx="90"
              cy="90"
              fill="none"
              r={radius}
              stroke={segment.color}
              strokeDasharray={`${segment.dash} ${circumference - segment.dash}`}
              strokeDashoffset={-segment.offset}
              strokeLinecap="round"
              strokeWidth="18"
              style={{
                transform: "rotate(-90deg)",
                transformOrigin: "90px 90px",
              }}
            />
          ))}
          <circle cx="90" cy="90" fill="#fff9f4" r="48" />
          <text
            className="tabular-nums"
            fill="#171412"
            fontFamily="IBM Plex Sans, Manrope, sans-serif"
            fontSize="18"
            fontWeight="700"
            textAnchor="middle"
            x="90"
            y="84"
          >
            {formatShortCurrency(total)}
          </text>
          <text
            fill="#7a756e"
            fontSize="11"
            fontWeight="600"
            textAnchor="middle"
            x="90"
            y="102"
          >
            COST MIX
          </text>
        </svg>
      </div>

      <div className="space-y-3">
        {displayItems.map((item, index) => (
          <div
            key={item.name}
            className="flex items-center justify-between rounded-2xl bg-[#f8f2eb] px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <span
                className="h-3.5 w-3.5 rounded-full"
                style={{
                  backgroundColor: gaugePalette[index % gaugePalette.length],
                }}
              />
              <div>
                <p className="text-sm font-semibold text-[#171412]">
                  {item.name}
                </p>
                <p className="text-xs text-slate-500">
                  {formatPercent(item.ratio)}
                </p>
              </div>
            </div>
            <span className="tabular-nums text-sm font-bold text-[#171412]">
              {formatCurrency(item.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChannelPanel({ channels }) {
  const maxValue = Math.max(...channels.map((channel) => channel.value), 1);

  return (
    <div className="space-y-4">
      {channels.map((channel, index) => (
        <div key={channel.name} className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="flex items-center gap-3">
              <span
                className="h-3 w-3 rounded-full"
                style={{
                  backgroundColor: gaugePalette[index % gaugePalette.length],
                }}
              />
              <span className="font-semibold text-[#171412]">
                {channel.name}
              </span>
            </div>
            <span className="tabular-nums font-bold text-slate-500">
              {formatPercent(channel.share)}
            </span>
          </div>
          <div className="h-2.5 rounded-full bg-black/5">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(channel.value / maxValue) * 100}%`,
                backgroundColor: gaugePalette[index % gaugePalette.length],
              }}
            />
          </div>
          <p className="tabular-nums text-xs font-semibold text-slate-500">
            {formatCurrency(channel.value)}
          </p>
        </div>
      ))}
    </div>
  );
}

function CommandCenterModal({
  open,
  onClose,
  dashboard,
  analysis,
  selectedStoreSummary,
  scopeModeHint,
  dragActive,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  pendingFiles,
  onChooseFile,
  storeOverride,
  onStoreOverrideChange,
  switcherStores,
  uploadState,
  onUpload,
}) {
  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(24,18,16,0.42)] p-3 backdrop-blur-md lg:items-center lg:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1480px] flex-col overflow-hidden rounded-[36px] border border-white/50 bg-[linear-gradient(135deg,rgba(250,244,238,0.98),rgba(255,255,255,0.94))] shadow-[0_32px_80px_rgba(18,16,14,0.24)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="border-b border-black/5 px-5 py-5 lg:px-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#d96e42]">
                Operations Hub
              </p>
              <h2 className="mt-2 text-2xl font-extrabold tracking-[-0.04em] text-[#171412]">
                上传与财务驾驶舱
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                月报上传中心和财务驾驶舱总览已收进这里。你可以在这个弹层里补录门店报表、查看覆盖情况和当前财务总览。
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                className="flex cursor-pointer items-center gap-2 rounded-2xl border border-[#d96e42]/20 bg-white/90 px-4 py-3 text-sm font-bold text-[#d96e42] transition hover:border-[#d96e42]/40 hover:bg-[#fff7f0]"
                onClick={onChooseFile}
                type="button"
              >
                快速选文件
                <span className="material-symbols-outlined text-base">
                  folder_open
                </span>
              </button>
              <button
                aria-label="关闭上传与总览面板"
                className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-2xl border border-black/5 bg-white/90 text-slate-500 transition hover:border-[#d96e42]/20 hover:text-[#d96e42]"
                onClick={onClose}
                type="button"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-[22px] bg-white/82 px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                当前分析
              </p>
              <p className="mt-2 text-lg font-bold text-[#171412]">
                {selectedStoreSummary}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-500">
                {scopeModeHint}
              </p>
            </div>
            <div className="rounded-[22px] bg-white/82 px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                数据覆盖
              </p>
              <p className="mt-2 text-lg font-bold text-[#171412]">
                {formatNumber(dashboard?.overview?.loadedStoreCount || 0)} / 6
              </p>
              <p className="mt-1 text-sm text-slate-500">
                已导入 {dashboard?.overview?.reportCount || 0} 份门店月报
              </p>
            </div>
            <div className="rounded-[22px] bg-[linear-gradient(135deg,rgba(255,247,240,0.96),rgba(255,255,255,0.88))] px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#d96e42]/70">
                AI 快照
              </p>
              <p className="mt-2 text-sm leading-6 text-[#171412]">
                {analysis?.overall?.summary || "等待数据载入后生成 AI 洞察。"}
              </p>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-6">
          <div className="grid gap-6 xl:grid-cols-[1.12fr_0.88fr]">
            <SectionCard
              eyebrow="Data Intake"
              subtitle="支持逐店上传，也支持一次性拖入多个门店的月度 Excel。文件名里带门店和月份时，系统会自动识别。"
              title="6 店月报上传中心"
            >
              <div
                className={cn(
                  "rounded-[30px] border-2 border-dashed px-6 py-8 transition",
                  dragActive
                    ? "border-[#d96e42] bg-[#fcf1ee]"
                    : "border-black/10 bg-[#f8f2eb]",
                )}
                onDragEnter={onDragEnter}
                onDragLeave={onDragLeave}
                onDragOver={onDragOver}
                onDrop={onDrop}
              >
                <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-lg font-extrabold tracking-[-0.03em] text-[#171412]">
                      拖拽门店报表到这里，或点击上传
                    </p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">
                      当前门店：梅溪湖店、华创店、凯德壹店、万象城店、德思勤店、佳兆业店。
                    </p>
                  </div>
                  <button
                    className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#d96e42]/20 bg-white px-5 py-3 text-sm font-bold text-[#d96e42] transition hover:border-[#d96e42]/40 hover:bg-[#fcf1ee]"
                    onClick={onChooseFile}
                    type="button"
                  >
                    选择文件
                    <span className="material-symbols-outlined text-base">
                      folder_open
                    </span>
                  </button>
                </div>

                {pendingFiles.length ? (
                  <div className="mt-6 grid gap-4 xl:grid-cols-[0.85fr_0.55fr]">
                    <div className="space-y-3">
                      {pendingFiles.map((file) => (
                        <div
                          key={`${file.name}-${file.size}`}
                          className="flex items-center justify-between rounded-2xl bg-white/80 px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[#171412]">
                              {file.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {(file.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                          <span className="rounded-full bg-[#f3ece3] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                            Queue
                          </span>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-[26px] bg-white/80 p-4">
                      <label className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                        单文件门店覆盖
                      </label>
                      <select
                        className="mt-3 w-full rounded-2xl border border-black/5 bg-[#f8f2eb] px-4 py-3 text-sm font-semibold text-slate-600 outline-none focus:border-[#d96e42]/30"
                        disabled={pendingFiles.length !== 1}
                        onChange={(event) =>
                          onStoreOverrideChange(event.target.value)
                        }
                        value={storeOverride}
                      >
                        <option value="">自动识别门店</option>
                        {switcherStores.map((store) => (
                          <option key={store.storeId} value={store.storeId}>
                            {store.storeName}
                          </option>
                        ))}
                      </select>
                      <button
                        className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#d96e42] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#cf6137] disabled:cursor-not-allowed disabled:opacity-50"
                        disabled={uploadState.uploading}
                        onClick={onUpload}
                        type="button"
                      >
                        {uploadState.uploading
                          ? "正在解析报表..."
                          : "导入并刷新面板"}
                        <span className="material-symbols-outlined text-base">
                          arrow_forward
                        </span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-6 rounded-[24px] bg-white/70 px-4 py-4 text-sm text-slate-500">
                    先选择至少 1 份 Excel
                    报表。批量上传时系统会优先根据文件名自动匹配门店。
                  </div>
                )}

                {uploadState.message ? (
                  <div className="mt-4 rounded-[24px] bg-white/80 px-4 py-4 text-sm text-[#171412]">
                    {uploadState.message}
                  </div>
                ) : null}

                {uploadState.errors.length ? (
                  <div className="mt-4 rounded-[24px] bg-[#fcf1ee] px-4 py-4 text-sm text-[#8f5138]">
                    {uploadState.errors.map((item) => (
                      <p key={`${item.fileName}-${item.message}`}>
                        {item.fileName}：{item.message}
                      </p>
                    ))}
                  </div>
                ) : null}
              </div>
            </SectionCard>

            <SectionCard
              eyebrow="Control Tower"
              subtitle="当前默认展示最新月份。你也可以切换到全部月份，查看跨月趋势和累计表现。"
              title="财务驾驶舱总览"
            >
              <div className="grid gap-5 lg:grid-cols-[150px_1fr] lg:items-center">
                <GaugeDial
                  accent="#d96e42"
                  caption={analysis?.overall?.grade || "待分析"}
                  score={dashboard?.overview?.healthScore || 0}
                  size={144}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-[26px] border border-[#d96e42]/15 bg-gradient-to-br from-[#fff7f0] via-[#fffaf5] to-[#f8efe7] px-5 py-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#d96e42]/70">
                      分析视角
                    </p>
                    <p className="mt-3 text-lg font-bold text-[#171412]">
                      {selectedStoreSummary}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      {dashboard?.appliedFilters?.periodStart ===
                      dashboard?.appliedFilters?.periodEnd
                        ? dashboard?.appliedFilters?.periodStart || "最新月份"
                        : `${dashboard?.appliedFilters?.periodStart || "起始"} 至 ${
                            dashboard?.appliedFilters?.periodEnd || "结束"
                          }`}
                    </p>
                    <p className="mt-3 text-sm leading-6 text-slate-500">
                      {scopeModeHint}
                    </p>
                  </div>
                  <div className="rounded-[26px] bg-[#f8f2eb] px-5 py-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                      数据覆盖
                    </p>
                    <p className="mt-3 tabular-nums text-2xl font-bold tracking-[-0.05em] text-[#171412]">
                      {formatNumber(dashboard?.overview?.loadedStoreCount || 0)}{" "}
                      / 6
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      已导入 {dashboard?.overview?.reportCount || 0} 份门店月报
                    </p>
                  </div>
                  <div className="rounded-[26px] bg-[#f8f2eb] px-5 py-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                      最新月份
                    </p>
                    <p className="mt-3 text-lg font-bold text-[#171412]">
                      {dashboard?.overview?.latestPeriod || "未导入"}
                    </p>
                    <p className="mt-1 text-sm text-slate-500">
                      缺少 {dashboard?.overview?.missingStoreCount || 0}{" "}
                      家门店数据
                    </p>
                  </div>
                  <div className="rounded-[26px] bg-[#f8f2eb] px-5 py-5">
                    <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
                      AI 洞察
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[#171412]">
                      {analysis?.overall?.summary ||
                        "等待数据载入后生成 AI 洞察。"}
                    </p>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoreScopeSwitcher({
  stores,
  activeStoreId,
  activeStoreMeta,
  expanded,
  panelRef,
  scopeModeLabel,
  onSelectAllStores,
  onToggle,
  onStoreClick,
}) {
  const loadedStoreCount = stores.filter((store) => store.isLoaded).length;
  const currentStoreLabel = activeStoreMeta?.storeName || "全部门店";

  return (
    <div ref={panelRef} className="relative z-50">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-full bg-[rgba(255,255,255,0.7)] p-2 pr-5 shadow-[0_4px_24px_rgba(22,20,18,0.04)] border border-white/60 backdrop-blur-lg">
        
        {/* Left Section: Current Store & Switcher */}
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            className={cn(
              "group flex items-center gap-3 rounded-full pl-2 pr-4 py-2 transition-all duration-300 border",
              expanded 
                ? "bg-white border-[#d96e42]/20 shadow-[0_8px_20px_rgba(217,110,66,0.06)]" 
                : "bg-white/60 border-transparent hover:bg-white hover:border-black/5 hover:shadow-sm"
            )}
          >
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-gradient-to-br from-[#f8efe6] to-[#f0dfce] text-[#d96e42] shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
              <span className="material-symbols-outlined text-[18px]">
                {activeStoreId === "all" ? "domain" : "storefront"}
              </span>
            </div>
            <div className="text-left">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">
                {activeStoreId === "all" ? "分析视角" : "当前门店"}
              </p>
              <p className="text-sm font-bold text-[#171412] leading-none">
                {currentStoreLabel}
              </p>
            </div>
            <span
              className={cn(
                "material-symbols-outlined text-slate-400 transition-transform duration-300 ml-2 text-[20px]",
                expanded ? "rotate-180 text-[#d96e42]" : ""
              )}
            >
              expand_more
            </span>
          </button>
        </div>

        {/* Right Section: Stats */}
        <div className="flex items-center gap-5">
          <div className="flex flex-col items-end">
             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">模式</span>
             <span className="text-[11px] font-bold text-[#d96e42] bg-[#d96e42]/10 px-2 py-0.5 rounded-md mt-1">{scopeModeLabel}</span>
          </div>
          <div className="w-[1px] h-8 bg-black/5"></div>
          <div className="flex flex-col items-end">
             <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">数据接入</span>
             <span className="text-xs font-bold text-slate-700 mt-1 tabular-nums">{loadedStoreCount} <span className="text-slate-400 font-medium">/ {stores.length || 6}</span></span>
          </div>
        </div>
      </div>

      {/* Animated Dropdown Panel */}
      <div 
        className={cn(
          "grid transition-[grid-template-rows,opacity,transform] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] w-full origin-top",
          expanded ? "grid-rows-[1fr] opacity-100 scale-100 mt-3" : "grid-rows-[0fr] opacity-0 scale-95 mt-0 pointer-events-none"
        )}
      >
        <div className="overflow-hidden">
          <div className="w-full rounded-[28px] border border-black/5 bg-[rgba(255,251,246,0.97)] p-4 shadow-[0_24px_60px_rgba(23,20,18,0.06)] backdrop-blur-xl">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest px-3 mb-3 mt-1">切换分析范围</p>
            <div className="flex flex-col gap-1.5">
              <button
                className={cn(
                  "flex items-center justify-between rounded-[20px] px-4 py-3.5 transition-colors border",
                  activeStoreId === "all"
                    ? "bg-[linear-gradient(135deg,rgba(255,248,242,0.96),rgba(255,255,255,0.92))] border-[#d96e42]/20 text-[#d96e42] shadow-[0_8px_20px_rgba(217,110,66,0.06)]"
                    : "border-transparent hover:bg-white hover:shadow-sm text-[#171412]"
                )}
                onClick={onSelectAllStores}
              >
                <div className="flex items-center gap-4">
                  <span className="material-symbols-outlined text-[24px] opacity-80">domain</span>
                  <div>
                    <p className="font-bold text-[14px] text-left">全部门店 (大盘汇总)</p>
                    {activeStoreId !== "all" && <p className="text-[11px] text-slate-400 text-left mt-0.5">查看 6 店汇总分析</p>}
                  </div>
                </div>
                {activeStoreId === "all" && <span className="material-symbols-outlined text-[20px]">check_circle</span>}
              </button>
              
              <div className="h-[1px] bg-black/5 mx-4 my-2"></div>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-1">
                {stores.map((store) => {
                  const isActive = activeStoreId === store.storeId;
                  return (
                    <button
                      key={store.storeId}
                      className={cn(
                        "flex flex-col items-start rounded-[18px] px-4 py-3 transition-all text-left border",
                        isActive
                          ? "bg-[#d96e42] text-white border-transparent shadow-[0_8px_24px_rgba(217,110,66,0.28)]"
                          : store.isLoaded
                            ? "bg-transparent border-black/5 hover:bg-white hover:border-black/10 text-[#171412] hover:shadow-sm"
                            : "bg-transparent border-dashed border-black/10 opacity-70 hover:opacity-100 transition-opacity text-slate-500"
                      )}
                      onClick={() => onStoreClick(store)}
                    >
                      <span className="font-bold text-[13px]">{store.storeName}</span>
                      <span className={cn("text-[10px] mt-1 font-medium", isActive ? "text-white/80" : "text-slate-400")}>
                        {store.isLoaded ? store.latestPeriod || "已接入" : "未接入数据"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StoreStatusCard({ store, active, onClick, onUpload }) {
  if (!store.isLoaded) {
    return (
      <button
        className="group flex cursor-pointer flex-col rounded-[28px] border border-dashed border-black/10 bg-[#f8f2eb] p-5 text-left transition hover:border-[#d96e42]/40 hover:bg-white"
        onClick={onUpload}
        type="button"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-[#171412]">{store.storeName}</p>
          <span className="rounded-full bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
            待上传
          </span>
        </div>
        <p className="mt-4 text-sm leading-6 text-slate-500">
          还没有导入月度体质表，点击为这家门店上传报表。
        </p>
        <span className="mt-6 inline-flex items-center gap-2 text-sm font-bold text-[#d96e42]">
          上传报表
          <span className="material-symbols-outlined text-base">upload</span>
        </span>
      </button>
    );
  }

  return (
    <button
      className={cn(
        "group flex cursor-pointer flex-col rounded-[30px] border p-5 text-left transition",
        active
          ? "border-[#d96e42]/40 bg-white shadow-[0_18px_45px_rgba(217,110,66,0.12)]"
          : "border-black/5 bg-[rgba(255,251,246,0.72)] hover:border-black/10 hover:bg-white",
      )}
      onClick={onClick}
      type="button"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-[#171412]">{store.storeName}</p>
          <p className="mt-1 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
            {store.latestPeriod || "未识别月份"}
          </p>
        </div>
        <span
          className={cn(
            "rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em]",
            active ? "bg-[#d96e42] text-white" : "bg-[#f3ece3] text-slate-500",
          )}
        >
          {active ? "已筛选" : "可查看"}
        </span>
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <GaugeDial
          accent={
            gaugePalette[(store.healthScore || 0) > 75 ? 2 : active ? 1 : 0]
          }
          caption="门店得分"
          score={store.healthScore}
          size={94}
        />
        <div className="min-w-0 flex-1 space-y-3">
          <div className="rounded-2xl bg-[#f8f2eb] px-4 py-3">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              营收
            </p>
            <p className="tabular-nums mt-1 text-lg font-bold text-[#171412]">
              {formatShortCurrency(store.revenue)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-[#f8f2eb] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                利润率
              </p>
              <p className="tabular-nums mt-1 text-sm font-bold text-[#171412]">
                {formatPercent(store.profitMargin)}
              </p>
            </div>
            <div className="rounded-2xl bg-[#f8f2eb] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                客单价
              </p>
              <p className="tabular-nums mt-1 text-sm font-bold text-[#171412]">
                {formatCurrency(store.avgTicket)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

function StoreMatrixCard({ store, active, onClick, onUpload }) {
  if (!store.isLoaded) {
    return (
      <button
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[28px] border border-dashed border-[#d7c4b6] p-4 text-left transition hover:border-[#d96e42]/40 hover:shadow-[0_24px_52px_rgba(24,20,18,0.08)]"
        style={{
          background:
            "linear-gradient(145deg, rgba(255,252,248,0.98), rgba(248,239,229,0.94) 54%, rgba(245,235,226,0.9))",
        }}
        onClick={onUpload}
        type="button"
      >
        <div className="absolute inset-[1px] rounded-[27px] border border-white/45" />
        <div className="absolute right-[-20px] top-[-16px] h-24 w-24 rounded-full bg-white/60 blur-2xl transition group-hover:scale-110" />
        <div className="absolute bottom-[-22px] left-[-18px] h-24 w-24 rounded-full bg-[#e3b04b]/15 blur-3xl" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold text-[#171412]">{store.storeName}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              等待月报
            </p>
          </div>
          <span className="rounded-full border border-black/5 bg-white px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-slate-500">
            待上传
          </span>
        </div>
        <div className="relative mt-5 rounded-[22px] border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(255,246,238,0.74))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#d96e42]">
            快速补报
          </p>
          <p className="mt-2 text-[13px] leading-5 text-slate-500">
            还没有导入月报，点击后可直接为这家门店补报并纳入分析。
          </p>
        </div>
        <div className="relative mt-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[12px] font-bold text-[#d96e42]">
            上传月报
            <span className="material-symbols-outlined text-[16px]">
              arrow_outward
            </span>
          </span>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,241,233,0.88))] text-[#d96e42] shadow-[0_12px_24px_rgba(217,110,66,0.16)]">
            <span className="material-symbols-outlined text-[18px]">upload</span>
          </span>
        </div>
      </button>
    );
  }

  const healthMeta = getStoreHealthMeta(store.healthScore);
  const clampedScore = Math.max(0, Math.min(Number(store.healthScore || 0), 100));

  return (
    <button
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-[30px] border p-4 text-left transition",
        active
          ? "border-[#d96e42]/35 shadow-[0_28px_60px_rgba(217,110,66,0.14)]"
          : "border-black/5 shadow-[0_18px_42px_rgba(22,20,18,0.07)] hover:border-black/10 hover:shadow-[0_24px_52px_rgba(22,20,18,0.09)]",
      )}
      style={{
        background: active
          ? "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(255,245,238,0.96) 48%, rgba(246,238,231,0.94))"
          : "linear-gradient(145deg, rgba(255,253,250,0.94), rgba(250,243,236,0.92) 56%, rgba(245,237,229,0.9))",
      }}
      onClick={onClick}
      type="button"
    >
      <div className="absolute inset-[1px] rounded-[29px] border border-white/45" />
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: healthMeta.accent }}
      />
      <div
        className="absolute right-[-22px] top-[-18px] h-28 w-28 rounded-full blur-3xl transition group-hover:scale-105"
        style={{ backgroundColor: `${healthMeta.accent}18` }}
      />
      <div className="absolute bottom-[-28px] left-[-18px] h-28 w-28 rounded-full bg-[#8aa2b3]/15 blur-3xl" />
      <div className="absolute right-10 top-16 h-16 w-16 rounded-full border border-white/25 bg-white/10 opacity-70" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-[#171412]">
            {store.storeName}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {store.latestPeriod || "未识别月份"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full border border-white/60 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
            style={{
              background: `linear-gradient(135deg, ${healthMeta.soft}, rgba(255,255,255,0.82))`,
              color: healthMeta.accent,
            }}
          >
            {healthMeta.label}
          </span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
              active
                ? "border-[#d96e42]/10 bg-[linear-gradient(135deg,#d96e42,#e39d78)] text-white"
                : "border-white/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(247,240,232,0.9))] text-slate-500",
            )}
          >
            {active ? "当前" : "切换"}
          </span>
        </div>
      </div>

      <div
        className="relative mt-5 overflow-hidden rounded-[24px] border border-white/70 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
        style={{
          background: `linear-gradient(140deg, rgba(255,255,255,0.92), ${healthMeta.soft} 54%, rgba(247,239,232,0.9))`,
        }}
      >
        <div
          className="absolute right-[-18px] top-[-10px] h-24 w-24 rounded-full blur-3xl"
          style={{ backgroundColor: `${healthMeta.accent}1e` }}
        />
        <div className="absolute bottom-[-22px] left-6 h-20 w-20 rounded-full bg-white/35 blur-2xl" />
        <div className="absolute inset-x-4 top-4 h-px bg-white/70" />
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              健康得分
            </p>
            <div className="mt-2 flex items-end gap-2">
              <span className="tabular-nums text-[2rem] font-bold tracking-[-0.06em] text-[#171412]">
                {Math.round(clampedScore)}
              </span>
              <span
                className="mb-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.14em]"
                style={{
                  backgroundColor: healthMeta.soft,
                  color: healthMeta.accent,
                }}
              >
                {healthMeta.label}
              </span>
            </div>
          </div>
          <span
            className="material-symbols-outlined text-[24px]"
            style={{ color: healthMeta.accent }}
          >
            monitoring
          </span>
        </div>
        <div
          className="mt-4 h-2.5 overflow-hidden rounded-full"
          style={{
            background: `linear-gradient(90deg, rgba(255,255,255,0.45), ${healthMeta.track})`,
          }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${clampedScore}%`,
              background: `linear-gradient(90deg, ${healthMeta.accent}, rgba(255,255,255,0.85))`,
            }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] font-medium text-slate-500">
          <span>经营韧性</span>
          <span className="tabular-nums text-[11px]" style={{ color: healthMeta.accent }}>
            {clampedScore}/100
          </span>
        </div>
      </div>

      <div className="relative mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-[18px] bg-[#f8f2eb] px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            营收
          </p>
          <p className="mt-1 truncate tabular-nums text-[15px] font-bold text-[#171412]">
            {formatShortCurrency(store.revenue)}
          </p>
        </div>
        <div className="rounded-[18px] bg-[#f8f2eb] px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            利润率
          </p>
          <p className="mt-1 tabular-nums text-[15px] font-bold text-[#171412]">
            {formatPercent(store.profitMargin)}
          </p>
        </div>
        <div className="rounded-[18px] bg-[#f8f2eb] px-3 py-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">
            客单价
          </p>
          <p className="mt-1 truncate tabular-nums text-[15px] font-bold text-[#171412]">
            {formatCurrency(store.avgTicket)}
          </p>
        </div>
      </div>

      <div className="relative mt-4 flex items-center justify-between border-t border-black/5 pt-3">
        <p className="text-[11px] text-slate-500">
          {active ? "当前正在查看该门店分析" : "点击切换到该门店分析"}
        </p>
        <span
          className="material-symbols-outlined text-[18px] transition group-hover:translate-x-0.5"
          style={{ color: healthMeta.accent }}
        >
          arrow_outward
        </span>
      </div>
    </button>
  );
}

function StoreMetricRow({ label, value, accent, hint }) {
  return (
    <div
      className="relative flex items-center justify-between gap-4 overflow-hidden rounded-[20px] border border-white/65 px-3.5 py-3.5 shadow-[0_12px_28px_rgba(28,22,18,0.05),inset_0_1px_0_rgba(255,255,255,0.82)]"
      style={{
        background: `linear-gradient(135deg, rgba(255,255,255,0.95), ${accent}10 58%, rgba(248,242,235,0.9))`,
      }}
    >
      <div
        className="absolute bottom-3 left-0 top-3 w-[3px] rounded-full"
        style={{ backgroundColor: accent }}
      />
      <div
        className="absolute right-[-14px] top-[-12px] h-16 w-16 rounded-full blur-2xl"
        style={{ backgroundColor: `${accent}18` }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-white/80" />

      <div className="min-w-0 flex items-center gap-3 pl-1.5">
        <span
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-white/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
          style={{
            background: `linear-gradient(145deg, ${accent}20, rgba(255,255,255,0.78))`,
          }}
        >
          <span
            className="inline-flex h-2.5 w-2.5 rounded-full shadow-[0_0_0_4px_rgba(255,255,255,0.45)]"
            style={{ backgroundColor: accent }}
          />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {label}
          </p>
          <p className="mt-1 truncate text-[11px] text-slate-500">{hint}</p>
        </div>
      </div>
      <p className="relative shrink-0 tabular-nums text-[16px] font-bold tracking-[-0.03em] text-[#171412]">
        {value}
      </p>
    </div>
  );
}

function StoreMatrixCardV2({ store, active, onClick, onUpload }) {
  if (!store.isLoaded) {
    return (
      <button
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[26px] border border-dashed border-black/10 bg-[linear-gradient(180deg,rgba(250,244,236,0.96),rgba(255,251,246,0.92))] p-4 text-left transition hover:border-[#d96e42]/35 hover:bg-white hover:shadow-[0_18px_42px_rgba(24,20,18,0.07)]"
        onClick={onUpload}
        type="button"
      >
        <div className="absolute right-[-20px] top-[-16px] h-24 w-24 rounded-full bg-white/55 blur-2xl transition group-hover:scale-110" />
        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold text-[#171412]">{store.storeName}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              等待月报
            </p>
          </div>
          <span className="rounded-full border border-black/5 bg-white px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-slate-500">
            待上传
          </span>
        </div>
        <div className="relative mt-5 rounded-[20px] border border-white/70 bg-white/70 px-4 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#d96e42]">
            快速补报
          </p>
          <p className="mt-2 text-[13px] leading-5 text-slate-500">
            还没有导入月报，点击后可直接为这家门店补报并纳入分析。
          </p>
        </div>
        <div className="relative mt-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[12px] font-bold text-[#d96e42]">
            上传月报
            <span className="material-symbols-outlined text-[16px]">
              arrow_outward
            </span>
          </span>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#d96e42] shadow-[0_10px_22px_rgba(217,110,66,0.14)]">
            <span className="material-symbols-outlined text-[18px]">upload</span>
          </span>
        </div>
      </button>
    );
  }

  const healthMeta = getStoreHealthMeta(store.healthScore);
  const clampedScore = Math.max(0, Math.min(Number(store.healthScore || 0), 100));

  return (
    <button
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-[26px] border p-4 text-left transition",
        active
          ? "border-[#d96e42]/35 bg-white shadow-[0_20px_44px_rgba(217,110,66,0.12)]"
          : "border-black/5 bg-[rgba(255,251,246,0.82)] hover:border-black/10 hover:bg-white hover:shadow-[0_18px_38px_rgba(22,20,18,0.06)]",
      )}
      onClick={onClick}
      type="button"
    >
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: healthMeta.accent }}
      />
      <div
        className="absolute right-[-22px] top-[-18px] h-28 w-28 rounded-full blur-3xl transition group-hover:scale-105"
        style={{ backgroundColor: `${healthMeta.accent}18` }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-[#171412]">
            {store.storeName}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {store.latestPeriod || "未识别月份"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.16em]"
            style={{ backgroundColor: healthMeta.soft, color: healthMeta.accent }}
          >
            {healthMeta.label}
          </span>
          <span
            className={cn(
              "rounded-full border border-black/5 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em]",
              active ? "bg-[#d96e42] text-white" : "bg-white text-slate-500",
            )}
          >
            {active ? "当前" : "切换"}
          </span>
        </div>
      </div>

      <div className="relative mt-5 rounded-[22px] border border-black/5 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(249,243,236,0.72))] px-4 py-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              健康得分
            </p>
            <div className="mt-2 flex items-end gap-2">
              <span className="tabular-nums text-[2rem] font-bold tracking-[-0.06em] text-[#171412]">
                {Math.round(clampedScore)}
              </span>
              <span
                className="mb-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.14em]"
                style={{
                  backgroundColor: healthMeta.soft,
                  color: healthMeta.accent,
                }}
              >
                {healthMeta.label}
              </span>
            </div>
          </div>
          <span
            className="material-symbols-outlined text-[24px]"
            style={{ color: healthMeta.accent }}
          >
            monitoring
          </span>
        </div>
        <div
          className="mt-4 h-2 overflow-hidden rounded-full"
          style={{ backgroundColor: healthMeta.track }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${clampedScore}%`,
              backgroundColor: healthMeta.accent,
            }}
          />
        </div>
      </div>

      <div className="relative mt-3 space-y-2.5">
        <StoreMetricRow
          accent="#8a7667"
          hint="本月核算营收"
          label="营收"
          value={formatShortCurrency(store.revenue)}
        />
        <StoreMetricRow
          accent={healthMeta.accent}
          hint="经营效率"
          label="利润率"
          value={formatPercent(store.profitMargin)}
        />
        <StoreMetricRow
          accent="#8aa2b3"
          hint="平均消费单价"
          label="客单价"
          value={formatCurrency(store.avgTicket)}
        />
      </div>

      <div className="relative mt-4 flex items-center justify-between border-t border-black/5 pt-3">
        <p className="text-[11px] text-slate-500">
          {active ? "当前正在查看该门店分析" : "点击切换到该门店分析"}
        </p>
        <span
          className="material-symbols-outlined text-[18px] transition group-hover:translate-x-0.5"
          style={{ color: healthMeta.accent }}
        >
          arrow_outward
        </span>
      </div>
    </button>
  );
}

function StoreMatrixCardV3({ store, active, onClick, onUpload }) {
  if (!store.isLoaded) {
    return (
      <button
        className="group relative flex cursor-pointer flex-col overflow-hidden rounded-[30px] border border-dashed border-[#d7c4b6] p-4 text-left transition hover:border-[#d96e42]/45 hover:shadow-[0_24px_52px_rgba(24,20,18,0.08)]"
        style={{
          background:
            "linear-gradient(145deg, rgba(255,252,248,0.98), rgba(248,239,229,0.94) 54%, rgba(245,235,226,0.9))",
        }}
        onClick={onUpload}
        type="button"
      >
        <div className="absolute inset-[1px] rounded-[29px] border border-white/45" />
        <div className="absolute right-[-20px] top-[-16px] h-24 w-24 rounded-full bg-white/60 blur-2xl transition group-hover:scale-110" />
        <div className="absolute bottom-[-22px] left-[-18px] h-24 w-24 rounded-full bg-[#e3b04b]/15 blur-3xl" />

        <div className="relative flex items-start justify-between gap-3">
          <div>
            <p className="text-[15px] font-bold text-[#171412]">{store.storeName}</p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              等待月报
            </p>
          </div>
          <span className="rounded-full border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(247,240,232,0.9))] px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
            待上传
          </span>
        </div>

        <div className="relative mt-5 overflow-hidden rounded-[22px] border border-white/80 bg-[linear-gradient(135deg,rgba(255,255,255,0.82),rgba(255,246,238,0.74))] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
          <div className="absolute right-[-16px] top-[-10px] h-20 w-20 rounded-full bg-[#d96e42]/12 blur-2xl" />
          <p className="relative text-[10px] font-bold uppercase tracking-[0.18em] text-[#d96e42]">
            快速补报
          </p>
          <p className="relative mt-2 text-[13px] leading-5 text-slate-500">
            还没有导入月报，点击后可直接为这家门店补报并纳入分析。
          </p>
        </div>

        <div className="relative mt-4 flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-[12px] font-bold text-[#d96e42]">
            上传月报
            <span className="material-symbols-outlined text-[16px]">
              arrow_outward
            </span>
          </span>
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-[16px] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(255,241,233,0.88))] text-[#d96e42] shadow-[0_12px_24px_rgba(217,110,66,0.16)]">
            <span className="material-symbols-outlined text-[18px]">upload</span>
          </span>
        </div>
      </button>
    );
  }

  const healthMeta = getStoreHealthMeta(store.healthScore);
  const clampedScore = Math.max(0, Math.min(Number(store.healthScore || 0), 100));

  return (
    <button
      className={cn(
        "group relative flex cursor-pointer flex-col overflow-hidden rounded-[30px] border p-4 text-left transition",
        active
          ? "border-[#d96e42]/35 shadow-[0_28px_60px_rgba(217,110,66,0.14)]"
          : "border-black/5 shadow-[0_18px_42px_rgba(22,20,18,0.07)] hover:border-black/10 hover:shadow-[0_24px_52px_rgba(22,20,18,0.09)]",
      )}
      style={{
        background: active
          ? "linear-gradient(145deg, rgba(255,255,255,0.98), rgba(255,245,238,0.96) 48%, rgba(246,238,231,0.94))"
          : "linear-gradient(145deg, rgba(255,253,250,0.94), rgba(250,243,236,0.92) 56%, rgba(245,237,229,0.9))",
      }}
      onClick={onClick}
      type="button"
    >
      <div className="absolute inset-[1px] rounded-[29px] border border-white/45" />
      <div
        className="absolute inset-x-0 top-0 h-[3px]"
        style={{ backgroundColor: healthMeta.accent }}
      />
      <div
        className="absolute right-[-22px] top-[-18px] h-28 w-28 rounded-full blur-3xl transition group-hover:scale-105"
        style={{ backgroundColor: `${healthMeta.accent}18` }}
      />
      <div className="absolute bottom-[-28px] left-[-18px] h-28 w-28 rounded-full bg-[#8aa2b3]/15 blur-3xl" />
      <div className="absolute right-10 top-16 h-16 w-16 rounded-full border border-white/25 bg-white/10 opacity-70" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-bold text-[#171412]">
            {store.storeName}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {store.latestPeriod || "未识别月份"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className="rounded-full border border-white/60 px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
            style={{
              background: `linear-gradient(135deg, ${healthMeta.soft}, rgba(255,255,255,0.82))`,
              color: healthMeta.accent,
            }}
          >
            {healthMeta.label}
          </span>
          <span
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.16em] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]",
              active
                ? "border-[#d96e42]/10 bg-[linear-gradient(135deg,#d96e42,#e39d78)] text-white"
                : "border-white/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.92),rgba(247,240,232,0.9))] text-slate-500",
            )}
          >
            {active ? "当前" : "切换"}
          </span>
        </div>
      </div>

      <div
        className="relative mt-5 overflow-hidden rounded-[24px] border border-white/70 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]"
        style={{
          background: `linear-gradient(140deg, rgba(255,255,255,0.92), ${healthMeta.soft} 54%, rgba(247,239,232,0.9))`,
        }}
      >
        <div
          className="absolute right-[-18px] top-[-10px] h-24 w-24 rounded-full blur-3xl"
          style={{ backgroundColor: `${healthMeta.accent}1e` }}
        />
        <div className="absolute bottom-[-22px] left-6 h-20 w-20 rounded-full bg-white/35 blur-2xl" />
        <div className="absolute inset-x-4 top-4 h-px bg-white/70" />

        <div className="relative flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              健康得分
            </p>
            <div className="mt-2 flex items-end gap-2">
              <span className="tabular-nums text-[2rem] font-bold tracking-[-0.06em] text-[#171412]">
                {Math.round(clampedScore)}
              </span>
              <span
                className="mb-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-[0.14em]"
                style={{
                  backgroundColor: healthMeta.soft,
                  color: healthMeta.accent,
                }}
              >
                {healthMeta.label}
              </span>
            </div>
          </div>
          <span
            className="material-symbols-outlined text-[24px]"
            style={{ color: healthMeta.accent }}
          >
            monitoring
          </span>
        </div>

        <div
          className="mt-4 h-2.5 overflow-hidden rounded-full"
          style={{
            background: `linear-gradient(90deg, rgba(255,255,255,0.45), ${healthMeta.track})`,
          }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${clampedScore}%`,
              background: `linear-gradient(90deg, ${healthMeta.accent}, rgba(255,255,255,0.85))`,
            }}
          />
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] font-medium text-slate-500">
          <span>经营韧性</span>
          <span className="tabular-nums text-[11px]" style={{ color: healthMeta.accent }}>
            {clampedScore}/100
          </span>
        </div>
      </div>

      <div className="relative mt-3 space-y-2.5">
        <StoreMetricRow
          accent="#8a7667"
          hint="本月核算营收"
          label="营收"
          value={formatShortCurrency(store.revenue)}
        />
        <StoreMetricRow
          accent={healthMeta.accent}
          hint="经营效率"
          label="利润率"
          value={formatPercent(store.profitMargin)}
        />
        <StoreMetricRow
          accent="#8aa2b3"
          hint="平均消费单价"
          label="客单价"
          value={formatCurrency(store.avgTicket)}
        />
      </div>

      <div className="relative mt-4 flex items-center justify-between border-t border-white/55 pt-3">
        <p className="text-[11px] text-slate-500">
          {active ? "当前正在查看该门店分析" : "点击切换到该门店分析"}
        </p>
        <span
          className="material-symbols-outlined text-[18px] transition group-hover:translate-x-0.5"
          style={{ color: healthMeta.accent }}
        >
          arrow_outward
        </span>
      </div>
    </button>
  );
}

function StoreSectionBadge({ loaded, total }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-black/6 bg-[#f7f1ea] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
      <span className="inline-flex h-2 w-2 rounded-full bg-[#d96e42]" />
      {loaded} / {total} 已导入
    </div>
  );
}

function StoreMetricLine({ label, value, accent }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-black/6 py-2.5 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className="inline-flex h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: accent }}
        />
        <span className="truncate text-[11px] font-semibold text-slate-500">
          {label}
        </span>
      </div>
      <span className="shrink-0 tabular-nums text-[14px] font-bold text-[#171412]">
        {value}
      </span>
    </div>
  );
}






const storeOverviewBarPalette = [
  "#8a7667",
  "#d96e42",
  "#e3b04b",
  "#8aa2b3",
  "#93a086",
  "#be7a61",
];



function StoreOverviewLineChart(props) {
  return <StoreComparisonCharts {...props} />;
}
function StoreMatrixCardV4({ store, active, onClick, onUpload }) {
  if (!store.isLoaded) {
    return (
      <button
        className="group relative flex cursor-pointer flex-col rounded-[20px] border border-dashed border-[#d8cec4] bg-[#fbf8f4] p-3.5 text-left transition hover:border-[#d96e42]/45 hover:bg-white"
        onClick={onUpload}
        type="button"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[14px] font-bold tracking-[-0.02em] text-[#171412]">
              {store.storeName}
            </p>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
              未导入
            </p>
          </div>
          <span className="material-symbols-outlined text-[18px] text-[#d96e42]">
            upload
          </span>
        </div>
        <div className="mt-3 border-t border-black/6 pt-3">
          <p className="text-[11px] text-slate-500">上传月报后纳入门店分析</p>
        </div>
      </button>
    );
  }

  const healthMeta = getStoreHealthMeta(store.healthScore);
  const clampedScore = Math.max(0, Math.min(Number(store.healthScore || 0), 100));

  return (
    <button
      className={cn(
        "group relative flex cursor-pointer flex-col rounded-[20px] border bg-white p-3.5 text-left transition",
        active
          ? "border-[#171412]/12 shadow-[0_14px_30px_rgba(20,18,16,0.08)]"
          : "border-black/6 shadow-[0_8px_20px_rgba(20,18,16,0.04)] hover:border-black/10 hover:shadow-[0_12px_26px_rgba(20,18,16,0.06)]",
      )}
      onClick={onClick}
      type="button"
    >
      <div
        className="absolute left-0 top-0 h-full w-[3px] rounded-l-[20px]"
        style={{ backgroundColor: active ? "#171412" : healthMeta.accent }}
      />

      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-bold tracking-[-0.02em] text-[#171412]">
            {store.storeName}
          </p>
          <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {store.latestPeriod || "未识别月份"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {active ? (
            <span className="inline-flex h-2 w-2 rounded-full bg-[#171412]" />
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-full bg-[#f6f2ec] px-2.5 py-1 text-[11px] font-bold text-[#171412]">
            <span style={{ color: healthMeta.accent }}>{Math.round(clampedScore)}</span>
            <span className="text-slate-400">分</span>
          </span>
        </div>
      </div>

      <div className="mt-3 pl-1">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
          <span>健康度</span>
          <span style={{ color: healthMeta.accent }}>{healthMeta.label}</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eee7df]">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${clampedScore}%`,
              backgroundColor: healthMeta.accent,
            }}
          />
        </div>
      </div>

      <div className="mt-3 pl-1">
        <StoreMetricLine
          accent="#d96e42"
          label="营收"
          value={formatShortCurrency(store.revenue)}
        />
        <StoreMetricLine
          accent="#e3b04b"
          label="利润率"
          value={formatPercent(store.profitMargin)}
        />
        <StoreMetricLine
          accent="#8aa2b3"
          label="客单价"
          value={formatCurrency(store.avgTicket)}
        />
      </div>
    </button>
  );
}

function ComparisonPanel({ stores, activeStoreId, metric }) {
  if (!stores.length) {
    return (
      <p className="text-sm text-slate-500">当前筛选下没有可对比的门店。</p>
    );
  }

  const width = 760;
  const height = 290;
  const padding = { top: 34, right: 18, bottom: 62, left: 18 };
  const baselineY = height - padding.bottom;
  const usableWidth = width - padding.left - padding.right;
  const usableHeight = height - padding.top - padding.bottom;
  const rankedStores = [...stores].sort(
    (left, right) =>
      Number(right[metric.key] || 0) - Number(left[metric.key] || 0),
  );
  const maxValue = Math.max(
    ...rankedStores.map((store) => Math.max(Number(store[metric.key] || 0), 0)),
    1,
  );
  const columnWidth = usableWidth / Math.max(rankedStores.length, 1);
  const barWidth = Math.min(72, columnWidth * 0.56);

  return (
    <div className="rounded-[24px] bg-[#fcfaf7] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">
            跨店柱状图
          </p>
          <p className="mt-1 text-sm font-bold text-[#171412]">
            按 {metric.label} 查看各门店差距
          </p>
        </div>
        <span className="rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-500">
          最高值 {metric.formatter(maxValue)}
        </span>
      </div>

      <div className="mt-4">
        <svg
          className="h-[290px] w-full"
          preserveAspectRatio="none"
          viewBox={`0 0 ${width} ${height}`}
        >
          {[0.25, 0.5, 0.75, 1].map((ratio) => {
            const y = baselineY - usableHeight * ratio;

            return (
              <line
                key={ratio}
                stroke="rgba(23,20,18,0.08)"
                strokeDasharray="5 8"
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
              />
            );
          })}

          <line
            stroke="rgba(23,20,18,0.12)"
            x1={padding.left}
            x2={width - padding.right}
            y1={baselineY}
            y2={baselineY}
          />

          {rankedStores.map((store, index) => {
            const value = Math.max(Number(store[metric.key] || 0), 0);
            const barHeight = maxValue > 0 ? (value / maxValue) * usableHeight : 0;
            const x = padding.left + columnWidth * index + (columnWidth - barWidth) / 2;
            const y = baselineY - barHeight;
            const active = activeStoreId === store.storeId;
            const barColor =
              storeOverviewBarPalette[index % storeOverviewBarPalette.length];

            return (
              <g key={store.storeId}>
                <text
                  fill={active ? "#171412" : "#8e887f"}
                  fontSize="10.5"
                  fontWeight={active ? "700" : "600"}
                  textAnchor="middle"
                  x={x + barWidth / 2}
                  y={Math.max(y - 8, padding.top - 4)}
                >
                  {metric.formatter(value)}
                </text>
                <rect
                  fill={barColor}
                  fillOpacity={active ? "0.98" : "0.78"}
                  height={barHeight}
                  rx="10"
                  stroke={active ? "#171412" : barColor}
                  strokeWidth={active ? "1.5" : "0"}
                  width={barWidth}
                  x={x}
                  y={y}
                />
                <rect
                  fill="rgba(255,255,255,0.24)"
                  height={Math.min(10, barHeight)}
                  rx="10"
                  width={barWidth}
                  x={x}
                  y={y}
                />
                <text
                  fill={active ? "#171412" : "#7d786f"}
                  fontSize="10.5"
                  fontWeight={active ? "700" : "600"}
                  textAnchor="middle"
                  x={x + barWidth / 2}
                  y={height - 18}
                >
                  {formatStoreAxisLabel(store.storeName)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rankedStores.map((store, index) => {
          const isActive = activeStoreId === store.storeId;

          return (
            <div
              key={store.storeId}
              className={cn(
                "rounded-[18px] border px-3 py-3 transition",
                isActive
                  ? "border-[#d96e42]/20 bg-[linear-gradient(135deg,rgba(255,248,242,0.96),rgba(255,255,255,0.92))]"
                  : "border-black/5 bg-white/82",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                  <span
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{
                      backgroundColor:
                        storeOverviewBarPalette[index % storeOverviewBarPalette.length],
                    }}
                  >
                    {index + 1}
                  </span>
                    <p className="truncate text-sm font-bold text-[#171412]">
                      {store.storeName}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    利润率 {formatPercent(store.profitMargin)} · 健康度{" "}
                    {Math.round(store.healthScore || 0)} 分
                  </p>
                </div>
                <p className="tabular-nums shrink-0 text-sm font-bold text-[#171412]">
                  {metric.formatter(store[metric.key])}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AiList({ title, icon, items, tone = "default" }) {
  const toneStyles = {
    default: {
      card: "border-black/5 bg-white/70 shadow-[0_4px_16px_rgba(0,0,0,0.02)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.04)]",
      header: "bg-slate-50 text-slate-600 border-slate-100",
      icon: "text-slate-400",
      text: "text-slate-600",
      bullet: "bg-slate-200"
    },
    risk: {
      card: "border-[#d96e42]/10 bg-[#fff5f2]/80 shadow-[0_4px_16px_rgba(217,110,66,0.03)] hover:shadow-[0_8px_24px_rgba(217,110,66,0.06)]",
      header: "bg-[#fcf1ee] text-[#b4542e] border-[#f4d3c8]",
      icon: "text-[#d96e42]",
      text: "text-[#8f5138]",
      bullet: "bg-[#d96e42]/40"
    },
    action: {
      card: "border-[#e3b04b]/10 bg-[#fbf4df]/60 shadow-[0_4px_16px_rgba(227,176,75,0.03)] hover:shadow-[0_8px_24px_rgba(227,176,75,0.06)]",
      header: "bg-[#f4eee6] text-[#927231] border-[#f2ddba]",
      icon: "text-[#e3b04b]",
      text: "text-[#7a5c2d]",
      bullet: "bg-[#e3b04b]/40"
    }
  };

  const style = toneStyles[tone] || toneStyles.default;

  return (
    <div className={cn("flex flex-col rounded-[24px] border backdrop-blur-md transition-all duration-300", style.card)}>
      <div className={cn("flex items-center gap-2.5 rounded-t-[24px] border-b px-5 py-3.5", style.header)}>
        <span className={cn("material-symbols-outlined text-[18px]", style.icon)}>{icon}</span>
        <span className="text-[12px] font-bold uppercase tracking-[0.15em]">{title}</span>
      </div>
      <div className="p-5 flex-1">
        <div className="space-y-3.5">
          {items.length ? (
            items.map((item, index) => (
              <div key={index} className="flex items-start gap-3 group">
                <div className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full transition-transform group-hover:scale-150", style.bullet)} />
                <p className={cn("text-[14px] leading-relaxed", style.text)}>
                  {item}
                </p>
              </div>
            ))
          ) : (
            <div className="flex items-center justify-center h-full py-4">
              <p className="text-[13px] text-slate-400 italic">当前没有额外内容。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AiStoreCard({ item }) {
  const priorityMeta =
    item.priority === "high"
      ? {
          label: "High Priority",
          dot: "bg-red-500",
          badge: "bg-red-50 text-red-700 border-red-100",
        }
      : item.priority === "low"
        ? {
            label: "Low Priority",
            dot: "bg-blue-400",
            badge: "bg-blue-50 text-blue-700 border-blue-100",
          }
        : {
            label: "Normal Priority",
            dot: "bg-amber-400",
            badge: "bg-amber-50 text-amber-700 border-amber-100",
          };

  return (
    <article className="group relative overflow-hidden rounded-[28px] border border-black/5 bg-white p-7 shadow-[0_8px_30px_rgba(0,0,0,0.04)] transition-all hover:shadow-[0_16px_40px_rgba(0,0,0,0.08)]">
      {/* Decorative background gradient */}
      <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-gradient-to-br from-[#d96e42]/5 to-transparent blur-3xl transition-transform group-hover:scale-110" />

      <div className="relative z-10 flex items-start justify-between gap-6">
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[#f8f2eb] to-[#f4eee6] text-[#d96e42] shadow-sm">
              <span className="material-symbols-outlined text-[20px]">storefront</span>
            </span>
            <div>
              <h3 className="text-[22px] font-bold tracking-tight text-[#171412]">
                {item.storeName}
              </h3>
              <div className="mt-1 flex items-center gap-2">
                <div
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    priorityMeta.badge,
                  )}
                >
                  <span className={cn("h-1.5 w-1.5 rounded-full", priorityMeta.dot)} />
                  {priorityMeta.label}
                </div>
              </div>
            </div>
          </div>
          <p className="mt-5 text-[15px] leading-relaxed text-slate-600 border-l-2 border-[#d96e42]/20 pl-4">
            {item.summary}
          </p>
        </div>
        <div className="shrink-0 bg-white/50 p-2 rounded-2xl border border-black/5 backdrop-blur-sm shadow-sm">
          <GaugeDial
            accent={item.healthScore >= 75 ? "#4ade80" : item.healthScore >= 60 ? "#fbbf24" : "#f87171"}
            caption={item.grade}
            score={item.healthScore}
            size={90}
          />
        </div>
      </div>

      <div className="relative z-10 mt-8 grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col rounded-[20px] bg-slate-50 p-5 border border-slate-100 transition-colors hover:bg-slate-100/50">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[18px] text-emerald-500">check_circle</span>
            <p className="text-[12px] font-bold uppercase tracking-wider text-slate-700">
              优势
            </p>
          </div>
          <div className="space-y-2.5 text-[13px] leading-relaxed text-slate-600">
            {(item.highlights.length ? item.highlights : ["当前无明显优势项。"]).map((line, idx) => (
              <p key={idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        </div>
        
        <div className="flex flex-col rounded-[20px] bg-red-50/50 p-5 border border-red-100/50 transition-colors hover:bg-red-50">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[18px] text-red-500">warning</span>
            <p className="text-[12px] font-bold uppercase tracking-wider text-red-700">
              风险
            </p>
          </div>
          <div className="space-y-2.5 text-[13px] leading-relaxed text-red-900/80">
            {(item.risks.length ? item.risks : ["当前无明显风险项。"]).map((line, idx) => (
              <p key={idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-red-400" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        </div>

        <div className="flex flex-col rounded-[20px] bg-amber-50/50 p-5 border border-amber-100/50 transition-colors hover:bg-amber-50">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[18px] text-amber-500">lightbulb</span>
            <p className="text-[12px] font-bold uppercase tracking-wider text-amber-700">
              动作
            </p>
          </div>
          <div className="space-y-2.5 text-[13px] leading-relaxed text-amber-900/80">
            {(item.actions.length ? item.actions : ["继续保持当前经营节奏。"]).map((line, idx) => (
              <p key={idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-400" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        </div>
      </div>

      {(item.evidence?.length || 0) > 0 ? (
        <div className="relative z-10 mt-5 rounded-[20px] bg-slate-50/80 p-5 border border-slate-100/80 text-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-[16px] text-slate-400">find_in_page</span>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Data Evidence
            </p>
          </div>
          <div className="space-y-2 text-[13px] leading-relaxed text-slate-600">
            {item.evidence.map((line, idx) => (
              <p key={idx} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-300" />
                <span>{line}</span>
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function AiRuntimeBadge({ agent }) {
  const live = agent?.mode === "llm";
  const badgeClass = live
    ? "border-[#d96e42]/20 bg-[#fff3ec] text-[#b4542e]"
    : "border-[#8a7667]/20 bg-[#f4eee6] text-[#6b5a4d]";

  return (
    <div className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]",
            badgeClass,
          )}
        >
          {live ? "Live AI" : "Fallback"}
        </span>
        {agent?.model ? (
          <span className="rounded-full border border-black/5 bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
            {agent.model}
          </span>
        ) : null}
        {agent?.strategyLabel ? (
          <span className="rounded-full border border-black/5 bg-white px-3 py-1 text-[11px] font-bold tracking-[0.16em] text-slate-500">
            {agent.strategyLabel}
          </span>
        ) : null}
      </div>
      {agent?.statusLine ? (
        <p className="text-xs font-semibold text-slate-500">{agent.statusLine}</p>
      ) : null}
      {agent?.note ? (
        <p className="text-xs leading-5 text-slate-500">{agent.note}</p>
      ) : null}
    </div>
  );
}

function AiAnalysisButton({
  loading,
  disabled,
  onClick,
  label = "点击 AI 分析",
  loadingLabel = "分析中...",
  fullWidth = false,
}) {
  return (
    <button
      className={cn(
        "group relative flex items-center justify-center gap-2 overflow-hidden rounded-2xl bg-[#171412] px-4 py-3 text-sm font-bold text-white shadow-[0_12px_30px_rgba(23,20,18,0.2)] transition-all hover:scale-[1.02] hover:shadow-[0_16px_40px_rgba(23,20,18,0.3)] disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:scale-100",
        fullWidth ? "w-full" : "",
      )}
      disabled={disabled || loading}
      onClick={onClick}
      type="button"
    >
      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-in-out" />
      {loading ? (
        <>
          <span className="material-symbols-outlined text-base animate-spin">sync</span>
          {loadingLabel}
        </>
      ) : (
        <>
          <span className="material-symbols-outlined text-base text-[#d96e42]">auto_awesome</span>
          {label}
        </>
      )}
    </button>
  );
}

function PeriodSelector({ value, options, onChange, label }) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [isOpen]);

  return (
    <>
      <button
        className="flex h-9 items-center rounded-xl bg-transparent px-2 transition-colors hover:bg-slate-50"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        <span className="min-w-[64px] text-center text-sm font-bold text-[#171412]">
          {value === "all" ? "全部" : value}
        </span>
        <span className="material-symbols-outlined ml-1 text-[16px] text-slate-400">
          arrow_drop_down
        </span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          <div 
            className="absolute inset-0 bg-[#f7f2ec]/60 backdrop-blur-sm transition-opacity duration-300"
            onClick={() => setIsOpen(false)}
          />
          <div className="relative w-full max-w-[360px] transform overflow-hidden rounded-[28px] border border-black/5 bg-white p-5 shadow-[0_24px_60px_rgba(23,20,18,0.1)] animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[22px] text-[#d96e42]">calendar_month</span>
                <h3 className="text-base font-bold text-[#171412]">
                  {label || '选择月份'}
                </h3>
              </div>
              <button
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-50 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                onClick={() => setIsOpen(false)}
                type="button"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="custom-scrollbar grid max-h-[40vh] grid-cols-2 gap-2 overflow-y-auto pr-1">
              {options.map((opt) => {
                const isSelected = value === opt;
                const labelStr = opt === "all" ? "全部月份" : opt;
                return (
                  <button
                    key={opt}
                    className={cn(
                      "flex items-center justify-center rounded-[16px] border px-4 py-3.5 transition-all duration-200 text-sm font-bold",
                      isSelected
                        ? "border-transparent bg-[#171412] text-white shadow-md"
                        : "border-black/5 bg-[#fcfaf7] text-slate-600 hover:border-black/15 hover:bg-white hover:text-[#171412] hover:shadow-sm"
                    )}
                    onClick={() => {
                      onChange(opt);
                      setIsOpen(false);
                    }}
                    type="button"
                  >
                    {labelStr}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function Financials() {
  const fileInputRef = useRef(null);
  const scopePanelRef = useRef(null);
  const [dashboard, setDashboard] = useState(null);
  const [referenceDashboard, setReferenceDashboard] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [activeStoreId, setActiveStoreId] = useState("all");
  const [storeScopeOpen, setStoreScopeOpen] = useState(false);
  const [commandCenterOpen, setCommandCenterOpen] = useState(false);
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [storeOverride, setStoreOverride] = useState("");
  const [uploadState, setUploadState] = useState({
    uploading: false,
    message: "",
    errors: [],
  });
  const [pageState, setPageState] = useState({ loading: true, error: "" });
  const [analysisState, setAnalysisState] = useState({
    loading: false,
    error: "",
    requested: false,
  });
  const [refreshToken, setRefreshToken] = useState(0);
  const [dragActive, setDragActive] = useState(false);

  const deferredSearch = useDeferredValue(searchQuery.trim());

  const fetchAnalysis = async () => {
    const activeStoreIds = activeStoreId === "all" ? [] : [activeStoreId];
    const selectedStoreCountForAi = activeStoreIds.length
      ? activeStoreIds.length
      : Number(dashboard?.overview?.selectedStoreCount || dashboard?.storeComparison?.length || 6);
    const analysisTimeoutMs = Math.min(
      300000,
      Math.max(90000, selectedStoreCountForAi * 30000),
    );

    setAnalysisState({
      loading: true,
      error: "",
      requested: true,
    });
    setAnalysis(null);

    try {
      const aiPayload = await fetchJson("/api/financials/ai-analysis", {
        body: JSON.stringify({
          storeIds: activeStoreIds,
          periodStart: periodStart || null,
          periodEnd: periodEnd || null,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
        timeoutMs: analysisTimeoutMs,
      });

      setAnalysis(aiPayload);
      setAnalysisState({
        loading: false,
        error: "",
        requested: true,
      });
    } catch (error) {
      setAnalysis(null);
      setAnalysisState({
        loading: false,
        error: error.message || "AI 分析暂时不可用。",
        requested: true,
      });
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      setPageState((current) => ({ ...current, loading: true, error: "" }));
      setAnalysisState({ loading: false, error: "", requested: false });
      setAnalysis(null);

      try {
        const activeStoreIds = activeStoreId === "all" ? [] : [activeStoreId];
        const query = buildQueryString({
          storeIds: activeStoreIds,
          periodStart,
          periodEnd,
        });
        const referenceQuery = buildQueryString({
          storeIds: [],
          periodStart,
          periodEnd,
        });
        const dashboardPath = query
          ? `/api/financials/dashboard?${query}`
          : "/api/financials/dashboard";
        const referencePath = referenceQuery
          ? `/api/financials/dashboard?${referenceQuery}`
          : "/api/financials/dashboard";

        const [dashboardPayload, referencePayload] = await Promise.all([
          fetchJson(dashboardPath),
          fetchJson(referencePath),
        ]);

        if (cancelled) {
          return;
        }

        setDashboard(dashboardPayload);
        setReferenceDashboard(referencePayload);
        setPageState({ loading: false, error: "" });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setDashboard(null);
        setReferenceDashboard(null);
        setAnalysis(null);
        setPageState({ loading: false, error: error.message });
        setAnalysisState({ loading: false, error: "", requested: false });
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [activeStoreId, periodEnd, periodStart, refreshToken]);

  useEffect(() => {
    if (!storeScopeOpen) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (
        scopePanelRef.current &&
        !scopePanelRef.current.contains(event.target)
      ) {
        setStoreScopeOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [storeScopeOpen]);

  useEffect(() => {
    if (!commandCenterOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleEscape(event) {
      if (event.key === "Escape") {
        setCommandCenterOpen(false);
      }
    }

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [commandCenterOpen]);

  function selectFiles(files) {
    const validFiles = Array.from(files || []).filter((file) =>
      /\.(xlsx|xls|csv)$/i.test(file.name || ""),
    );

    if (!validFiles.length) {
      return;
    }

    setPendingFiles(validFiles);
    setUploadState({ uploading: false, message: "", errors: [] });
  }

  function handleFileChange(event) {
    selectFiles(event.target.files);
  }

  function handleDrag(event) {
    event.preventDefault();
    event.stopPropagation();

    if (event.type === "dragenter" || event.type === "dragover") {
      setDragActive(true);
    } else if (event.type === "dragleave") {
      setDragActive(false);
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setDragActive(false);
    selectFiles(event.dataTransfer.files);
  }

  async function handleUpload() {
    if (!pendingFiles.length) {
      return;
    }

    const nextStoreId = storeOverride;
    const formData = new FormData();
    pendingFiles.forEach((file) => formData.append("files", file));

    if (storeOverride && pendingFiles.length === 1) {
      formData.append("storeId", storeOverride);
    }

    setUploadState({ uploading: true, message: "", errors: [] });

    try {
      const result = await fetchJson("/api/financials/upload", {
        body: formData,
        method: "POST",
      });

      setUploadState({
        uploading: false,
        message: `已导入 ${result.ingested.length} 份报表。`,
        errors: result.errors || [],
      });
      setPendingFiles([]);
      setStoreOverride("");

      if (nextStoreId) {
        setActiveStoreId(nextStoreId);
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }

      startTransition(() => {
        setRefreshToken((current) => current + 1);
      });
    } catch (error) {
      setUploadState({ uploading: false, message: error.message, errors: [] });
    }
  }

  function openCommandCenter() {
    setCommandCenterOpen(true);
  }

  function toggleStoreScopeOpen() {
    setStoreScopeOpen((current) => !current);
  }

  function handleSelectAllStores() {
    setActiveStoreId("all");
    setStoreScopeOpen(false);
  }

  function handleScopeStoreClick(store) {
    if (!store.isLoaded) {
      setStoreOverride(store.storeId);
      fileInputRef.current?.click();
      return;
    }

    setActiveStoreId(store.storeId);
    setStoreScopeOpen(false);
  }

  function handlePeriodStartChange(value) {
    if (value === "all") {
      setPeriodStart("all");
      setPeriodEnd("all");
      return;
    }

    setPeriodStart(value);

    if (periodEnd === "all" || (periodEnd && periodEnd < value)) {
      setPeriodEnd(value);
    }
  }

  function handlePeriodEndChange(value) {
    if (value === "all") {
      setPeriodStart("all");
      setPeriodEnd("all");
      return;
    }

    setPeriodEnd(value);

    if (periodStart === "all" || (periodStart && periodStart > value)) {
      setPeriodStart(value);
    }
  }

  const availablePeriods =
    referenceDashboard?.availablePeriods || dashboard?.availablePeriods || [];
  const activePeriodStart =
    periodStart ||
    dashboard?.appliedFilters?.periodStart ||
    referenceDashboard?.appliedFilters?.periodStart ||
    "all";
  const activePeriodEnd =
    periodEnd ||
    dashboard?.appliedFilters?.periodEnd ||
    referenceDashboard?.appliedFilters?.periodEnd ||
    "all";
  const switcherStores =
    referenceDashboard?.storeStatus || dashboard?.storeStatus || [];
  const loadedStoreCount = switcherStores.filter((store) => store.isLoaded).length;
  const activeStoreMeta =
    activeStoreId === "all"
      ? null
      : switcherStores.find((store) => store.storeId === activeStoreId) || null;
  const searchedStoreStatus = switcherStores.filter((store) =>
    deferredSearch ? store.storeName.includes(deferredSearch) : true,
  );
  const searchedItems = (dashboard?.topCostItems || []).filter((item) => {
    if (!deferredSearch) {
      return true;
    }

    return `${item.categoryName}${item.name}${item.notes}`.includes(
      deferredSearch,
    );
  });
  const searchedAiStores = (analysis?.stores || []).filter((store) =>
    deferredSearch ? store.storeName.includes(deferredSearch) : true,
  );
  const selectedStoreSummary = activeStoreMeta?.storeName || "全部门店";
  const scopeModeLabel = activeStoreMeta ? "单店分析" : "全店分析";
  const scopeModeHint = activeStoreMeta
    ? `当前聚焦 ${activeStoreMeta.storeName}，核心指标与 AI 洞察已经切到单店视角，同时保留全店基准对比。`
    : "当前显示 6 家门店汇总、跨店排名和整体 AI 洞察。";
  const aiOverviewTitle = activeStoreMeta
    ? `${activeStoreMeta.storeName} AI 分析`
    : "全店 AI 分析";
  const aiOverviewSubtitle = activeStoreMeta
    ? `当前为 ${activeStoreMeta.storeName} 的单店分析，AI 结论会围绕这家门店的经营表现展开。`
    : "根据你当前的月份筛选，系统自动生成整体诊断和行动建议。";
  const storeAiTitle = activeStoreMeta
    ? `${activeStoreMeta.storeName} 门店 AI 卡`
    : "单店 AI 分析";
  const storeAiSubtitle = activeStoreMeta
    ? "当前仅展示选中门店的 AI 诊断卡，上方仍保留全店维度的基准视角。"
    : "这里会逐店生成 AI 诊断卡。只要门店报表上传完整，每家店都会得到自己的经营结论、风险和动作建议。";
  const analysisCtaLabel = activeStoreMeta ? "分析当前门店" : "分析全部门店";
  const analysisSummaryPlaceholder = activeStoreMeta
    ? `点击右侧按钮，生成 ${activeStoreMeta.storeName} 的 AI 分析。`
    : "点击右侧按钮开始 AI 分析。系统会先逐店分析，再汇总总分析，通常需要 1 到 2 分钟。";
  const analysisHintText = activeStoreMeta
    ? "当前不会自动分析，避免一直转圈。切换筛选后请手动触发。"
    : "全部门店场景下会先逐店分析，再生成整体总结，耗时会明显高于单店分析。";
  const canRunAnalysis =
    !pageState.loading &&
    !analysisState.loading &&
    Number(dashboard?.overview?.reportCount || 0) > 0;

  return (
    <AppShell
      actions={
        <>
          <div className="relative min-w-[240px] flex-1 lg:w-80 lg:flex-none">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
              search
            </span>
            <input
              className="w-full rounded-2xl border border-black/5 bg-white/85 py-3 pl-11 pr-4 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-[#d96e42]/30 focus:ring-2 focus:ring-[#d96e42]/10"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索门店、成本细项、渠道"
              type="text"
              value={searchQuery}
            />
          </div>

          <div className="flex items-center gap-1.5 rounded-2xl border border-black/5 bg-white/85 p-1.5 shadow-[0_2px_12px_rgba(23,20,18,0.03)] backdrop-blur transition-all focus-within:border-[#d96e42]/30 focus-within:shadow-[0_8px_24px_rgba(217,110,66,0.08)] hover:bg-white">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#f8f2eb] text-[#d96e42]">
              <span className="material-symbols-outlined text-[18px]">calendar_month</span>
            </div>
            
            <PeriodSelector
              value={activePeriodStart}
              options={['all', ...availablePeriods]}
              onChange={handlePeriodStartChange}
              label="起始月份"
            />

            <span className="text-slate-300 material-symbols-outlined text-[16px]">arrow_forward</span>

            <PeriodSelector
              value={activePeriodEnd}
              options={['all', ...availablePeriods]}
              onChange={handlePeriodEndChange}
              label="结束月份"
            />
          </div>

          <div className="flex items-center gap-2">
            <AiAnalysisButton
              disabled={!canRunAnalysis}
              label={analysisCtaLabel}
              loading={analysisState.loading}
              loadingLabel="AI 分析中..."
              onClick={fetchAnalysis}
            />

            <button
              className="flex cursor-pointer items-center gap-2 rounded-2xl bg-white px-4 py-3 text-sm font-bold text-[#171412] border border-black/5 shadow-[0_4px_16px_rgba(0,0,0,0.04)] transition-all hover:bg-slate-50 hover:border-black/10 hover:shadow-[0_8px_24px_rgba(0,0,0,0.06)]"
              onClick={openCommandCenter}
              type="button"
            >
              <span className="material-symbols-outlined text-base text-slate-500">
                dashboard_customize
              </span>
              上传与总览
            </button>
          </div>
        </>
      }
      breadcrumb="经营系统"
      subtitle="上传 6 家门店的月度体质表，系统会自动生成门店经营仪表盘、跨店对比和 AI 财务洞察。"
      title="财务数据罗盘"
      toolbar={
        <StoreScopeSwitcher
          activeStoreId={activeStoreId}
          activeStoreMeta={activeStoreMeta}
          expanded={storeScopeOpen}
          onSelectAllStores={handleSelectAllStores}
          onStoreClick={handleScopeStoreClick}
          onToggle={toggleStoreScopeOpen}
          panelRef={scopePanelRef}
          scopeModeLabel={scopeModeLabel}
          stores={switcherStores}
        />
      }
    >
      <input
        accept=".xlsx,.xls,.csv"
        className="hidden"
        multiple
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      <CommandCenterModal
        analysis={analysis}
        dashboard={dashboard}
        dragActive={dragActive}
        onChooseFile={() => fileInputRef.current?.click()}
        onClose={() => setCommandCenterOpen(false)}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onStoreOverrideChange={setStoreOverride}
        onUpload={handleUpload}
        open={commandCenterOpen}
        pendingFiles={pendingFiles}
        scopeModeHint={scopeModeHint}
        selectedStoreSummary={selectedStoreSummary}
        storeOverride={storeOverride}
        switcherStores={switcherStores}
        uploadState={uploadState}
      />
      {pageState.error ? (
        <div className="rounded-[28px] border border-[#d96e42]/20 bg-[#fcf1ee] px-6 py-5 text-sm text-[#8f5138]">
          {pageState.error}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          accent="#8a7667"
          detail="按当前筛选门店和月份汇总的核算总实收。"
          label="核算营收"
          note={
            dashboard?.overview?.selectedStoreCount
              ? `${dashboard.overview.selectedStoreCount} 店`
              : "汇总"
          }
          value={formatShortCurrency(dashboard?.overview?.revenue)}
        />
        <MetricCard
          accent="#d96e42"
          detail="已自动扣除管理费、平台手续费和各项门店成本。"
          label="净利润"
          note={formatPercent(dashboard?.overview?.profitMargin)}
          value={formatShortCurrency(dashboard?.overview?.profit)}
        />
        <MetricCard
          accent="#e3b04b"
          detail="直接读取报表中的月总客数，便于后续看客单和客成本。"
          label="月总客数"
          note={`${formatNumber(dashboard?.overview?.newMembers || 0)} 新增会员`}
          value={formatNumber(dashboard?.overview?.customerCount)}
        />
        <MetricCard
          accent="#8aa2b3"
          detail="用于观察平台依赖、私域转化和渠道结构变化。"
          label="平台收入占比"
          note={`${formatCurrency(dashboard?.overview?.savingsAmount || 0)} 储蓄`}
          value={formatPercent(dashboard?.overview?.platformRevenueShare)}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.6fr_0.95fr]">
        <SectionCard
          eyebrow="Trend Board"
          subtitle={
            dashboard?.trend?.length > 1
              ? "支持单店跨月追踪，也支持多店累计趋势。"
              : "当前只识别到一个月份，继续补齐历史月报后会自动生成环比趋势。"
          }
          title="营收 / 成本 / 净利润趋势"
        >
          <TrendChart trend={dashboard?.trend || []} />
        </SectionCard>

        <div className="grid gap-6">
          <SectionCard
            eyebrow="Cost Structure"
            subtitle="按开支大类聚合，快速识别本月最重的成本杠杆。"
            title="成本结构盘"
          >
            <DonutChart items={dashboard?.costBreakdown || []} />
          </SectionCard>

          <SectionCard
            eyebrow="Channel Mix"
            subtitle="渠道收入能帮助判断平台抽成压力和私域转化空间。"
            title="渠道结构"
          >
            <ChannelPanel channels={dashboard?.channels || []} />
          </SectionCard>
        </div>
      </section>

      <section className="grid gap-6">
        <SectionCard
          className="rounded-[26px] bg-[rgba(255,252,248,0.9)] p-5 shadow-[0_16px_34px_rgba(22,20,18,0.05)]"
          actions={
            <StoreSectionBadge
              loaded={loadedStoreCount}
              total={switcherStores.length}
            />
          }
          subtitle="把门店概览和跨店对比收进一个分析方块里。上方看折线轮廓，下方直接看柱状图和结构占比。"
          title="门店概览与跨店对比"
        >
          <StoreOverviewLineChart
            activeStoreId={activeStoreId}
            stores={searchedStoreStatus}
          />
        </SectionCard>

        <FlexibleChartAnalysis stores={dashboard?.storeStatus || switcherStores} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SectionCard
          eyebrow="Cost Drilldown"
          subtitle="按细分项查看最大成本开口，方便继续追查采购、推广、平台费或福利费。"
          title="重点成本细项"
        >
          <div className="space-y-4">
            {searchedItems.length ? (
              searchedItems.map((item) => {
                const searchStr = `${item.categoryName || ''} ${item.name || ''}`.toLowerCase();
                let iconMeta = { icon: 'receipt_long', color: 'text-[#d96e42]', bg: 'group-hover:bg-[#fff9f5]', border: 'border-black/5' };
                
                if (searchStr.includes('手工') || searchStr.includes('头疗师') || searchStr.includes('技师') || searchStr.includes('提成') || searchStr.includes('钟费')) {
                  iconMeta = { icon: 'spa', color: 'text-rose-500', bg: 'group-hover:bg-rose-50', border: 'border-rose-100' };
                } else if (searchStr.includes('管理') || searchStr.includes('店长') || searchStr.includes('行政')) {
                  iconMeta = { icon: 'manage_accounts', color: 'text-indigo-500', bg: 'group-hover:bg-indigo-50', border: 'border-indigo-100' };
                } else if (searchStr.includes('房租') || searchStr.includes('水电') || searchStr.includes('物业')) {
                  iconMeta = { icon: 'home_work', color: 'text-blue-500', bg: 'group-hover:bg-blue-50', border: 'border-blue-100' };
                } else if (searchStr.includes('营销') || searchStr.includes('推广') || searchStr.includes('平台') || searchStr.includes('美团') || searchStr.includes('抖音') || searchStr.includes('大众点评')) {
                  iconMeta = { icon: 'campaign', color: 'text-amber-500', bg: 'group-hover:bg-amber-50', border: 'border-amber-100' };
                } else if (searchStr.includes('采购') || searchStr.includes('进货') || searchStr.includes('耗材') || searchStr.includes('产品') || searchStr.includes('材料') || searchStr.includes('物料')) {
                  iconMeta = { icon: 'inventory_2', color: 'text-emerald-500', bg: 'group-hover:bg-emerald-50', border: 'border-emerald-100' };
                } else if (searchStr.includes('福利') || searchStr.includes('团建') || searchStr.includes('社保') || searchStr.includes('公积金')) {
                  iconMeta = { icon: 'redeem', color: 'text-violet-500', bg: 'group-hover:bg-violet-50', border: 'border-violet-100' };
                } else if (searchStr.includes('薪') || searchStr.includes('工资') || searchStr.includes('薪酬') || searchStr.includes('保底')) {
                  iconMeta = { icon: 'payments', color: 'text-teal-500', bg: 'group-hover:bg-teal-50', border: 'border-teal-100' };
                }

                return (
                <div
                  key={`${item.categoryName}-${item.name}`}
                  className="group relative flex flex-col justify-center min-h-[90px] rounded-[24px] border border-[#eadfd3]/50 bg-[#faf7f2]/50 p-5 shadow-[0_2px_8px_rgba(22,20,18,0.02)] transition-all duration-300 hover:bg-white hover:border-[#d96e42]/20 hover:shadow-[0_12px_24px_rgba(217,110,66,0.06)]"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white shadow-sm border transition-transform group-hover:scale-105 ${iconMeta.color} ${iconMeta.border} ${iconMeta.bg}`}>
                        <span className="material-symbols-outlined text-[22px]">{iconMeta.icon}</span>
                      </div>
                      <div className="flex flex-col justify-center">
                        <div className="flex items-center gap-2">
                          <p className="text-[16px] font-bold text-[#171412] truncate">
                            {item.name}
                          </p>
                          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100/80 text-[10px] font-semibold uppercase tracking-widest text-slate-500">
                            {item.categoryName}
                          </span>
                        </div>
                        {item.notes ? (
                          <p className="mt-1 text-[13px] text-slate-500 line-clamp-1 pr-4">
                            {item.notes}
                          </p>
                        ) : (
                          <p className="mt-1 text-[13px] text-slate-400 italic">
                            无附加备注
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end justify-center shrink-0">
                      <span className="tabular-nums text-[18px] font-extrabold text-[#171412]">
                        {formatCurrency(item.value)}
                      </span>
                      <span className="sm:hidden mt-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                        {item.categoryName}
                      </span>
                    </div>
                  </div>
                </div>
                );
              })
            ) : (
              <div className="rounded-[24px] bg-[#f8f2eb] px-4 py-4 text-sm text-slate-500">
                没有命中搜索条件的成本细项。
              </div>
            )}
          </div>
        </SectionCard>

        <SectionCard
          className="border-[#d96e42]/10 bg-[linear-gradient(135deg,rgba(255,249,242,0.94),rgba(255,252,248,0.88))]"
          eyebrow="AI Overview"
          subtitle={aiOverviewSubtitle}
          tone="light"
          title={aiOverviewTitle}
        >
          <div className="space-y-6">
            <div className="relative overflow-hidden rounded-[32px] border border-black/5 bg-gradient-to-br from-white via-white to-[#fff8f5] p-8 shadow-[0_8px_30px_rgba(217,110,66,0.04)]">
              {/* Background accent */}
              <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-gradient-to-br from-[#d96e42]/10 to-transparent blur-3xl" />
              
              <div className="relative z-10 flex flex-col md:flex-row items-start md:items-center justify-between gap-8">
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-3 mb-4">
                    <div className="flex items-center gap-1.5 rounded-full bg-[#fff1eb] px-3 py-1 text-[#d96e42] border border-[#d96e42]/20">
                      <span className="material-symbols-outlined text-[14px]">auto_awesome</span>
                      <span className="text-[11px] font-bold uppercase tracking-[0.15em]">AI Overview</span>
                    </div>
                    <AiRuntimeBadge agent={analysis?.agent} />
                  </div>
                  
                  <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#171412] leading-tight mb-4">
                    {analysis?.overall?.summary || analysisSummaryPlaceholder}
                  </h3>

                  {!analysis?.overall?.summary ? (
                    <p className="max-w-[620px] text-sm leading-6 text-slate-500">
                      {analysisHintText}
                    </p>
                  ) : null}

                  {analysis?.overall?.ownerBrief ? (
                    <div className="mt-6 rounded-[24px] border-l-4 border-[#d96e42] bg-white p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="material-symbols-outlined text-[18px] text-[#d96e42]">record_voice_over</span>
                        <p className="text-[12px] font-bold uppercase tracking-[0.15em] text-slate-800">
                          老板速读 (Owner Brief)
                        </p>
                      </div>
                      <p className="text-[15px] leading-relaxed text-slate-600 font-medium">
                        {analysis.overall.ownerBrief}
                      </p>
                    </div>
                  ) : null}
                </div>
                
                <div className="shrink-0 self-center md:self-start bg-white rounded-3xl p-4 shadow-[0_8px_24px_rgba(0,0,0,0.04)] border border-black/5 md:w-[240px]">
                  {analysis?.overall ? (
                    <div className="flex flex-col items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Health Score</span>
                      <GaugeDial
                        accent={analysis?.overall?.healthScore >= 75 ? "#4ade80" : analysis?.overall?.healthScore >= 60 ? "#fbbf24" : "#f87171"}
                        caption={analysis?.overall?.grade || "AI"}
                        score={analysis?.overall?.healthScore || 0}
                        size={140}
                      />
                    </div>
                  ) : (
                    <div className="flex h-full flex-col justify-center gap-4 rounded-[24px] bg-[#fff8f3] p-4">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#d96e42]">
                          AI 入口
                        </p>
                        <p className="mt-2 text-sm leading-6 text-slate-500">
                          这里现在改成手动触发，不会一进页面就卡在“分析中”。
                        </p>
                      </div>
                      <AiAnalysisButton
                        disabled={!canRunAnalysis}
                        fullWidth
                        label={analysisCtaLabel}
                        loading={analysisState.loading}
                        loadingLabel="AI 分析中..."
                        onClick={fetchAnalysis}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {analysis?.overall ? (
              <>
                <div className="grid gap-4 lg:grid-cols-3">
                  <AiList
                    icon="award_star"
                    items={analysis?.overall?.highlights || []}
                    title="亮点"
                  />
                  <AiList
                    icon="warning"
                    items={analysis?.overall?.risks || []}
                    title="风险"
                    tone="risk"
                  />
                  <AiList
                    icon="trending_up"
                    items={analysis?.overall?.actions || []}
                    title="动作"
                    tone="action"
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <AiList
                    icon="leaderboard"
                    items={analysis?.overall?.rankingSnapshot || []}
                    title="Ranking"
                  />
                  <AiList
                    icon="crisis_alert"
                    items={analysis?.overall?.anomalies || []}
                    title="Anomalies"
                    tone="risk"
                  />
                  <AiList
                    icon="event_note"
                    items={analysis?.overall?.plan30d || []}
                    title="30D Plan"
                    tone="action"
                  />
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <AiList
                    icon="lab_profile"
                    items={analysis?.overall?.diagnosis || []}
                    title="Diagnosis"
                  />
                  <AiList
                    icon="inventory_2"
                    items={analysis?.overall?.dataGaps || []}
                    title="Data Gaps"
                    tone="risk"
                  />
                </div>
              </>
            ) : (
              <div className="rounded-[28px] border border-dashed border-[#d96e42]/20 bg-white/80 px-5 py-6 text-sm leading-6 text-slate-500">
                当前不会自动触发 AI。先确认门店和月份筛选，然后点击右侧或顶部的 AI 按钮开始分析。
              </div>
            )}
          </div>
        </SectionCard>
      </section>

      <SectionCard
        eyebrow="Store AI"
        subtitle={storeAiSubtitle}
        title={storeAiTitle}
      >
        {analysisState.loading ? (
          <div className="rounded-[28px] bg-[#f8f2eb] px-5 py-8 text-sm text-slate-500">
            正在生成门店 AI 洞察，请稍候...
          </div>
        ) : analysisState.error ? (
          <div className="rounded-[28px] border border-[#d96e42]/20 bg-[#fcf1ee] px-5 py-8 text-sm text-[#8f5138]">
            <p>{analysisState.error}</p>
            <div className="mt-4">
              <AiAnalysisButton
                disabled={!canRunAnalysis}
                label="重新尝试 AI 分析"
                loading={analysisState.loading}
                onClick={fetchAnalysis}
              />
            </div>
          </div>
        ) : searchedAiStores.length ? (
          <div className="grid gap-6 xl:grid-cols-2">
            {searchedAiStores.map((item) => (
              <AiStoreCard key={item.storeId} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-[28px] bg-[#f8f2eb] px-5 py-8 text-sm text-slate-500">
            <p>
              {analysisState.requested
                ? "当前筛选下没有可展示的门店 AI 分析。"
                : "还没有执行 AI 分析。点击下面按钮开始。"}
            </p>
            {!analysisState.requested ? (
              <div className="mt-4">
                <AiAnalysisButton
                  disabled={!canRunAnalysis}
                  label={analysisCtaLabel}
                  loading={analysisState.loading}
                  onClick={fetchAnalysis}
                />
              </div>
            ) : null}
          </div>
        )}
      </SectionCard>
    </AppShell>
  );
}
