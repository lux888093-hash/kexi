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
const { parseWorkbook } = require('./lib/financialParser');
const {
  resolveParsingExportPath,
} = require('./lib/sourceFileWorkbook');
const {
  clearConversationShuadanAssetCache,
  ensureParsingArtifactDirectories,
  resolveConversationArtifactPath,
  writeConversationArtifact,
} = require('./lib/parsingArtifactStore');
const {
  buildWorkspaceAgentReply,
} = require('./lib/agentChat');
const {
  DEFAULT_PARSING_SKILL_ID,
  listParsingSkills,
  resolveParsingSkill,
  toPublicParsingSkill,
} = require('./lib/parsingSkills');
const { BODY_TABLE_SKILL_ID } = require('./lib/parsingSkills/bodyTableSkill');
const { parseShuadanScreenshot } = require('./lib/parsingSkills/shuadanPacketParser');

const app = express();
const PORT = process.env.PORT || 3101;

ensureDirectories();
ensureParsingArtifactDirectories();
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

function isPdfExportFile(filePath = '', fileName = '') {
  return /\.pdf$/i.test(String(fileName || filePath || '').trim());
}

function buildInlineContentDisposition(fileName = '') {
  const normalized = normalizeDownloadFileName(fileName || 'document.pdf');
  const asciiFallback = normalized.replace(/[^\x20-\x7e]+/g, '_') || 'document.pdf';

  return `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(normalized)}`;
}

function resolveExportLabel(inputValue = '', candidates = [], pattern = /./) {
  const raw = String(inputValue || '').trim();

  if (pattern.test(raw)) {
    return raw;
  }

  const fallback = candidates.find((value) => pattern.test(String(value || '').trim()));
  return String(fallback || raw || '').trim();
}

function resolveFreshParsingSkill(skillId = '') {
  const normalizedSkillId = String(skillId || '').trim();

  if (normalizedSkillId !== 'shuadan_packet_builder') {
    return resolveParsingSkill(normalizedSkillId);
  }

  [
    './lib/parsingSkills/shuadanPacketParser',
    './lib/parsingSkills/shuadanPacketSkill',
    './lib/parsingSkills/index',
  ].forEach((modulePath) => {
    try {
      delete require.cache[require.resolve(modulePath)];
    } catch (_error) {
      // Ignore cache misses.
    }
    });

  return require('./lib/parsingSkills').resolveParsingSkill(normalizedSkillId);
}

function buildConversationArtifactApiPath(conversationId = '', skillId = '', mode = 'download') {
  return `/api/parsing/history/${encodeURIComponent(
    String(conversationId || '').trim(),
  )}/${encodeURIComponent(String(skillId || '').trim())}/${mode}`;
}

function resolvePeriodIdFromLabel(periodLabel = '') {
  const match = String(periodLabel || '').trim().match(/(\d{4})年(\d{1,2})月/);

  if (!match) {
    return '';
  }

  return `${match[1]}-${match[2].padStart(2, '0')}`;
}

function syncGeneratedBodyTableReport({
  filePath = '',
  downloadFileName = '',
  storeName = '',
  periodLabel = '',
}) {
  return ingestWorkbook(filePath, {
    originalName: downloadFileName || path.basename(filePath),
    storeName,
    period: resolvePeriodIdFromLabel(periodLabel),
    uploadedAt: new Date().toISOString(),
  });
}

