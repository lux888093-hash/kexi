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

export default function PhysicalTablePanel({ storeId, storeName, period, periodLabel, onClose }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  
  const [formData, setFormData] = useState({});
  const [expenses, setExpenses] = useState({});
  const [saving, setSaving] = useState(false);
  
  const [activeTab, setActiveTab] = useState("expenses");
  const [activeCategory, setActiveCategory] = useState(EXPENSE_CATEGORIES[0]);

  useEffect(() => {
    const fetchReport = async () => {
      setLoading(true);
      try {
        const res = await fetch(buildApiUrl(`/api/financials/reports/${storeId}/${period}`));
        if (res.ok) {
          const data = await res.json();
          setReport(data);
          setFormData(data.summary || {});
          
          // Ensure expenses object is initialized for all categories
          const loadedExpenses = data.expenses || {};
          const initialExpenses = {};
          EXPENSE_CATEGORIES.forEach(cat => {
             initialExpenses[cat] = loadedExpenses[cat] || [];
          });
          setExpenses(initialExpenses);
        } else {
          setReport(null);
          setFormData({});
          
          const initialExpenses = {};
          EXPENSE_CATEGORIES.forEach(cat => { initialExpenses[cat] = []; });
          setExpenses(initialExpenses);
        }
      } catch (e) {
        console.error(e);
        setReport(null);
      } finally {
        setLoading(false);
      }
    };

    if (storeId && period) {
      fetchReport();
    }
  }, [storeId, period]);

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
            const loadedExpenses = data.expenses || {};
            const initialExpenses = {};
            EXPENSE_CATEGORIES.forEach(cat => { initialExpenses[cat] = loadedExpenses[cat] || []; });
            setExpenses(initialExpenses);
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
    window.open(buildApiUrl(`/api/financials/reports/${storeId}/${period}/download`), "_blank");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#171412]/60 backdrop-blur-[2px] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-[24px] w-full max-w-[1100px] h-[85vh] flex flex-col shadow-2xl overflow-hidden border border-[#e8dcc4]/50 transform transition-all scale-100">
        
        {/* Header */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-[#e8dcc4]/60 bg-[#fcfbf9]">
          <div>
            <h2 className="text-[20px] font-extrabold text-[#171412] flex items-center gap-2">
              <div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-[#171412] to-[#2c2724] shadow-sm">
                 <span className="material-symbols-outlined text-[16px] text-[#e8dcc4]">edit_document</span>
              </div>
              体质表数据核查与填报
            </h2>
            <p className="text-[13px] font-medium text-[#8c8273] mt-1.5 ml-10">
              {storeName} <span className="mx-1.5 opacity-50">|</span> {periodLabel}
            </p>
          </div>
          
          <div className="flex items-center gap-5">
            <div className="flex bg-[#f5f2eb] p-1.5 rounded-xl border border-[#e8dcc4]/40">
              <button
                onClick={() => setActiveTab('basic')}
                className={`px-5 py-2 text-[14px] font-bold rounded-lg transition-all duration-200 flex items-center gap-2 ${activeTab === 'basic' ? 'bg-white text-[#171412] shadow-sm ring-1 ring-[#e8dcc4]/50' : 'text-[#8c8273] hover:text-[#171412]'}`}
              >
                <span className="material-symbols-outlined text-[18px]">bar_chart</span>
                基础数据
              </button>
              <button
                onClick={() => setActiveTab('expenses')}
                className={`px-5 py-2 text-[14px] font-bold rounded-lg transition-all duration-200 flex items-center gap-2 ${activeTab === 'expenses' ? 'bg-white text-[#171412] shadow-sm ring-1 ring-[#e8dcc4]/50' : 'text-[#8c8273] hover:text-[#171412]'}`}
              >
                <span className="material-symbols-outlined text-[18px]">receipt_long</span>
                开支明细填报
              </button>
            </div>
            
            <div className="w-[1px] h-6 bg-[#e8dcc4]/60"></div>
            
            <button
              onClick={onClose}
              className="flex size-10 items-center justify-center rounded-full bg-[#fcfaf7] border border-[#e8dcc4]/60 hover:bg-[#f5f2eb] hover:border-[#e8dcc4] text-[#8c8273] transition-all hover:text-[#171412]"
              title="关闭"
            >
              <span className="material-symbols-outlined text-[20px]">close</span>
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
                  <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                    {!report && (
                       <div className="mb-6 rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-[13px] text-yellow-800 leading-relaxed flex items-start gap-3">
                          <span className="material-symbols-outlined text-[18px] text-yellow-600">info</span>
                          <div>当前门店该月尚未生成正式体质表数据。您可以在此手动创建或等待AI解析完成后自动填充。</div>
                       </div>
                    )}
                    <div className="grid grid-cols-3 gap-x-8 gap-y-6">
                      {BASIC_FIELDS.map((field) => (
                        <div key={field.key} className="flex flex-col gap-2">
                          <label className="text-[13px] font-bold text-[#8c8273] ml-1">{field.label}</label>
                          <div className="relative flex items-center">
                            <input
                              type={field.type}
                              step={field.step}
                              value={formData[field.key] ?? ""}
                              onChange={(e) => handleChangeBasic(field.key, e.target.value)}
                              className="w-full rounded-xl border border-[#e8dcc4]/60 bg-white px-4 py-3 text-[14px] text-[#171412] font-semibold outline-none transition-all focus:border-[#b6860c]/50 focus:ring-2 focus:ring-[#b6860c]/10 shadow-sm"
                              placeholder={`输入${field.label}`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 开支明细填报 Tab */}
                {activeTab === 'expenses' && (
                  <div className="flex-1 flex overflow-hidden">
                    {/* 左侧：分类列表 */}
                    <div className="w-[280px] border-r border-[#e8dcc4]/60 bg-[#fcfaf7] overflow-y-auto custom-scrollbar flex flex-col p-4 gap-2 shadow-[inset_-5px_0_15px_rgba(0,0,0,0.01)]">
                       <div className="text-[12px] font-bold text-[#8c8273] uppercase tracking-wider mb-2 px-2">开支分类汇总</div>
                       {EXPENSE_CATEGORIES.map(cat => {
                          const total = calculateCategoryTotal(cat);
                          const isActive = activeCategory === cat;
                          return (
                            <button
                              key={cat}
                              onClick={() => setActiveCategory(cat)}
                              className={`flex items-center justify-between text-left px-4 py-3.5 rounded-xl transition-all ${
                                isActive 
                                  ? 'bg-gradient-to-r from-[#b6860c]/10 to-[#b6860c]/5 border border-[#b6860c]/30 shadow-sm' 
                                  : 'bg-transparent border border-transparent hover:bg-white hover:border-[#e8dcc4]/50'
                              }`}
                            >
                               <span className={`text-[14px] font-bold ${isActive ? 'text-[#b6860c]' : 'text-[#171412]'}`}>{cat}</span>
                               <span className={`text-[13px] font-semibold tracking-tight ${isActive ? 'text-[#171412]' : 'text-[#8c8273]'}`}>
                                 ¥ {total.toLocaleString('zh-CN', {minimumFractionDigits: 2})}
                               </span>
                            </button>
                          )
                       })}
                    </div>
                    
                    {/* 右侧：分类明细录入 */}
                    <div className="flex-1 bg-white flex flex-col overflow-hidden relative">
                       <div className="absolute top-0 right-0 w-[400px] h-[300px] bg-gradient-to-bl from-[#f5f2eb] to-transparent opacity-50 pointer-events-none rounded-bl-full"></div>
                       
                       <div className="px-8 py-6 border-b border-[#e8dcc4]/30 flex items-center justify-between z-10 bg-white/80 backdrop-blur-md">
                          <div>
                             <h3 className="text-[22px] font-extrabold text-[#171412] flex items-center gap-2">
                               {activeCategory}
                             </h3>
                             <p className="text-[13px] text-[#8c8273] mt-1">
                               AI 会自动提取此项明细，您也可以手动补充或修改。
                             </p>
                          </div>
                          <button
                            onClick={handleAddExpenseItem}
                            className="flex items-center gap-2 px-4 py-2 bg-[#171412] hover:bg-[#b6860c] text-white rounded-xl text-[14px] font-bold transition-all shadow-md hover:shadow-lg"
                          >
                             <span className="material-symbols-outlined text-[18px]">add_circle</span>
                             添加细分项
                          </button>
                       </div>
                       
                       <div className="flex-1 overflow-y-auto custom-scrollbar p-8 z-10">
                          <div className="space-y-4">
                             {(expenses[activeCategory] || []).length === 0 ? (
                                <div className="text-center py-20 text-[#8c8273]">
                                   <div className="size-20 bg-[#f5f2eb] rounded-3xl mx-auto flex items-center justify-center mb-6 shadow-inner">
                                      <span className="material-symbols-outlined text-[40px] text-[#e8dcc4]">receipt_long</span>
                                   </div>
                                   <p className="text-[15px] font-bold text-[#171412] mb-1">暂无细分项</p>
                                   <p className="text-[13px]">点击右上角添加，或等待 AI 系统处理源文件</p>
                                </div>
                             ) : (
                                (expenses[activeCategory] || []).map((item, index) => (
                                   <div key={item.id} className="flex items-start gap-5 p-5 rounded-2xl border border-[#e8dcc4]/60 bg-[#fcfaf7] group hover:border-[#b6860c]/30 hover:shadow-sm transition-all relative overflow-hidden">
                                      <div className="absolute top-0 left-0 w-1 h-full bg-[#e8dcc4]/60 group-hover:bg-[#b6860c]/50 transition-colors"></div>
                                      <div className="flex-1 grid grid-cols-12 gap-5">
                                        <div className="col-span-4">
                                          <label className="text-[12px] font-bold text-[#8c8273] mb-2 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">label</span> 细分项名称</label>
                                          <input
                                            type="text"
                                            value={item.name}
                                            onChange={(e) => updateExpenseItem(item.id, 'name', e.target.value)}
                                            className="w-full bg-white border border-[#e8dcc4] rounded-xl px-4 py-2.5 text-[14px] font-medium text-[#171412] outline-none transition-all focus:border-[#b6860c]/50 focus:ring-2 focus:ring-[#b6860c]/10"
                                            placeholder="例如：提成 / 电费"
                                          />
                                        </div>
                                        <div className="col-span-3">
                                          <label className="text-[12px] font-bold text-[#8c8273] mb-2 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">payments</span> 金额 (¥)</label>
                                          <input
                                            type="number"
                                            value={item.amount}
                                            onChange={(e) => updateExpenseItem(item.id, 'amount', e.target.value)}
                                            className="w-full bg-white border border-[#e8dcc4] rounded-xl px-4 py-2.5 text-[14px] font-bold text-[#b6860c] outline-none transition-all focus:border-[#b6860c]/50 focus:ring-2 focus:ring-[#b6860c]/10"
                                            placeholder="0.00"
                                          />
                                        </div>
                                        <div className="col-span-5">
                                          <label className="text-[12px] font-bold text-[#8c8273] mb-2 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">notes</span> 备注说明</label>
                                          <input
                                            type="text"
                                            value={item.remark}
                                            onChange={(e) => updateExpenseItem(item.id, 'remark', e.target.value)}
                                            className="w-full bg-white border border-[#e8dcc4] rounded-xl px-4 py-2.5 text-[14px] font-medium text-[#171412] outline-none transition-all focus:border-[#b6860c]/50 focus:ring-2 focus:ring-[#b6860c]/10"
                                            placeholder="选填补充信息..."
                                          />
                                        </div>
                                      </div>
                                      <button
                                        onClick={() => removeExpenseItem(item.id)}
                                        className="mt-8 flex size-9 items-center justify-center rounded-xl bg-red-50 text-red-400 hover:text-red-600 hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-all border border-red-100 shrink-0"
                                        title="删除此项"
                                      >
                                        <span className="material-symbols-outlined text-[18px]">delete</span>
                                      </button>
                                   </div>
                                ))
                             )}
                          </div>
                       </div>
                    </div>
                  </div>
                )}
             </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-8 py-5 border-t border-[#e8dcc4]/60 bg-white relative z-20 shadow-[0_-10px_20px_rgba(0,0,0,0.02)]">
          <div className="flex items-center gap-6">
             <div className="flex flex-col">
                <span className="text-[12px] font-bold text-[#8c8273] uppercase tracking-wider">本月开支总计</span>
                <span className="text-[24px] font-extrabold text-[#171412] tracking-tight">
                  <span className="text-[16px] text-[#b6860c] mr-1">¥</span>
                  {calculateTotalExpenses().toLocaleString('zh-CN', {minimumFractionDigits:2})}
                </span>
             </div>
          </div>
          
          <div className="flex gap-4 items-center">
            {report && (
              <>
                 <button
                   onClick={handleDelete}
                   className="px-5 py-2.5 flex items-center gap-2 rounded-xl text-[14px] font-bold text-red-600 bg-white border border-red-200 hover:bg-red-50 transition-colors"
                 >
                   <span className="material-symbols-outlined text-[18px]">delete_sweep</span>
                   清除表单
                 </button>
                 <button
                   onClick={handleDownload}
                   className="px-5 py-2.5 flex items-center gap-2 rounded-xl text-[14px] font-bold text-[#171412] bg-[#fcfaf7] border border-[#e8dcc4] hover:bg-[#f5f2eb] transition-colors"
                 >
                   <span className="material-symbols-outlined text-[18px]">download</span>
                   下载报表
                 </button>
              </>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-8 py-3 rounded-xl text-[15px] font-bold text-white bg-gradient-to-r from-[#171412] to-[#2c2724] hover:from-[#b6860c] hover:to-[#d4a373] transition-all shadow-md hover:shadow-lg flex items-center gap-2 min-w-[140px] justify-center disabled:opacity-70"
            >
              {saving ? (
                 <span className="material-symbols-outlined text-[20px] animate-spin">sync</span>
              ) : (
                 <span className="material-symbols-outlined text-[20px]">task_alt</span>
              )}
              {saving ? '正在保存...' : '保存填报数据'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
