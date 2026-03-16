function formatCurrency(value) {
  return `¥${Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function joinItems(items = [], limit = items.length) {
  return items.filter((item) => item && item !== "粉").slice(0, limit).join("、");
}

function normalizePeriodLabel(value = "") {
  const text = String(value || "").trim();

  if (!text) {
    return "";
  }

  const yearMonthMatch = text.match(/(20\d{2})[\s./-]*年?[\s./-]*(\d{1,2})\s*月?/);

  if (yearMonthMatch) {
    return `${yearMonthMatch[1]}年${Number(yearMonthMatch[2])}月`;
  }

  const monthMatch = text.match(/(\d{1,2})\s*月/);

  if (monthMatch) {
    return `${Number(monthMatch[1])}月`;
  }

  return text;
}

function trimSentenceEnding(value = "") {
  return String(value || "").replace(/[。；，\s]+$/g, "").trim();
}

function resolveReportPeriodLabel(parsedFiles = [], fallback = "") {
  const explicitPeriod = normalizePeriodLabel(fallback);

  if (explicitPeriod) {
    return explicitPeriod;
  }

  const periodCandidates = parsedFiles.flatMap((file) => [
    file?.periodLabel,
    file?.structuredData?.periodLabel,
    file?.structuredData?.mainSheetName,
    file?.metrics?.sheetName,
  ]);
  const normalizedPeriods = periodCandidates.map((item) => normalizePeriodLabel(item)).filter(Boolean);
  const fullPeriod = normalizedPeriods.find((item) => /20\d{2}年\d{1,2}月/.test(item));

  return fullPeriod || normalizedPeriods[0] || "";
}

function resolveFilePeriodLabel(file = {}, fallback = "") {
  const filePeriod =
    normalizePeriodLabel(file.periodLabel) ||
    normalizePeriodLabel(file.structuredData?.periodLabel) ||
    "";
  const fallbackPeriod = normalizePeriodLabel(fallback);

  if (fallbackPeriod && /20\d{2}年/.test(fallbackPeriod) && (!filePeriod || !/20\d{2}年/.test(filePeriod))) {
    return fallbackPeriod;
  }

  return filePeriod || fallbackPeriod || normalizePeriodLabel(file.structuredData?.mainSheetName) || normalizePeriodLabel(file.metrics?.sheetName) || "";
}

function formatInventoryMainSheetLabel(file = {}, fallback = "") {
  const normalizedPeriod = resolveFilePeriodLabel(file, fallback);

  if (normalizedPeriod) {
    return `${normalizedPeriod}日常出入库主表`;
  }

  return file.structuredData?.mainSheetName || "出入库主表";
}

function formatInventoryAssetSheetLabel(file = {}) {
  const sheetName = String(file.structuredData?.fixedAssetSheetName || "").trim();

  if (!sheetName) {
    return "固定资产";
  }

  if (/固定资产/.test(sheetName)) {
    return "固定资产盘点表";
  }

  return sheetName;
}

function getFileName(file = {}) {
  return file.fileName || file.name || "未命名文件";
}

function getBodySheetMappings(file = {}) {
  return Array.isArray(file.bodySheetMappings)
    ? file.bodySheetMappings
    : Array.isArray(file.structuredData?.bodySheetMappings)
      ? file.structuredData.bodySheetMappings
      : [];
}

function classifyExpenseMapping(mapping = {}) {
  const category = String(mapping.targetCategory || "");
  const detail = String(mapping.targetDetail || "");
  const source = joinItems(mapping.sourceNames || [], 4);
  const matcher = `${category} ${detail} ${source}`;

  if (/水电|门店|宿舍|租金|物业|固定资产|工程维修/.test(matcher)) {
    return "fixed";
  }

  if (/餐费|员工福利/.test(matcher)) {
    return "staff";
  }

  if (/增值服务|消耗品|洗护|茶饮|附加值|袋子|纸巾|棉签|清洁|床单|手套/.test(matcher)) {
    return "materials";
  }

  if (/话费|网络|办公|退款|退费|杂费|管理费|推广费|手续费/.test(matcher)) {
    return "admin";
  }

  return "other";
}

function buildExpenseFileSection(file = {}, periodLabel = "", index = 1) {
  const resolvedPeriodLabel = resolveFilePeriodLabel(file, periodLabel);
  const totalAmount = file.structuredData?.totalAmount || file.metrics?.totalAmount || 0;
  const mappings = getBodySheetMappings(file).filter((item) => item.placementType !== "reference");
  const groups = {
    fixed: [],
    staff: [],
    materials: [],
    admin: [],
    other: [],
  };

  mappings.forEach((mapping) => {
    groups[classifyExpenseMapping(mapping)].push(mapping);
  });

  const bullets = [];

  if (groups.fixed.length) {
    bullets.push(`- **固定经营支出**：${groups.fixed.slice(0, 4).map((item) => `${joinItems(item.sourceNames, 3)} ${formatCurrency(item.amount)}`).join("，")}。`);
  }

  if (groups.staff.length) {
    bullets.push(`- **员工餐饮与福利**：${groups.staff.slice(0, 4).map((item) => `${joinItems(item.sourceNames, 3)} ${formatCurrency(item.amount)}`).join("，")}。`);
  }

  if (groups.materials.length) {
    bullets.push(`- **业务耗材与服务物料**：${groups.materials.slice(0, 5).map((item) => `${joinItems(item.sourceNames, 3)} ${formatCurrency(item.amount)}`).join("，")}。`);
  }

  if (groups.admin.length) {
    bullets.push(`- **行政杂项与店务维护**：${groups.admin.slice(0, 5).map((item) => `${joinItems(item.sourceNames, 3)} ${formatCurrency(item.amount)}`).join("，")}。`);
  }

  if (!bullets.length && Array.isArray(file.structuredData?.topItems) && file.structuredData.topItems.length) {
    bullets.push(`- **主要报销条目**：${file.structuredData.topItems.slice(0, 6).map((item) => `${item.name} ${formatCurrency(item.amount)}`).join("，")}。`);
  }

  return [
    `### ${index}. 《${getFileName(file)}》数据详情`,
    `这份文档主要记录了门店 ${resolvedPeriodLabel || "当前月份"} 的报销与费用流水，本月合计 ${formatCurrency(totalAmount)}。从已提取的文本看，费用可以拆成以下几个模块：`,
    ...bullets,
  ].join("\n\n");
}

