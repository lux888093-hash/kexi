const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { readSettings } = require('../appSettings');
const {
  aggregateShuadanFiles,
  formatCurrency,
} = require('./shuadanPacketParser');

const PARSING_EXPORTS_DIR = path.join(__dirname, '..', '..', 'exports', 'parsing-drafts');
const ZHIPU_API_URL =
  process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/NotoSansSC-VF.ttf',
  'C:/Windows/Fonts/simsunb.ttf',
  'C:/Windows/Fonts/msyh.ttc',
];

function ensureParsingExportsDir() {
  fs.mkdirSync(PARSING_EXPORTS_DIR, { recursive: true });
}

function resolveFontPath() {
  return FONT_CANDIDATES.find((fontPath) => fs.existsSync(fontPath)) || '';
}

function chunk(items = [], size = 1) {
  const result = [];

  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }

  return result;
}

function safeText(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function dedupeStrings(values = []) {
  return [...new Set(values.map((value) => safeText(value)).filter(Boolean))];
}

function getSummaryModelCandidates() {
  const settings = readSettings();

  return [
    process.env.ZHIPU_TEXT_MODEL || '',
    process.env.ZHIPU_MODEL || '',
    settings?.zhipuModel || '',
    'glm-5',
    'glm-4.7-flash',
    'glm-4-flash-250414',
  ].filter(Boolean).filter((value, index, array) => array.indexOf(value) === index);
}

function extractJsonObjectFromText(text = '') {
  const source = String(text || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  if (!source) {
    return null;
  }

  try {
    return JSON.parse(source);
  } catch (_error) {
    // Fall through.
  }

  const startIndex = source.indexOf('{');

  if (startIndex === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;

      if (depth === 0) {
        try {
          return JSON.parse(source.slice(startIndex, index + 1));
        } catch (_error) {
          return null;
        }
      }
    }
  }

  return null;
}

function buildTransferAmountRepeatLines(section = {}) {
  const entries = Array.isArray(section.items) ? section.items : [];
  const amountMap = new Map();

  entries.forEach((item) => {
    const amount = Number(item?.primaryAmount || 0);

    if (!amount) {
      return;
    }

    const key = amount.toFixed(2);
    const current = amountMap.get(key) || {
      amount,
      times: [],
    };

    if (item.normalizedTime) {
      current.times.push(item.normalizedTime);
    }

    amountMap.set(key, current);
  });

  return [...amountMap.values()]
    .filter((item) => item.times.length > 1)
    .sort((left, right) => right.times.length - left.times.length || right.amount - left.amount)
    .slice(0, 4)
    .map((item) => `${formatCurrency(item.amount)} 出现 ${item.times.length} 次：${dedupeStrings(item.times).join('、')}`);
}

function buildFallbackAiAuditSummary(aggregate = {}) {
  const transferSection = aggregate.sections.find((section) => section.key === 'transfer') || {};
  const verificationSection = aggregate.sections.find((section) => section.key === 'verification') || {};
  const reviewSection = aggregate.sections.find((section) => section.key === 'review') || {};
  const repeatedAmountLines = buildTransferAmountRepeatLines(transferSection);

  return {
    title: '财务安全审核分析',
    scope: `审核范围：转账截图板块，共 ${transferSection.screenshotCount || 0} 张截图，当前口径合计 ${formatCurrency(aggregate.transferTotal || 0)}。`,
    goal: '审核目标：检查是否存在重复计入、明显异常单据，并说明本版金额口径与归类规则。',
    classificationSummary: [
      `当前按截图归类为：核销截图板块 ${verificationSection.screenshotCount || 0} 张，转账截图板块 ${transferSection.screenshotCount || 0} 张${reviewSection.screenshotCount ? `，待复核 ${reviewSection.screenshotCount} 张` : ''}。`,
      `金额口径：按每张截图中可见金额统计；若同一订单同时出现列表页和详情页，本版不做一对一配对，也不主动去重。`,
      `核销截图板块合计 ${formatCurrency(aggregate.verificationTotal || 0)}，转账截图板块合计 ${formatCurrency(aggregate.transferTotal || 0)}。`,
    ],
    conclusions: [
      aggregate.repeatedAmountTime?.length
        ? `发现 ${aggregate.repeatedAmountTime.length} 组“同金额 + 同时间”的高风险重复，需要人工复核。`
        : '未发现“同金额 + 同时间”的完全重复转账截图，当前转账板块未见直接重复入账。',
      transferSection.listCount
        ? `转账板块含 ${transferSection.listCount} 张列表页，本版按截图可见金额统计，后续若补录对应详情页，需人工删除或改写列表页金额口径。`
        : '当前转账板块未出现列表页与详情页并存导致的明显统计冲突。',
      verificationSection.listCount
        ? `核销板块含 ${verificationSection.listCount} 张列表页，本版同样按截图可见金额统计，不与详情页自动对冲。`
        : '当前核销板块以详情页为主，金额来源相对直接。',
    ],
    focusChecks: repeatedAmountLines.length
      ? repeatedAmountLines
      : ['重点盯同金额高频记录与列表页/详情页并存场景；当前未发现需要立刻剔除的重复单据。'],
    recommendations: [
      '本批继续按“分板块、按截图可见金额统计”的口径使用。',
      '后续补图时，若同一业务同时补进列表页和单笔详情页，必须人工确认是否重复计入。',
      reviewSection.screenshotCount
        ? `待复核截图仍有 ${reviewSection.screenshotCount} 张，建议在报销前再次人工确认。`
        : '当前截图包已完成分板块归类，可直接用于导出归档。',
    ],
    generatedBy: 'fallback',
  };
}

function buildAiSummaryPrompt({ storeName = '', periodLabel = '', aggregate = {} } = {}) {
  const transferSection = aggregate.sections.find((section) => section.key === 'transfer') || {};
  const verificationSection = aggregate.sections.find((section) => section.key === 'verification') || {};
  const reviewSection = aggregate.sections.find((section) => section.key === 'review') || {};

  const context = {
    storeName: safeText(storeName),
    periodLabel: safeText(periodLabel),
    amountRule: '按每张截图中可见金额统计；若同一订单同时出现列表页和详情页，本版不做一对一配对，也不主动去重。',
    summary: {
      screenshotCount: aggregate.screenshotCount || 0,
      verificationTotal: aggregate.verificationTotal || 0,
      transferTotal: aggregate.transferTotal || 0,
      actualReimbursementTotal: aggregate.actualReimbursementTotal || 0,
    },
    sections: [verificationSection, transferSection, reviewSection]
      .filter((section) => section.key)
      .map((section) => ({
        key: section.key,
        label: section.label,
        screenshotCount: section.screenshotCount || 0,
        total: section.summaryTotal || 0,
        listCount: section.listCount || 0,
        detailCount: section.detailCount || 0,
        items: (section.items || []).slice(0, 20).map((item) => ({
          caption: item.caption,
          amount: item.primaryAmount,
          time: item.normalizedTime,
          isListPage: Boolean(item.isListPage),
        })),
      })),
    duplicateTransfers: aggregate.duplicateTransfers || [],
    repeatedAmountTime: aggregate.repeatedAmountTime || [],
    caveats: aggregate.caveats || [],
  };

  return [
    '你是“门店刷单整理-分板块版.pdf”的财务审核总结器。',
    '请严格基于给定 JSON 输出一个 JSON 对象，不要 Markdown，不要解释，不要补充额外文字。',
    '统计口径非常重要：本版只按截图归类，不做一对一配对；金额按每张截图中可见金额统计；即使列表页与详情页疑似同单，也不要擅自去重，只能提示风险。',
    '输出字段：',
    '- title: 固定写“财务安全审核分析”',
    '- scope: 一句话说明审核范围',
    '- goal: 一句话说明审核目标',
    '- classificationSummary: 2到4条，说明板块归类和金额口径',
    '- conclusions: 3到5条，说明审核结论',
    '- focusChecks: 2到5条，说明重点复核点',
    '- recommendations: 2到4条，给出后续建议',
    '要求：',
    '- 结论必须简洁、可落地。',
    '- 如果没有高风险重复，也要明确说未发现。',
    '- 如果有列表页，要明确提醒后续补详情页时可能重复计入。',
    '上下文 JSON：',
    JSON.stringify(context, null, 2),
  ].join('\n');
}

async function requestShuadanAiAuditSummary({ storeName = '', periodLabel = '', aggregate = {} } = {}) {
  const settings = readSettings();
  const apiKey = String(process.env.ZHIPU_API_KEY || settings?.zhipuApiKey || '').trim();
  const fallbackSummary = buildFallbackAiAuditSummary(aggregate);

  if (!apiKey) {
    return fallbackSummary;
  }

  const prompt = buildAiSummaryPrompt({
    storeName,
    periodLabel,
    aggregate,
  });
  let lastError = null;

  for (const model of getSummaryModelCandidates()) {
    try {
      const response = await fetch(ZHIPU_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.2,
          top_p: 0.7,
          max_tokens: 1400,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(payload?.error?.message || payload?.message || `AI 审核总结调用失败（HTTP ${response.status}）`);
        error.status = response.status;
        throw error;
      }

      const raw = payload?.choices?.[0]?.message?.content || '';
      const parsed = extractJsonObjectFromText(raw);

      if (!parsed) {
        throw new Error(`模型 ${model} 返回了无法解析的审核总结结果。`);
      }

      return {
        ...fallbackSummary,
        title: safeText(parsed.title) || fallbackSummary.title,
        conclusions: dedupeStrings(parsed.conclusions).slice(0, 5).length
          ? dedupeStrings(parsed.conclusions).slice(0, 5)
          : fallbackSummary.conclusions,
        focusChecks: dedupeStrings(parsed.focusChecks).slice(0, 5).length
          ? dedupeStrings(parsed.focusChecks).slice(0, 5)
          : fallbackSummary.focusChecks,
        recommendations: dedupeStrings(parsed.recommendations).slice(0, 4).length
          ? dedupeStrings(parsed.recommendations).slice(0, 4)
          : fallbackSummary.recommendations,
        generatedBy: model,
      };
    } catch (error) {
      lastError = error;

      if (error?.status === 401 || error?.status === 403) {
        break;
      }
    }
  }

  return {
    ...fallbackSummary,
    error: lastError?.message || '',
  };
}

function drawSectionSummaryTable(doc, sections = [], startY) {
  const pageWidth = doc.page.width;
  const margin = doc.page.margins.left;
  const totalWidth = pageWidth - margin * 2;
  const columns = [0.24, 0.16, 0.2, 0.4];
  const widths = columns.map((ratio) => totalWidth * ratio);
  let cursorY = startY;

  const rows = [
    ['板块', '截图数', '汇总金额', '统计规则'],
    ...sections.map((section) => [
      section.label,
      `${section.screenshotCount}`,
      section.key === 'review' ? '不计入' : formatCurrency(section.summaryTotal),
      section.totalRule,
    ]),
  ];

  rows.forEach((row, rowIndex) => {
    const height = rowIndex === 0 ? 28 : 34;
    let cursorX = margin;

    row.forEach((cell, cellIndex) => {
      doc
        .save()
        .lineWidth(0.6)
        .fillColor(rowIndex === 0 ? '#f5efe6' : '#ffffff')
        .strokeColor('#d6c9b7')
        .roundedRect(cursorX, cursorY, widths[cellIndex], height, 6)
        .fillAndStroke()
        .restore();
      doc
        .fillColor('#2f261f')
        .fontSize(rowIndex === 0 ? 11 : 10.5)
        .text(safeText(cell), cursorX + 10, cursorY + 8, {
          width: widths[cellIndex] - 20,
          height: height - 10,
        });
      cursorX += widths[cellIndex];
    });

    cursorY += height + 8;
  });

  return cursorY;
}

function drawBulletList(doc, title, items = [], startY) {
  doc
    .fillColor('#1f2937')
    .fontSize(13)
    .text(title, doc.page.margins.left, startY);

  let cursorY = startY + 22;

  items.forEach((item) => {
    doc
      .fillColor('#475569')
      .fontSize(10.5)
      .text(`• ${safeText(item)}`, doc.page.margins.left + 6, cursorY, {
        width: doc.page.width - doc.page.margins.left * 2 - 12,
      });
    cursorY = doc.y + 8;
  });

  return cursorY;
}

function drawSummaryPage(doc, options, aggregate) {
  const { storeName = '', periodLabel = '' } = options;

  doc
    .fillColor('#18110b')
    .fontSize(22)
    .text('门店刷单整理-分板块版', doc.page.margins.left, 48);
  doc
    .fillColor('#8a6d3b')
    .fontSize(10.5)
    .text(
      [safeText(storeName), safeText(periodLabel), `生成时间 ${new Date().toLocaleString('zh-CN')}`]
        .filter(Boolean)
        .join(' | '),
      doc.page.margins.left,
      80,
    );

  doc
    .save()
    .fillColor('#fff7ed')
    .roundedRect(doc.page.margins.left, 112, 770, 90, 18)
    .fill()
    .restore();

  const cardItems = [
    {
      label: '核销板块合计',
      value: formatCurrency(aggregate.verificationTotal),
    },
    {
      label: '转账板块合计',
      value: formatCurrency(aggregate.transferTotal),
    },
    {
      label: '实际报销口径',
      value: formatCurrency(aggregate.actualReimbursementTotal),
    },
    {
      label: '已接收截图',
      value: `${aggregate.screenshotCount} 张`,
    },
  ];

  cardItems.forEach((item, index) => {
    const x = doc.page.margins.left + 20 + index * 185;
    doc
      .fillColor('#8c6239')
      .fontSize(10)
      .text(item.label, x, 132);
    doc
      .fillColor('#18110b')
      .fontSize(18)
      .text(item.value, x, 150, {
        width: 150,
      });
  });

  let cursorY = drawSectionSummaryTable(doc, aggregate.sections, 228);

  const caveats = [
    '默认输出为分板块版，核销截图与转账截图分别成组排版。',
    '金额统计优先按详情页去重汇总；列表页会保留在证据页中，但尽量不与详情页重复计入。',
    '若转账截图存在，则“实际报销口径”优先采用转账板块汇总。',
    ...(aggregate.caveats || []),
  ];

  const normalizedCaveats = [
    '本版不做一对一配对，仅按截图分为“核销截图板块”和“转账截图板块”两个部分。',
    '金额口径按每张截图中可见金额统计；若同一订单同时出现列表页和详情页，本版不主动去重。',
    '若存在转账截图，实际报销口径默认参考转账截图板块金额；核销板块主要用于归类与留档。',
    ...(aggregate.caveats || []),
  ];

  cursorY = drawBulletList(doc, '整理说明', normalizedCaveats, cursorY + 8);

  const auditLines = [
    aggregate.duplicateTransfers.length
      ? `发现 ${aggregate.duplicateTransfers.length} 组疑似重复转账详情，需要人工确认。`
      : '未发现明显重复的转账详情截图。',
    aggregate.repeatedAmountTime.length
      ? `发现 ${aggregate.repeatedAmountTime.length} 组“相同金额 + 相同时间”重复。`
      : '未发现明显重复的“金额 + 时间”组合。',
  ];

  drawBulletList(doc, '初步审计结论', auditLines, cursorY + 8);
}

function drawSectionImagePages(doc, section) {
  if (!section.items.length) {
    return;
  }

  const marginX = doc.page.margins.left;
  const topY = 74;
  const gap = 18;
  const headerHeight = 48;
  const footerHeight = 44;
  const availableWidth = doc.page.width - marginX * 2;
  const availableHeight =
    doc.page.height - doc.page.margins.top - doc.page.margins.bottom - headerHeight - footerHeight;
  const cellWidth = (availableWidth - gap) / 2;
  const cellHeight = (availableHeight - gap) / 2;
  const imageHeight = cellHeight - 54;

  chunk(section.items, 4).forEach((items, pageIndex) => {
    doc.addPage({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
    });

    doc
      .fillColor('#18110b')
      .fontSize(18)
      .text(section.label, marginX, 34);
    doc
      .fillColor('#8a6d3b')
      .fontSize(10.5)
      .text(
        `第 ${pageIndex + 1} 页 | 截图 ${section.screenshotCount} 张 | 汇总 ${section.key === 'review' ? '不计入金额' : formatCurrency(section.summaryTotal)}`,
        marginX,
        56,
      );

    items.forEach((item, index) => {
      const row = Math.floor(index / 2);
      const col = index % 2;
      const x = marginX + col * (cellWidth + gap);
      const y = topY + row * (cellHeight + gap);

      doc
        .save()
        .lineWidth(0.8)
        .fillColor('#ffffff')
        .strokeColor('#ddd6cb')
        .roundedRect(x, y, cellWidth, cellHeight, 16)
        .fillAndStroke()
        .restore();

      try {
        doc.image(item.assetPath, x + 12, y + 12, {
          fit: [cellWidth - 24, imageHeight - 18],
          align: 'center',
          valign: 'center',
        });
      } catch (_error) {
        doc
          .fillColor('#94a3b8')
          .fontSize(10)
          .text('图片载入失败', x + 16, y + 24);
      }

      const metaLine = [item.platform, item.screenshotKind, item.isListPage ? '列表页' : '详情页']
        .map((value) => safeText(value))
        .filter(Boolean)
        .join(' | ');

      doc
        .fillColor('#111827')
        .fontSize(10)
        .text(item.caption || item.shortCaption || item.fileName, x + 12, y + imageHeight, {
          width: cellWidth - 24,
          height: 28,
        });
      doc
        .fillColor('#64748b')
        .fontSize(8.8)
        .text(metaLine, x + 12, y + imageHeight + 22, {
          width: cellWidth - 24,
          height: 12,
        });
    });
  });
}

function drawAuditPage(doc, aggregate) {
  doc.addPage({
    size: 'A4',
    layout: 'landscape',
    margin: 36,
  });

  doc
    .fillColor('#18110b')
    .fontSize(20)
    .text('财务安全复核页', doc.page.margins.left, 42);
  doc
    .fillColor('#8a6d3b')
    .fontSize(10.5)
    .text('用于提示可能的重复、列表页重叠与待复核风险。', doc.page.margins.left, 68);

  let cursorY = 112;

  const duplicateLines = aggregate.duplicateTransfers.length
    ? aggregate.duplicateTransfers.map(
        (item) =>
          `${item.count} 次重复：${item.captions.join(' / ') || item.key}`,
      )
    : ['未发现明显重复的转账详情截图。'];
  cursorY = drawBulletList(doc, '1. 转账重复检查', duplicateLines, cursorY);

  const amountTimeLines = aggregate.repeatedAmountTime.length
    ? aggregate.repeatedAmountTime.map(
        (item) =>
          `${formatCurrency(item.amount)} @ ${item.normalizedTime} 出现 ${item.count} 次：${item.captions.join(' / ')}`,
      )
    : ['未发现明显重复的“金额 + 时间”组合。'];
  cursorY = drawBulletList(doc, '2. 金额 + 时间重复检查', amountTimeLines, cursorY + 4);

  const caveatLines = aggregate.caveats.length
    ? aggregate.caveats
    : ['当前截图包未触发额外的列表页或待复核提醒。'];
  drawBulletList(doc, '3. 其他风险提示', caveatLines, cursorY + 4);
}

function drawAiAuditSummaryPages(doc, aiSummary = {}) {
  const sections = [
    ['AI 归类总结', aiSummary.classificationSummary || []],
    ['审核结论', aiSummary.conclusions || []],
    ['重点复核点', aiSummary.focusChecks || []],
    ['财务建议', aiSummary.recommendations || []],
  ].filter(([, items]) => Array.isArray(items) && items.length);

  if (!sections.length) {
    return;
  }

  doc.addPage({
    size: 'A4',
    layout: 'landscape',
    margin: 36,
  });

  doc
    .fillColor('#18110b')
    .fontSize(20)
    .text(aiSummary.title || '财务安全审核分析', doc.page.margins.left, 42);

  if (aiSummary.scope) {
    doc
      .fillColor('#8a6d3b')
      .fontSize(10.5)
      .text(aiSummary.scope, doc.page.margins.left, 68, {
        width: doc.page.width - doc.page.margins.left * 2,
      });
  }

  if (aiSummary.goal) {
    doc
      .fillColor('#475569')
      .fontSize(10.5)
      .text(aiSummary.goal, doc.page.margins.left, doc.y + 8, {
        width: doc.page.width - doc.page.margins.left * 2,
      });
  }

  let cursorY = doc.y + 18;

  sections.forEach(([title, items], index) => {
    if (cursorY > doc.page.height - doc.page.margins.bottom - 120) {
      doc.addPage({
        size: 'A4',
        layout: 'landscape',
        margin: 36,
      });
      doc
        .fillColor('#18110b')
        .fontSize(18)
        .text(`${aiSummary.title || '财务安全审核分析'}（续）`, doc.page.margins.left, 42);
      cursorY = 86;
    }

    cursorY = drawBulletList(doc, `${index + 1}. ${title}`, items, cursorY);
    cursorY += 4;
  });

  doc
    .fillColor('#94a3b8')
    .fontSize(9)
    .text(
      `生成方式：${safeText(aiSummary.generatedBy || 'fallback')}`,
      doc.page.margins.left,
      doc.page.height - doc.page.margins.bottom + 4,
    );
}

async function createShuadanPacketPdf({
  storeName = '',
  periodLabel = '',
  parsedFiles = [],
  reviewFiles = [],
}) {
  ensureParsingExportsDir();
  const aggregate = aggregateShuadanFiles(
    Array.isArray(parsedFiles) ? parsedFiles : [],
    Array.isArray(reviewFiles) ? reviewFiles : [],
  );

  if (!aggregate.screenshotCount) {
    throw new Error('当前没有可用于生成《门店刷单整理-分板块版》的截图。');
  }

  const fontPath = resolveFontPath();

  if (!fontPath) {
    throw new Error('当前环境缺少可用于导出中文 PDF 的字体文件。');
  }

  const aiSummary = await requestShuadanAiAuditSummary({
    storeName,
    periodLabel,
    aggregate,
  });

  const token = `${Date.now()}-${crypto.randomUUID()}.pdf`;
  const filePath = path.join(PARSING_EXPORTS_DIR, token);

  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(filePath);
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
      info: {
        Title: '门店刷单整理-分板块版',
      },
    });

    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);

    doc.pipe(stream);
    doc.font(fontPath);

    drawSummaryPage(doc, { storeName, periodLabel }, aggregate);

    aggregate.sections
      .filter((section) => section.items.length)
      .forEach((section) => {
        drawSectionImagePages(doc, section);
      });

    drawAuditPage(doc, aggregate);
    drawAiAuditSummaryPages(doc, aiSummary);
    doc.end();
  });

  return {
    token,
    filePath,
    downloadFileName: '门店刷单整理-分板块版.pdf',
  };
}

module.exports = {
  createShuadanPacketPdf,
};
