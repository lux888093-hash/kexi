const express = require('express');
const cors = require('cors');
const fs = require('fs');
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
  getReport,
  deleteReport,
  updateReportData,
} = require('./lib/financialStore');
const {
  REQUIRED_SOURCE_GROUPS,
  parseSourceFile,
} = require('./lib/sourceFileParser');
const {
  createParsingDraftWorkbook,
  resolveParsingExportPath,
} = require('./lib/sourceFileWorkbook');
const {
  buildFinancialAgentExecutionContext,
  buildWorkspaceAgentReply,
} = require('./lib/agentChat');
const {
  getChatExecutionPlan,
  streamZhipuFinancialChatAgent,
} = require('./lib/zhipuFinancialAgent');

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
app.use(express.json({ limit: '10mb' }));

function normalizeUploadFileName(fileName = '') {
  const raw = String(fileName || '').trim();

  if (!raw) {
    return '';
  }

  try {
    const decoded = Buffer.from(raw, 'latin1').toString('utf8');

    if (decoded.includes('�')) {
      return raw;
    }

    if (!/[\u4e00-\u9fff]/.test(raw) && /[\u4e00-\u9fff]/.test(decoded)) {
      return decoded;
    }

    return raw;
  } catch {
    return raw;
  }
}

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

function normalizeDownloadFileName(fileName = '') {
  const normalized = String(fileName || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-');

  if (!normalized) {
    return '体质表草稿.xlsx';
  }

  return normalized;
}

function resolveExportLabel(inputValue = '', candidates = [], pattern = /./) {
  const raw = String(inputValue || '').trim();

  if (pattern.test(raw)) {
    return raw;
  }

  const fallback = candidates.find((value) => pattern.test(String(value || '').trim()));
  return String(fallback || raw || '').trim();
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

app.get('/api/financials/reports/:storeId/:period/download', (request, response) => {
  const { storeId, period } = request.params;
  const report = getReport(storeId, period);
  if (!report) {
    return response.status(404).json({ message: '体质表未找到' });
  }

  if (report.sourceRelativePath) {
    const filePath = path.join(__dirname, '..', report.sourceRelativePath);
    if (fs.existsSync(filePath)) {
      return response.download(filePath, report.sourceFileName);
    }
  }

  response.status(404).json({ message: '原文件未找到，请重新生成' });
});

app.get('/api/financials/reports/:storeId/:period', (request, response) => {
  const { storeId, period } = request.params;
  const report = getReport(storeId, period);
  if (!report) {
    return response.status(404).json({ message: '体质表未找到' });
  }
  response.json(report);
});

app.delete('/api/financials/reports/:storeId/:period', (request, response) => {
  const { storeId, period } = request.params;
  const deleted = deleteReport(storeId, period);
  if (deleted) {
    response.json({ message: '体质表已删除' });
  } else {
    response.status(404).json({ message: '体质表未找到' });
  }
});

app.put('/api/financials/reports/:storeId/:period', (request, response) => {
  const { storeId, period } = request.params;
  const updatePayload = request.body || {};
  const updatedReport = updateReportData(storeId, period, updatePayload);
  if (updatedReport) {
    response.json({ message: '体质表已更新', report: updatedReport });
  } else {
    response.status(404).json({ message: '体质表未找到' });
  }
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
      const normalizedOriginalName = normalizeUploadFileName(file.originalname);
      const report = ingestWorkbook(file.path, {
        originalName: normalizedOriginalName,
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
        fileName: normalizeUploadFileName(file.originalname),
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

app.post('/api/parsing/upload', upload.array('files', 12), async (request, response) => {
  const files = request.files || [];

  if (!files.length) {
    response.status(400).json({ message: '请至少上传一个源文件。' });
    return;
  }

  const storeName = String(request.body.storeName || '').trim();
  const periodLabel = String(request.body.periodLabel || '').trim();

  try {
    const results = await Promise.all(
      files.map(async (file) => {
        const normalizedOriginalName = normalizeUploadFileName(file.originalname);

        try {
          return await parseSourceFile(file.path, {
            originalName: normalizedOriginalName,
            storeName,
            periodLabel,
          });
        } catch (error) {
          return {
            fileName: normalizedOriginalName,
            extension: path.extname(normalizedOriginalName || '').replace(/^\./, ''),
            status: 'unsupported',
            parserMode: 'error',
            sourceGroupKey: '',
            sourceGroupLabel: '',
            storeName,
            periodLabel,
            previewLines: [],
            metrics: {},
            reason: error.message || '文件解析失败，请稍后重试。',
          };
        }
      }),
    );

    const parsedFiles = results.filter((item) => item.status === 'parsed');
    const reviewFiles = results.filter((item) => item.status === 'review');
    const failFiles = results.filter((item) => item.status === 'unsupported');

    const matchedGroupKeys = new Set(
      results
        .map((item) => item.sourceGroupKey)
        .filter(Boolean),
    );

    const missingFiles = REQUIRED_SOURCE_GROUPS.filter(
      (group) => !matchedGroupKeys.has(group.key),
    ).map((group) => group.label);

    response.status(failFiles.length ? 207 : 200).json({
      message: parsedFiles.length
        ? '源文件解析完成。'
        : '暂未成功解析出可直接入表的源文件。',
      parsedFiles,
      reviewFiles,
      failFiles,
      missingFiles,
      storeName,
      periodLabel,
    });
  } finally {
    await Promise.all(
      files.map((file) =>
        fs.promises.unlink(file.path).catch(() => null),
      ),
    );
  }
});

app.post('/api/parsing/export-draft', async (request, response) => {
  const {
    storeName = '',
    periodLabel = '',
    parsedFiles = [],
    reviewFiles = [],
    failFiles = [],
    missingFiles = [],
  } = request.body || {};

  const parsedList = Array.isArray(parsedFiles) ? parsedFiles : [];
  const reviewList = Array.isArray(reviewFiles) ? reviewFiles : [];
  const resolvedStoreName = resolveExportLabel(
    storeName,
    [...parsedList, ...reviewList].map((item) => item?.storeName),
    /[\u4e00-\u9fff]/,
  );
  const resolvedPeriodLabel = resolveExportLabel(
    periodLabel,
    [...parsedList, ...reviewList].map((item) => item?.periodLabel),
    /(20\d{2}\s*年|\d{4}-\d{2}|\d{1,2}\s*月)/,
  );

  try {
    const { token, downloadFileName } = await createParsingDraftWorkbook({
      storeName: resolvedStoreName,
      periodLabel: resolvedPeriodLabel,
      parsedFiles: parsedList,
      reviewFiles: reviewList,
      failFiles: Array.isArray(failFiles) ? failFiles : [],
      missingFiles: Array.isArray(missingFiles) ? missingFiles : [],
    });

    response.json({
      message: '体质表已生成。',
      downloadPath: `/api/parsing/download/${token}`,
      downloadFileName,
    });
  } catch (error) {
    response.status(500).json({
      message: error.message || '体质表生成失败，请稍后重试。',
    });
  }
});

app.get('/api/parsing/download/:token', (request, response) => {
  const filePath = resolveParsingExportPath(request.params.token);

  if (!filePath) {
    response.status(404).json({
      message: '下载文件不存在或已失效。',
    });
    return;
  }

  const requestedName = normalizeDownloadFileName(request.query.name || '');

  response.download(filePath, requestedName);
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

function writeSseEvent(response, event, payload) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.post('/api/agents/chat/stream', async (request, response) => {
  response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  response.setHeader('Cache-Control', 'no-cache, no-transform');
  response.setHeader('Connection', 'keep-alive');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders?.();

  let heartbeatTimer = null;

  try {
    const { agentId, history, message } = request.body || {};
    const normalizedMessage = String(message || '').trim();

    if (!normalizedMessage) {
      writeSseEvent(response, 'error', {
        message: '请输入你要发送的内容。',
      });
      response.end();
      return;
    }

    const normalizedAgentId = agentId || 'default';
    const reports = listReports();
    const settings = readSettings();

    if (normalizedAgentId !== 'financial_analyst') {
      const payload = await buildWorkspaceAgentReply({
        agentId: normalizedAgentId,
        history: Array.isArray(history) ? history : [],
        message: normalizedMessage,
        reports,
        settings,
      });

      writeSseEvent(response, 'done', payload);
      response.end();
      return;
    }

    const executionContext = buildFinancialAgentExecutionContext({
      message: normalizedMessage,
      history: Array.isArray(history) ? history : [],
      reports,
      settings,
    });

    if (executionContext.payload) {
      writeSseEvent(response, 'done', executionContext.payload);
      response.end();
      return;
    }

    const executionPlan = getChatExecutionPlan(
      executionContext.llmContext,
      executionContext.preferredModel,
    );
    const preferredModel = executionContext.preferredModel || '';
    const plannedModel = executionPlan.modelCandidates[0] || preferredModel || '';
    let model = '';
    let reply = '';
    let metaSent = false;

    writeSseEvent(response, 'meta', {
      agent: {
        id: 'financial_analyst',
        name: 'Kexi 财务分析师 Agent',
        version: 'financial-analyst-v1.0.0',
        mode: 'streaming',
        provider: 'zhipu',
        model: plannedModel,
        note: plannedModel
          ? `正在整理财务上下文，优先连接智谱 ${plannedModel}，稍后开始生成。`
          : '正在整理财务上下文并连接智谱，稍后开始生成。',
      },
    });

    heartbeatTimer = setInterval(() => {
      if (reply) {
        return;
      }

      writeSseEvent(response, 'meta', {
        agent: {
          id: 'financial_analyst',
          name: 'Kexi 财务分析师 Agent',
          version: 'financial-analyst-v1.0.0',
          mode: 'streaming',
          provider: 'zhipu',
          model: model || plannedModel,
          note: `已提交智谱 ${model || plannedModel || '模型'}，正在等待首个 token 返回...`,
        },
      });
    }, 8000);

    await streamZhipuFinancialChatAgent({
      apiKey: executionContext.settings.zhipuApiKey,
      question: executionContext.message,
      history: executionContext.history,
      context: executionContext.llmContext,
      preferredModel: executionContext.preferredModel,
      onStart: async ({ model: resolvedModel, webSearchEnabled }) => {
        model = resolvedModel;
        metaSent = true;
        writeSseEvent(response, 'meta', {
          agent: {
            id: 'financial_analyst',
            name: 'Kexi 财务分析师 Agent',
            version: 'financial-analyst-v1.0.0',
            mode: 'llm',
            provider: 'zhipu',
            model,
            note:
              preferredModel && model !== preferredModel
                ? webSearchEnabled
                  ? `首选模型 ${preferredModel} 暂不可用，已回退到智谱 ${model}，并启用联网搜索继续生成。`
                  : `首选模型 ${preferredModel} 暂不可用，已回退到智谱 ${model} 继续生成。`
                : webSearchEnabled
                  ? `已切换到智谱 ${model}，正在结合当前财务数据和联网搜索实时生成。`
                  : `已切换到智谱 ${model}，正在基于当前财务数据实时生成。`,
          },
        });
      },
      onDelta: async (delta) => {
        reply += delta;
        writeSseEvent(response, 'delta', { delta });
      },
    });

    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }

    if (!metaSent) {
      writeSseEvent(response, 'meta', {
        agent: {
          id: 'financial_analyst',
          name: 'Kexi 财务分析师 Agent',
          version: 'financial-analyst-v1.0.0',
          mode: 'llm',
          provider: 'zhipu',
          model,
          note: '已基于当前财务数据完成智谱实时问答。',
        },
      });
    }

    writeSseEvent(response, 'done', {
      reply: reply.trim(),
      agent: {
        id: 'financial_analyst',
        name: 'Kexi 财务分析师 Agent',
        version: 'financial-analyst-v1.0.0',
        mode: 'llm',
        provider: 'zhipu',
        model,
        note: `已基于当前财务数据完成智谱 ${model} 实时问答。`,
      },
    });
  } catch (error) {
    writeSseEvent(response, 'error', {
      message: error.message || '首页智能体流式问答失败，请检查后端日志。',
    });
  } finally {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    response.end();
  }
});

app.listen(PORT, () => {
  console.log(`Kexi Backend running on http://localhost:${PORT}`);
});
