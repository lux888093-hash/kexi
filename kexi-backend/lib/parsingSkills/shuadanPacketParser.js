const crypto = require('crypto');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { readSettings } = require('../appSettings');
const {
  SHUADAN_ASSETS_DIR,
  buildShuadanAssetToken,
} = require('../parsingArtifactStore');

const execFileAsync = promisify(execFile);

const ZHIPU_API_URL =
  process.env.ZHIPU_API_URL || 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const IMAGE_MIME_TYPES = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const IMAGE_EXTENSIONS = new Set(Object.keys(IMAGE_MIME_TYPES));

const SECTION_DEFINITIONS = {
  verification: {
    key: 'verification',
    label: '核销截图板块',
    bodySheetSection: {
      key: 'shuadan_verification',
      label: '核销截图板块',
      target: '门店刷单整理 PDF',
      description: '用于整理美团、抖音、大众点评等平台核销或订单截图。',
    },
  },
  transfer: {
    key: 'transfer',
    label: '转账截图板块',
    bodySheetSection: {
      key: 'shuadan_transfer',
      label: '转账截图板块',
      target: '门店刷单整理 PDF',
      description: '用于整理微信、支付宝、银行卡等实际打款截图。',
    },
  },
  review: {
    key: 'review',
    label: '待复核截图板块',
    bodySheetSection: {
      key: 'shuadan_review',
      label: '待复核截图板块',
      target: '门店刷单整理 PDF',
      description: '用于收纳暂未稳定识别的截图，避免遗漏证据。',
    },
  },
};

const SHUADAN_REQUIRED_SOURCE_GROUPS = [
  {
    key: SECTION_DEFINITIONS.verification.key,
    label: SECTION_DEFINITIONS.verification.label,
  },
  {
    key: SECTION_DEFINITIONS.transfer.key,
    label: SECTION_DEFINITIONS.transfer.label,
  },
];

function ensureShuadanAssetsDir() {
  fs.mkdirSync(SHUADAN_ASSETS_DIR, { recursive: true });
}

function getExtension(fileName = '') {
  const extension = path.extname(String(fileName || '').trim().toLowerCase());
  return extension ? extension.slice(1) : '';
}

