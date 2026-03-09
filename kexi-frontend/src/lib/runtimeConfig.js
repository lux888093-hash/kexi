const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3101";

const API_BASE_URL_STORAGE_KEY = "kexi.apiBaseUrl";

function normalizeApiBaseUrl(value) {
  const fallback = DEFAULT_API_BASE_URL;
  const rawValue = typeof value === "string" ? value.trim() : "";
  const normalized = rawValue || fallback;

  return normalized.replace(/\/+$/, "");
}

function getApiBaseUrl() {
  if (typeof window === "undefined") {
    return normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
  }

  return normalizeApiBaseUrl(
    window.localStorage.getItem(API_BASE_URL_STORAGE_KEY) ||
      DEFAULT_API_BASE_URL,
  );
}

function saveApiBaseUrl(value) {
  const normalized = normalizeApiBaseUrl(value);

  if (typeof window !== "undefined") {
    window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, normalized);
  }

  return normalized;
}

function buildApiUrl(path, baseUrl = getApiBaseUrl()) {
  return `${normalizeApiBaseUrl(baseUrl)}${path}`;
}

export {
  API_BASE_URL_STORAGE_KEY,
  DEFAULT_API_BASE_URL,
  buildApiUrl,
  getApiBaseUrl,
  normalizeApiBaseUrl,
  saveApiBaseUrl,
};
