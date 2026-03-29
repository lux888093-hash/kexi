import React, { useState, useEffect } from "react";
import { buildApiUrl } from "../lib/runtimeConfig";

const BASIC_FIELDS = [
  { key: "customerCount", label: "客流人数", type: "number" },
  { key: "recognizedRevenue", label: "确收业绩", type: "number" },
  { key: "grossRevenue", label: "毛业绩", type: "number" },
  { key: "savingsAmount", label: "储值金额", type: "number" },
  { key: "totalCost", label: "总成本", type: "number" },
  { key: "avgTicket", label: "客单价", type: "number" },
  { key: "avgCustomerCost", label: "客成本", type: "number" },
  { key: "newMembers", label: "新客/会员数", type: "number" },
  { key: "projectRevenue", label: "项目耗卡", type: "number" },
  { key: "managementFee", label: "管理费", type: "number" },
  { key: "profit", label: "利润", type: "number" },
  { key: "profitMargin", label: "利润率", type: "number", step: "0.01" },
];

const EXPENSE_CATEGORIES = [
  "头疗师工资",
  "管理工资",
  "其他工资",
  "付管理公司",
  "门店宿舍",
  "租金",
  "水电",
  "生活费",
  "增值服务",
  "消耗品",
  "手续费",
  "工程维修",
  "其他开支"
];

function createEmptyExpenses() {
  const initialExpenses = {};
  EXPENSE_CATEGORIES.forEach((category) => {
    initialExpenses[category] = [];
  });
  return initialExpenses;
}

function normalizeExpenseCategoryLabel(value = "") {
  return String(value || "").replace(/\s+/g, "").replace(/[()（）]/g, "").trim();
}

function createExpenseItem(item = {}, categoryName = "", index = 0) {
  const remark = [item.notes, item.previousMonthHint].filter(Boolean).join("；");

  return {
    id: `${categoryName || "expense"}-${item.sourceRowIndex ?? index}-${index}`,
    name: item.name || "",
    amount: Number.isFinite(Number(item.amount)) ? Number(item.amount) : "",
    remark,
  };
}

function buildExpensesFromCategories(categories = []) {
  const expenses = createEmptyExpenses();

  categories.forEach((category = {}) => {
    const normalizedCategory = normalizeExpenseCategoryLabel(category.name);
    const items = Array.isArray(category.items) ? category.items : [];

    if (!items.length) {
      return;
    }

    if (normalizedCategory === "门店宿舍租金") {
      items.forEach((item, index) => {
        const targetCategory = /宿舍/.test(item?.name || "") ? "门店宿舍" : "租金";
        expenses[targetCategory].push(createExpenseItem(item, targetCategory, index));
      });
      return;
    }

    const targetCategory =
      normalizedCategory === "其他" || normalizedCategory === "其他工资"
        ? "其他工资"
        : normalizedCategory === "其它开支" || normalizedCategory === "其他开支"
          ? "其他开支"
          : EXPENSE_CATEGORIES.find(
              (expenseCategory) =>
                normalizeExpenseCategoryLabel(expenseCategory) === normalizedCategory,
            ) || "其他开支";

    items.forEach((item, index) => {
      expenses[targetCategory].push(createExpenseItem(item, targetCategory, index));
    });
  });

  return expenses;
}

function normalizeReportExpenses(report = {}) {
  const existingExpenses = report?.expenses && typeof report.expenses === "object"
    ? report.expenses
    : null;
  const hasExistingExpenses = existingExpenses
    ? Object.values(existingExpenses).some((items) => Array.isArray(items) && items.length > 0)
    : false;

  if (hasExistingExpenses) {
    const normalizedExpenses = createEmptyExpenses();

    EXPENSE_CATEGORIES.forEach((category) => {
      normalizedExpenses[category] = Array.isArray(existingExpenses[category])
        ? existingExpenses[category]
        : [];
    });

    return normalizedExpenses;
  }

  return buildExpensesFromCategories(Array.isArray(report?.categories) ? report.categories : []);
}

