const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

const {
  ensureSettingsFile,
  getPublicSettings,
  readSettings,
  updateSettings,
} = require('./lib/appSettings');
const { STORE_REGISTRY } = require('./lib/financialConstants');
const { buildDashboard } = require('./lib/financialAnalytics');
const { buildAiAnalysis } = require('./lib/financialAi');
const {
  UPLOADS_DIR,
  bootstrapWorkspaceReports,
  ensureDirectories,
  ingestWorkbook,
  listReports,
} = require('./lib/financialStore');
const { buildWorkspaceAgentReply } = require('./lib/agentChat');

const app = express();
const PORT = process.env.PORT || 3101;

ensureDirectories();
ensureSettingsFile();
bootstrapWorkspaceReports();

const storage = multer.diskStorage({
  destination: (_request, _file, callback) => {
    callback(null, UPLOADS_DIR);
  },
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname || '.xlsx') || '.xlsx';
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 12,
  },
});

app.use(cors());
app.use(express.json({ limit: '2mb' }));

function parseStoreIds(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFilters(source = {}) {
  return {
    storeIds: parseStoreIds(source.storeIds || source.stores),
    periodStart: source.periodStart || null,
    periodEnd: source.periodEnd || null,
  };
}

app.get('/api/system/health', (_request, response) => {
  const reports = listReports();

  response.json({
    ok: true,
    service: 'kexi-backend',
    settings: getPublicSettings(),
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    reportCount: reports.length,
  });
});

app.get('/api/system/settings', (_request, response) => {
  response.json(getPublicSettings());
});

app.put('/api/system/settings', (request, response) => {
  const { llmProvider, zhipuApiKey, zhipuModel } = request.body || {};
  const nextSettings = {};

  if (typeof llmProvider === 'string' && llmProvider.trim()) {
    nextSettings.llmProvider = llmProvider.trim();
  }

  if (typeof zhipuApiKey === 'string') {
    nextSettings.zhipuApiKey = zhipuApiKey.trim();
  }

  if (typeof zhipuModel === 'string' && zhipuModel.trim()) {
    nextSettings.zhipuModel = zhipuModel.trim();
  }

  updateSettings(nextSettings);

  response.json({
    message: '系统设置已保存。',
    settings: getPublicSettings(),
  });
});

app.get('/api/financials/config', (_request, response) => {
  const reports = listReports();
  const dashboard = buildDashboard(reports, {});

  response.json({
    stores: STORE_REGISTRY,
    availablePeriods: dashboard.availablePeriods,
    status: dashboard.storeStatus,
  });
});

app.get('/api/financials/dashboard', (request, response) => {
  const reports = listReports();
  const dashboard = buildDashboard(reports, parseFilters(request.query));
  response.json(dashboard);
});

app.get('/api/financials/reports', (_request, response) => {
  const reports = listReports()
    .sort((left, right) => right.period.localeCompare(left.period))
    .map((report) => ({
      id: report.id,
      storeId: report.storeId,
      storeName: report.storeName,
      period: report.period,
      periodLabel: report.periodLabel,
      sourceFileName: report.sourceFileName,
      uploadedAt: report.uploadedAt,
    }));

  response.json({ reports });
});

app.post('/api/financials/upload', upload.array('files', 12), (request, response) => {
  const files = request.files || [];

  if (!files.length) {
    response.status(400).json({ message: '请至少上传一个 Excel 报表文件。' });
    return;
  }

  const storeId = request.body.storeId || null;
  const period = request.body.period || null;
  const ingested = [];
  const errors = [];

  files.forEach((file) => {
    try {
      const report = ingestWorkbook(file.path, {
        originalName: file.originalname,
        storeId: files.length === 1 ? storeId : null,
        period: files.length === 1 ? period : null,
        uploadedAt: new Date().toISOString(),
      });

      ingested.push({
        id: report.id,
        storeId: report.storeId,
        storeName: report.storeName,
        period: report.period,
        sourceFileName: report.sourceFileName,
      });
    } catch (error) {
      errors.push({
        fileName: file.originalname,
        message: error.message,
      });
    }
  });

  response.status(errors.length ? 207 : 200).json({
    message: ingested.length ? '报表解析完成。' : '没有成功导入任何报表。',
    ingested,
    errors,
  });
});

app.post('/api/financials/ai-analysis', async (request, response) => {
  try {
    const reports = listReports();
    const analysis = await buildAiAnalysis(reports, parseFilters(request.body || {}), {
      settings: readSettings(),
    });
    response.json(analysis);
  } catch (error) {
    response.status(500).json({
      message: error.message || 'AI 财务分析失败，请检查后端日志。',
    });
  }
});

app.post('/api/agents/chat', async (request, response) => {
  try {
    const { agentId, history, message } = request.body || {};

    if (!String(message || '').trim()) {
      response.status(400).json({
        message: '请输入你要发送的内容。',
      });
      return;
    }

    const payload = await buildWorkspaceAgentReply({
      agentId: agentId || 'default',
      history: Array.isArray(history) ? history : [],
      message: String(message).trim(),
      reports: listReports(),
      settings: readSettings(),
    });

    response.json(payload);
  } catch (error) {
    response.status(500).json({
      message: error.message || '首页智能体问答失败，请检查后端日志。',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Kexi Backend running on http://localhost:${PORT}`);
});