function normalizeText(value = '') {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function safeText(value = '') {
  return normalizeText(value).replace(/\n+/g, ' ').trim();
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const sanitized = String(value)
    .replace(/,/g, '')
    .replace(/[^\d.-]/g, '')
    .replace(/(\.\d{2})\d+/g, '$1');
  const normalized = Number(sanitized);

  return Number.isFinite(normalized) ? normalized : null;
}

function formatCurrency(amount) {
  return `¥${Number(amount || 0).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function parseCaptureDateFromName(originalName = '') {
  const matched = String(originalName || '').match(/(20\d{2})(\d{2})(\d{2})/);

  if (!matched) {
    return null;
  }

  return {
    year: matched[1],
    month: matched[2],
    day: matched[3],
  };
}

function correctFutureTimeAgainstCaptureDate(value = '', originalName = '') {
  const matched = String(value || '').match(
    /^(20\d{2})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/,
  );
  const captureDate = parseCaptureDateFromName(originalName);

  if (!matched || !captureDate) {
    return value;
  }

  const current = new Date(
    `${matched[1]}-${matched[2]}-${matched[3]}T${matched[4]}+08:00`,
  );
  const capture = new Date(
    `${captureDate.year}-${captureDate.month}-${captureDate.day}T23:59:59+08:00`,
  );

  if (Number.isNaN(current.getTime()) || Number.isNaN(capture.getTime()) || current <= capture) {
    return value;
  }

  const futureDays = (current.getTime() - capture.getTime()) / (24 * 60 * 60 * 1000);

  if (futureDays <= 3) {
    return value;
  }

  const corrected = `${matched[1]}-${captureDate.month}-${matched[3]} ${matched[4]}`;
  const correctedDate = new Date(
    `${matched[1]}-${captureDate.month}-${matched[3]}T${matched[4]}+08:00`,
  );

  return !Number.isNaN(correctedDate.getTime()) && correctedDate <= capture ? corrected : value;
}

function dedupeStrings(values = []) {
  return [...new Set(values.map((value) => safeText(value)).filter(Boolean))];
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
    // Fall through to bracket scan.
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

function getZhipuSettings() {
  try {
    const stored = readSettings();
    const apiKey = String(process.env.ZHIPU_API_KEY || stored?.zhipuApiKey || '').trim();
    const configuredTextModel = String(
      process.env.ZHIPU_MODEL || stored?.zhipuModel || '',
    ).trim();
    const configuredVisionModel = String(process.env.ZHIPU_VISION_MODEL || '').trim();
    const visionModelCandidates = [
      configuredVisionModel,
      'glm-4.6v-flash',
      'glm-4.5v',
    ].filter(Boolean);
    const textModelCandidates = [
      configuredTextModel,
      process.env.ZHIPU_TEXT_MODEL || '',
      'glm-5',
      'glm-4.7-flash',
      'glm-4-flash-250414',
    ].filter(Boolean);

    return {
      apiKey,
      visionModelCandidates: [...new Set(visionModelCandidates)],
      textModelCandidates: [...new Set(textModelCandidates)],
    };
  } catch {
    return {
      apiKey: String(process.env.ZHIPU_API_KEY || '').trim(),
      visionModelCandidates: ['glm-4.6v-flash', 'glm-4.5v'],
      textModelCandidates: ['glm-5', 'glm-4.7-flash', 'glm-4-flash-250414'],
    };
  }
}

function normalizeDateTime(value = '') {
  const text = safeText(value)
    .replace(/[：﹕]/g, ':')
    .replace(/[—–]/g, '-')
    .replace(/(\d)\s*一\s*(?=\d)/g, '$1-')
    .replace(/年/g, '-')
    .replace(/月/g, '-')
    .replace(/[日号]/g, ' ')
    .replace(/(\d{4}-\d{1,2}-\d{1,2})(\d{1,2}:\d{2}:\d{2})/, '$1 $2');

  if (!text) {
    return '';
  }

  const matched = text.match(
    /(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:[日号]?\s+|\s*T?)(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/,
  );

  if (!matched) {
    return '';
  }

  const year = matched[1];
  const month = matched[2].padStart(2, '0');
  const day = matched[3].padStart(2, '0');
  const hour = matched[4].padStart(2, '0');
  const minute = matched[5].padStart(2, '0');
  const second = (matched[6] || '00').padStart(2, '0');

  if (
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(day) > 31 ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  ) {
    return '';
  }

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function buildVisionPrompt({ originalName = '', storeName = '', periodLabel = '' } = {}) {
  return [
    '你是“门店刷单整理-分板块版”截图解析器，负责识别单张截图并输出结构化 JSON。',
    '请只输出一个 JSON 对象，不要 Markdown，不要解释，不要补充额外文字。',
    '识别目标是两大板块：',
    '1. verification: 平台核销/团购/订单/券码/验券截图，例如美团、抖音、大众点评。',
    '2. transfer: 实际转账/代付/账单详情截图，例如微信、支付宝、银行卡。',
    '如果无法稳定判断，section_key 返回 "unknown"。',
    '字段要求：',
    '- section_key: "verification" | "transfer" | "unknown"',
    '- screenshot_kind: "verification_detail" | "verification_list" | "transfer_detail" | "transfer_list" | "other"',
    '- platform: 平台或支付渠道名称，不确定填空字符串',
    '- is_list_page: true/false',
    '- primary_amount: 最适合做汇总的主金额；转账详情优先实际支付金额；核销详情优先消费金额/实付金额；无法判断填 null',
    '- amount_candidates: [{ "label": "", "amount": 0 }]',
    '- normalized_time: 标准化为 YYYY-MM-DD HH:mm:ss，无法判断填空字符串',
    '- voucher_code: 券码或验券码，没有则空',
    '- order_id: 订单号/流水号，没有则空',
    '- applicant_name: 申请人/付款人/收款对象，没有则空',
    '- recipient_name: 商户/收款方，没有则空',
    '- list_items: 对列表页尽量提取可见条目，例如 [{ "time": "", "amount": 0, "label": "" }]',
    '- evidence: 提取 2 到 6 条最关键的可见文字证据',
    '- short_caption: 生成一个不超过 36 个汉字的中文标题，适合放在 PDF 图片下方',
    '- confidence: 0 到 1 之间的小数',
    '规则：',
    '- 只根据截图中清晰可见的信息作答，不要臆造。',
    '- 如果一个页面同时显示多个金额，把主要金额放进 primary_amount，其余金额放进 amount_candidates。',
    '- 列表页不要把不可确认的多条记录强行汇总为一笔。',
    '- 券码、订单号、时间尽量提取完整。',
    '- evidence 使用原图里出现的短语，不要改写。',
    `当前文件名：${safeText(originalName) || '未提供'}`,
    `当前门店提示：${safeText(storeName) || '未提供'}`,
    `当前月份提示：${safeText(periodLabel) || '未提供'}`,
    '输出示例：',
    JSON.stringify(
      {
        section_key: 'verification',
        screenshot_kind: 'verification_detail',
        platform: '美团',
        is_list_page: false,
        primary_amount: 995,
        amount_candidates: [
          { label: '售卖价', amount: 1000 },
          { label: '优惠金额', amount: 5 },
        ],
        normalized_time: '2026-03-18 15:20:11',
        voucher_code: '0108 7204 6069 9',
        order_id: '5017032994898743155',
        applicant_name: '',
        recipient_name: '',
        list_items: [],
        evidence: ['券码', '验证时间', '消费金额'],
        short_caption: '美团核销详情',
        confidence: 0.96,
      },
      null,
      2,
    ),
  ].join('\n');
}

function buildTextAuditPrompt({
  originalName = '',
  storeName = '',
  periodLabel = '',
  ocrText = '',
  visionCandidate = null,
} = {}) {
  return [
    '你是“门店刷单整理-分板块版”二次审核器。',
    '现在给你的是截图 OCR 文本，以及上一轮视觉识别候选结果。',
    '请基于 OCR 文本做审核，输出一个 JSON 对象，不要 Markdown，不要解释，不要补充额外文字。',
    '识别目标是两大板块：',
    '1. verification: 平台核销/团购/订单/券码/验券截图，例如美团、抖音、大众点评。',
    '2. transfer: 实际转账/代付/账单详情截图，例如微信、支付宝、银行卡。',
    '如果 OCR 文本仍不足以稳定判断，section_key 返回 "unknown"。',
    '字段要求：',
    '- section_key: "verification" | "transfer" | "unknown"',
    '- screenshot_kind: "verification_detail" | "verification_list" | "transfer_detail" | "transfer_list" | "other"',
    '- platform: 平台或支付渠道名称，不确定填空字符串',
    '- is_list_page: true/false',
    '- primary_amount: 最适合做汇总的主金额；无法判断填 null',
    '- amount_candidates: [{ "label": "", "amount": 0 }]',
    '- normalized_time: 标准化为 YYYY-MM-DD HH:mm:ss，无法判断填空字符串',
    '- voucher_code: 券码或验券码，没有则空',
    '- order_id: 订单号/流水号，没有则空',
    '- applicant_name: 申请人/付款人/收款对象，没有则空',
    '- recipient_name: 商户/收款方，没有则空',
    '- list_items: 对列表页尽量提取可见条目，例如 [{ "time": "", "amount": 0, "label": "" }]',
    '- evidence: 提取 2 到 6 条最关键的 OCR 原文短语',
    '- short_caption: 生成一个不超过 36 个汉字的中文标题，适合放在 PDF 图片下方',
    '- confidence: 0 到 1 之间的小数',
    '规则：',
    '- 只能依据 OCR 文本和候选结果，不要臆造原图信息。',
    '- OCR 文本里如果同时出现多种金额，尽量挑出真正用于汇总的那一笔。',
    '- 如果候选结果与 OCR 文本冲突，以 OCR 文本为准。',
    `当前文件名：${safeText(originalName) || '未提供'}`,
    `当前门店提示：${safeText(storeName) || '未提供'}`,
    `当前月份提示：${safeText(periodLabel) || '未提供'}`,
    'OCR 文本：',
    normalizeText(ocrText).slice(0, 8000) || '无',
    '上一轮候选结果：',
    JSON.stringify(visionCandidate || {}, null, 2),
  ].join('\n');
}

function extractMessageText(content) {
  if (!content) {
    return '';
  }

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }

        if (item && typeof item === 'object') {
          return item.text || item.content || '';
        }

        return '';
      })
      .join('');
  }

  if (typeof content === 'object') {
    return content.text || content.content || '';
  }

  return String(content);
}

function buildImageDataUrl(filePath, extension) {
  const mimeType = IMAGE_MIME_TYPES[extension] || 'image/png';
  const base64 = fs.readFileSync(filePath).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

async function requestVisionAnalysis(filePath, options = {}) {
  const { apiKey, visionModelCandidates } = getZhipuSettings();

  if (!apiKey) {
    throw new Error('当前未配置智谱视觉解析所需的 API Key。');
  }

  const extension = getExtension(options.originalName || filePath);
  const imageUrl = buildImageDataUrl(filePath, extension);
  const prompt = buildVisionPrompt(options);
  let lastError = null;

  for (const model of visionModelCandidates) {
    try {
      const response = await fetch(ZHIPU_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          top_p: 0.6,
          max_tokens: 1200,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: prompt,
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: imageUrl,
                  },
                },
              ],
            },
          ],
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        const error = new Error(
          payload?.error?.message ||
            payload?.message ||
            `智谱视觉解析失败（HTTP ${response.status}）。`,
        );
        error.status = response.status;
        throw error;
      }

      const rawContent = extractMessageText(payload?.choices?.[0]?.message?.content);
      const parsed = extractJsonObjectFromText(rawContent);

      if (!parsed) {
        throw new Error(`模型 ${model} 返回了无法解析的结构化内容。`);
      }

      return {
        model,
        rawContent,
        parsed,
      };
    } catch (error) {
      lastError = error;

      if (error?.status === 401 || error?.status === 403) {
        break;
      }
    }
  }

  throw lastError || new Error('智谱视觉解析调用失败。');
}

async function requestTextAuditAnalysis({
  originalName = '',
  storeName = '',
  periodLabel = '',
  ocrText = '',
  visionCandidate = null,
} = {}) {
  const { apiKey, textModelCandidates } = getZhipuSettings();

  if (!apiKey) {
    throw new Error('当前未配置智谱文本审核所需的 API Key。');
  }

  const prompt = buildTextAuditPrompt({
    originalName,
    storeName,
    periodLabel,
    ocrText,
    visionCandidate,
  });
  let lastError = null;

  for (const model of textModelCandidates) {
    try {
      const response = await fetch(ZHIPU_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          top_p: 0.7,
          max_tokens: 1200,
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
        const error = new Error(
          payload?.error?.message ||
            payload?.message ||
            `智谱文本审核失败（HTTP ${response.status}）。`,
        );
        error.status = response.status;
        throw error;
      }

      const rawContent = extractMessageText(payload?.choices?.[0]?.message?.content);
      const parsed = extractJsonObjectFromText(rawContent);

      if (!parsed) {
        throw new Error(`模型 ${model} 返回了无法解析的审核结果。`);
      }

      return {
        model,
        rawContent,
        parsed,
      };
    } catch (error) {
      lastError = error;

      if (error?.status === 401 || error?.status === 403) {
        break;
      }
    }
  }

  throw lastError || new Error('智谱文本审核调用失败。');
}

function escapePowerShellString(value = '') {
  return String(value || '').replace(/'/g, "''");
}

function buildWindowsOcrCommand(filePath, options = {}) {
  const escapedPath = escapePowerShellString(filePath);
  const scaleFactor = Math.max(1, Number(options.scaleFactor || 1) || 1);
  const scaleLiteral = scaleFactor.toFixed(2);

  return [
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
    ...(scaleFactor > 1 ? ['Add-Type -AssemblyName System.Drawing'] : []),
    "$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]",
    "$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]",
    "$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType=WindowsRuntime]",
    "$null = [Windows.Globalization.Language, Windows.Globalization, ContentType=WindowsRuntime]",
    "function AwaitWinRt($op, $typeName) {",
    "  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1",
    "  $type = [Type]::GetType($typeName)",
    "  $task = $method.MakeGenericMethod($type).Invoke($null, @($op))",
    "  $task.Wait()",
    "  return $task.Result",
    "}",
    `$path = '${escapedPath}'`,
    `$scaleFactor = [double]::Parse('${scaleLiteral}', [System.Globalization.CultureInfo]::InvariantCulture)`,
    "$tempPath = ''",
    "try {",
    "  if ($scaleFactor -gt 1) {",
    "    $sourceImage = [System.Drawing.Image]::FromFile($path)",
    "    try {",
    "      $scaledWidth = [Math]::Max(1, [int]([Math]::Round($sourceImage.Width * $scaleFactor)))",
    "      $scaledHeight = [Math]::Max(1, [int]([Math]::Round($sourceImage.Height * $scaleFactor)))",
    "      $bitmapImage = New-Object System.Drawing.Bitmap $scaledWidth, $scaledHeight",
    "      try {",
    "        $graphics = [System.Drawing.Graphics]::FromImage($bitmapImage)",
    "        try {",
    "          $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic",
    "          $graphics.DrawImage($sourceImage, 0, 0, $scaledWidth, $scaledHeight)",
    "        } finally {",
    "          $graphics.Dispose()",
    "        }",
    "        $tempPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ([System.Guid]::NewGuid().ToString() + '.png'))",
    "        $bitmapImage.Save($tempPath, [System.Drawing.Imaging.ImageFormat]::Png)",
    "        $path = $tempPath",
    "      } finally {",
    "        $bitmapImage.Dispose()",
    "      }",
    "    } finally {",
    "      $sourceImage.Dispose()",
    "    }",
    "  }",
    "  $file = AwaitWinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($path)) 'Windows.Storage.StorageFile, Windows, ContentType=WindowsRuntime'",
    "  $stream = AwaitWinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) 'Windows.Storage.Streams.IRandomAccessStream, Windows, ContentType=WindowsRuntime'",
    "  $decoder = AwaitWinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) 'Windows.Graphics.Imaging.BitmapDecoder, Windows, ContentType=WindowsRuntime'",
    "  $bitmap = AwaitWinRt ($decoder.GetSoftwareBitmapAsync()) 'Windows.Graphics.Imaging.SoftwareBitmap, Windows, ContentType=WindowsRuntime'",
    "  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage((New-Object Windows.Globalization.Language('zh-CN')))",
    "  $result = AwaitWinRt ($engine.RecognizeAsync($bitmap)) 'Windows.Media.Ocr.OcrResult, Windows, ContentType=WindowsRuntime'",
    "  $lines = @($result.Lines | ForEach-Object { $_.Text })",
    "  [string]::Join([Environment]::NewLine, $lines)",
    "} finally {",
    "  if ($tempPath -and (Test-Path -LiteralPath $tempPath)) {",
    "    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue",
    "  }",
    "}",
  ].join('; ');
}

async function runWindowsOcr(filePath, options = {}) {
  const command = buildWindowsOcrCommand(filePath, options);
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      command,
    ],
    {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30000,
    },
  );

  return normalizeText(stdout || '');
}

function compactOcrText(text = '') {
  return normalizeText(text)
    .replace(/[：﹕]/g, ':')
    .replace(/°\s*[Cc]/g, ':')
    .replace(/[℃]/g, ':')
    .replace(/(\d)\s*[°oO]\s*(\d)/g, '$1:$2')
    .replace(/[·•]/g, '.')
    .replace(/[—–]/g, '-')
    .replace(/(\d)\s*一\s*(?=\d)/g, '$1-')
    .replace(/\s+/g, '');
}

function normalizeLooseOcrText(text = '') {
  return normalizeText(text)
    .replace(/\uFF1A/g, ':')
    .replace(/\uFF0C/g, ',')
    .replace(/°\s*[Cc]/g, ':')
    .replace(/[℃]/g, ':')
    .replace(/(\d)\s*[°oO]\s*(\d)/g, '$1:$2')
    .replace(/[\u00B7\u2022\u2027]/g, '.')
    .replace(/[\u2012\u2013\u2014\u2212]/g, '-')
    .replace(/(\d)\s*[一-]\s*(?=\d)/g, '$1-')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractOcrLines(text = '') {
  return normalizeText(text)
    .split(/\n+/)
    .map((line) => normalizeLooseOcrText(line))
    .filter(Boolean);
}

function parseLooseAmountValue(value = '') {
  const normalized = normalizeLooseOcrText(value)
    .replace(/\s+/g, '')
    .replace(/,+/g, ',');

  if (!normalized) {
    return null;
  }

  if (normalized.includes(':')) {
    return null;
  }

  const separatorIndex = Math.max(normalized.lastIndexOf('.'), normalized.lastIndexOf('-'));

  if (separatorIndex <= 0 || separatorIndex >= normalized.length - 2) {
    return null;
  }

  const integerPart = normalized.slice(0, separatorIndex).replace(/[^\d]/g, '');
  const decimalPart = normalized.slice(separatorIndex + 1).replace(/[^\d]/g, '').slice(0, 2);

  if (!integerPart || decimalPart.length !== 2) {
    return null;
  }

  const amount = toNumber(`${integerPart}.${decimalPart}`);
  return amount !== null ? Math.abs(amount) : null;
}

function extractOcrAmountLines(text = '') {
  return extractOcrLines(text)
    .map((line, index) => ({
      index,
      line,
      amount: parseLooseAmountValue(line),
    }))
    .filter((item) => item.amount !== null);
}

function compactNeedle(value = '') {
  return safeText(value).replace(/\s+/g, '');
}

function findOrderedLabelIndices(lines = [], labels = []) {
  const positions = [];
  let cursor = 0;

  for (const label of labels) {
    const normalizedLabel = compactNeedle(label);
    const nextIndex = lines.findIndex(
      (line, index) => index >= cursor && compactNeedle(line).includes(normalizedLabel),
    );

    if (nextIndex === -1) {
      return [];
    }

    positions.push({
      label,
      index: nextIndex,
    });
    cursor = nextIndex + 1;
  }

  return positions;
}

function extractOrderedLabelAmountFromLines(text = '', orderedLabels = [], targetLabel = '') {
  const lines = extractOcrLines(text);
  const positions = findOrderedLabelIndices(lines, orderedLabels);

  if (!positions.length) {
    return null;
  }

  const targetIndex = positions.findIndex((item) => item.label === targetLabel);

  if (targetIndex === -1) {
    return null;
  }

  const amountLines = extractOcrAmountLines(text).filter(
    (item) => item.index >= positions[0].index,
  );

  if (amountLines.length <= targetIndex) {
    return null;
  }

  return amountLines[targetIndex].amount;
}

function extractMarkedVerificationDetailAmount(text = '', markerLabel = '') {
  const normalizedMarker = compactNeedle(markerLabel);

  if (!normalizedMarker) {
    return null;
  }

  const lines = extractOcrLines(text);
  const markerIndex = lines.findIndex((line) => compactNeedle(line).includes(normalizedMarker));

  if (markerIndex === -1) {
    return null;
  }

  const markedAmountLines = lines
    .slice(markerIndex)
    .map((line, index) => ({
      index: markerIndex + index,
      line,
      amount: parseLooseAmountValue(line),
    }))
    .filter((item) => {
      const normalizedLine = compactNeedle(item.line);
      return item.amount !== null && (
        normalizedLine.includes('明细') ||
        normalizedLine.includes('实收') ||
        normalizedLine.includes('实付')
      );
    });

  if (!markedAmountLines.length) {
    return null;
  }

  return markedAmountLines[markedAmountLines.length - 1].amount;
}

function extractLabelAmount(compactText = '', labels = []) {
  for (const label of labels) {
    const pattern = new RegExp(`${label}:?¥?(-?[0-9][0-9,.]*\\.?[0-9]{0,2})`);
    const matched = compactText.match(pattern);

    if (matched) {
      const amount = toNumber(matched[1]);

      if (amount !== null) {
        return Math.abs(amount);
      }
    }
  }

  return null;
}

function extractAllAmounts(compactText = '') {
  return [...compactText.matchAll(/-?[0-9][0-9,]*\.\d{1,2}(?!\d)/g)]
    .map((matched) => Math.abs(toNumber(matched[0]) || 0))
    .filter((value) => value > 0);
}

function extractLooseAmounts(text = '') {
  const lineMatches = extractOcrLines(text)
    .map((line) => parseLooseAmountValue(line))
    .filter((value) => value > 0);

  if (lineMatches.length) {
    return lineMatches;
  }

  return [...normalizeLooseOcrText(text).matchAll(/-?(?:\d[\d\s,.-]{0,16}\d|\d)\s*[-.]\s*\d{2}(?!\d)/g)]
    .map((matched) => parseLooseAmountValue(matched[0]))
    .filter((value) => value > 0);
}

function extractAllDateTimes(compactText = '') {
  return [...compactText.matchAll(/20\d{2}[/-]\d{1,2}[/-]\d{1,2}\d{1,2}:\d{2}:\d{2}/g)]
    .map((matched) => normalizeDateTime(matched[0]))
    .filter(Boolean);
}

function extractLooseFullDateTimes(text = '') {
  const normalized = normalizeLooseOcrText(text)
    .replace(/[℃C]/g, ':')
    .replace(
      /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?/g,
      '$1-$2-$3 ',
    );

  return dedupeStrings(
    [...normalized.matchAll(
      /(20\d{2})\s*[-/]\s*(\d{1,2})\s*[-/]\s*(\d{1,2})\s*(\d{1,2})\s*[-:：]\s*(\d{1,2})(?:\s*[-:：]\s*(\d{1,2}))?/g,
    )].map((matched) =>
      normalizeDateTime(
        `${matched[1]}-${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}:${matched[6] || '00'}`,
      ),
    ),
  ).filter(Boolean);
}

function filterMeaningfulDateTimes(values = []) {
  const cleaned = dedupeStrings(values).filter(Boolean);
  const nonBoundary = cleaned.filter((value) => !/ (?:00:00:00|23:59:00)$/.test(value));

  return nonBoundary.length ? nonBoundary : cleaned;
}

function inferYearFromPeriodLabel(periodLabel = '') {
  const matched = String(periodLabel || '').match(/(20\d{2})/);
  return matched ? matched[1] : '';
}

function extractMonthDayTimes(compactText = '', fallbackYear = '') {
  if (!fallbackYear) {
    return [];
  }

  return [...compactText.matchAll(/(\d{2})-(\d{2})(\d{2}:\d{2})/g)]
    .map((matched) => `${fallbackYear}-${matched[1]}-${matched[2]} ${matched[3]}:00`)
    .filter(Boolean);
}

function extractLooseMonthDayTimes(text = '', fallbackYear = '') {
  if (!fallbackYear) {
    return [];
  }

  return [...normalizeLooseOcrText(text).matchAll(/(\d{2})\s*-\s*(\d{2})\s*(\d{1,2})\s*:\s*(\d{2})(?:\s*:\s*(\d{2}))?/g)]
    .map((matched) => {
      const month = matched[1].padStart(2, '0');
      const day = matched[2].padStart(2, '0');
      const hour = matched[3].padStart(2, '0');
      const minute = matched[4].padStart(2, '0');
      const second = (matched[5] || '00').padStart(2, '0');

      return `${fallbackYear}-${month}-${day} ${hour}:${minute}:${second}`;
    })
    .filter(Boolean);
}

function extractLargestAmountInSlice(compactText = '') {
  const values = extractAllAmounts(compactText);

  if (!values.length) {
    return null;
  }

  return values.sort((left, right) => right - left)[0];
}

function sumAmounts(values = []) {
  return Number(
    values.reduce((sum, value) => sum + (Number(value) || 0), 0).toFixed(2),
  );
}

function extractRepeatedLabelAmounts(compactText = '', labels = []) {
  const amounts = [];

  labels.forEach((label) => {
    const pattern = new RegExp(`${label}:?¥?(-?[0-9][0-9,.]*\\.?[0-9]*)`, 'g');

    [...compactText.matchAll(pattern)].forEach((matched) => {
      const amount = toNumber(matched[1]);

      if (amount !== null) {
        amounts.push(Math.abs(amount));
      }
    });
  });

  return amounts;
}

function extractVoucherCodes(compactText = '') {
  return dedupeStrings(
    [...compactText.matchAll(/(?:核销券码|券码):?([0-9A-Za-z]{10,24})/g)].map((matched) => matched[1]),
  );
}

function normalizeLooseCode(value = '') {
  return safeText(value)
    .replace(/\s+/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Il|]/g, '1')
    .replace(/[^\dA-Za-z]/g, '');
}

function extractStandaloneNumericCodes(text = '') {
  return dedupeStrings(
    extractOcrLines(text)
      .filter((line) => /^[\dA-Za-z引oOIl|\s.-]{10,28}$/.test(safeText(line)))
      .map((line) => normalizeLooseCode(line))
      .filter((line) => /^\d{12,24}$/.test(line)),
  );
}

function dedupeListItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      amount: toNumber(item?.amount),
      time: safeText(item?.time || ''),
      label: safeText(item?.label || ''),
    }))
    .filter((item) => item.label || item.time || item.amount !== null);
}

function buildTransferListItemsFromOcr(compactText = '', fallbackYear = '', rawText = '') {
  const rawOcrText = rawText || compactText;
  const normalizedRawText = normalizeLooseOcrText(rawOcrText);
  const compactAmounts = extractAllAmounts(compactText);
  const amounts = compactAmounts.length >= 2 ? compactAmounts : extractLooseAmounts(rawOcrText);
  const dateTimes = dedupeStrings([
    ...extractMonthDayTimes(compactText, fallbackYear),
    ...extractLooseMonthDayTimes(rawOcrText, fallbackYear),
  ]);
  const friendPayCount = Math.max(
    countMatches(compactText, '浜插弸浠ｄ粯'),
    countMatches(normalizedRawText.replace(/\s+/g, ''), '亲友代付'),
  );
  const count = Math.max(amounts.length, dateTimes.length, friendPayCount);

  if (count < 2) {
    return [];
  }

  return dedupeListItems(
    Array.from({ length: count }, (_item, index) => ({
      amount: amounts[index] ?? null,
      time: filterMeaningfulDateTimes(dateTimes)[index] || '',
      label: friendPayCount >= 2 ? '亲友代付' : '',
    })),
  );
}

function buildVerificationListItemsFromOcr(compactText = '', fallbackYear = '', rawText = '') {
  const amounts = extractRepeatedLabelAmounts(compactText, [
    '订单实收',
    '消费金额',
    '实付金额',
    '支付金额',
  ]);
  const voucherCodes = dedupeStrings([
    ...extractVoucherCodes(compactText),
    ...extractStandaloneNumericCodes(rawText || compactText),
  ]);
  const dateTimes = filterMeaningfulDateTimes([
    ...extractAllDateTimes(compactText),
    ...extractLooseFullDateTimes(rawText || compactText),
    ...extractMonthDayTimes(compactText, fallbackYear),
  ]);
  const count = Math.max(amounts.length, voucherCodes.length, dateTimes.length);

  if (count < 2) {
    return [];
  }

  return dedupeListItems(
    Array.from({ length: count }, (_item, index) => ({
      amount: amounts[index] ?? null,
      time: dateTimes[index] || '',
      label: voucherCodes[index] ? `券码 ${voucherCodes[index]}` : '',
    })),
  );
}

function detectPlatform(compactText = '') {
  if (compactText.includes('美团')) return '美团';
  if (compactText.includes('抖音')) return '抖音';
  if (compactText.includes('大众点评')) return '大众点评';
  if (compactText.includes('微信')) return '微信';
  if (compactText.includes('支付宝')) return '支付宝';
  if (compactText.includes('银行卡') || compactText.includes('储蓄卡')) return '银行卡';
  return '';
}

function buildOcrEvidence(compactText = '') {
  return dedupeStrings(
    [
      ['券码', '券码'],
      ['验证时间', '验证时间'],
      ['核销明细', '核销明细'],
      ['消费金额', '消费金额'],
      ['账单详情', '账单详情'],
      ['代付成功', '代付成功'],
      ['亲友代付', '亲友代付'],
      ['支付时间', '支付时间'],
      ['申请人', '申请人'],
      ['订单号', '订单号'],
      ['订单实收', '订单实收'],
      ['已核销', '已核销'],
      ['账单管理', '账单管理'],
    ]
      .filter(([needle]) => compactText.includes(needle))
      .map(([, label]) => label),
  ).slice(0, 6);
}

function detectBusinessLabel(compactText = '') {
  if (compactText.includes('1050元代金券')) {
    return '1050元代金券';
  }

  if (compactText.includes('1000代1100')) {
    return '1000代1100代金券';
  }

  return '';
}

function countMatches(source = '', pattern = '') {
  if (!pattern) {
    return 0;
  }

  return source.split(pattern).length - 1;
}

function parseWithWindowsOcrText(ocrText = '', options = {}) {
  const compactText = compactOcrText(ocrText);
  const looseText = normalizeLooseOcrText(ocrText);
  const fallbackYear = inferYearFromPeriodLabel(options.periodLabel);
  const verificationScore = [
    '券码',
    '核销券码',
    '核销时间',
    '验证时间',
    '消费金额',
    '订单实收',
    '已核销',
    '代金券',
    '验券账号',
    '团购',
    '美团',
    '抖音',
    '大众点评',
  ].filter((needle) => compactText.includes(needle)).length;
  const transferScore = [
    '账单详情',
    '代付成功',
    '支付成功',
    '支付时间',
    '付款方式',
    '申请人',
    '亲友代付',
    '交易单号',
    '收单机构',
    '经营单号',
    '全部账单',
    '账单管理',
    '计入收支',
    '支付宝',
    '微信',
  ].filter((needle) => compactText.includes(needle)).length;

  const transferListFriendPayCount = Math.max(
    countMatches(compactText, '浜插弸浠ｄ粯'),
    countMatches(looseText.replace(/\s+/g, ''), '亲友代付'),
  );
  const transferLooseAmounts = extractLooseAmounts(ocrText);
  const sectionKey =
    transferScore > verificationScore && transferScore >= 2
      ? 'transfer'
      : verificationScore >= 2
        ? 'verification'
        : compactText.includes('亲友代付') ||
            transferListFriendPayCount >= 2 ||
            (compactText.includes('代付') && Math.max(extractAllAmounts(compactText).length, transferLooseAmounts.length) > 1)
          ? 'transfer'
        : 'unknown';
  const dateTimes = filterMeaningfulDateTimes([
    ...extractAllDateTimes(compactText),
    ...extractLooseFullDateTimes(ocrText),
    ...extractMonthDayTimes(compactText, fallbackYear),
    ...extractLooseMonthDayTimes(looseText, fallbackYear),
  ]);
  const repeatedFriendPayCount = Math.max(
    countMatches(compactText, '浜插弸浠ｄ粯'),
    countMatches(looseText.replace(/\s+/g, ''), '亲友代付'),
  );
  const looseAmounts = extractLooseAmounts(ocrText);
  const isDetailTransfer =
    compactText.includes('代付成功') ||
    compactText.includes('支付成功') ||
    compactText.includes('账单详情') ||
    compactText.includes('交易单号');
  const repeatedVerificationFieldCount = Math.max(
    countMatches(compactText, '券码'),
    countMatches(compactText, '验证时间'),
    countMatches(compactText, '消费金额'),
    countMatches(compactText, '订单号'),
  );
  const isListPage =
    sectionKey === 'transfer'
      ? !isDetailTransfer &&
        (/账单管理|账单分类|标签|本月亲友代付|明细列表/.test(compactText) ||
          (dateTimes.length > 1 && !compactText.includes('订单号')))
      : /明细列表|列表/.test(compactText) ||
        countMatches(compactText, '订单ID') > 1 ||
        countMatches(compactText, '核销券码') > 1 ||
        repeatedVerificationFieldCount > 1;
  const effectiveIsListPage =
    isListPage ||
    (sectionKey === 'transfer' &&
      !isDetailTransfer &&
      (repeatedFriendPayCount >= 2 || transferLooseAmounts.length >= 3 || dateTimes.length > 1));
  const screenshotKind =
    sectionKey === 'transfer'
      ? effectiveIsListPage
        ? 'transfer_list'
        : 'transfer_detail'
      : sectionKey === 'verification'
        ? effectiveIsListPage
          ? 'verification_list'
          : 'verification_detail'
        : 'other';
  const transferListItems =
    sectionKey === 'transfer' && effectiveIsListPage
      ? buildTransferListItemsFromOcr(compactText, fallbackYear, ocrText)
      : [];
  const verificationListItems =
    sectionKey === 'verification' && effectiveIsListPage
      ? buildVerificationListItemsFromOcr(compactText, fallbackYear, ocrText)
      : [];
  const listItems = sectionKey === 'transfer' ? transferListItems : verificationListItems;
  let primaryAmount = null;

  if (sectionKey === 'transfer') {
    const beforeSuccessText = compactText.split('代付成功')[0] || compactText;
    primaryAmount =
      (effectiveIsListPage
        ? sumAmounts(listItems.map((item) => item.amount).filter((amount) => amount))
        : null) ||
      (effectiveIsListPage ? sumAmounts(transferLooseAmounts) : null) ||
      extractLabelAmount(compactText, ['支付金额']) ||
      extractLargestAmountInSlice(beforeSuccessText) ||
      (!effectiveIsListPage ? extractLargestAmountInSlice(compactText) : null);
  } else if (sectionKey === 'verification') {
    const markedRealPayAmount = extractMarkedVerificationDetailAmount(ocrText, '顾客实付');
    const orderedRealPayAmount = extractOrderedLabelAmountFromLines(
      ocrText,
      ['预计收入', '顾客实付'],
      '顾客实付',
    );
    primaryAmount =
      (effectiveIsListPage
        ? sumAmounts(listItems.map((item) => item.amount).filter((amount) => amount))
        : null) ||
      markedRealPayAmount ||
      orderedRealPayAmount ||
      extractLabelAmount(compactText, ['消费金额', '订单实收', '实付金额', '实付', '支付金额', '售卖价']) ||
      extractAllAmounts(compactText)[0] ||
      null;
  }

  const orderId = effectiveIsListPage
    ? ''
    : (compactText.match(/(?:订单号|订单ID|交易单号):?([0-9A-Za-z]{8,32})/) || [])[1] || '';
  const standaloneCodes = extractStandaloneNumericCodes(ocrText);
  const voucherCode = effectiveIsListPage
    ? ''
    : (compactText.match(/(?:核销券码|券码):?([0-9A-Za-z]{8,24})/) || [])[1] ||
      standaloneCodes.find((code) => code && code !== orderId) ||
      '';
  const applicantName = (compactText.match(/申请人:?([^:¥0-9]{1,8})/) || [])[1] || '';
  const recipientName = (compactText.match(/收款方:?([^:¥0-9]{1,12})/) || [])[1] || '';

  return normalizeMonetaryPayload({
    sectionKey,
    screenshotKind,
    isListPage: effectiveIsListPage,
    platform: detectPlatform(compactText),
    primaryAmount,
    amountCandidates: [],
    normalizedTime: dateTimes[0] || '',
    voucherCode,
    orderId,
    applicantName: safeText(applicantName),
    recipientName: safeText(recipientName),
    listItems,
    evidence: buildOcrEvidence(compactText),
    businessLabel: detectBusinessLabel(compactText),
    shortCaption: '',
    confidence: sectionKey === 'unknown' ? 0.3 : 0.62,
    ocrText: compactText,
  });
}

function shouldRetryOcrWithScaling(ocrText = '', parsed = {}, options = {}) {
  const rawText = normalizeText(ocrText);
  const captureDate = parseCaptureDateFromName(options.originalName || '');

  if (!rawText) {
    return false;
  }

  if (parsed.sectionKey === 'verification' && parsed.isListPage) {
    return true;
  }

  if (!parsed.normalizedTime && /(支付时间|核销时间|20\d{2})/.test(rawText)) {
    return true;
  }

  if (/°\s*[Cc]|℃/.test(rawText)) {
    return true;
  }

  if (
    captureDate &&
    parsed.normalizedTime &&
    parsed.normalizedTime.startsWith(`${captureDate.year}-`) &&
    parsed.normalizedTime.slice(5, 7) !== captureDate.month
  ) {
    return true;
  }

  return false;
}

function isScaledAmountImplausible(baseAmount, scaledAmount) {
  const normalizedBase = toNumber(baseAmount);
  const normalizedScaled = toNumber(scaledAmount);

  if (normalizedBase === null || normalizedScaled === null) {
    return false;
  }

  if (normalizedScaled <= 0 || normalizedBase <= 0) {
    return false;
  }

  return (
    normalizedScaled > normalizedBase * 3 ||
    normalizedScaled < Math.max(10, normalizedBase * 0.5)
  );
}

function mergeScaledListItems(baseItems = [], scaledItems = []) {
  const normalizedBase = normalizeListItems(baseItems);
  const normalizedScaled = normalizeListItems(scaledItems);
  const targetCount = normalizedBase.length || normalizedScaled.length;

  return dedupeListItems(
    Array.from({ length: targetCount }, (_item, index) => {
      const baseItem = normalizedBase[index] || {};
      const scaledItem = normalizedScaled[index] || {};

      return {
        amount:
          baseItem.amount === null || baseItem.amount === undefined
            ? scaledItem.amount ?? null
            : baseItem.amount,
        time: scaledItem.time || baseItem.time || '',
        label: scaledItem.label || baseItem.label || '',
      };
    }),
  );
}

function mergeScaledOcrPayloads(basePayload = {}, scaledPayload = {}) {
  const merged = mergeNormalizedPayloads(scaledPayload, basePayload);
  const baseAmount = toNumber(basePayload.primaryAmount);
  const scaledAmount = toNumber(scaledPayload.primaryAmount);
  const useBaseVerificationRealPay =
    basePayload.sectionKey === 'verification' &&
    !basePayload.isListPage &&
    /顾客实付/.test(safeText(basePayload.ocrText || '')) &&
    baseAmount !== null &&
    scaledAmount !== null &&
    baseAmount >= scaledAmount;
  const useBaseAmount =
    useBaseVerificationRealPay ||
    isScaledAmountImplausible(baseAmount, scaledAmount);
  const useMergedList =
    (basePayload.isListPage || scaledPayload.isListPage) &&
    (Array.isArray(basePayload.listItems) && basePayload.listItems.length) &&
    (Array.isArray(scaledPayload.listItems) && scaledPayload.listItems.length);

  if (!useBaseAmount && !useMergedList) {
    return merged;
  }

  const listItems = useMergedList
    ? mergeScaledListItems(basePayload.listItems, scaledPayload.listItems)
    : merged.listItems;
  let primaryAmount = useBaseAmount ? basePayload.primaryAmount : merged.primaryAmount;

  if (listItems.length) {
    const listAmountValues = listItems
      .map((item) => toNumber(item.amount))
      .filter((value) => value !== null);
    const listAmountTotal = sumAmounts(listAmountValues);

    if (listAmountTotal) {
      primaryAmount = listAmountTotal;
    }
  }

  return normalizeMonetaryPayload({
    ...merged,
    primaryAmount,
    listItems,
  });
}

async function parseWithWindowsOcrFallback(filePath, options = {}) {
  const ocrText = await runWindowsOcr(filePath);
  const parsed = parseWithWindowsOcrText(ocrText, options);

  if (!shouldRetryOcrWithScaling(ocrText, parsed, options)) {
    return parsed;
  }

  try {
    const scaledOcrText = await runWindowsOcr(filePath, {
      scaleFactor: 3,
    });

    if (!scaledOcrText || scaledOcrText === ocrText) {
      return parsed;
    }

    const scaledParsed = parseWithWindowsOcrText(scaledOcrText, options);
    const preferred = choosePreferredPayload(scaledParsed, parsed);

    return {
      ...mergeScaledOcrPayloads(parsed, scaledParsed),
      ocrText: preferred === scaledParsed ? scaledOcrText : ocrText,
    };
  } catch {
    return parsed;
  }
}

function hasResolvedSection(payload = {}) {
  return payload.sectionKey === 'verification' || payload.sectionKey === 'transfer';
}

function hasCoreSignal(payload = {}) {
  return Boolean(
    payload.primaryAmount ||
      payload.normalizedTime ||
      payload.voucherCode ||
      payload.orderId ||
      payload.platform ||
      (Array.isArray(payload.listItems) && payload.listItems.length) ||
      (Array.isArray(payload.evidence) && payload.evidence.length),
  );
}

function scoreNormalizedPayload(payload = {}) {
  let score = 0;

  if (hasResolvedSection(payload)) score += 5;
  if (payload.primaryAmount) score += 2;
  if (payload.normalizedTime) score += 1.5;
  if (payload.voucherCode || payload.orderId) score += 2;
  if (payload.platform) score += 1;
  if (payload.isListPage) score += 0.5;
  if (Array.isArray(payload.listItems) && payload.listItems.length) score += 1;
  if (Array.isArray(payload.evidence) && payload.evidence.length) {
    score += Math.min(payload.evidence.length, 3) * 0.25;
  }

  return score + Math.min(Number(payload.confidence || 0) || 0, 1);
}

function shouldRunOcrAssist(payload = {}) {
  if (!hasResolvedSection(payload)) {
    return true;
  }

  if (!hasCoreSignal(payload)) {
    return true;
  }

  if (payload.sectionKey === 'verification') {
    return true;
  }

  return Number(payload.confidence || 0) < 0.72;
}

function shouldRunTextAudit(payload = {}, ocrPayload = {}) {
  if (!safeText(ocrPayload.ocrText || '')) {
    return false;
  }

  if (!hasResolvedSection(payload)) {
    return true;
  }

  return !payload.primaryAmount && !payload.normalizedTime && !payload.voucherCode && !payload.orderId;
}

function hasStrongListSignal(payload = {}) {
  const listItems = Array.isArray(payload.listItems) ? payload.listItems : [];
  return Boolean(
    payload.isListPage &&
      (listItems.length > 1 || safeText(payload.screenshotKind).toLowerCase().endsWith('_list')),
  );
}

function getListPreferredAmount(payload = {}) {
  const listItems = Array.isArray(payload.listItems) ? payload.listItems : [];
  const summed = sumAmounts(listItems.map((item) => item?.amount).filter((amount) => amount));

  return summed || payload.primaryAmount || null;
}

function mergeAmountCandidates(primary = [], secondary = []) {
  const merged = new Map();

  [...(Array.isArray(primary) ? primary : []), ...(Array.isArray(secondary) ? secondary : [])].forEach(
    (item) => {
      const label = safeText(item?.label || '');
      const amount = toNumber(item?.amount);
      const key = `${label}|${amount ?? ''}`;

      if (!label && amount === null) {
        return;
      }

      if (!merged.has(key)) {
        merged.set(key, {
          label,
          amount,
        });
      }
    },
  );

  return [...merged.values()].slice(0, 6);
}

function normalizeMonetaryPayload(payload = {}) {
  return {
    ...payload,
    primaryAmount:
      payload.primaryAmount === null || payload.primaryAmount === undefined
        ? null
        : Math.abs(Number(payload.primaryAmount) || 0),
    amountCandidates: Array.isArray(payload.amountCandidates)
      ? payload.amountCandidates
          .map((item) => ({
            label: safeText(item?.label || ''),
            amount:
              item?.amount === null || item?.amount === undefined
                ? null
                : Math.abs(Number(item.amount) || 0),
          }))
          .filter((item) => item.label || item.amount !== null)
      : [],
    listItems: Array.isArray(payload.listItems)
      ? payload.listItems
          .map((item) => ({
            ...item,
            amount:
              item?.amount === null || item?.amount === undefined
                ? null
                : Math.abs(Number(item.amount) || 0),
          }))
          .filter((item) => item.label || item.time || item.amount !== null)
      : [],
  };
}

function inferVerificationPlatform(payload = {}) {
  const explicitPlatform = safeText(payload.platform);
  const listItems = Array.isArray(payload.listItems) ? payload.listItems : [];
  const labels = listItems.map((item) => safeText(item.label)).join(' ');
  const evidence = dedupeStrings(payload.evidence || []).join(' ');
  const businessLabel = safeText(payload.businessLabel);

  if (explicitPlatform.includes('抖音')) {
    return '抖音';
  }

  if (
    payload.sectionKey === 'verification' &&
    /1050元代金券/.test(businessLabel)
  ) {
    return '抖音';
  }

  if (
    payload.sectionKey === 'verification' &&
    payload.screenshotKind === 'verification_list' &&
    !explicitPlatform &&
    listItems.length >= 2 &&
    listItems.every((item) => Number(item.amount || 0) >= 1000) &&
    !/券码/.test(labels) &&
    /订单实收|已核销/.test(evidence)
  ) {
    return '抖音';
  }

  if (
    payload.sectionKey === 'verification' &&
    payload.screenshotKind === 'verification_detail' &&
    !explicitPlatform &&
    !payload.voucherCode &&
    Number(payload.primaryAmount || 0) >= 900 &&
    /订单实收|已核销/.test(evidence)
  ) {
    return '抖音';
  }

  if (
    explicitPlatform.includes('美团') ||
    explicitPlatform.includes('大众点评') ||
    payload.voucherCode ||
    /券码/.test(labels)
  ) {
    return '大众点评';
  }

  return explicitPlatform;
}

function normalizeShuadanPayloadForOutput(payload = {}, options = {}) {
  const normalizedTime = correctFutureTimeAgainstCaptureDate(payload.normalizedTime || '', options.originalName);
  const listItems = Array.isArray(payload.listItems)
    ? payload.listItems.map((item) => ({
        ...item,
        time: correctFutureTimeAgainstCaptureDate(item.time || '', options.originalName),
      }))
    : [];
  const businessLabel = safeText(payload.businessLabel);
  const platform =
    payload.sectionKey === 'verification'
      ? inferVerificationPlatform({
          ...payload,
          normalizedTime,
          listItems,
        })
      : safeText(payload.platform);

  return normalizeMonetaryPayload({
    ...payload,
    platform,
    normalizedTime,
    listItems,
    businessLabel: businessLabel
      ? businessLabel
      : platform === '抖音' &&
          payload.screenshotKind === 'verification_list' &&
          Array.isArray(listItems) &&
          listItems.length >= 2 &&
          Number(payload.primaryAmount || 0) >= 2000
        ? '1050元代金券'
        : '',
  });
}

function choosePreferredPayload(left = {}, right = {}) {
  return scoreNormalizedPayload(left) >= scoreNormalizedPayload(right) ? left : right;
}

function resolveMergedSectionKey(primary = {}, secondary = {}) {
  const primaryResolved = hasResolvedSection(primary);
  const secondaryResolved = hasResolvedSection(secondary);

  if (primaryResolved && secondaryResolved && primary.sectionKey === secondary.sectionKey) {
    return primary.sectionKey;
  }

  if (primaryResolved && !secondaryResolved) {
    return primary.sectionKey;
  }

  if (!primaryResolved && secondaryResolved) {
    return secondary.sectionKey;
  }

  if (!primaryResolved && !secondaryResolved) {
    return 'unknown';
  }

  const primaryScore = scoreNormalizedPayload(primary);
  const secondaryScore = scoreNormalizedPayload(secondary);

  if (Math.abs(primaryScore - secondaryScore) < 1.25) {
    return 'unknown';
  }

  return primaryScore > secondaryScore ? primary.sectionKey : secondary.sectionKey;
}

function resolveScreenshotKind(sectionKey = '', candidates = []) {
  const listCandidate = candidates.find((candidate) => hasStrongListSignal(candidate));

  if (listCandidate) {
    if (sectionKey === 'verification') {
      return 'verification_list';
    }

    if (sectionKey === 'transfer') {
      return 'transfer_list';
    }
  }

  const matched = candidates
    .map((candidate) => safeText(candidate?.screenshotKind || '').toLowerCase())
    .find((kind) => kind && kind.startsWith(sectionKey));

  if (matched) {
    return matched;
  }

  if (sectionKey === 'verification') {
    return candidates.some((candidate) => candidate?.isListPage)
      ? 'verification_list'
      : 'verification_detail';
  }

  if (sectionKey === 'transfer') {
    return candidates.some((candidate) => candidate?.isListPage)
      ? 'transfer_list'
      : 'transfer_detail';
  }

  return 'other';
}

function mergeNormalizedPayloads(primary = {}, secondary = {}) {
  if (!primary || !Object.keys(primary).length) {
    return secondary || {};
  }

  if (!secondary || !Object.keys(secondary).length) {
    return primary || {};
  }

  const preferred = choosePreferredPayload(primary, secondary);
  const alternate = preferred === primary ? secondary : primary;
  const sectionKey = resolveMergedSectionKey(preferred, alternate);
  const structuralSource =
    hasStrongListSignal(preferred) && hasStrongListSignal(alternate)
      ? choosePreferredPayload(preferred, alternate)
      : hasStrongListSignal(preferred)
        ? preferred
        : hasStrongListSignal(alternate)
          ? alternate
          : preferred;
  const listItems =
    Array.isArray(structuralSource.listItems) && structuralSource.listItems.length
      ? structuralSource.listItems
      : Array.isArray(preferred.listItems) && preferred.listItems.length
        ? preferred.listItems
        : Array.isArray(alternate.listItems)
        ? alternate.listItems
        : [];
  const isListPage = Boolean(
    structuralSource.isListPage || preferred.isListPage || alternate.isListPage || listItems.length > 1,
  );
  const primaryAmount = isListPage
    ? getListPreferredAmount(structuralSource) ||
      getListPreferredAmount(preferred) ||
      getListPreferredAmount(alternate)
    : preferred.primaryAmount || alternate.primaryAmount || null;
  const normalizedTime = isListPage
    ? structuralSource.normalizedTime ||
      preferred.normalizedTime ||
      alternate.normalizedTime ||
      safeText(listItems[0]?.time || '')
    : preferred.normalizedTime || alternate.normalizedTime || '';

  return normalizeMonetaryPayload({
    sectionKey,
    screenshotKind: resolveScreenshotKind(sectionKey, [structuralSource, preferred, alternate]),
    isListPage,
    platform: preferred.platform || alternate.platform || '',
    primaryAmount,
    amountCandidates: mergeAmountCandidates(preferred.amountCandidates, alternate.amountCandidates),
    normalizedTime,
    voucherCode: isListPage ? '' : preferred.voucherCode || alternate.voucherCode || '',
    orderId: isListPage ? '' : preferred.orderId || alternate.orderId || '',
    applicantName: preferred.applicantName || alternate.applicantName || '',
    recipientName: preferred.recipientName || alternate.recipientName || '',
    listItems,
    evidence: dedupeStrings([...(preferred.evidence || []), ...(alternate.evidence || [])]).slice(0, 6),
    businessLabel: preferred.businessLabel || alternate.businessLabel || '',
    shortCaption: preferred.shortCaption || alternate.shortCaption || '',
    confidence: Math.max(
      Number(preferred.confidence || 0) || 0,
      Number(alternate.confidence || 0) || 0,
    ),
    ocrText: preferred.ocrText || alternate.ocrText || '',
    model: dedupeStrings([preferred.model, alternate.model]).join(' + '),
  });
}

function buildProcessingNote(sources = []) {
  const pipeline = dedupeStrings(sources);

  if (pipeline.includes('ocr') && pipeline.includes('text-audit')) {
    return '截图识别完成，当前走的是 OCR 提文 + AI 审核链路。';
  }

  if (pipeline.includes('vision') && pipeline.includes('ocr')) {
    return '截图识别完成，当前走的是视觉识别 + OCR 融合链路。';
  }

  if (pipeline.includes('ocr')) {
    return '截图识别完成，当前走的是本地 OCR 兜底链路。';
  }

  return '截图识别完成，可直接纳入《门店刷单整理-分板块版》导出。';
}

function persistImageAsset(filePath, originalName = '', conversationId = '') {
  ensureShuadanAssetsDir();
  const token = buildShuadanAssetToken(conversationId, originalName || filePath);
  const targetPath = path.join(SHUADAN_ASSETS_DIR, token);
  fs.copyFileSync(filePath, targetPath);
  return {
    assetToken: token,
    storedFileName: path.basename(originalName || filePath),
  };
}

function resolveShuadanAssetPath(assetToken = '') {
  const safeToken = path.basename(String(assetToken || '').trim());

  if (!safeToken) {
    return '';
  }

  const filePath = path.join(SHUADAN_ASSETS_DIR, safeToken);
  return fs.existsSync(filePath) ? filePath : '';
}

function resolveSectionDefinition(sectionKey = '') {
  return SECTION_DEFINITIONS[sectionKey] || SECTION_DEFINITIONS.review;
}

function deriveSectionKey(payload = {}) {
  const direct = safeText(payload.section_key).toLowerCase();

  if (direct === 'verification' || direct === 'transfer') {
    return direct;
  }

  const hintText = [
    payload.screenshot_kind,
    payload.platform,
    payload.short_caption,
    ...(Array.isArray(payload.evidence) ? payload.evidence : []),
  ]
    .map((item) => safeText(item))
    .join(' ');

  if (/代付|账单|支付|转账|银行卡|微信支付|支付宝|付款/.test(hintText)) {
    return 'transfer';
  }

  if (/券码|验券|核销|消费金额|订单号|美团|抖音|大众点评|团购/.test(hintText)) {
    return 'verification';
  }

  return 'unknown';
}

function normalizeListItems(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => ({
      time: normalizeDateTime(item?.time || item?.normalized_time || ''),
      amount: toNumber(item?.amount),
      label: safeText(item?.label || item?.title || item?.name || ''),
    }))
    .filter((item) => item.amount || item.time || item.label);
}

function buildShortCaption(payload = {}) {
  const sectionKey = payload.sectionKey || 'review';
  const captionBase = safeText(payload.shortCaption);

  if (captionBase) {
    return captionBase;
  }

  const kindMap = {
    verification_detail: '核销详情',
    verification_list: '核销列表',
    transfer_detail: '转账详情',
    transfer_list: '转账列表',
    other: sectionKey === 'transfer' ? '转账截图' : '核销截图',
  };

  const title = kindMap[payload.screenshotKind] || '待复核截图';
  const parts = [payload.platform, title].map((item) => safeText(item)).filter(Boolean);
  return parts.join(' ').trim() || title;
}

function buildCaption(payload = {}) {
  const parts = [buildShortCaption(payload)];

  if (payload.primaryAmount) {
    parts.push(
      payload.isListPage && payload.listItems?.length
        ? `可见合计 ${formatCurrency(payload.primaryAmount)}`
        : formatCurrency(payload.primaryAmount),
    );
  }

  if (payload.normalizedTime) {
    parts.push(payload.normalizedTime);
  }

  if (payload.isListPage && payload.listItems?.length) {
    parts.push(`${payload.listItems.length} 条`);
  }

  if (payload.voucherCode) {
    parts.push(`券码 ${payload.voucherCode}`);
  } else if (payload.orderId) {
    parts.push(`单号 ${payload.orderId}`);
  }

  return parts.slice(0, 4).join(' | ');
}

function normalizeVisionPayload(parsed = {}) {
  const sectionKey = deriveSectionKey(parsed);
  const screenshotKind = safeText(parsed.screenshot_kind || '').toLowerCase() || 'other';
  const listItems = normalizeListItems(parsed.list_items);
  let primaryAmount = toNumber(parsed.primary_amount);

  if (!primaryAmount && listItems.length === 1 && listItems[0].amount) {
    primaryAmount = listItems[0].amount;
  }

  if (!primaryAmount && listItems.length > 1) {
    primaryAmount = sumAmounts(listItems.map((item) => item.amount).filter((amount) => amount));
  }

  const normalizedTime = normalizeDateTime(
    parsed.normalized_time || parsed.time || parsed.payment_time || parsed.verification_time || '',
  );
  const isListPage = Boolean(
    parsed.is_list_page ||
      screenshotKind.endsWith('_list') ||
      (listItems.length > 1 && !toNumber(parsed.primary_amount)),
  );

  return normalizeMonetaryPayload({
    sectionKey,
    screenshotKind,
    isListPage,
    platform: safeText(parsed.platform),
    primaryAmount,
    amountCandidates: Array.isArray(parsed.amount_candidates)
      ? parsed.amount_candidates
          .map((item) => ({
            label: safeText(item?.label || ''),
            amount: toNumber(item?.amount),
          }))
          .filter((item) => item.label || item.amount)
      : [],
    normalizedTime,
    voucherCode: isListPage ? '' : safeText(parsed.voucher_code),
    orderId: isListPage ? '' : safeText(parsed.order_id),
    applicantName: safeText(parsed.applicant_name),
    recipientName: safeText(parsed.recipient_name),
    listItems,
    evidence: dedupeStrings(parsed.evidence).slice(0, 6),
    shortCaption: safeText(parsed.short_caption),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0) || 0)),
  });
}

function buildParsedDataSummary(payload = {}) {
  const section = resolveSectionDefinition(payload.sectionKey);
  const screenshotKindLabel = {
    verification_detail: '核销详情截图',
    verification_list: '核销列表截图',
    transfer_detail: '转账详情截图',
    transfer_list: '转账列表截图',
    other: '待复核截图',
  }[payload.screenshotKind] || '待复核截图';

  const summary = [`识别为 ${section.label} / ${screenshotKindLabel}`];

  if (payload.primaryAmount) {
    summary.push(
      payload.isListPage
        ? `列表页可见合计 ${formatCurrency(payload.primaryAmount)}`
        : `主金额 ${formatCurrency(payload.primaryAmount)}`,
    );
  }

  if (payload.normalizedTime) {
    summary.push(`时间 ${payload.normalizedTime}`);
  }

  if (payload.voucherCode) {
    summary.push(`券码 ${payload.voucherCode}`);
  } else if (payload.orderId) {
    summary.push(`订单号 ${payload.orderId}`);
  }

  if (payload.isListPage && payload.listItems.length) {
    summary.push(`列表页识别到 ${payload.listItems.length} 条可见记录`);
  }

  return summary;
}

function buildReviewResult({
  originalName,
  extension,
  storeName,
  periodLabel,
  assetToken,
  reason,
  normalizedPayload = {},
}) {
  const normalizedReviewPayload = normalizeShuadanPayloadForOutput(normalizedPayload, {
    originalName,
  });
  const section = SECTION_DEFINITIONS.review;

  return {
    fileName: originalName,
    extension,
    status: 'review',
    parserMode: 'image-vision',
    sourceGroupKey: '',
    sourceGroupLabel: '',
    storeName,
    periodLabel,
    bodySheetSection: section.bodySheetSection,
    parsedDataSummary: normalizedReviewPayload.sectionKey && normalizedReviewPayload.sectionKey !== 'unknown'
      ? buildParsedDataSummary(normalizedReviewPayload)
      : ['当前截图已接收，但尚未稳定识别到可直接归板块的结构化字段。'],
    previewLines: dedupeStrings([
      buildCaption(normalizedReviewPayload),
      ...(normalizedReviewPayload.evidence || []),
    ]).slice(0, 5),
    metrics: {
      primaryAmount: normalizedReviewPayload.primaryAmount || null,
      listCount: normalizedReviewPayload.listItems?.length || 0,
      confidence: normalizedReviewPayload.confidence || 0,
    },
    structuredData: {
      kind: 'shuadan-screenshot',
      assetToken,
      sectionKey: 'review',
      sectionLabel: section.label,
      screenshotKind: normalizedReviewPayload.screenshotKind || 'other',
      isListPage: Boolean(normalizedReviewPayload.isListPage),
      platform: normalizedReviewPayload.platform || '',
      primaryAmount: normalizedReviewPayload.primaryAmount || null,
      amountCandidates: normalizedReviewPayload.amountCandidates || [],
      normalizedTime: normalizedReviewPayload.normalizedTime || '',
      voucherCode: normalizedReviewPayload.voucherCode || '',
      orderId: normalizedReviewPayload.orderId || '',
      applicantName: normalizedReviewPayload.applicantName || '',
      recipientName: normalizedReviewPayload.recipientName || '',
      listItems: normalizedReviewPayload.listItems || [],
      evidence: normalizedReviewPayload.evidence || [],
      businessLabel: normalizedReviewPayload.businessLabel || '',
      caption: buildCaption({
        ...normalizedReviewPayload,
        sectionKey: 'review',
      }),
      shortCaption: buildShortCaption({
        ...normalizedReviewPayload,
        sectionKey: 'review',
      }),
      confidence: normalizedReviewPayload.confidence || 0,
    },
    reason,
  };
}

async function parseShuadanScreenshot(filePath, options = {}) {
  const originalName = options.originalName || path.basename(filePath);
  const extension = getExtension(originalName);
  const storeName = safeText(options.storeName);
  const periodLabel = safeText(options.periodLabel);
  const conversationId = safeText(options.conversationId);

  if (!IMAGE_EXTENSIONS.has(extension)) {
    return {
      fileName: originalName,
      extension,
      status: 'unsupported',
      parserMode: 'unsupported',
      sourceGroupKey: '',
      sourceGroupLabel: '',
      storeName,
      periodLabel,
      bodySheetSection: SECTION_DEFINITIONS.review.bodySheetSection,
      parsedDataSummary: [],
      previewLines: [],
      metrics: {},
      reason: extension
        ? `当前技能暂不支持 .${extension} 图片格式。`
        : '当前文件格式无法识别。',
    };
  }

  const asset = persistImageAsset(filePath, originalName, conversationId);
  const pipeline = [];
  const errors = [];
  let visionNormalized = null;
  let ocrNormalized = null;
  let auditNormalized = null;

  try {
    const analysis = await requestVisionAnalysis(filePath, {
      originalName,
      storeName,
      periodLabel,
    });
    visionNormalized = {
      ...normalizeVisionPayload(analysis.parsed),
      model: analysis.model,
    };
    pipeline.push('vision');
  } catch (error) {
    errors.push(error.message || '视觉识别失败');
  }

  if (!visionNormalized || shouldRunOcrAssist(visionNormalized)) {
    try {
      ocrNormalized = {
        ...(await parseWithWindowsOcrFallback(filePath, {
          originalName,
          periodLabel,
        })),
        model: 'windows-ocr-fallback',
      };
      pipeline.push('ocr');
    } catch (error) {
      errors.push(error.message || '本地 OCR 提文失败');
    }
  }

  let finalNormalized = mergeNormalizedPayloads(visionNormalized || {}, ocrNormalized || {});
  const ocrHasListSignal = hasStrongListSignal(ocrNormalized || {});

  if (ocrHasListSignal) {
    finalNormalized = mergeNormalizedPayloads(ocrNormalized, finalNormalized);
  }

  if (!finalNormalized.normalizedTime && !pipeline.includes('ocr')) {
    try {
      ocrNormalized = {
        ...(await parseWithWindowsOcrFallback(filePath, {
          originalName,
          periodLabel,
        })),
        model: 'windows-ocr-fallback',
      };
      pipeline.push('ocr');
      finalNormalized = mergeNormalizedPayloads(ocrNormalized, finalNormalized);
    } catch (error) {
      errors.push(error.message || '本地 OCR 补时失败');
    }
  }

  if (!ocrHasListSignal && shouldRunTextAudit(finalNormalized, ocrNormalized || {})) {
    try {
      const audit = await requestTextAuditAnalysis({
        originalName,
        storeName,
        periodLabel,
        ocrText: ocrNormalized?.ocrText || '',
        visionCandidate: {
          section_key: finalNormalized.sectionKey || 'unknown',
          screenshot_kind: finalNormalized.screenshotKind || 'other',
          platform: finalNormalized.platform || '',
          primary_amount: finalNormalized.primaryAmount,
          normalized_time: finalNormalized.normalizedTime || '',
          voucher_code: finalNormalized.voucherCode || '',
          order_id: finalNormalized.orderId || '',
          evidence: finalNormalized.evidence || [],
          confidence: finalNormalized.confidence || 0,
        },
      });
      auditNormalized = {
        ...normalizeVisionPayload(audit.parsed),
        model: audit.model,
      };
      pipeline.push('text-audit');
      finalNormalized = mergeNormalizedPayloads(auditNormalized, finalNormalized);
    } catch (error) {
      errors.push(error.message || '文本审核失败');
    }
  }

  finalNormalized = normalizeShuadanPayloadForOutput(finalNormalized, {
    originalName,
  });

  if (!hasResolvedSection(finalNormalized)) {
    return buildReviewResult({
      originalName,
      extension,
      storeName,
      periodLabel,
      assetToken: asset.assetToken,
      reason:
        errors[0] ||
        '已尝试视觉识别、本地 OCR 与文本审核，但仍未稳定判断属于核销板块还是转账板块。',
      normalizedPayload: finalNormalized,
    });
  }

  const section = resolveSectionDefinition(finalNormalized.sectionKey);
  const caption = buildCaption(finalNormalized);
  const parsedDataSummary = buildParsedDataSummary(finalNormalized);

  if (pipeline.includes('ocr') && pipeline.includes('text-audit')) {
    parsedDataSummary.push('当前截图由 OCR 提文后经 AI 二次审核完成。');
  } else if (pipeline.includes('vision') && pipeline.includes('ocr')) {
    parsedDataSummary.push('当前截图由视觉识别与本地 OCR 融合完成。');
  } else if (pipeline.includes('ocr')) {
    parsedDataSummary.push('当前截图由本地 Windows OCR 兜底识别完成。');
  }

  return {
    fileName: originalName,
    extension,
    status: 'parsed',
    parserMode: 'image-vision',
    sourceGroupKey: section.key,
    sourceGroupLabel: section.label,
    storeName,
    periodLabel,
    bodySheetSection: section.bodySheetSection,
    parsedDataSummary,
    previewLines: dedupeStrings([caption, ...(finalNormalized.evidence || [])]).slice(0, 5),
    metrics: {
      primaryAmount: finalNormalized.primaryAmount || null,
      listCount: finalNormalized.listItems?.length || 0,
      confidence: finalNormalized.confidence || 0,
    },
    structuredData: {
      kind: 'shuadan-screenshot',
      assetToken: asset.assetToken,
      sectionKey: section.key,
      sectionLabel: section.label,
      screenshotKind: finalNormalized.screenshotKind,
      isListPage: finalNormalized.isListPage,
      platform: finalNormalized.platform,
      primaryAmount: finalNormalized.primaryAmount,
      amountCandidates: finalNormalized.amountCandidates,
      normalizedTime: finalNormalized.normalizedTime,
      voucherCode: finalNormalized.voucherCode,
      orderId: finalNormalized.orderId,
      applicantName: finalNormalized.applicantName,
      recipientName: finalNormalized.recipientName,
      listItems: finalNormalized.listItems,
      evidence: finalNormalized.evidence,
      businessLabel: finalNormalized.businessLabel || '',
      caption,
      shortCaption: buildShortCaption(finalNormalized),
      confidence: finalNormalized.confidence,
      model: finalNormalized.model || 'hybrid',
    },
    note: buildProcessingNote(pipeline),
  };
}

function buildStableIdentity(item = {}) {
  if (item.orderId) {
    return `order:${item.orderId}`;
  }

  if (item.voucherCode) {
    return `voucher:${item.voucherCode}`;
  }

  if (item.primaryAmount && item.normalizedTime) {
    return `amount-time:${item.primaryAmount}|${item.normalizedTime}`;
  }

  return `file:${item.fileName}`;
}

function buildDuplicateAudit(entries = []) {
  const groups = new Map();

  entries.forEach((entry) => {
    const key = buildStableIdentity(entry);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  });

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({
      key,
      count: items.length,
      captions: dedupeStrings(items.map((item) => item.caption)).slice(0, 4),
    }));
}

function buildAmountTimeAudit(entries = []) {
  const groups = new Map();

  entries.forEach((entry) => {
    if (!entry.primaryAmount || !entry.normalizedTime) {
      return;
    }

    const key = `${entry.primaryAmount}|${entry.normalizedTime}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(entry);
  });

  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => {
      const [amount, normalizedTime] = key.split('|');
      return {
        amount: Number(amount),
        normalizedTime,
        count: items.length,
        captions: dedupeStrings(items.map((item) => item.caption)).slice(0, 4),
      };
    });
}