function readConversationBodyTableReport(conversationId = '', skillId = '') {
  const filePath = resolveConversationArtifactPath(conversationId, skillId);

  if (!filePath) {
    return null;
  }

  if (!/\.(xlsx|xls|csv)$/i.test(filePath)) {
    throw new Error('当前会话产物不是可读取的体质表文件。');
  }

  return parseWorkbook(filePath, {
    originalName: path.basename(filePath),
    sourceRelativePath: '',
    uploadedAt: new Date().toISOString(),
  });
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

app.post('/api/financials/upload', upload.array('files', 12), async (request, response) => {
  const files = request.files || [];

  if (!files.length) {
    response.status(400).json({ message: '请至少上传一个 Excel 报表文件。' });
    return;
  }

  const storeId = request.body.storeId || null;
  const period = request.body.period || null;
  const ingested = [];
  const errors = [];

  try {
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
  } finally {
    await Promise.all(
      files.map((file) => fs.promises.unlink(file.path).catch(() => null)),
    );
  }
});

app.get('/api/parsing/skills', (_request, response) => {
  response.json({
    defaultSkillId: DEFAULT_PARSING_SKILL_ID,
    skills: listParsingSkills(),
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
  const conversationId = String(request.body.conversationId || '').trim();
  const skill = resolveFreshParsingSkill(request.body.skillId);

  try {
    const results = await Promise.all(
      files.map(async (file) => {
        const normalizedOriginalName = normalizeUploadFileName(file.originalname);

        try {
          if (skill.id === 'shuadan_packet_builder') {
            return await parseShuadanScreenshot(file.path, {
              originalName: normalizedOriginalName,
              storeName,
              periodLabel,
              conversationId,
            });
          }

          return await skill.parseFile(file.path, {
            originalName: normalizedOriginalName,
            storeName,
            periodLabel,
            conversationId,
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
      results.flatMap((item) => [
        item.sourceGroupKey,
        ...(Array.isArray(item.coveredSourceGroupKeys) ? item.coveredSourceGroupKeys : []),
      ]).filter(Boolean),
    );

    const missingFiles = (skill.requiredSourceGroups || []).filter(
      (group) => !matchedGroupKeys.has(group.key),
    ).map((group) => group.label);

    response.status(failFiles.length ? 207 : 200).json({
      message: parsedFiles.length
        ? `${skill.label}解析完成。`
        : `暂未成功解析出可直接用于${skill.deliverableLabel || '当前技能'}的源文件。`,
      skillId: skill.id,
      skill: toPublicParsingSkill(skill),
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
    skillId = '',
    conversationId = '',
  } = request.body || {};

  const skill = resolveParsingSkill(skillId);
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
    const { token, filePath, downloadFileName } = await skill.exportDraft({
      storeName: resolvedStoreName,
      periodLabel: resolvedPeriodLabel,
      parsedFiles: parsedList,
      reviewFiles: reviewList,
      failFiles: Array.isArray(failFiles) ? failFiles : [],
      missingFiles: Array.isArray(missingFiles) ? missingFiles : [],
    });

    if (skill.id === BODY_TABLE_SKILL_ID && filePath) {
      syncGeneratedBodyTableReport({
        filePath,
        downloadFileName,
        storeName: resolvedStoreName,
        periodLabel: resolvedPeriodLabel,
      });
    }

    let downloadPath = `/api/parsing/download/${token}`;
    let previewPath = isPdfExportFile(token, downloadFileName) ? `/api/parsing/view/${token}` : '';

    if (String(conversationId || '').trim() && filePath) {
      writeConversationArtifact({
        conversationId,
        skillId: skill.id,
        sourceFilePath: filePath,
        downloadFileName,
      });

      downloadPath = buildConversationArtifactApiPath(conversationId, skill.id, 'download');
      previewPath = isPdfExportFile(filePath, downloadFileName)
        ? buildConversationArtifactApiPath(conversationId, skill.id, 'view')
        : '';

      await fs.promises.unlink(filePath).catch(() => null);
      clearConversationShuadanAssetCache(conversationId);
    }

    response.json({
      message: `${skill.deliverableLabel || '文档'}已生成。`,
      skillId: skill.id,
      skill: toPublicParsingSkill(skill),
      downloadPath,
      previewPath,
      downloadFileName,
    });
  } catch (error) {
    response.status(500).json({
      message: error.message || `${skill.deliverableLabel || '文档'}生成失败，请稍后重试。`,
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

app.get('/api/parsing/view/:token', (request, response) => {
  const filePath = resolveParsingExportPath(request.params.token);

  if (!filePath) {
    response.status(404).json({
      message: '预览文件不存在或已失效。',
    });
    return;
  }

  if (!isPdfExportFile(filePath, request.query.name || filePath)) {
    response.status(400).json({
      message: '当前文件不支持在线预览。',
    });
    return;
  }

  const requestedName = normalizeDownloadFileName(request.query.name || path.basename(filePath));

  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', buildInlineContentDisposition(requestedName));
  response.sendFile(filePath);
});

app.get('/api/parsing/history/:conversationId/:skillId/download', (request, response) => {
  const filePath = resolveConversationArtifactPath(
    request.params.conversationId,
    request.params.skillId,
  );

  if (!filePath) {
    response.status(404).json({
      message: 'History artifact not found.',
    });
    return;
  }

  const requestedName = normalizeDownloadFileName(
    request.query.name || path.basename(filePath),
  );

  response.download(filePath, requestedName);
});

app.get('/api/parsing/history/:conversationId/:skillId/report', (request, response) => {
  try {
    if (request.params.skillId !== BODY_TABLE_SKILL_ID) {
      response.status(400).json({
        message: '当前技能没有会话级体质表数据。',
      });
      return;
    }

    const report = readConversationBodyTableReport(
      request.params.conversationId,
      request.params.skillId,
    );

    if (!report) {
      response.status(404).json({
        message: '当前会话还没有生成体质表。',
      });
      return;
    }

    response.json(report);
  } catch (error) {
    response.status(400).json({
      message: error.message || '当前会话体质表读取失败。',
    });
  }
});

app.get('/api/parsing/history/:conversationId/:skillId/view', (request, response) => {
  const filePath = resolveConversationArtifactPath(
    request.params.conversationId,
    request.params.skillId,
  );

  if (!filePath) {
    response.status(404).json({
      message: 'Preview artifact not found.',
    });
    return;
  }

  if (!isPdfExportFile(filePath, request.query.name || filePath)) {
    response.status(400).json({
      message: 'This artifact does not support inline preview.',
    });
    return;
  }

  const requestedName = normalizeDownloadFileName(
    request.query.name || path.basename(filePath),
  );

  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', buildInlineContentDisposition(requestedName));
  response.sendFile(filePath);
});

app.post('/api/parsing/chat', async (request, response) => {
  try {
    const { skillId, history, message, parsingContext } = request.body || {};

    if (!String(message || '').trim()) {
      response.status(400).json({
        message: '请输入你要发送的内容。',
      });
      return;
    }

    const skill = resolveParsingSkill(skillId || parsingContext?.skillId);
    const payload = await skill.chat({
      message: String(message).trim(),
      history: Array.isArray(history) ? history : [],
      reports: listReports(),
      settings: readSettings(),
      parsingContext:
        parsingContext && typeof parsingContext === 'object'
          ? {
              ...parsingContext,
              skillId: skill.id,
            }
          : skill.createContext(),
    });

    response.json({
      ...payload,
      skillId: skill.id,
      skill: toPublicParsingSkill(skill),
    });
  } catch (error) {
    response.status(500).json({
      message: error.message || '解析技能问答失败，请检查后端日志。',
    });
  }
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
    const { agentId, history, message, chatScope, parsingContext } = request.body || {};

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
      chatScope: String(chatScope || '').trim(),
      parsingContext: parsingContext && typeof parsingContext === 'object' ? parsingContext : null,
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
    const { agentId, history, message, chatScope, parsingContext } = request.body || {};
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

    writeSseEvent(response, 'meta', {
      agent: {
        id: normalizedAgentId,
        name: normalizedAgentId === 'financial_analyst' ? 'Kexi 财务分析师 Agent' : 'Kexi Workspace Agent',
        version: 'financial-analyst-v1.0.0',
        mode: 'streaming',
        provider: normalizedAgentId === 'financial_analyst' ? 'zhipu' : 'local',
        model: '',
        note:
          normalizedAgentId === 'financial_analyst'
            ? '正在整理当前会话上下文，并按本地事实口径生成回复。'
            : '正在整理当前会话上下文，稍后返回结果。',
      },
    });

    const payload = await buildWorkspaceAgentReply({
      agentId: normalizedAgentId,
      history: Array.isArray(history) ? history : [],
      message: normalizedMessage,
      reports,
      settings,
      chatScope: String(chatScope || '').trim(),
      parsingContext: parsingContext && typeof parsingContext === 'object' ? parsingContext : null,
    });

    writeSseEvent(response, 'meta', {
      agent: payload.agent || {
        id: normalizedAgentId,
        name: normalizedAgentId === 'financial_analyst' ? 'Kexi 财务分析师 Agent' : 'Kexi Workspace Agent',
        version: 'financial-analyst-v1.0.0',
        mode: 'fallback',
        provider: 'local',
        model: '',
        note: '已完成当前会话回复。',
      },
    });
    writeSseEvent(response, 'done', payload);
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
