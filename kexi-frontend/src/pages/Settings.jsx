import { useEffect, useState } from "react";
import AppShell from "../components/AppShell";
import {
  DEFAULT_API_BASE_URL,
  buildApiUrl,
  getApiBaseUrl,
  normalizeApiBaseUrl,
  saveApiBaseUrl,
} from "../lib/runtimeConfig";

async function requestJson(baseUrl, path, options) {
  const response = await fetch(buildApiUrl(path, baseUrl), options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.message || "请求失败，请检查服务地址。");
  }

  return payload;
}

function cn(...classes) {
  return classes.filter(Boolean).join(" ");
}

function StatusBadge({ status, children }) {
  const className =
    status === "success"
      ? "bg-emerald-50 text-emerald-700"
      : status === "error"
        ? "bg-[#fcf1ee] text-[#b45d3d]"
        : "bg-[#f4eee6] text-slate-500";

  return (
    <span
      className={cn(
        "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.18em]",
        className,
      )}
    >
      {children}
    </span>
  );
}

function FieldShell({ label, hint, children }) {
  return (
    <label className="block">
      <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">
        {label}
      </p>
      <div className="mt-3">{children}</div>
      {hint ? (
        <p className="mt-2 text-sm leading-6 text-slate-500">{hint}</p>
      ) : null}
    </label>
  );
}

