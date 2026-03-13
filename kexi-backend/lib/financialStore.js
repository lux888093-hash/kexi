const fs = require('fs');
const path = require('path');
const { parseWorkbook } = require('./financialParser');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'financial-reports.json');
const WORKSPACE_DIR = path.resolve(__dirname, '..', '..');
const IGNORED_WORKSPACE_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'coverage',
  'uploads',
  'data',
]);

function ensureDirectories() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ reports: [] }, null, 2));
  }
}

function readDatabase() {
  ensureDirectories();

  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch (error) {
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
  const reports = listReports();
  return reports.find((r) => r.storeId === storeId && r.period === period) || null;
}

function deleteReport(storeId, period) {
  const database = readDatabase();
  const initialLength = database.reports.length;
  database.reports = database.reports.filter(
    (item) => !(item.storeId === storeId && item.period === period),
  );
  if (database.reports.length < initialLength) {
    writeDatabase(database);
    return true;
  }
  return false;
}

function updateReportData(storeId, period, updatePayload) {
  const database = readDatabase();
  const existingIndex = database.reports.findIndex(
    (item) => item.storeId === storeId && item.period === period,
  );

  if (existingIndex >= 0) {
    database.reports[existingIndex] = {
      ...database.reports[existingIndex],
      ...updatePayload,
      updatedAt: new Date().toISOString()
    };
    writeDatabase(database);
    return database.reports[existingIndex];
  }
  return null;
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

function ingestWorkbook(filePath, options = {}) {
  const report = parseWorkbook(filePath, options);
  return upsertReport(report);
}

function collectWorkspaceWorkbookCandidates(dir, collection = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  entries.forEach((entry) => {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (IGNORED_WORKSPACE_DIRS.has(entry.name)) {
        return;
      }

      collectWorkspaceWorkbookCandidates(fullPath, collection);
      return;
    }

    if (
      /\.(xlsx|xls|csv)$/i.test(entry.name) &&
      !entry.name.startsWith('~$')
    ) {
      collection.push(fullPath);
    }
  });

  return collection;
}

function getWorkspaceWorkbookPriority(filePath) {
  const relativePath = path.relative(WORKSPACE_DIR, filePath);
  let priority = 0;

  if (relativePath.includes('珂溪1月体质检测表')) {
    priority += 20;
  }

  if (relativePath.includes('体质表')) {
    priority += 10;
  }

  return priority;
}

function bootstrapWorkspaceReports() {
  ensureDirectories();
  const candidates = collectWorkspaceWorkbookCandidates(WORKSPACE_DIR).sort(
    (left, right) => {
      const priorityDelta =
        getWorkspaceWorkbookPriority(left) - getWorkspaceWorkbookPriority(right);

      if (priorityDelta !== 0) {
        return priorityDelta;
      }

      return left.localeCompare(right);
    },
  );

  for (const candidate of candidates) {
    try {
      ingestWorkbook(candidate, {
        originalName: path.basename(candidate),
        sourceRelativePath: path.relative(WORKSPACE_DIR, candidate),
        uploadedAt: fs.statSync(candidate).mtime.toISOString(),
      });
    } catch (error) {
      // Ignore files that are not financial report templates.
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
