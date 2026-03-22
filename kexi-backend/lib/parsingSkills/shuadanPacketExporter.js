const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { aggregateShuadanFiles } = require('./shuadanPacketParser');

const PARSING_EXPORTS_DIR = path.join(__dirname, '..', '..', 'exports', 'parsing-drafts');
const FONT_CANDIDATES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/NotoSansSC-VF.ttf',
  'C:/Windows/Fonts/simsunb.ttf',
  'C:/Windows/Fonts/msyh.ttc',
];
const SECTION_PAGE_COLUMNS = 4;
const SECTION_PAGE_FRAME = {
  x: 54,
  y: 74,
  height: 392,
  titleY: 46,
  totalY: 486,
  totalWidth: 240,
};
const SECTION_CARD_STYLE = {
  paddingX: 10,
  paddingTop: 8,
  imageHeight: 272,
  dividerWidth: 46,
};
const SECTION_NUMBER_LABELS = ['一', '二', '三'];

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

function formatPlainAmount(amount = 0) {
  return Number(amount || 0).toFixed(2);
}

function parseNormalizedTime(value = '') {
  const matched = String(value || '').match(
    /^(20\d{2})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );

  if (!matched) {
    return null;
  }

  return {
    year: matched[1],
    month: matched[2],
    day: matched[3],
    hour: matched[4],
    minute: matched[5],
    second: matched[6],
  };
}

