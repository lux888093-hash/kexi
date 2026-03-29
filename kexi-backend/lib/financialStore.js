const fs = require('fs');
const path = require('path');
const { parseWorkbook } = require('./financialParser');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const REPORT_FILES_DIR = path.join(DATA_DIR, 'financial-report-files');
const DATA_FILE = path.join(DATA_DIR, 'financial-reports.json');
const WORKSPACE_DIR = path.resolve(__dirname, '..', '..');
const STALE_UPLOAD_MAX_AGE_MS = 60 * 60 * 1000;

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.mkdirSync(REPORT_FILES_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ reports: [] }, null, 2));
  }
}

function readDatabase() {
  ensureDirectories();

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (_error) {
    return { reports: [] };
  }
}

function writeDatabase(data) {
  ensureDirectories();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function listReports() {
  return readDatabase().reports || [];
}

function getReport(storeId, period) {
  return listReports().find((report) => report.storeId === storeId && report.period === period) || null;
}

function sanitizeStorageSegment(value = '', fallback = 'file') {
  const normalized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);

  return normalized || fallback;
}

function normalizeRelativePath(relativePath = '') {
  return String(relativePath || '').replace(/\\/g, '/');
}

function resolveWorkspacePath(relativePath = '') {
  const normalized = String(relativePath || '').trim();

  if (!normalized) {
    return '';
  }

  const resolved = path.resolve(WORKSPACE_DIR, normalized);
  const relative = path.relative(WORKSPACE_DIR, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return '';
  }

  return resolved;
}

function removeFileIfExists(filePath = '') {
  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    fs.unlinkSync(filePath);
  }
}

function removeReportSource(sourceRelativePath = '') {
  const resolvedPath = resolveWorkspacePath(sourceRelativePath);

  if (!resolvedPath) {
    return;
  }

  if (
    resolvedPath.startsWith(REPORT_FILES_DIR) ||
    resolvedPath.startsWith(UPLOADS_DIR)
  ) {
    removeFileIfExists(resolvedPath);
  }
}

function deleteReport(storeId, period) {
  const database = readDatabase();
  const existing = database.reports.find(
    (item) => item.storeId === storeId && item.period === period,
  );

  if (!existing) {
    return false;
  }

  database.reports = database.reports.filter(
    (item) => !(item.storeId === storeId && item.period === period),
  );
  writeDatabase(database);
  removeReportSource(existing.sourceRelativePath);
  return true;
}

function updateReportData(storeId, period, updatePayload) {
  const database = readDatabase();
  const existingIndex = database.reports.findIndex(
    (item) => item.storeId === storeId && item.period === period,
  );

  if (existingIndex < 0) {
    return null;
  }

  database.reports[existingIndex] = {
    ...database.reports[existingIndex],
    ...updatePayload,
    updatedAt: new Date().toISOString(),
  };
  writeDatabase(database);
  return database.reports[existingIndex];
}

function upsertReport(report) {
  const database = readDatabase();
  const existingIndex = database.reports.findIndex(
    (item) => item.storeId === report.storeId && item.period === report.period,
  );

  if (existingIndex >= 0) {
    database.reports[existingIndex] = report;
  } else {
    database.reports.push(report);
  }

  writeDatabase(database);
  return report;
}

function resolveManagedReportDir(report) {
  return path.join(
    REPORT_FILES_DIR,
    sanitizeStorageSegment(report.storeId, 'store'),
  );
}

function persistReportSourceFile(filePath, report, originalName = '') {
  const extension = path.extname(originalName || filePath || '').toLowerCase() || '.xlsx';
  const reportDir = resolveManagedReportDir(report);
  const baseName = sanitizeStorageSegment(report.period, 'period');
  const targetPath = path.join(reportDir, `${baseName}${extension}`);
  const isSameTarget = path.resolve(filePath) === path.resolve(targetPath);

  fs.mkdirSync(reportDir, { recursive: true });

  if (!isSameTarget) {
    for (const entry of fs.readdirSync(reportDir, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }

      if (path.parse(entry.name).name === baseName) {
        removeFileIfExists(path.join(reportDir, entry.name));
      }
    }
  }

  if (!isSameTarget) {
    fs.copyFileSync(filePath, targetPath);
  }

  return {
    fileName: originalName || path.basename(targetPath),
    relativePath: normalizeRelativePath(path.relative(WORKSPACE_DIR, targetPath)),
  };
}

