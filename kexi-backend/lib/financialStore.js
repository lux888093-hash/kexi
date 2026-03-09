const fs = require('fs');
const path = require('path');
const { parseWorkbook } = require('./financialParser');

const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const DATA_FILE = path.join(DATA_DIR, 'financial-reports.json');
const WORKSPACE_DIR = path.resolve(__dirname, '..', '..');

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

function bootstrapWorkspaceReports() {
  ensureDirectories();

  const candidates = fs
    .readdirSync(WORKSPACE_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.(xlsx|xls|csv)$/i.test(entry.name) &&
        !entry.name.startsWith('~$'),
    )
    .map((entry) => path.join(WORKSPACE_DIR, entry.name));

  for (const candidate of candidates) {
    try {
      ingestWorkbook(candidate, {
        originalName: path.basename(candidate),
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
};