export default function Settings() {
  const [apiBaseUrl, setApiBaseUrl] = useState(getApiBaseUrl());
  const [zhipuApiKey, setZhipuApiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState("");
  const [hasStoredKey, setHasStoredKey] = useState(false);
  const [updatedAt, setUpdatedAt] = useState("");
  const [connection, setConnection] = useState({
    checking: false,
    message: "等待检测",
    status: "idle",
  });
  const [saveState, setSaveState] = useState({
    message: "",
    saving: false,
    status: "idle",
  });

  async function loadSettings(baseUrl = getApiBaseUrl()) {
    const normalized = normalizeApiBaseUrl(baseUrl);

    setConnection({
      checking: true,
      message: `正在检测 ${normalized}`,
      status: "idle",
    });

    try {
      const [health, settings] = await Promise.all([
        requestJson(normalized, "/api/system/health"),
        requestJson(normalized, "/api/system/settings"),
      ]);

      setApiBaseUrl(normalized);
      setMaskedKey(settings.zhipuApiKeyMasked || "");
      setHasStoredKey(Boolean(settings.hasZhipuApiKey));
      setUpdatedAt(settings.updatedAt || "");
      setConnection({
        checking: false,
        message: `已连接 ${health.service}，当前共有 ${health.reportCount} 份月报数据。`,
        status: "success",
      });
    } catch {
      setConnection({
        checking: false,
        message: `${normalized} 无法连接。请确认后端已启动，或修改为正确地址。`,
        status: "error",
      });
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSettings();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, []);

  async function handleTestConnection() {
    setSaveState({ message: "", saving: false, status: "idle" });
    await loadSettings(apiBaseUrl);
  }

  async function handleSave() {
    const normalized = saveApiBaseUrl(apiBaseUrl);
    const payload = {
      llmProvider: "zhipu",
    };

    if (zhipuApiKey.trim()) {
      payload.zhipuApiKey = zhipuApiKey.trim();
    }

    setSaveState({
      message: "正在保存系统设置...",
      saving: true,
      status: "idle",
    });

    try {
      const result = await requestJson(normalized, "/api/system/settings", {
        body: JSON.stringify(payload),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });

      setMaskedKey(result.settings?.zhipuApiKeyMasked || "");
      setHasStoredKey(Boolean(result.settings?.hasZhipuApiKey));
      setUpdatedAt(result.settings?.updatedAt || "");
      setZhipuApiKey("");
      setConnection({
        checking: false,
        message: `已连接 ${normalized}。后端服务地址和智谱 Key 已保存。`,
        status: "success",
      });
      setSaveState({
        message: "系统设置已保存。",
        saving: false,
        status: "success",
      });
    } catch (error) {
      setSaveState({
        message: `服务地址已保存到本地，但后端保存失败：${error.message}`,
        saving: false,
        status: "error",
      });
    }
  }

  async function handleClearKey() {
    const normalized = saveApiBaseUrl(apiBaseUrl);

    setSaveState({
      message: "正在清空已保存的智谱 Key...",
      saving: true,
      status: "idle",
    });

    try {
      const payload = await requestJson(normalized, "/api/system/settings", {
        body: JSON.stringify({
          llmProvider: "zhipu",
          zhipuApiKey: "",
        }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });

      setMaskedKey(payload.settings?.zhipuApiKeyMasked || "");
      setHasStoredKey(Boolean(payload.settings?.hasZhipuApiKey));
      setUpdatedAt(payload.settings?.updatedAt || "");
      setZhipuApiKey("");
      setSaveState({
        message: "智谱 Key 已清空。",
        saving: false,
        status: "success",
      });
    } catch (error) {
      setSaveState({
        message: error.message,
        saving: false,
        status: "error",
      });
    }
  }

  return (
    <AppShell
      actions={
        <>
          <button
            className="rounded-2xl border border-black/5 bg-white/85 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-[#d96e42]/20 hover:text-[#8b6720]"
            onClick={handleTestConnection}
            type="button"
          >
            {connection.checking ? "检测中..." : "测试连接"}
          </button>
          <button
            className="rounded-2xl bg-[#d96e42] px-4 py-3 text-sm font-bold text-white shadow-[0_18px_40px_rgba(217,110,66,0.22)] transition hover:bg-[#cf6137] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={saveState.saving}
            onClick={handleSave}
            type="button"
          >
            {saveState.saving ? "保存中..." : "保存设置"}
          </button>
        </>
      }
      breadcrumb="经营系统"
      subtitle="在这里维护后端服务地址和智谱 API Key。财务页的请求失败，通常就是这里的服务地址不对或后端没有启动。"
      title="系统设置"
    >
      <section className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="rounded-[34px] border border-black/5 bg-[rgba(255,251,246,0.88)] p-6 shadow-[0_18px_60px_rgba(27,22,19,0.08)]">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#d96e42]">
                Connection
              </p>
              <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em] text-[#171412]">
                后端服务地址
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                财务数据、AI 分析和上传都依赖这个地址。默认是本机
                `http://localhost:3101`。
              </p>
            </div>
            <StatusBadge status={connection.status}>
              {connection.status === "success"
                ? "已连接"
                : connection.status === "error"
                  ? "连接失败"
                  : "未检测"}
            </StatusBadge>
          </div>

          <div className="mt-6 space-y-5">
            <FieldShell
              hint="如果后端部署在别的机器或端口，把地址改成对应的完整 http 地址。"
              label="服务地址"
            >
              <input
                className="w-full rounded-2xl border border-black/5 bg-white/90 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#d96e42]/30 focus:ring-2 focus:ring-[#d96e42]/10"
                onChange={(event) => setApiBaseUrl(event.target.value)}
                placeholder={DEFAULT_API_BASE_URL}
                type="text"
                value={apiBaseUrl}
              />
            </FieldShell>

            <div className="rounded-[24px] bg-[#f8f2eb] px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                连接状态
              </p>
              <p className="mt-2 text-sm leading-6 text-[#171412]">
                {connection.message}
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-[24px] bg-white/82 px-4 py-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  当前地址
                </p>
                <p className="mt-2 break-all text-sm font-semibold text-[#171412]">
                  {normalizeApiBaseUrl(apiBaseUrl)}
                </p>
              </div>
              <div className="rounded-[24px] bg-white/82 px-4 py-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  已保存 Key
                </p>
                <p className="mt-2 text-sm font-semibold text-[#171412]">
                  {hasStoredKey ? maskedKey || "已保存" : "未配置"}
                </p>
              </div>
              <div className="rounded-[24px] bg-white/82 px-4 py-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                  最近更新
                </p>
                <p className="mt-2 text-sm font-semibold text-[#171412]">
                  {updatedAt
                    ? new Date(updatedAt).toLocaleString("zh-CN")
                    : "暂无"}
                </p>
              </div>
            </div>
          </div>
        </article>

        <article className="rounded-[34px] border border-black/5 bg-[linear-gradient(135deg,rgba(255,249,242,0.94),rgba(255,252,248,0.88))] p-6 shadow-[0_18px_60px_rgba(27,22,19,0.08)]">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#d96e42]">
                Model
              </p>
              <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em] text-[#171412]">
                智谱 API Key
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                这里保存的是后端使用的模型 Key，不建议直接写进前端代码。
              </p>
            </div>
            <StatusBadge status={hasStoredKey ? "success" : "idle"}>
              {hasStoredKey ? "已配置" : "待配置"}
            </StatusBadge>
          </div>

          <div className="mt-6 space-y-5">
            <FieldShell
              hint={
                hasStoredKey
                  ? `当前已保存：${maskedKey || "已配置"}`
                  : "保存后会写入后端配置文件。"
              }
              label="智谱 API Key"
            >
              <input
                autoComplete="off"
                className="w-full rounded-2xl border border-black/5 bg-white/90 px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-[#d96e42]/30 focus:ring-2 focus:ring-[#d96e42]/10"
                onChange={(event) => setZhipuApiKey(event.target.value)}
                placeholder="请输入智谱 API Key"
                type="password"
                value={zhipuApiKey}
              />
            </FieldShell>

            <div className="rounded-[24px] bg-white/84 px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                保存说明
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                `保存设置` 会先把服务地址写入本地，再把智谱 Key
                写入后端。若后端连不上，页面会明确提示是哪一步失败。
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                className="rounded-2xl border border-black/5 bg-white/90 px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-[#d96e42]/20 hover:text-[#8b6720] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!hasStoredKey || saveState.saving}
                onClick={handleClearKey}
                type="button"
              >
                清空已保存 Key
              </button>
              <div className="flex items-center">
                <StatusBadge status={saveState.status}>
                  {saveState.message || "等待保存"}
                </StatusBadge>
              </div>
            </div>
          </div>
        </article>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <article className="rounded-[34px] border border-black/5 bg-[rgba(255,251,246,0.88)] p-6 shadow-[0_18px_60px_rgba(27,22,19,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#d96e42]">
            Troubleshooting
          </p>
          <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em] text-[#171412]">
            当前报错怎么排查
          </h2>
          <div className="mt-6 space-y-3 text-sm leading-6 text-slate-500">
            <p>1. 先在这里点 `测试连接`，确认后端服务地址能通。</p>
            <p>
              2. 如果失败，先启动 `kexi-backend`，或把地址改成正确的部署地址。
            </p>
            <p>3. 如果连接成功但 AI 还不能用，再补充智谱 API Key 并保存。</p>
          </div>
        </article>

        <article className="rounded-[34px] border border-black/5 bg-[rgba(255,251,246,0.88)] p-6 shadow-[0_18px_60px_rgba(27,22,19,0.08)]">
          <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#d96e42]">
            Current Runtime
          </p>
          <h2 className="mt-2 text-xl font-extrabold tracking-[-0.04em] text-[#171412]">
            当前运行配置
          </h2>
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            <div className="rounded-[24px] bg-[#f8f2eb] px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                前端默认地址
              </p>
              <p className="mt-2 break-all text-sm font-semibold text-[#171412]">
                {DEFAULT_API_BASE_URL}
              </p>
            </div>
            <div className="rounded-[24px] bg-[#f8f2eb] px-4 py-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                当前生效地址
              </p>
              <p className="mt-2 break-all text-sm font-semibold text-[#171412]">
                {getApiBaseUrl()}
              </p>
            </div>
          </div>
        </article>
      </section>
    </AppShell>
  );
}