function classifyInventoryItem(item = {}) {
  const text = `${item.name || ""} ${item.spec || ""}`;

  if (/洗发|发膜|护理液|净化液|洁泥膏|精华|精油|按摩膏|眼罩/.test(text)) {
    return "service";
  }

  if (/茶|糖浆|茶杯|杯盖|纸杯|坚果|茶麸|打包袋/.test(text)) {
    return "tea";
  }

  if (/抽纸|棉签|酒精|床单|口罩|打印纸/.test(text)) {
    return "admin";
  }

  return "other";
}

function buildInventoryFileSection(file = {}, index = 1, periodLabel = "") {
  const data = file.structuredData || {};
  const mainItems = Array.isArray(data.mainSheetItems) ? data.mainSheetItems : [];
  const topOutboundItems = Array.isArray(data.topOutboundItems) ? data.topOutboundItems : [];
  const fixedAssets = Array.isArray(data.highValueAssets) ? data.highValueAssets : [];
  const mainSheetLabel = formatInventoryMainSheetLabel(file, periodLabel);
  const fixedAssetSheetLabel = formatInventoryAssetSheetLabel(file);
  const durableTools = (Array.isArray(data.fixedAssets) ? data.fixedAssets : [])
    .filter((item) => /吹风|八爪鱼|梳|枪|毛毯|椅|推车|检测|陶瓷炉|净水器|打印机/.test(item.name || ""))
    .sort((a, b) => Number(b.endingStock || 0) - Number(a.endingStock || 0))
    .slice(0, 6);
  const serviceItems = mainItems.filter((item) => classifyInventoryItem(item) === "service").sort((a, b) => b.outboundQuantity - a.outboundQuantity).slice(0, 5);
  const teaItems = mainItems.filter((item) => classifyInventoryItem(item) === "tea").sort((a, b) => b.outboundQuantity - a.outboundQuantity).slice(0, 5);
  const adminItems = mainItems.filter((item) => classifyInventoryItem(item) === "admin").sort((a, b) => b.outboundQuantity - a.outboundQuantity).slice(0, 5);

  return [
    `### ${index}. 《${getFileName(file)}》数据详情`,
    "该表格同时记录了日常耗材出入库与固定资产盘点，适合拆成两个维度来看：",
    `**表A：${mainSheetLabel}**`,
    `- **字段结构**：包含品名、上月库存、规格、日期（1-31）、合计出入库、单价、合计总金额。`,
    topOutboundItems.length
      ? `- **高频消耗项**：${topOutboundItems.slice(0, 4).map((item) => `${item.name} 出仓${item.outboundQuantity}${item.spec || ""}${item.endingStock === 0 ? "，月末库存归零" : ""}`).join("；")}。`
      : `- **高频消耗项**：当前未抽取到有效的出仓记录。`,
    serviceItems.length
      ? `- **洗护与服务类物资**：${serviceItems.map((item) => `${item.name}${item.outboundQuantity ? `（出仓${item.outboundQuantity}${item.spec || ""}）` : ""}`).join("、")}。`
      : null,
    teaItems.length
      ? `- **茶饮与客耗品**：${teaItems.map((item) => `${item.name}${item.outboundQuantity ? `（出仓${item.outboundQuantity}${item.spec || ""}）` : ""}`).join("、")}。`
      : null,
    adminItems.length
      ? `- **行政及清洁杂项**：${adminItems.map((item) => `${item.name}${item.outboundQuantity ? `（出仓${item.outboundQuantity}${item.spec || ""}）` : ""}`).join("、")}。`
      : null,
    "",
    `**表B：${fixedAssetSheetLabel}**`,
    fixedAssets.length
      ? `- **核心固定资产**：${fixedAssets.slice(0, 6).map((item) => `${item.name}${item.endingStock}${item.spec || ""}，单价${formatCurrency(item.unitPrice)}`).join("；")}。`
      : `- **核心固定资产**：当前未识别到高价值设备。`,
    durableTools.length
      ? `- **耐用品与工具**：${durableTools.slice(0, 6).map((item) => `${item.name}${item.endingStock}${item.spec || ""}`).join("、")}。`
      : null,
    `- **数据问题**：固定资产工作表表头仍标注历史月份，说明设备清单与当月出入库记录混放在同一本工作簿里，后续应拆成“当月消耗台账”和“固定资产台账”两套口径。`,
  ].filter(Boolean).join("\n\n");
}

