const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const PARSING_HISTORY_DIR = path.join(DATA_DIR, 'parsing-history');
const SHUADAN_ASSETS_DIR = path.join(__dirname, '..', 'exports', 'parsing-assets', 'shuadan');

function sanitizeScopeId(value = '', fallback = 'default') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);

  return normalized || fallback;
}

function ensureParsingArtifactDirectories() {
  fs.mkdirSync(PARSING_HISTORY_DIR, { recursive: true });
  fs.mkdirSync(SHUADAN_ASSETS_DIR, { recursive: true });
}

function resolveConversationArtifactDirectory(conversationId = '') {
  return path.join(
    PARSING_HISTORY_DIR,
    sanitizeScopeId(conversationId, 'conversation'),
  );
}

function clearConversationArtifact(conversationId = '') {
  const conversationDir = resolveConversationArtifactDirectory(conversationId);
  fs.rmSync(conversationDir, { recursive: true, force: true });
}

function writeConversationArtifact({
  conversationId = '',
  skillId = '',
  sourceFilePath = '',
  downloadFileName = '',
}) {
  ensureParsingArtifactDirectories();

  const conversationDir = resolveConversationArtifactDirectory(conversationId);
  const safeSkillId = sanitizeScopeId(skillId, 'artifact');
  const extension = path.extname(downloadFileName || sourceFilePath || '').toLowerCase() || '.bin';
  const targetPath = path.join(conversationDir, `${safeSkillId}${extension}`);

  clearConversationArtifact(conversationId);
  fs.mkdirSync(conversationDir, { recursive: true });
  fs.copyFileSync(sourceFilePath, targetPath);

  return {
    filePath: targetPath,
    fileName: downloadFileName || path.basename(targetPath),
  };
}

function resolveConversationArtifactPath(conversationId = '', skillId = '') {
  const conversationDir = resolveConversationArtifactDirectory(conversationId);

  if (!fs.existsSync(conversationDir)) {
    return null;
  }

  const safeSkillId = sanitizeScopeId(skillId, 'artifact');
  const files = fs.readdirSync(conversationDir, { withFileTypes: true }).filter((entry) => entry.isFile());

  if (!files.length) {
    return null;
  }

  const matched = files.find((entry) => path.parse(entry.name).name === safeSkillId) || files[0];
  return path.join(conversationDir, matched.name);
}

function buildShuadanAssetToken(conversationId = '', originalName = '') {
  const safeConversationId = sanitizeScopeId(conversationId, 'shared');
  const extension = path.extname(originalName || '').toLowerCase();
  return `${safeConversationId}--${Date.now()}-${crypto.randomUUID()}${extension}`;
}

function clearConversationShuadanAssetCache(conversationId = '') {
  ensureParsingArtifactDirectories();
  const prefix = `${sanitizeScopeId(conversationId, 'shared')}--`;

  for (const entry of fs.readdirSync(SHUADAN_ASSETS_DIR, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.startsWith(prefix)) {
      fs.rmSync(path.join(SHUADAN_ASSETS_DIR, entry.name), { force: true });
    }
  }
}

module.exports = {
  SHUADAN_ASSETS_DIR,
  buildShuadanAssetToken,
  clearConversationShuadanAssetCache,
  ensureParsingArtifactDirectories,
  resolveConversationArtifactPath,
  sanitizeScopeId,
  writeConversationArtifact,
};