export default function PhysicalTablePanel({
  storeId,
  storeName,
  period,
  periodLabel,
  onClose,
  reportScope = "global",
  conversationId = "",
  skillId = "",
  generatedDeliverable = null,
}) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [formData, setFormData] = useState({});
  const [expenses, setExpenses] = useState({});
  const [saving, setSaving] = useState(false);
  
  const [activeTab, setActiveTab] = useState("expenses");
  const [activeCategory, setActiveCategory] = useState(EXPENSE_CATEGORIES[0]);
  const isConversationScope = reportScope === "conversation";

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true);
      try {
        const reportPath = isConversationScope
          ? `/api/parsing/history/${encodeURIComponent(conversationId)}/${encodeURIComponent(skillId)}/report`
          : `/api/financials/reports/${storeId}/${period}`;
        const res = await fetch(buildApiUrl(reportPath));
        if (res.ok) {
          const data = await res.json();
          setReport(data);
          setFormData(data.summary || {});
          setExpenses(normalizeReportExpenses(data));
        } else {
          setReport(null);
          setFormData({});
          setExpenses(createEmptyExpenses());
        }
      } catch (e) {
        console.error(e);
        setReport(null);
        setFormData({});
        setExpenses(createEmptyExpenses());
      } finally {
        setLoading(false);
      }
    };

    if (isConversationScope ? conversationId && skillId : storeId && period) {
      fetchReport();
    } else {
      setReport(null);
      setFormData({});
      setExpenses(createEmptyExpenses());
      setLoading(false);
    }
  }, [
    conversationId,
    generatedDeliverable?.fileName,
    generatedDeliverable?.generatedAt,
    isConversationScope,
    period,
    skillId,
    storeId,
  ]);

  const handleChangeBasic = (key, val) => {
    setFormData((prev) => ({ ...prev, [key]: val === "" ? "" : Number(val) }));
  };

  const handleAddExpenseItem = () => {
    const newItem = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
      name: "",
      amount: "",
      remark: ""
    };
    setExpenses(prev => ({
      ...prev,
      [activeCategory]: [...(prev[activeCategory] || []), newItem]
    }));
  };

  const updateExpenseItem = (id, field, value) => {
    setExpenses(prev => ({
      ...prev,
      [activeCategory]: prev[activeCategory].map(item => 
        item.id === id ? { ...item, [field]: value } : item
      )
    }));
  };

  const removeExpenseItem = (id) => {
    setExpenses(prev => ({
      ...prev,
      [activeCategory]: prev[activeCategory].filter(item => item.id !== id)
    }));
  };

  const calculateCategoryTotal = (cat) => {
    const items = expenses[cat] || [];
    return items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  };

  const calculateTotalExpenses = () => {
    return EXPENSE_CATEGORIES.reduce((sum, cat) => sum + calculateCategoryTotal(cat), 0);
  };

  const handleSave = async () => {
    if (isConversationScope) {
      alert("当前窗口只查看本会话生成的体质表，不会写入其他会话或全局月报。");
      return;
    }

    setSaving(true);
    try {
      // Clean up expenses before saving: convert amount to number, remove completely empty items
      const cleanedExpenses = {};
      Object.keys(expenses).forEach(cat => {
         cleanedExpenses[cat] = expenses[cat]
           .filter(item => item.name || item.amount || item.remark)
           .map(item => ({
              ...item,
              amount: item.amount === "" ? 0 : Number(item.amount)
           }));
      });

      const payload = { 
        summary: { ...report?.summary, ...formData },
        expenses: cleanedExpenses
      };
      
      const res = await fetch(buildApiUrl(`/api/financials/reports/${storeId}/${period}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      
      if (res.ok) {
        alert("保存成功");
        const fetchReportData = await fetch(buildApiUrl(`/api/financials/reports/${storeId}/${period}`));
        if (fetchReportData.ok) {
            const data = await fetchReportData.json();
            setReport(data);
            setFormData(data.summary || {});
            setExpenses(normalizeReportExpenses(data));
        }
      } else {
        alert("保存失败");
      }
    } catch {
      alert("保存出错");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (isConversationScope) {
      alert("当前窗口只查看本会话生成的体质表，如需清理请在本会话重新生成或切换会话。");
      return;
    }

    if (!window.confirm(`确定要删除 ${storeName} ${periodLabel} 的体质表吗？`)) return;
    try {
      const res = await fetch(buildApiUrl(`/api/financials/reports/${storeId}/${period}`), {
        method: "DELETE"
      });
      if (res.ok) {
        alert("删除成功");
        setReport(null);
        setFormData({});
        onClose();
      } else {
        alert("删除失败");
      }
    } catch {
      alert("删除出错");
    }
  };

  const handleDownload = () => {
    if (isConversationScope) {
      const downloadUrl = generatedDeliverable?.downloadUrl || generatedDeliverable?.previewUrl || "";

      if (!downloadUrl) {
        alert("当前会话还没有可下载的体质表。");
        return;
      }

      window.open(downloadUrl, "_blank");
      return;
    }

    window.open(buildApiUrl(`/api/financials/reports/${storeId}/${period}/download`), "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171412]/60 backdrop-blur-[2px] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[24px] w-full max-w-[1100px] h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-[#e8dcc4]/50 transform transition-all scale-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#e8dcc4]/60 bg-[#fcfbf9]">
          <div>
            <h2 className="text-[18px] font-extrabold text-[#171412] flex items-center gap-2">
              <div className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-[#171412] to-[#2c2724] shadow-sm">
                 <span className="material-symbols-outlined text-[14px] text-[#e8dcc4]">edit_document</span>
              </div>
              体质表数据核查与填报
            </h2>
            <p className="text-[12px] font-medium text-[#8c8273] mt-1 ml-9">
              {storeName} <span className="mx-1 opacity-50">|</span> {periodLabel}
            </p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex bg-[#f5f2eb] p-1 rounded-lg border border-[#e8dcc4]/40">
              <button
                onClick={() => setActiveTab('basic')}
                className={`px-4 py-1.5 text-[13px] font-bold rounded-md transition-all duration-200 flex items-center gap-2 ${activeTab === 'basic' ? 'bg-white text-[#171412] shadow-sm' : 'text-[#8c8273] hover:text-[#171412]'}`}
              >
                <span className="material-symbols-outlined text-[16px]">bar_chart</span>
                基础数据
              </button>
              <button
                onClick={() => setActiveTab('expenses')}
                className={`px-4 py-1.5 text-[13px] font-bold rounded-md transition-all duration-200 flex items-center gap-2 ${activeTab === 'expenses' ? 'bg-white text-[#171412] shadow-sm' : 'text-[#8c8273] hover:text-[#171412]'}`}
              >
                <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                开支明细
              </button>
            </div>
            
            <div className="w-[1px] h-5 bg-[#e8dcc4]/60"></div>
            
            <button
              onClick={onClose}
              className="flex size-8 items-center justify-center rounded-full bg-[#fcfaf7] border border-[#e8dcc4]/60 hover:bg-[#f5f2eb] hover:border-[#e8dcc4] text-[#8c8273] transition-all hover:text-[#171412]"
              title="关闭"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 flex overflow-hidden bg-[#fcfaf7]">
          {loading ? (
             <div className="flex-1 flex flex-col items-center justify-center text-[#8c8273]">
                <span className="material-symbols-outlined text-[40px] animate-spin mb-4 text-[#b6860c]">sync</span>
                <p className="text-[15px] font-medium text-[#171412]">正在加载体质表数据...</p>
             </div>
          ) : (
             <>
                {/* 基础数据 Tab */}
                {activeTab === 'basic' && (
                  <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                    {!report && (
                       <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-[13px] text-yellow-800 leading-relaxed flex items-start gap-2">
                          <span className="material-symbols-outlined text-[16px] text-yellow-600 mt-0.5">info</span>
                          <div>
                            {isConversationScope
                              ? "当前会话还没有生成体质表。请先在这个会话里上传并完成解析。"
                              : "当前门店该月尚未生成正式体质表数据。您可以在此手动创建或等待AI解析完成后自动填充。"}
                          </div>
                       </div>
                    )}
                    <div className="grid grid-cols-4 gap-x-4 gap-y-4">
                      {BASIC_FIELDS.map((field) => (
                        <div key={field.key} className="flex flex-col gap-1.5">
                          <label className="text-[12px] font-bold text-[#8c8273] ml-0.5">{field.label}</label>
                          <input
                            type={field.type}
                            step={field.step}
                            value={formData[field.key] ?? ""}
                            onChange={(e) => handleChangeBasic(field.key, e.target.value)}
                            className="w-full rounded-lg border border-[#e8dcc4]/60 bg-white px-3 py-2 text-[13px] text-[#171412] font-semibold outline-none transition-all focus:border-[#b6860c]/50 focus:ring-1 focus:ring-[#b6860c]/10"
                            placeholder={field.label}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 开支明细填报 Tab */}
                {activeTab === 'expenses' && (
                  <div className="flex-1 flex overflow-hidden">
                    {/* 左侧：分类列表 */}
                    <div className="w-[240px] border-r border-[#e8dcc4]/60 bg-[#fcfaf7] overflow-y-auto custom-scrollbar flex flex-col p-3 gap-1 shadow-[inset_-5px_0_15px_rgba(0,0,0,0.01)]">
                       <div className="text-[11px] font-bold text-[#8c8273] uppercase tracking-wider mb-2 px-2">开支分类</div>
                       {EXPENSE_CATEGORIES.map(cat => {
                          const total = calculateCategoryTotal(cat);
                          const isActive = activeCategory === cat;
                          return (
                            <button
                              key={cat}
                              onClick={() => setActiveCategory(cat)}
                              className={`flex items-center justify-between text-left px-3 py-2.5 rounded-lg transition-all ${
                                isActive 
                                  ? 'bg-white border border-[#b6860c]/30 shadow-sm' 
                                  : 'bg-transparent border border-transparent hover:bg-white/50 hover:border-[#e8dcc4]/40'
                              }`}
                            >
                               <span className={`text-[13px] font-bold ${isActive ? 'text-[#b6860c]' : 'text-[#171412]'}`}>{cat}</span>
                               <span className={`text-[12px] font-medium tracking-tight ${isActive ? 'text-[#171412]' : 'text-[#8c8273]'}`}>
                                 {total > 0 ? `¥${total.toLocaleString('zh-CN', {minimumFractionDigits: 0})}` : '-'}
                               </span>
                            </button>
                          )
                       })}
                    </div>
                    
                    {/* 右侧：分类明细录入 */}
                    <div className="flex-1 bg-white flex flex-col overflow-hidden relative">
                       <div className="px-6 py-4 border-b border-[#e8dcc4]/30 flex items-center justify-between z-10 bg-white/80 backdrop-blur-md">
                          <div className="flex items-center gap-3">
                             <h3 className="text-[18px] font-extrabold text-[#171412]">
                               {activeCategory}
                             </h3>
                             <span className="text-[14px] font-bold text-[#b6860c] bg-[#b6860c]/5 px-2 py-0.5 rounded-md">
                               ¥ {calculateCategoryTotal(activeCategory).toLocaleString('zh-CN', {minimumFractionDigits: 2})}
                             </span>
                          </div>
                          <button
                            onClick={handleAddExpenseItem}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#171412] hover:bg-[#b6860c] text-white rounded-lg text-[13px] font-bold transition-all shadow-sm"
                          >
                             <span className="material-symbols-outlined text-[16px]">add</span>
                             增加一项
                          </button>
                       </div>
                       
                       <div className="flex-1 overflow-y-auto custom-scrollbar z-10">
                          {(expenses[activeCategory] || []).length === 0 ? (
                             <div className="text-center py-20 text-[#8c8273]">
                                <span className="material-symbols-outlined text-[32px] text-[#e8dcc4] mb-2">inventory_2</span>
                                <p className="text-[14px] font-bold text-[#171412]">暂无细分明细</p>
                                <p className="text-[12px]">点击右上角添加，或等待 AI 系统处理</p>
                             </div>
                          ) : (
                             <div className="w-full">
                                {/* Table Header */}
                                <div className="grid grid-cols-12 gap-3 px-6 py-2 bg-[#fcfaf7] border-b border-[#e8dcc4]/40 text-[11px] font-bold text-[#8c8273] uppercase tracking-wider sticky top-0 z-20">
                                   <div className="col-span-4">细分项目名称</div>
                                   <div className="col-span-3">金额 (¥)</div>
                                   <div className="col-span-4">备注说明</div>
                                   <div className="col-span-1 text-right">操作</div>
                                </div>
                                
                                <div className="divide-y divide-[#e8dcc4]/30">
                                   {(expenses[activeCategory] || []).map((item, index) => (
                                      <div key={item.id} className="grid grid-cols-12 gap-3 px-6 py-3 items-center group hover:bg-[#fcfaf7]/50 transition-colors">
                                         <div className="col-span-4">
                                           <input
                                             type="text"
                                             value={item.name}
                                             onChange={(e) => updateExpenseItem(item.id, 'name', e.target.value)}
                                             className="w-full bg-transparent border-none p-0 text-[14px] font-medium text-[#171412] outline-none placeholder:text-[#ccc]"
                                             placeholder="输入项目名..."
                                           />
                                         </div>
                                         <div className="col-span-3">
                                           <input
                                             type="number"
                                             value={item.amount}
                                             onChange={(e) => updateExpenseItem(item.id, 'amount', e.target.value)}
                                             className="w-full bg-transparent border-none p-0 text-[14px] font-bold text-[#b6860c] outline-none placeholder:text-[#ccc]"
                                             placeholder="0.00"
                                           />
                                         </div>
                                         <div className="col-span-4">
                                           <input
                                             type="text"
                                             value={item.remark}
                                             onChange={(e) => updateExpenseItem(item.id, 'remark', e.target.value)}
                                             className="w-full bg-transparent border-none p-0 text-[13px] font-medium text-[#8c8273] outline-none placeholder:text-[#ccc]"
                                             placeholder="添加备注..."
                                           />
                                         </div>
                                         <div className="col-span-1 flex justify-end">
                                           <button
                                             onClick={() => removeExpenseItem(item.id)}
                                             className="size-7 flex items-center justify-center rounded-md text-[#ccc] hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                                             title="删除"
                                           >
                                             <span className="material-symbols-outlined text-[16px]">close</span>
                                           </button>
                                         </div>
                                      </div>
                                   ))}
                                </div>
                             </div>
                          )}
                       </div>
                    </div>
                  </div>
                )}
             </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#e8dcc4]/60 bg-white relative z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-6">
             <div className="flex flex-col">
                <span className="text-[11px] font-bold text-[#8c8273] uppercase tracking-wider">本月开支总计</span>
                <span className="text-[20px] font-extrabold text-[#171412] tracking-tight">
                  <span className="text-[14px] text-[#b6860c] mr-1">¥</span>
                  {calculateTotalExpenses().toLocaleString('zh-CN', {minimumFractionDigits:2})}
                </span>
             </div>
          </div>
          
          <div className="flex gap-3 items-center">
            {report && (
              <>
                 <button
                   onClick={handleDelete}
                   className="px-4 py-2 flex items-center gap-2 rounded-lg text-[13px] font-bold text-red-600 bg-white border border-red-200 hover:bg-red-50 transition-colors"
                 >
                   <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                   清除
                 </button>
                 <button
                   onClick={handleDownload}
                   className="px-4 py-2 flex items-center gap-2 rounded-lg text-[13px] font-bold text-[#171412] bg-[#fcfaf7] border border-[#e8dcc4] hover:bg-[#f5f2eb] transition-colors"
                 >
                   <span className="material-symbols-outlined text-[16px]">download</span>
                   下载
                 </button>
              </>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-6 py-2.5 rounded-lg text-[14px] font-bold text-white bg-gradient-to-r from-[#171412] to-[#2c2724] hover:from-[#b6860c] hover:to-[#d4a373] transition-all shadow-sm hover:shadow-md flex items-center gap-2 min-w-[120px] justify-center disabled:opacity-70"
            >
              {saving ? (
                 <span className="material-symbols-outlined text-[18px] animate-spin">sync</span>
              ) : (
                 <span className="material-symbols-outlined text-[18px]">task_alt</span>
              )}
              {saving ? '正在保存...' : '保存填报'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