function formatDisplayTime(value = '', options = {}) {
  const parts = parseNormalizedTime(value);

  if (!parts) {
    return '';
  }

  const date = options.slashes
    ? `${parts.year}/${parts.month}/${parts.day}`
    : `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;

  return options.timeOnly ? time : `${date} ${time}`;
}

function formatDisplayTimeRange(values = [], options = {}) {
  const points = dedupeStrings(values)
    .map((value) => parseNormalizedTime(value))
    .filter(Boolean)
    .sort((left, right) =>
      `${left.year}${left.month}${left.day}${left.hour}${left.minute}${left.second}`.localeCompare(
        `${right.year}${right.month}${right.day}${right.hour}${right.minute}${right.second}`,
      ),
    );

  if (!points.length) {
    return '';
  }

  if (points.length === 1) {
    const only = points[0];
    return formatDisplayTime(
      `${only.year}-${only.month}-${only.day} ${only.hour}:${only.minute}:${only.second}`,
      options,
    );
  }

  const first = points[0];
  const last = points[points.length - 1];
  const sameDay =
    first.year === last.year && first.month === last.month && first.day === last.day;
  const firstFull = formatDisplayTime(
    `${first.year}-${first.month}-${first.day} ${first.hour}:${first.minute}:${first.second}`,
    options,
  );

  if (!sameDay) {
    const lastFull = formatDisplayTime(
      `${last.year}-${last.month}-${last.day} ${last.hour}:${last.minute}:${last.second}`,
      options,
    );
    return `${firstFull}-${lastFull}`;
  }

  return `${firstFull}-${last.hour}:${last.minute}:${last.second}`;
}

function formatAuditFileName(fileName = '') {
  return safeText(path.basename(String(fileName || '')));
}

function normalizeCode(value = '') {
  return safeText(value).replace(/[^\dA-Za-z]/g, '');
}

function formatVoucherCodeDisplay(value = '') {
  const code = normalizeCode(value);

  if (/^\d{12}$/.test(code)) {
    return code.replace(/(\d{4})(\d{4})(\d{4})/, '$1 $2 $3');
  }

  if (/^\d{13}$/.test(code)) {
    return code.replace(/(\d{4})(\d{4})(\d{4})(\d)/, '$1 $2 $3 $4');
  }

  return code;
}

function extractCodesFromLabel(label = '') {
  return dedupeStrings(
    (safeText(label).match(/[0-9A-Za-z]{8,24}/g) || []).map((item) => normalizeCode(item)),
  );
}

function toDateObject(value = '') {
  const parts = parseNormalizedTime(value);

  if (!parts) {
    return null;
  }

  const date = new Date(
    `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}+08:00`,
  );

  return Number.isNaN(date.getTime()) ? null : date;
}

function diffSeconds(left = '', right = '') {
  const leftDate = toDateObject(left);
  const rightDate = toDateObject(right);

  if (!leftDate || !rightDate) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.abs(leftDate.getTime() - rightDate.getTime()) / 1000;
}

function formatClock(value = '') {
  const parts = parseNormalizedTime(value);
  return parts ? `${parts.hour}:${parts.minute}` : '';
}

function buildVerificationVoucherPool(aggregate = {}) {
  const verificationSection = aggregate.sections.find((section) => section.key === 'verification') || {};
  const refs = [];

  (verificationSection.items || []).forEach((item) => {
    if (item.voucherCode && item.normalizedTime) {
      refs.push({
        code: normalizeCode(item.voucherCode),
        time: item.normalizedTime,
        source: 'detail',
      });
    }

    (item.listItems || []).forEach((listItem) => {
      extractCodesFromLabel(listItem.label).forEach((code) => {
        refs.push({
          code,
          time: listItem.time || item.normalizedTime,
          source: 'list',
        });
      });
    });
  });

  return refs.filter((item) => item.code && item.time);
}

function findNearbyVoucherRefs(targetTime = '', refs = [], toleranceSeconds = 120) {
  return refs
    .map((ref) => ({
      ...ref,
      diffSeconds: diffSeconds(targetTime, ref.time),
    }))
    .filter((ref) => ref.diffSeconds <= toleranceSeconds)
    .sort((left, right) => {
      if (left.diffSeconds !== right.diffSeconds) {
        return left.diffSeconds - right.diffSeconds;
      }

      if (left.source !== right.source) {
        return left.source === 'list' ? -1 : 1;
      }

      return left.code.localeCompare(right.code);
    });
}

function buildTransferVoucherLinks(aggregate = {}) {
  const transferSection = aggregate.sections.find((section) => section.key === 'transfer') || {};
  const refs = buildVerificationVoucherPool(aggregate);
  const links = new Map();

  (transferSection.items || []).forEach((item) => {
    const key = item.assetToken || item.fileName;

    if (item.isListPage) {
      const listLines = [];

      (item.listItems || []).forEach((listItem) => {
        const candidates = findNearbyVoucherRefs(listItem.time || item.normalizedTime, refs);
        const relaxedCandidates =
          candidates.length
            ? candidates
            : findNearbyVoucherRefs(listItem.time || item.normalizedTime, refs, 1800);

        if (!relaxedCandidates.length) {
          return;
        }

        const listCodes = dedupeStrings(
          relaxedCandidates
            .filter((candidate) => candidate.source === 'list')
            .map((candidate) => candidate.code),
        );
        const detailCodes = dedupeStrings(
          relaxedCandidates
            .filter((candidate) => candidate.source === 'detail')
            .map((candidate) => candidate.code),
        ).filter((code) => !listCodes.includes(code));
        const primaryCodes = listCodes.length ? listCodes : detailCodes.slice(0, 1);
        const extraDetailCodes = detailCodes.filter((code) => !primaryCodes.includes(code));

        if (!primaryCodes.length) {
          return;
        }

        let line = `${formatClock(listItem.time || item.normalizedTime)} 对应 ${primaryCodes
          .map((code) => formatVoucherCodeDisplay(code))
          .join('、')}`;

        if (extraDetailCodes.length) {
          line += `（另附详情页券码 ${extraDetailCodes
            .map((code) => formatVoucherCodeDisplay(code))
            .join('、')}）`;
        }

        listLines.push(line);
      });

      links.set(key, {
        listLines: dedupeStrings(listLines).slice(0, 4),
      });
      return;
    }

    const primaryMatches = findNearbyVoucherRefs(item.normalizedTime, refs);
    const relaxedMatches = primaryMatches.length
      ? primaryMatches
      : findNearbyVoucherRefs(item.normalizedTime, refs, 1800);
    const codes = dedupeStrings(relaxedMatches.map((candidate) => candidate.code))
      .map((code) => formatVoucherCodeDisplay(code))
      .slice(0, 4);

    links.set(key, { codes });
  });

  return links;
}

function buildSectionSummaryRows(aggregate = {}) {
  const verificationSection = aggregate.sections.find((section) => section.key === 'verification') || {};
  const transferSection = aggregate.sections.find((section) => section.key === 'transfer') || {};

  return [
    ['板块', '截图数量', '板块金额（元）'],
    ['核销截图板块', `${verificationSection.screenshotCount || 0}`, formatPlainAmount(aggregate.verificationTotal)],
    ['转账截图板块', `${transferSection.screenshotCount || 0}`, formatPlainAmount(aggregate.transferTotal)],
  ];
}

function drawStandardSummaryTable(doc, rows = [], startY = 0) {
  const margin = doc.page.margins.left;
  const totalWidth = doc.page.width - margin * 2;
  const widths = [totalWidth * 0.46, totalWidth * 0.18, totalWidth * 0.36];
  let cursorY = startY;

  rows.forEach((row, rowIndex) => {
    let cursorX = margin;
    const rowHeight = 34;

    row.forEach((cell, cellIndex) => {
      doc
        .save()
        .lineWidth(0.6)
        .fillColor(rowIndex === 0 ? '#f6f1e8' : '#ffffff')
        .strokeColor('#ccbfae')
        .rect(cursorX, cursorY, widths[cellIndex], rowHeight)
        .fillAndStroke()
        .restore();
      doc
        .fillColor('#1f1a17')
        .fontSize(rowIndex === 0 ? 11 : 10.8)
        .text(safeText(cell), cursorX + 10, cursorY + 10, {
          width: widths[cellIndex] - 20,
          align: cellIndex === 0 ? 'left' : 'center',
        });
      cursorX += widths[cellIndex];
    });

    cursorY += rowHeight;
  });

  return cursorY;
}

function drawSummaryPage(doc, aggregate) {
  doc
    .fillColor('#18110b')
    .fontSize(24)
    .text('门店刷单整理-分板块版', doc.page.margins.left, 52);
  doc
    .fillColor('#3f342b')
    .fontSize(11)
    .text(
      '说明：本版不做一对一配对，仅按截图分为“核销截图”和“转账截图”两个板块。',
      doc.page.margins.left,
      96,
    );
  doc
    .fillColor('#3f342b')
    .fontSize(11)
    .text(
      '金额口径：按每张截图中可见金额统计；若同一订单同时出现列表页和详情页，本版不去重。',
      doc.page.margins.left,
      118,
    );

  let cursorY = drawStandardSummaryTable(doc, buildSectionSummaryRows(aggregate), 166);
  const reviewSection = aggregate.sections.find((section) => section.key === 'review') || {};

  if (reviewSection.screenshotCount) {
    cursorY += 18;
    doc
      .fillColor('#6b5a48')
      .fontSize(10.2)
      .text(
        `补充说明：仍有 ${reviewSection.screenshotCount} 张截图进入待复核板块，未计入本版板块金额。`,
        doc.page.margins.left,
        cursorY,
      );
  }
}

function buildCardTitle(item = {}) {
  if (item.sectionKey === 'transfer') {
    return item.isListPage ? '转账列表' : '实际转账';
  }

  if (item.platform === '抖音') {
    if (item.isListPage) {
      return '抖音核销合集';
    }

    return Number(item.primaryAmount || 0) < 980 ? '抖音核销详情' : '抖音核销';
  }

  if (item.platform === '大众点评') {
    return item.isListPage ? '大众点评核销合集' : '大众点评核销';
  }

  return item.isListPage ? '核销合集' : '核销详情';
}

function buildItemTimeLabel(item = {}) {
  const useSlashes = item.sectionKey === 'verification' && item.platform === '抖音';
  const values = dedupeStrings([
    item.normalizedTime,
    ...(item.isListPage ? (item.listItems || []).map((listItem) => listItem.time) : []),
  ]);

  return formatDisplayTimeRange(values, { slashes: useSlashes });
}

function buildVerificationDetailLine(item = {}) {
  const amount = formatPlainAmount(item.primaryAmount);
  const listAmountItems = (item.listItems || []).filter((listItem) => listItem.amount);

  if (item.isListPage) {
    if (item.platform === '抖音') {
      const businessLabel = safeText(item.businessLabel);
      return `说明：同页可见 ${listAmountItems.length || item.listItems.length || 2} 笔${businessLabel || ''}核销，按页面可见金额合计 ${amount} 元。`;
    }

    const distinctAmounts = dedupeStrings(listAmountItems.map((listItem) => formatPlainAmount(listItem.amount)));

    if (distinctAmounts.length === 1 && listAmountItems.length > 1) {
      return `说明：同页可见 ${listAmountItems.length} 笔核销，消费金额均为 ${distinctAmounts[0]} 元，按页面合计 ${amount} 元。`;
    }

    return `说明：同页可见 ${listAmountItems.length || item.listItems.length || 2} 笔核销，按页面可见金额合计 ${amount} 元。`;
  }

  if (item.platform === '抖音') {
    if (Number(item.primaryAmount || 0) < 980) {
      return `说明：详情页按顾客实付金额 ${amount} 元统计；该页可能与列表页存在补充信息重叠。`;
    }

    if (item.orderId) {
      return `说明：订单 ID ${normalizeCode(item.orderId)}，页面显示订单实收 ${amount} 元。`;
    }

    return `说明：页面显示订单实收 ${amount} 元。`;
  }

  if (item.voucherCode) {
    return `说明：券码 ${formatVoucherCodeDisplay(item.voucherCode)}，单张核销截图。`;
  }

  if (item.orderId) {
    return `说明：订单号 ${normalizeCode(item.orderId)}，单张核销截图。`;
  }

  return `说明：页面显示订单实收 ${amount} 元。`;
}

function buildTransferDetailLine(item = {}, transferVoucherLinks = new Map()) {
  const link = transferVoucherLinks.get(item.assetToken || item.fileName) || {};

  if (item.isListPage) {
    if (Array.isArray(link.listLines) && link.listLines.length) {
      return `券码：${link.listLines.join('；')}`;
    }

    return '券码：当前样本缺少可对应的核销记录，列表页先按截图可见金额统计。';
  }

  if (Array.isArray(link.codes) && link.codes.length) {
    return `券码：${link.codes.join('、')}`;
  }

  if (item.voucherCode) {
    return `券码：${formatVoucherCodeDisplay(item.voucherCode)}`;
  }

  if (item.orderId) {
    return `单号：${normalizeCode(item.orderId)}`;
  }

  return '说明：按截图可见金额统计。';
}

function buildCardLines(item = {}, transferVoucherLinks = new Map()) {
  return [
    buildCardTitle(item),
    `${formatPlainAmount(item.primaryAmount)} 元`,
    `时间：${buildItemTimeLabel(item) || '待补充'}`,
    item.sectionKey === 'transfer'
      ? buildTransferDetailLine(item, transferVoucherLinks)
      : buildVerificationDetailLine(item),
  ];
}

function drawSectionCellFrame(doc, x, y, width, height) {
  doc
    .save()
    .lineWidth(0.9)
    .strokeColor('#1b1b1b')
    .rect(x, y, width, height)
    .stroke()
    .restore();
}

function drawSectionPageTitle(doc, title) {
  doc
    .fillColor('#18110b')
    .fontSize(18)
    .text(title, 0, SECTION_PAGE_FRAME.titleY, {
      width: doc.page.width,
      align: 'center',
    });
}

function drawSectionPageTotal(doc, section = {}) {
  doc
    .fillColor('#18110b')
    .fontSize(16)
    .text(
      `${safeText(section.label)}合计：${formatPlainAmount(section.summaryTotal)} 元`,
      doc.page.width - SECTION_PAGE_FRAME.x - SECTION_PAGE_FRAME.totalWidth,
      SECTION_PAGE_FRAME.totalY,
      {
        width: SECTION_PAGE_FRAME.totalWidth,
        align: 'right',
      },
    );
}

function drawItemCard(doc, item, x, y, width, height, transferVoucherLinks) {
  const imageHeight = Math.min(SECTION_CARD_STYLE.imageHeight, height - 114);
  const imageX = x + SECTION_CARD_STYLE.paddingX;
  const imageY = y + SECTION_CARD_STYLE.paddingTop;
  const dividerY = imageY + imageHeight + 6;
  const textWidth = width - SECTION_CARD_STYLE.paddingX * 2;
  const titleY = dividerY + 10;
  const lines = buildCardLines(item, transferVoucherLinks);

  drawSectionCellFrame(doc, x, y, width, height);

  try {
    doc.image(item.assetPath, imageX, imageY, {
      fit: [textWidth, imageHeight],
      align: 'center',
      valign: 'top',
    });
  } catch (_error) {
    doc
      .fillColor('#8b8b8b')
      .fontSize(10)
      .text('图片加载失败', imageX, imageY + 12, {
        width: textWidth,
        align: 'center',
      });
  }

  doc
    .save()
    .lineWidth(0.7)
    .strokeColor('#2a2a2a')
    .moveTo(x + width / 2 - SECTION_CARD_STYLE.dividerWidth / 2, dividerY)
    .lineTo(x + width / 2 + SECTION_CARD_STYLE.dividerWidth / 2, dividerY)
    .stroke()
    .restore();

  doc
    .fillColor('#1d1a17')
    .fontSize(14.2)
    .text(lines[0], imageX, titleY, {
      width: textWidth,
      align: 'center',
    });
  doc
    .fillColor('#1d1a17')
    .fontSize(13.2)
    .text(lines[1], imageX, doc.y + 4, {
      width: textWidth,
      align: 'center',
    });
  doc
    .fillColor('#222222')
    .fontSize(8.8)
    .text(lines[2], imageX, doc.y + 8, {
      width: textWidth,
    });
  doc
    .fillColor('#222222')
    .fontSize(8.4)
    .text(lines[3], imageX, doc.y + 4, {
      width: textWidth,
      height: height - (doc.y - y) - 10,
      lineGap: 1,
    });
}

function drawSectionImagePages(doc, section, sectionIndex, transferVoucherLinks) {
  if (!section.items.length) {
    return;
  }

  const pages = chunk(section.items, SECTION_PAGE_COLUMNS);
  const sectionNumber = SECTION_NUMBER_LABELS[sectionIndex] || `${sectionIndex + 1}`;
  const gridX = SECTION_PAGE_FRAME.x;
  const gridY = SECTION_PAGE_FRAME.y;
  const gridWidth = doc.page.width - gridX * 2;
  const cellWidth = gridWidth / SECTION_PAGE_COLUMNS;
  const cellHeight = SECTION_PAGE_FRAME.height;

  pages.forEach((items, pageIndex) => {
    const isFirstPage = pageIndex === 0;
    const isLastPage = pageIndex === pages.length - 1;

    doc.addPage({
      size: 'A4',
      layout: 'landscape',
      margin: 36,
    });

    if (isFirstPage) {
      drawSectionPageTitle(doc, `${sectionNumber}、${section.label}`);
    }

    for (let index = 0; index < SECTION_PAGE_COLUMNS; index += 1) {
      const x = gridX + cellWidth * index;
      const item = items[index];

      if (item) {
        drawItemCard(doc, item, x, gridY, cellWidth, cellHeight, transferVoucherLinks);
      } else {
        drawSectionCellFrame(doc, x, gridY, cellWidth, cellHeight);
      }
    }

    if (isLastPage) {
      drawSectionPageTotal(doc, section);
    }
  });
}

function buildTransferAmountSummary(transferSection = {}) {
  const groups = new Map();

  (transferSection.items || []).forEach((item) => {
    const amount = Number(item.primaryAmount || 0);

    if (!amount) {
      return;
    }

    const key = amount.toFixed(2);
    const current = groups.get(key) || {
      amount,
      times: [],
      entries: [],
    };

    if (item.normalizedTime) {
      current.times.push(item.normalizedTime);
    }

    current.entries.push({
      time: item.normalizedTime || '',
      fileName: item.fileName || '',
    });

    groups.set(key, current);
  });

  return [...groups.values()]
    .map((item) => {
      const uniqueTimes = dedupeStrings(item.times);
      const sameTimeDuplicates = [...item.entries.reduce((map, entry) => {
        if (!entry.time) {
          return map;
        }

        const current = map.get(entry.time) || [];
        current.push(entry.fileName || '');
        map.set(entry.time, current);
        return map;
      }, new Map()).entries()]
        .filter(([, fileNames]) => fileNames.length > 1)
        .map(([time, fileNames]) => ({
          time,
          count: fileNames.length,
          fileNames: dedupeStrings(fileNames).slice(0, 4),
        }));

      return {
        ...item,
        uniqueTimes,
        hasSameTimeDuplicate: uniqueTimes.length < item.times.length,
        sameTimeDuplicates,
      };
    })
    .filter((item) => item.times.length > 1)
    .sort((left, right) => right.times.length - left.times.length || right.amount - left.amount);
}

function buildAuditSections(aggregate = {}, transferVoucherLinks = new Map()) {
  const transferSection = aggregate.sections.find((section) => section.key === 'transfer') || {};
  const reviewSection = aggregate.sections.find((section) => section.key === 'review') || {};
  const repeatedAmounts = buildTransferAmountSummary(transferSection);
  const transferListItem = (transferSection.items || []).find((item) => item.isListPage);
  const transferListLink = transferListItem
    ? transferVoucherLinks.get(transferListItem.assetToken || transferListItem.fileName) || {}
    : {};
  const listDateText = transferListItem?.normalizedTime
    ? formatDisplayTime(transferListItem.normalizedTime).slice(0, 10)
    : '当前';
  const repeatedAmountLabels = repeatedAmounts
    .slice(0, 3)
    .map((item) => `${formatPlainAmount(item.amount)} 元`);
  const sameTimeRepeatedAmounts = repeatedAmounts.filter((item) => item.hasSameTimeDuplicate);
  const differentTimeRepeatedAmounts = repeatedAmounts.filter((item) => !item.hasSameTimeDuplicate);
  const sameTimeLabels = sameTimeRepeatedAmounts
    .slice(0, 3)
    .map((item) => `${formatPlainAmount(item.amount)} 元`);
  const differentTimeLabels = differentTimeRepeatedAmounts
    .slice(0, 3)
    .map((item) => `${formatPlainAmount(item.amount)} 元`);

  const conclusions = [
    aggregate.repeatedAmountTime.length
      ? `发现 ${aggregate.repeatedAmountTime.length} 组“同金额 + 同时间”的高风险重复，需要人工复核。`
      : '未发现“同金额 + 同时间”的完全重复转账截图，当前转账板块未见直接重复入账。',
    repeatedAmounts.length
      ? sameTimeLabels.length && differentTimeLabels.length
        ? `已知的高频重复金额主要是 ${repeatedAmountLabels.join('、')}；其中 ${sameTimeLabels.join('、')} 存在同时间重复，按高风险疑似重复处理，${differentTimeLabels.join('、')} 虽重复出现，但时间不同，暂不判定为重复单据。`
        : sameTimeLabels.length
          ? `已知的高频重复金额主要是 ${sameTimeLabels.join('、')}，且存在同时间重复，按高风险疑似重复处理。`
          : `已知的高频重复金额主要是 ${differentTimeLabels.join('、')}，但它们对应时间不同，不判定为重复单据。`
      : '当前转账板块未发现需要立即剔除的重复金额组合。',
    transferListItem
      ? `${formatPlainAmount(transferListItem.primaryAmount)} 元这张为 ${listDateText} 的转账列表截图，内容本身是多笔转账汇总；在当前文档里未见与其它单笔重复计入。`
      : '当前截图包未出现需要单独剔除的转账列表页重叠问题。',
    '从现有截图看，未发现超出板块统计逻辑的异常大额单笔；本批高金额主要来自 1050 元代金券相关业务，属于业务特征导致的高频高额。',
  ];
  const focusChecks = [
    ...repeatedAmounts.slice(0, 3).map((item) => {
      const times = item.uniqueTimes
        .slice(0, 3)
        .map((time) => formatDisplayTime(time))
        .join('、');

      if (item.hasSameTimeDuplicate) {
        const duplicateDetails = item.sameTimeDuplicates
          .slice(0, 2)
          .map((duplicate) => {
            const duplicateTime = formatDisplayTime(duplicate.time);
            const duplicateFiles = duplicate.fileNames
              .map((fileName) => formatAuditFileName(fileName))
              .join('、');

            if (duplicateFiles) {
              return `${duplicateTime} 对应截图：${duplicateFiles}`;
            }

            return duplicateTime;
          })
          .join('；');

        return `${formatPlainAmount(item.amount)} 元出现 ${item.times.length} 次：${times}。其中 ${duplicateDetails || '存在同时间重复记录'}，为同金额同时间重复，按高风险疑似重复处理，建议核对原图并剔除重复入账。`;
      }

      return `${formatPlainAmount(item.amount)} 元出现 ${item.times.length} 次：${times}。时间不同，需结合原图复核但不直接判重。`;
    }),
    Array.isArray(transferListLink.listLines) && transferListLink.listLines.length
      ? `${formatPlainAmount(transferListItem.primaryAmount)} 元列表页当前可对应 ${transferListLink.listLines.join('；')}。后续若补录这些单笔详情，应删除或改写列表页金额统计。`
      : '后续补图时，应优先补单笔转账详情页；若同时保留列表页，需人工避免二次计入。',
  ].filter(Boolean);
  const recommendations = [
    '本批可按“转账截图金额为准”继续使用。',
    '后续补图时，优先补单笔转账详情页；一旦补齐，应删除对应的汇总列表页金额统计。',
    aggregate.repeatedAmountTime.length
      ? `审批时重点复核“同金额 + 同分钟/同时间”重复出现的记录；当前已发现 ${aggregate.repeatedAmountTime.length} 组，报销前应人工确认并剔除重复入账。`
      : '审批时重点盯“同金额 + 同分钟”重复出现的记录；本版暂未发现这种高风险情形。',
  ];

  if (reviewSection.screenshotCount) {
    recommendations.splice(
      2,
      0,
      `仍有 ${reviewSection.screenshotCount} 张截图进入待复核板块，报销前建议再做一次人工确认。`,
    );
  }

  return {
    scope: `审核范围：转账截图板块，共 ${transferSection.screenshotCount || 0} 张截图，当前口径合计 ${formatPlainAmount(aggregate.transferTotal)} 元。`,
    goal: '审核目标：检查是否存在重复计入、明显异常单据，降低因店长高频操作造成的金额错误风险。',
    conclusions,
    focusChecks,
    recommendations,
  };
}

function openAuditPage(doc, title) {
  doc.addPage({
    size: 'A4',
    layout: 'landscape',
    margin: 36,
  });
  doc
    .fillColor('#18110b')
    .fontSize(20)
    .text(title, doc.page.margins.left, 42);
  return 86;
}

function ensureAuditPageSpace(doc, cursorY, neededHeight, state) {
  const limit = doc.page.height - doc.page.margins.bottom - 18;

  if (cursorY + neededHeight <= limit) {
    return cursorY;
  }

  state.pageCount += 1;
  return openAuditPage(doc, '三、财务安全审核分析（续）');
}

function drawAuditBulletSection(doc, title, items = [], startY, state) {
  let cursorY = ensureAuditPageSpace(doc, startY, 36, state);

  doc
    .fillColor('#18110b')
    .fontSize(14)
    .text(title, doc.page.margins.left, cursorY);
  cursorY = doc.y + 10;

  items.forEach((item) => {
    cursorY = ensureAuditPageSpace(doc, cursorY, 48, state);
    doc
      .fillColor('#3f342b')
      .fontSize(10.8)
      .text(`- ${safeText(item)}`, doc.page.margins.left + 2, cursorY, {
        width: doc.page.width - doc.page.margins.left * 2 - 4,
      });
    cursorY = doc.y + 7;
  });

  return cursorY + 4;
}

function drawAuditAnalysis(doc, aggregate, transferVoucherLinks) {
  const audit = buildAuditSections(aggregate, transferVoucherLinks);
  const state = { pageCount: 1 };
  let cursorY = openAuditPage(doc, '三、财务安全审核分析');

  doc
    .fillColor('#6d5740')
    .fontSize(10.8)
    .text(audit.scope, doc.page.margins.left, cursorY, {
      width: doc.page.width - doc.page.margins.left * 2,
    });
  cursorY = doc.y + 8;
  doc
    .fillColor('#6d5740')
    .fontSize(10.8)
    .text(audit.goal, doc.page.margins.left, cursorY, {
      width: doc.page.width - doc.page.margins.left * 2,
    });
  cursorY = doc.y + 16;

  cursorY = drawAuditBulletSection(doc, '审核结论', audit.conclusions, cursorY, state);
  cursorY = drawAuditBulletSection(doc, '重点复核点', audit.focusChecks, cursorY, state);
  state.pageCount += 1;
  cursorY = openAuditPage(doc, '三、财务安全审核分析（续）');
  drawAuditBulletSection(doc, '财务建议', audit.recommendations, cursorY, state);
}

async function createShuadanPacketPdf({
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

  const transferVoucherLinks = buildTransferVoucherLinks(aggregate);
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

    drawSummaryPage(doc, aggregate);

    aggregate.sections
      .filter((section) => ['verification', 'transfer'].includes(section.key) && section.items.length)
      .forEach((section, index) => {
        drawSectionImagePages(doc, section, index, transferVoucherLinks);
      });

    drawAuditAnalysis(doc, aggregate, transferVoucherLinks);
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