function buildRevenueFileSection(file = {}, periodLabel = "", index = 1) {
  const data = file.structuredData || {};
  const resolvedPeriodLabel = resolveFilePeriodLabel(file, periodLabel);

  return [
    `### ${index}. 《${getFileName(file)}》数据详情`,
    `这份报表记录了门店 ${resolvedPeriodLabel || "当前月份"} 的营收与渠道结构，当前已识别出以下关键指标：`,
    `- **经营规模**：消费人数 ${Number(data.customerCount || 0).toLocaleString("zh-CN")} 人，新增会员 ${Number(data.newMembers || 0).toLocaleString("zh-CN")} 人。`,
    `- **核心收入**：核算总实收 ${formatCurrency(data.recognizedRevenue)}，月度总实收 ${formatCurrency(data.grossRevenue)}，储值金额 ${formatCurrency(data.savingsAmount)}。`,
    `- **渠道结构**：微信银联支付宝 ${formatCurrency(data.channels?.walletChannel)}，现金 ${formatCurrency(data.channels?.cashChannel)}，美团 ${formatCurrency(data.channels?.meituanRevenue)}，抖音 ${formatCurrency(data.channels?.douyinRevenue)}。`,
  ].join("\n\n");
}

function formatPlacementSentence(mapping = {}, sourceLimit = 3) {
  const target = mapping.targetDetail
    ? `「${mapping.targetCategory} > ${mapping.targetDetail}」`
    : mapping.targetCategory
      ? `「${mapping.targetCategory}」`
      : "待人工归类";
  const rowText = mapping.targetRow ? `（第${mapping.targetRow}行）` : "";
  const matcher = `${mapping.targetCategory || ""} ${mapping.targetDetail || ""} ${(mapping.sourceNames || []).join(" ")}`;
  let amountText = "";

  if (mapping.amount) {
    if (/客数|人数|会员数/.test(matcher)) {
      amountText = ` ${Number(mapping.amount || 0).toLocaleString("zh-CN")}人`;
    } else {
      amountText = ` ${formatCurrency(mapping.amount)}`;
    }
  }

  return `${joinItems(mapping.sourceNames, sourceLimit)}${amountText} 应回填到 ${target}${rowText}`;
}

