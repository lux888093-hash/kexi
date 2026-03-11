const DEFAULT_API_PORT = import.meta.env.VITE_API_PORT || "3101";
const LEGACY_LOCAL_API_BASE_URL = `http://localhost:${DEFAULT_API_PORT}`;
const ENV_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const API_BASE_URL_STORAGE_KEY = "kexi.apiBaseUrl";

function isLocalHostname(hostname) {
  const normalized = String(hostname || "").trim().toLowerCase();
  return (
    !normalized ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

function getDetectedApiBaseUrl() {
  if (ENV_API_BASE_URL) {
    return ENV_API_BASE_URL;
  }

  if (typeof window === "undefined") {
    return LEGACY_LOCAL_API_BASE_URL;
  }

  const { hostname, protocol } = window.location;

  if (isLocalHostname(hostname)) {
    return LEGACY_LOCAL_API_BASE_URL;
  }

  return `${protocol}//${hostname}:${DEFAULT_API_PORT}`;
}

const DEFAULT_API_BASE_URL = getDetectedApiBaseUrl();

function normalizeApiBaseUrl(value) {
  const fallback = DEFAULT_API_BASE_URL;
  const rawValue = typeof value === "string" ? value.trim() : "";
  const normalized = rawValue || fallback;

  return normalized.replace(/\/+$/, "");
}

function shouldRefreshStoredApiBaseUrl(value) {
  if (ENV_API_BASE_URL || typeof window === "undefined") {
    return false;
  }

  return (
    normalizeApiBaseUrl(value) === normalizeApiBaseUrl(LEGACY_LOCAL_API_BASE_URL) &&
    !isLocalHostname(window.location.hostname)
  );
}

function getApiBaseUrl() {
  if (typeof window === "undefined") {
    return normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
  }

  const storedValue = window.localStorage.getItem(API_BASE_URL_STORAGE_KEY);

  if (!storedValue || shouldRefreshStoredApiBaseUrl(storedValue)) {
    const detected = normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
    window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, detected);
    return detected;
  }

  return normalizeApiBaseUrl(storedValue);
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
  DEFAULT_API_PORT,
  LEGACY_LOCAL_API_BASE_URL,
  buildApiUrl,
  getApiBaseUrl,
  getDetectedApiBaseUrl,
  isLocalHostname,
  normalizeApiBaseUrl,
  saveApiBaseUrl,
};