function ingestWorkbook(filePath, options = {}) {
  const report = parseWorkbook(filePath, options);
  const existingReport = getReport(report.storeId, report.period);

  if (options.persistSourceFile !== false) {
    const storedSource = persistReportSourceFile(
      filePath,
      report,
      options.originalName || report.sourceFileName,
    );

    report.sourceRelativePath = storedSource.relativePath;
    report.sourceFileName = storedSource.fileName;
  }

  const savedReport = upsertReport(report);

  if (
    existingReport &&
    existingReport.sourceRelativePath &&
    existingReport.sourceRelativePath !== savedReport.sourceRelativePath
  ) {
    removeReportSource(existingReport.sourceRelativePath);
  }

  return savedReport;
}

function collectManagedReportCandidates(dir, collection = []) {
  if (!fs.existsSync(dir)) {
    return collection;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      collectManagedReportCandidates(fullPath, collection);
      return;
    }

    if (entry.isFile() && /\.(xlsx|xls|csv)$/i.test(entry.name) && !entry.name.startsWith('~$')) {
      collection.push(fullPath);
    }
  });

  return collection;
}

function migrateLegacyReportSources() {
  const database = readDatabase();
  let changed = false;

  database.reports = (database.reports || []).map((report) => {
    const resolvedPath = resolveWorkspacePath(report.sourceRelativePath);

    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      return report;
    }

    if (resolvedPath.startsWith(REPORT_FILES_DIR)) {
      return report;
    }

    const storedSource = persistReportSourceFile(
      resolvedPath,
      report,
      report.sourceFileName,
    );

    if (resolvedPath.startsWith(UPLOADS_DIR)) {
      removeFileIfExists(resolvedPath);
    }

    if (storedSource.relativePath === report.sourceRelativePath) {
      return report;
    }

    changed = true;
    return {
      ...report,
      sourceRelativePath: storedSource.relativePath,
      sourceFileName: storedSource.fileName,
    };
  });

  if (changed) {
    writeDatabase(database);
  }
}

function cleanupStaleUploadFiles(referenceTime = Date.now()) {
  ensureDirectories();

  for (const entry of fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })) {
    const fullPath = path.join(UPLOADS_DIR, entry.name);

    if (entry.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      continue;
    }

    const stats = fs.statSync(fullPath);
    if (referenceTime - stats.mtimeMs >= STALE_UPLOAD_MAX_AGE_MS) {
      removeFileIfExists(fullPath);
    }
  }
}

function bootstrapWorkspaceReports() {
  ensureDirectories();
  migrateLegacyReportSources();
  cleanupStaleUploadFiles();

  const database = readDatabase();
  if ((database.reports || []).length > 0) {
    return;
  }

  const candidates = collectManagedReportCandidates(REPORT_FILES_DIR).sort((left, right) =>
    left.localeCompare(right),
  );

  for (const candidate of candidates) {
    try {
      ingestWorkbook(candidate, {
        originalName: path.basename(candidate),
        sourceRelativePath: normalizeRelativePath(path.relative(WORKSPACE_DIR, candidate)),
        uploadedAt: fs.statSync(candidate).mtime.toISOString(),
        persistSourceFile: false,
      });
    } catch (_error) {
      // Ignore broken managed files so the service can still boot.
    }
  }
}

module.exports = {
  DATA_FILE,
  UPLOADS_DIR,
  bootstrapWorkspaceReports,
  ensureDirectories,
  ingestWorkbook,
  listReports,
  getReport,
  deleteReport,
  updateReportData,
};