function getPlacementLines(file = {}, placementType = "detail") {
  const mappings = getBodySheetMappings(file);

  if (!mappings.length) {
    return [];
  }

  if (placementType === "summary") {
    return mappings
      .filter((item) => item.placementType === "summary")
      .slice(0, 6)
      .map((item) => formatPlacementSentence(item, 2));
  }

  if (placementType === "reference") {
    return mappings
      .filter((item) => item.placementType === "reference" || item.placementType === "unmapped")
      .slice(0, 4)
      .map((item) => {
        const note = trimSentenceEnding(item.note);
        return `${joinItems(item.sourceNames, 4)} 建议归到 ${item.targetLabel}${note ? `，${note}` : ""}`;
      });
  }

  return mappings
    .filter((item) => item.placementType !== "reference" && item.placementType !== "summary" && item.placementType !== "unmapped")
    .slice(0, 8)
    .map((item) => formatPlacementSentence(item, 3));
}

function buildPlacementGroupBlock(title = "", files = [], placementType = "detail") {
  const sections = files
    .filter(Boolean)
    .map((file) => {
      const lines = getPlacementLines(file, placementType);

      if (!lines.length) {
        return "";
      }

      return [
        `《${getFileName(file)}》`,
        ...lines.map((line) => `- ${line}`),
      ].join("\n");
    })
    .filter(Boolean);

  if (!sections.length) {
    return "";
  }

  return [
    `**${title}**`,
    ...sections,
  ].join("\n\n");
}

function buildMissingWarning({ reviewFiles = [], failFiles = [], missingFiles = [] }) {
  const lines = [];

  if (missingFiles.length) {
    lines.push(`本轮仍缺少 ${joinItems(missingFiles)}，因此相关体质表模块无法形成完整闭环。`);
  }

  if (reviewFiles.length) {
    lines.push(`${reviewFiles.map((file) => `《${getFileName(file)}》${file.reason ? `：${file.reason}` : "需要人工复核"}`).join("；")}。`);
  }

  if (failFiles.length) {
    lines.push(`${failFiles.map((file) => `《${getFileName(file)}》${file.reason ? `：${file.reason}` : "未能解析"}`).join("；")}。`);
  }

  return lines.join(" ");
}

function buildOverviewIntro(parsedFiles = []) {
  const kinds = new Set(parsedFiles.map((file) => file.structuredData?.kind || file.sourceGroupKey));

  if (kinds.has("expense-pdf") && kinds.has("inventory-register")) {
    return "这两份文档分别记录了门店在日常经营中的财务现金流出（报销）与物资流转（出入库 / 固定资产）。";
  }

  if (kinds.has("expense-pdf") && kinds.has("revenue-report")) {
    return "这批文档分别记录了门店的营收结构与费用支出，已经可以支撑一版基础经营复盘。";
  }

  if (kinds.has("expense-pdf")) {
    return "这批文档主要记录了门店的报销与费用支出。";
  }

  if (kinds.has("inventory-register")) {
    return "这批文档主要记录了门店的物资流转与固定资产情况。";
  }

  if (kinds.has("revenue-report")) {
    return "这批文档主要记录了门店的营收、客流与渠道结构。";
  }

  return "这些文档已经完成结构化整理，可直接用于当前门店的数据复核。";
}