function aggregateShuadanFiles(parsedFiles = [], reviewFiles = []) {
  const parsedEntries = [...parsedFiles, ...reviewFiles]
    .map((file) => {
      const structured = file?.structuredData || {};

      if (structured.kind !== 'shuadan-screenshot') {
        return null;
      }

      const sectionKey =
        structured.sectionKey === 'verification' || structured.sectionKey === 'transfer'
          ? structured.sectionKey
          : 'review';

      return {
        fileName: file.fileName || '',
        sourceGroupKey: file.sourceGroupKey || sectionKey,
        sourceGroupLabel: file.sourceGroupLabel || resolveSectionDefinition(sectionKey).label,
        sectionKey,
        sectionLabel: resolveSectionDefinition(sectionKey).label,
        assetToken: structured.assetToken || '',
        assetPath: resolveShuadanAssetPath(structured.assetToken || ''),
        screenshotKind: safeText(structured.screenshotKind).toLowerCase() || 'other',
        isListPage: Boolean(structured.isListPage),
        platform: safeText(structured.platform),
        primaryAmount: toNumber(structured.primaryAmount),
        amountCandidates: Array.isArray(structured.amountCandidates)
          ? structured.amountCandidates
          : [],
        normalizedTime: normalizeDateTime(structured.normalizedTime || ''),
        voucherCode: safeText(structured.voucherCode),
        orderId: safeText(structured.orderId),
        applicantName: safeText(structured.applicantName),
        recipientName: safeText(structured.recipientName),
        listItems: normalizeListItems(structured.listItems),
        caption: safeText(structured.caption),
        shortCaption: safeText(structured.shortCaption),
        evidence: dedupeStrings(structured.evidence).slice(0, 6),
        businessLabel: safeText(structured.businessLabel),
        confidence: Number(structured.confidence || 0) || 0,
        reviewReason: safeText(file.reason || ''),
      };
    })
    .filter((item) => item && item.assetPath);

  const sections = ['verification', 'transfer', 'review'].map((sectionKey) => {
    const items = parsedEntries
      .filter((entry) => entry.sectionKey === sectionKey)
      .sort((left, right) => {
        const leftKey = left.normalizedTime || left.fileName;
        const rightKey = right.normalizedTime || right.fileName;
        return leftKey.localeCompare(rightKey, 'zh-CN');
      });
    const detailItems = items.filter((item) => !item.isListPage && item.primaryAmount);
    const listItems = items.filter((item) => item.isListPage);
    const visibleTotal = Number(
      items.reduce((sum, item) => sum + Number(item.primaryAmount || 0), 0).toFixed(2),
    );
    const dedupedDetails = [];
    const seen = new Set();

    detailItems.forEach((item) => {
      const identity = buildStableIdentity(item);
      if (seen.has(identity)) {
        return;
      }
      seen.add(identity);
      dedupedDetails.push(item);
    });

    const detailTotal = Number(
      dedupedDetails.reduce((sum, item) => sum + Number(item.primaryAmount || 0), 0).toFixed(2),
    );

    return {
      key: sectionKey,
      label: resolveSectionDefinition(sectionKey).label,
      items,
      detailItems,
      listItems,
      screenshotCount: items.length,
      detailCount: detailItems.length,
      listCount: listItems.length,
      visibleTotal,
      summaryTotal: sectionKey === 'review' ? 0 : visibleTotal,
      totalRule:
        sectionKey === 'review'
          ? '待复核截图不计入金额汇总'
          : '按每张截图可见金额统计，不做一对一配对与去重',
    };
  });

  const transferSection = sections.find((section) => section.key === 'transfer');
  const verificationSection = sections.find((section) => section.key === 'verification');
  const reviewSection = sections.find((section) => section.key === 'review');
  const transferDetailEntries = transferSection?.detailItems || [];
  const duplicateTransfers = buildDuplicateAudit(transferDetailEntries);
  const repeatedAmountTime = buildAmountTimeAudit(transferDetailEntries);
  const caveats = [];

  if (transferSection?.listCount) {
    caveats.push(`转账板块包含 ${transferSection.listCount} 张列表页；本版按截图可见金额统计，不主动与详情页去重。`);
  }

  if (verificationSection?.listCount) {
    caveats.push(`核销板块包含 ${verificationSection.listCount} 张列表页；本版按截图可见金额统计，不主动与详情页去重。`);
  }

  if (reviewSection?.screenshotCount) {
    caveats.push(`仍有 ${reviewSection.screenshotCount} 张截图进入待复核板块，建议人工再看一遍。`);
  }

  return {
    sections,
    screenshotCount: parsedEntries.length,
    verificationTotal: verificationSection?.summaryTotal || 0,
    transferTotal: transferSection?.summaryTotal || 0,
    actualReimbursementTotal: transferSection?.summaryTotal || verificationSection?.summaryTotal || 0,
    duplicateTransfers,
    repeatedAmountTime,
    caveats,
  };
}

module.exports = {
  SHUADAN_REQUIRED_SOURCE_GROUPS,
  aggregateShuadanFiles,
  formatCurrency,
  parseShuadanScreenshot,
  resolveShuadanAssetPath,
};
