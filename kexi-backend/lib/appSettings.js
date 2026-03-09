const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'app-settings.json');

const DEFAULT_SETTINGS = {
  llmProvider: 'zhipu',
  zhipuApiKey: '',
  updatedAt: null,
};

function ensureSettingsFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
  }
}

function readSettings() {
  ensureSettingsFile();

  try {
    const stored = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
    };
  } catch (error) {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(nextSettings) {
  ensureSettingsFile();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(nextSettings, null, 2));
}

function maskApiKey(value) {
  if (!value) {
    return '';
  }

  if (value.length <= 8) {
    return `${value.slice(0, 2)}****`;
  }

  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

function getPublicSettings() {
  const settings = readSettings();

  return {
    llmProvider: settings.llmProvider,
    hasZhipuApiKey: Boolean(settings.zhipuApiKey),
    updatedAt: settings.updatedAt,
    zhipuApiKeyMasked: maskApiKey(settings.zhipuApiKey),
  };
}

function updateSettings(patch = {}) {
  const current = readSettings();
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };

  writeSettings(next);
  return next;
}

module.exports = {
  ensureSettingsFile,
  getPublicSettings,
  readSettings,
  SETTINGS_FILE,
  updateSettings,
};