export function buildParsingInsightMarkdown({
  storeName = "",
  periodLabel = "",
  parsedFiles = [],
  reviewFiles = [],
  failFiles = [],
  missingFiles = [],
}) {
  const sections = [];
  const resolvedPeriodLabel = resolveReportPeriodLabel(parsedFiles, periodLabel);
  const revenueFile = parsedFiles.find((file) => file.structuredData?.kind === "revenue-report");
  const expenseFile = parsedFiles.find((file) => file.structuredData?.kind === "expense-pdf");
  const inventoryFile = parsedFiles.find((file) => file.structuredData?.kind === "inventory-register");

  let sectionIndex = 1;

  if (revenueFile) {
    sections.push(buildRevenueFileSection(revenueFile, resolvedPeriodLabel, sectionIndex));
    sectionIndex += 1;
  }

  if (expenseFile) {
    sections.push(buildExpenseFileSection(expenseFile, resolvedPeriodLabel, sectionIndex));
    sectionIndex += 1;
  }

  if (inventoryFile) {
    sections.push(buildInventoryFileSection(inventoryFile, sectionIndex, resolvedPeriodLabel));
  }

  const expenseMappings = expenseFile ? getBodySheetMappings(expenseFile) : [];
  const fixedCostAmount = expenseMappings
    .filter((item) => classifyExpenseMapping(item) === "fixed")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const staffAmount = expenseMappings
    .filter((item) => classifyExpenseMapping(item) === "staff")
    .reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const topOutboundText = inventoryFile?.structuredData?.topOutboundItems?.length
    ? inventoryFile.structuredData.topOutboundItems.slice(0, 4).map((item) => `${item.name}${item.outboundQuantity}${item.spec || ""}`).join("、")
    : "";
  const placementBlocks = [
    buildPlacementGroupBlock("汇总数据", [revenueFile, expenseFile, inventoryFile], "summary"),
    buildPlacementGroupBlock("明细数据", [expenseFile, inventoryFile], "detail"),
    buildPlacementGroupBlock("辅助说明", [inventoryFile, expenseFile, revenueFile], "reference"),
  ].filter(Boolean);
  const missingWarning = buildMissingWarning({ reviewFiles, failFiles, missingFiles });

  return [
    buildOverviewIntro(parsedFiles),
    "将这些手工记录的表格与零散报销单据结构化，是实现门店数据看板、自动生成体质表和后续 AI 分析的基础。以下是当前文件的详细梳理：",
    "",
    ...sections.flatMap((section) => [section, ""]),
    "---",
    "",
    "### 数据综合总结",
    `1. **运营成本结构已经显出主轴**：${expenseFile ? `从报销明细看，固定经营支出约 ${formatCurrency(fixedCostAmount)}，员工餐饮与福利约 ${formatCurrency(staffAmount)}；` : ""}${inventoryFile ? `出入库主表又补充了 ${formatCurrency(inventoryFile.structuredData?.totalAmount)} 的物料采购金额，说明门店成本并不只落在单一费用项，而是由固定支出与服务耗材共同驱动。` : "当前仍需补齐更多费用与物料数据，才能判断成本主轴。"} `,
    `2. **核心业务消耗路径较清晰**：${topOutboundText ? `高频出仓主要集中在 ${topOutboundText}，结合洗护、眼罩和茶饮类物料，可以反推门店当前高频服务场景仍围绕头皮护理、热敷舒压和客耗茶饮展开。` : "当前物资消耗记录不足，暂时只能识别基础台账结构。"} `,
    `3. **体质表归口建议要按“汇总数据 / 明细数据 / 辅助说明”拆开处理。**`,
    "",
    placementBlocks.join("\n\n") || "当前仅完成基础识别，尚未生成可用的体质表归口建议。",
    "",
    `4. **缺失预警**：${missingWarning || "当前上传文件已经能支撑基础洞察，但如果要形成完整体质表，仍建议同步补齐营业报表、工资表和可直接读取的辅助单据。"} `,
  ].join("\n");
}
