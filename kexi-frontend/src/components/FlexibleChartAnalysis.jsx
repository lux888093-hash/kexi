import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart
} from 'recharts';

const formatCurrency = (value) => {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
};

const COLORS = ['#5c829e', '#d96e42', '#d4a04c', '#508b79', '#c66f70', '#8b739e', '#45637a', '#a88661', '#759068', '#4b6e56', '#a16d5d', '#5a4f66', '#d69e4e'];

const INCOME_CATEGORIES = ['微信银联支付宝', '现金', '美团', '抖音'];
const EXPENSE_CATEGORIES = ['头疗师工资', '管理工资', '其他工资', '付管理公司', '门店宿舍', '租金', '水电', '生活费', '增值服务', '消耗品', '手续费', '工程维修', '其他开支'];

function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 rounded-xl border border-black/5 shadow-lg">
        <p className="font-bold text-sm text-gray-800 mb-2">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-sm flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.payload.fill }}></span>
            <span className="text-gray-600">{entry.name}:</span>
            <span className="font-bold text-gray-900">{formatCurrency(entry.value)}</span>
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function FlexibleChartAnalysis({ stores }) {
  const [mode, setMode] = useState('single'); // 'single' | 'multi'
  
  // Single Store State
  const [singleStoreId, setSingleStoreId] = useState('');
  const [singleMetricType, setSingleMetricType] = useState('income'); // 'income' | 'expense' | 'both'
  const [singleChartType, setSingleChartType] = useState('bar'); // 'bar' | 'line' | 'pie' | 'composed'
  
  // Multi Store State
  const [multiStoreIds, setMultiStoreIds] = useState([]);
  const [multiMetricType, setMultiMetricType] = useState('income'); // 'income' | 'expense'
  const [multiSubCategory, setMultiSubCategory] = useState('合计'); // '合计' or specific
  const [multiChartType, setMultiChartType] = useState('bar'); // 'bar' | 'line'

  // Initialize defaults
  const loadedStores = (stores || []).filter(s => s.isLoaded);
  if (loadedStores.length > 0 && !singleStoreId) {
    setSingleStoreId(loadedStores[0].storeId);
    setMultiStoreIds([loadedStores[0].storeId]);
  }

  const toggleMultiStore = (storeId) => {
    setMultiStoreIds(prev => 
      prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId]
    );
  };

  const getSubCategoryValue = (store, type, subCategory) => {
    if (type === 'income') {
      if (subCategory === '合计') return store.revenue || 0;
      const channel = (store.channels || []).find(c => c.name.includes(subCategory) || subCategory.includes(c.name));
      return channel ? channel.value : 0;
    } else {
      if (subCategory === '合计') return store.cost || 0;
      const category = (store.costBreakdown || []).find(c => c.name.includes(subCategory) || subCategory.includes(c.name));
      return category ? category.value : 0;
    }
  };

  const singleStoreData = useMemo(() => {
    if (mode !== 'single' || !singleStoreId) return [];
    const store = loadedStores.find(s => s.storeId === singleStoreId);
    if (!store) return [];

    let data = [];
    if (singleMetricType === 'income' || singleMetricType === 'both') {
      INCOME_CATEGORIES.forEach(cat => {
        data.push({
          name: cat,
          [singleMetricType === 'both' ? '收入' : '金额']: getSubCategoryValue(store, 'income', cat),
          type: '收入'
        });
      });
    }
    if (singleMetricType === 'expense' || singleMetricType === 'both') {
      EXPENSE_CATEGORIES.forEach(cat => {
        data.push({
          name: cat,
          [singleMetricType === 'both' ? '支出' : '金额']: getSubCategoryValue(store, 'expense', cat),
          type: '支出'
        });
      });
    }

    if (singleMetricType === 'both' && (singleChartType === 'pie')) {
      // For pie, we need a single value key
      return data.map(item => ({
        ...item,
        金额: item.收入 !== undefined ? item.收入 : item.支出
      })).filter(d => d.金额 > 0);
    }

    return data;
  }, [mode, singleStoreId, singleMetricType, singleChartType, loadedStores]);

  const multiStoreData = useMemo(() => {
    if (mode !== 'multi' || multiStoreIds.length === 0) return [];
    
    return multiStoreIds.map(id => {
      const store = loadedStores.find(s => s.storeId === id);
      return {
        storeName: store ? store.storeName.replace(/店$/, "") : id,
        金额: store ? getSubCategoryValue(store, multiMetricType, multiSubCategory) : 0
      };
    });
  }, [mode, multiStoreIds, multiMetricType, multiSubCategory, loadedStores]);

  const renderSingleStoreChart = () => {
    if (!singleStoreData.length) return <div className="flex h-full items-center justify-center text-slate-400">暂无数据</div>;

    const hasBoth = singleMetricType === 'both';
    
    if (singleChartType === 'pie') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={singleStoreData.filter(d => (d.金额 || d.收入 || d.支出) > 0)} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={2} dataKey={hasBoth ? '金额' : '金额'}>
              {singleStoreData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      );
    }

    if (singleChartType === 'composed') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={singleStoreData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e0d8" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} angle={hasBoth ? -45 : 0} textAnchor={hasBoth ? "end" : "middle"} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v).replace('¥', '')} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            {hasBoth ? (
              <>
                <Bar dataKey="收入" fill="#d96e42" radius={[4, 4, 0, 0]} barSize={20} />
                <Line type="monotone" dataKey="支出" stroke="#5c829e" strokeWidth={2} dot={{ r: 4 }} />
              </>
            ) : (
              <>
                <Bar dataKey="金额" fill="#d96e42" radius={[4, 4, 0, 0]} barSize={32} />
                <Line type="monotone" dataKey="金额" stroke="#5c829e" strokeWidth={2} dot={{ r: 4 }} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    const ChartComponent = singleChartType === 'line' ? LineChart : BarChart;
    const DataComponent = singleChartType === 'line' ? Line : Bar;

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={singleStoreData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e0d8" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v).replace('¥', '')} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {hasBoth ? (
            <>
              <DataComponent type="monotone" dataKey="收入" fill="#d96e42" stroke="#d96e42" strokeWidth={2} radius={[4, 4, 0, 0]} />
              <DataComponent type="monotone" dataKey="支出" fill="#5c829e" stroke="#5c829e" strokeWidth={2} radius={[4, 4, 0, 0]} />
            </>
          ) : (
            <DataComponent type="monotone" dataKey="金额" fill="#d96e42" stroke="#d96e42" strokeWidth={2} radius={[4, 4, 0, 0]} />
          )}
        </ChartComponent>
      </ResponsiveContainer>
    );
  };

  const renderMultiStoreChart = () => {
    if (!multiStoreData.length) return <div className="flex h-full items-center justify-center text-slate-400">暂无数据</div>;

    const ChartComponent = multiChartType === 'line' ? LineChart : BarChart;
    const DataComponent = multiChartType === 'line' ? Line : Bar;

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={multiStoreData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e0d8" />
          <XAxis dataKey="storeName" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} dy={10} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v).replace('¥', '')} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          <DataComponent type="monotone" dataKey="金额" name={multiSubCategory} fill="#d96e42" stroke="#d96e42" strokeWidth={2} radius={[4, 4, 0, 0]} barSize={32}>
            {multiChartType === 'bar' && multiStoreData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </DataComponent>
        </ChartComponent>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="bg-[#fcfaf7] rounded-[24px] p-6 shadow-[0_4px_24px_rgba(22,20,18,0.03)] border border-black/5 mt-6">
      <div className="flex items-center gap-2 mb-6 border-b border-black/5 pb-4">
        <span className="material-symbols-outlined text-[#d96e42]">analytics</span>
        <h3 className="text-lg font-bold text-[#171412]">多维灵活分析与跨店筛查</h3>
      </div>

      <div className="flex flex-col gap-4">
        {/* Filter Builder UI */}
        <div className="bg-white p-4 rounded-[20px] border border-black/5 shadow-sm space-y-4">
          
          {/* Level 1: Analysis Mode */}
          <div className="flex items-center gap-4">
            <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">模式</span>
            <div className="flex bg-[#f2ebe1] p-1 rounded-lg">
              <button onClick={() => setMode('single')} className={cn("px-4 py-1.5 text-sm font-bold rounded-md transition-all", mode === 'single' ? "bg-white text-[#d96e42] shadow-sm" : "text-slate-600 hover:text-slate-900")}>单店分析</button>
              <button onClick={() => setMode('multi')} className={cn("px-4 py-1.5 text-sm font-bold rounded-md transition-all", mode === 'multi' ? "bg-white text-[#d96e42] shadow-sm" : "text-slate-600 hover:text-slate-900")}>多店分析</button>
            </div>
          </div>

          {mode === 'single' ? (
            <>
              {/* Single Store Filters */}
              <div className="flex items-center gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">门店</span>
                <div className="flex flex-wrap gap-2">
                  <select 
                    value={singleStoreId} 
                    onChange={(e) => setSingleStoreId(e.target.value)}
                    className="border border-black/10 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 bg-[#fbf8f4] outline-none focus:border-[#d96e42]"
                  >
                    {loadedStores.map(s => <option key={s.storeId} value={s.storeId}>{s.storeName}</option>)}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">指标</span>
                <div className="flex flex-wrap gap-2">
                  {[{id: 'income', label: '收入'}, {id: 'expense', label: '支出'}, {id: 'both', label: '收入和支出'}].map(opt => (
                    <button key={opt.id} onClick={() => setSingleMetricType(opt.id)} className={cn("px-3 py-1 text-[13px] font-medium rounded-full border transition-all", singleMetricType === opt.id ? "bg-[#d96e42]/10 border-[#d96e42] text-[#d96e42]" : "border-black/5 bg-white text-slate-600 hover:bg-slate-50")}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">图表</span>
                <div className="flex flex-wrap gap-2">
                  {[{id: 'bar', label: '柱状图'}, {id: 'line', label: '折线图'}, {id: 'pie', label: '饼图'}, {id: 'composed', label: '柱状图和折线图'}].map(opt => (
                    <button key={opt.id} onClick={() => setSingleChartType(opt.id)} className={cn("px-3 py-1 text-[13px] font-medium rounded-full border transition-all", singleChartType === opt.id ? "bg-[#5c829e]/10 border-[#5c829e] text-[#5c829e]" : "border-black/5 bg-white text-slate-600 hover:bg-slate-50")}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Multi Store Filters */}
              <div className="flex items-start gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider mt-1">门店</span>
                <div className="flex flex-wrap gap-2 flex-1">
                  {loadedStores.map(s => (
                    <button 
                      key={s.storeId} 
                      onClick={() => toggleMultiStore(s.storeId)}
                      className={cn("px-3 py-1 text-[13px] font-medium rounded-full border transition-all flex items-center gap-1", multiStoreIds.includes(s.storeId) ? "bg-[#171412] border-[#171412] text-white" : "border-black/10 bg-white text-slate-600 hover:bg-slate-50")}
                    >
                      {multiStoreIds.includes(s.storeId) && <span className="material-symbols-outlined text-[14px]">check</span>}
                      {s.storeName}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">指标</span>
                <div className="flex flex-wrap gap-2">
                  {[{id: 'income', label: '收入'}, {id: 'expense', label: '支出'}].map(opt => (
                    <button key={opt.id} onClick={() => { setMultiMetricType(opt.id); setMultiSubCategory('合计'); }} className={cn("px-3 py-1 text-[13px] font-medium rounded-full border transition-all", multiMetricType === opt.id ? "bg-[#d96e42]/10 border-[#d96e42] text-[#d96e42]" : "border-black/5 bg-white text-slate-600 hover:bg-slate-50")}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">细分项</span>
                <div className="flex flex-wrap gap-2">
                  <select 
                    value={multiSubCategory} 
                    onChange={(e) => setMultiSubCategory(e.target.value)}
                    className="border border-black/10 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 bg-[#fbf8f4] outline-none focus:border-[#d96e42]"
                  >
                    <option value="合计">合计</option>
                    {(multiMetricType === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">图表</span>
                <div className="flex flex-wrap gap-2">
                  {[{id: 'bar', label: '柱状图'}, {id: 'line', label: '折线图'}].map(opt => (
                    <button key={opt.id} onClick={() => setMultiChartType(opt.id)} className={cn("px-3 py-1 text-[13px] font-medium rounded-full border transition-all", multiChartType === opt.id ? "bg-[#5c829e]/10 border-[#5c829e] text-[#5c829e]" : "border-black/5 bg-white text-slate-600 hover:bg-slate-50")}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Chart Render Area */}
        <div className="bg-white rounded-[20px] p-5 border border-black/5 shadow-sm mt-2 h-[380px]">
          {mode === 'single' ? renderSingleStoreChart() : renderMultiStoreChart()}
        </div>
      </div>
    </div>
  );
}
