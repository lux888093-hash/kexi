import React, { useState, useMemo } from 'react';
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, ReferenceLine
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
const EXPENSE_CATEGORIES = ['头疗师工资', '管理工资', '其他工资', '付管理公司', '门店宿舍租金', '水电', '生活费', '增值服务', '消耗品', '手续费', '工程维修', '其他开支'];

function cn(...classes) {
  return classes.filter(Boolean).join(' ');
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 rounded-xl border border-black/5 shadow-lg">
        <p className="font-bold text-sm text-gray-800 mb-2">{label}</p>
        {payload.map((entry, index) => {
          const isRatio = entry.payload?._isRatio || entry.dataKey === '比例';
          const value = isRatio ? `${Number(entry.value).toFixed(2)}%` : formatCurrency(entry.value);
          return (
            <div key={index} className="mb-1 last:mb-0">
              <p className="text-sm flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.payload.fill }}></span>
                <span className="text-gray-600">{entry.name}:</span>
                <span className="font-bold text-gray-900">{value}</span>
              </p>
              {isRatio && entry.payload?._expense !== undefined && (
                <p className="text-[10px] text-gray-400 ml-4">
                  (开支 {formatCurrency(entry.payload._expense)} / 产值 {formatCurrency(entry.payload._revenue)})
                </p>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  return null;
};

const RADIAN = Math.PI / 180;
const renderCustomizedLabel = ({ cx, cy, midAngle, innerRadius, outerRadius, percent, index, name }) => {
  if (percent < 0.02) return null; // Don't show label for very small slices
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5 + 40;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  const textAnchor = x > cx ? 'start' : 'end';

  return (
    <text x={x} y={y} fill={COLORS[index % COLORS.length]} textAnchor={textAnchor} dominantBaseline="central" className="text-[11px] font-bold">
      {`${name} ${(percent * 100).toFixed(1)}%`}
    </text>
  );
};

export default function FlexibleChartAnalysis({ stores }) {
  const [mode, setMode] = useState('single'); // 'single' | 'multi'
  
  // Single Store State
  const [singleStoreId, setSingleStoreId] = useState('');
  const [singleMetricType, setSingleMetricType] = useState('income'); // 'income' | 'expense' | 'both'
  const [singleChartType, setSingleChartType] = useState('bar'); // 'bar' | 'line' | 'pie' | 'composed'
  const [singleExpenseCategory, setSingleExpenseCategory] = useState('所有大类'); // '所有大类' or specific category
  
  // Multi Store State
  const [multiStoreIds, setMultiStoreIds] = useState([]);
  const [multiMetricType, setMultiMetricType] = useState('income'); // 'income' | 'expense'
  const [multiSubCategory, setMultiSubCategory] = useState('合计'); // '合计' or specific
  const [multiChartType, setMultiChartType] = useState('bar'); // 'bar' | 'line'
  const [multiShowAverageLine, setMultiShowAverageLine] = useState(false);

  // Initialize defaults
  const loadedStores = useMemo(() => (stores || []).filter(s => s.isLoaded), [stores]);
  
  React.useEffect(() => {
    if (loadedStores.length > 0) {
      if (!singleStoreId) setSingleStoreId(loadedStores[0].storeId);
      if (multiStoreIds.length === 0) setMultiStoreIds(loadedStores.map(s => s.storeId));
    }
  }, [loadedStores, singleStoreId, multiStoreIds.length]);

  const toggleMultiStore = (storeId) => {
    setMultiStoreIds(prev => 
      prev.includes(storeId) ? prev.filter(id => id !== storeId) : [...prev, storeId]
    );
  };

  const getSubCategoryValue = (store, type, subCategory) => {
    if (!store) return 0;
    if (type === 'income') {
      if (subCategory === '合计') return store.revenue || 0;
      const channel = (store.channels || []).find(c => 
        c.name === subCategory || c.name.includes(subCategory) || subCategory.includes(c.name)
      );
      return channel ? channel.value : 0;
    } else {
      if (subCategory === '合计') return store.cost || 0;
      
      // Special case for combined Rent and Dormitory
      if (subCategory === '门店宿舍租金') {
        const dormitory = (store.costBreakdown || []).find(c => 
          c.name.includes('宿舍') || c.name.includes('门店宿舍')
        )?.value || 0;
        const rent = (store.costBreakdown || []).find(c => 
          c.name.includes('租金') || c.name.includes('房租')
        )?.value || 0;
        return dormitory + rent;
      }

      // First, try exact match in costBreakdown (top-level category)
      const exactCategory = (store.costBreakdown || []).find(c => c.name === subCategory);
      if (exactCategory) return exactCategory.value;

      // If not an exact category, look for it as an item or fuzzy match
      const item = (store.allCostItems || []).find(c => c.name === subCategory || c.name.includes(subCategory) || subCategory.includes(c.name)) || 
                   (store.costBreakdown || []).find(c => c.name.includes(subCategory) || subCategory.includes(c.name));
      return item ? item.value : 0;
    }
  };

  const calculateAverage = (data, key) => {
    if (!data || data.length === 0) return 0;
    const sum = data.reduce((acc, curr) => acc + (curr[key] || 0), 0);
    return sum / data.length;
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
      if (singleMetricType === 'expense' && singleExpenseCategory !== '所有大类') {
        const detailedItems = (store.allCostItems || []).filter(item => {
          if (singleExpenseCategory === '门店宿舍租金') {
            return item.categoryName === '租金' || item.categoryName === '门店宿舍' || 
                   item.name.includes('租金') || item.name.includes('宿舍');
          }
          return item.categoryName === singleExpenseCategory || item.name.includes(singleExpenseCategory);
        });
        
        if (detailedItems.length > 0) {
          detailedItems.forEach(item => {
            data.push({
              name: item.name,
              金额: item.value,
              type: '支出'
            });
          });
        } else {
          data.push({
            name: singleExpenseCategory,
            金额: getSubCategoryValue(store, 'expense', singleExpenseCategory),
            type: '支出'
          });
        }
      } else {
        EXPENSE_CATEGORIES.forEach(cat => {
          data.push({
            name: cat,
            [singleMetricType === 'both' ? '支出' : '金额']: getSubCategoryValue(store, 'expense', cat),
            type: '支出'
          });
        });
      }
    }

    if (singleMetricType === 'both' && (singleChartType === 'pie')) {
      // For pie, we need a single value key
      return data.map(item => ({
        ...item,
        金额: item.收入 !== undefined ? item.收入 : item.支出
      })).filter(d => d.金额 > 0);
    }

    return data;
  }, [mode, singleStoreId, singleMetricType, singleChartType, singleExpenseCategory, loadedStores]);

  const multiStoreData = useMemo(() => {
    if (mode !== 'multi' || multiStoreIds.length === 0) return [];
    
    const data = multiStoreIds.map(id => {
      const store = loadedStores.find(s => s.storeId === id);
      const storeName = store ? store.storeName.replace(/店$/, "") : id;

      if (multiMetricType === 'both') {
        return {
          storeName,
          收入: store ? getSubCategoryValue(store, 'income', multiSubCategory) : 0,
          支出: store ? getSubCategoryValue(store, 'expense', multiSubCategory) : 0,
        };
      }

      if (multiMetricType === 'expense_ratio') {
        const expense = store ? getSubCategoryValue(store, 'expense', multiSubCategory) : 0;
        // Use recognized revenue (核算总实收) as requested by user
        const denominator = store ? (store.revenue || 0) : 0;
        const ratio = denominator > 0 ? (expense / denominator) * 100 : 0;
        return {
          storeName,
          金额: ratio,
          _isRatio: true,
          _expense: expense,
          _revenue: denominator
        };
      }

      return {
        storeName,
        金额: store ? getSubCategoryValue(store, multiMetricType, multiSubCategory) : 0
      };
    });

    // Always sort by value (rank) for multi-store comparison as requested
    return data.sort((a, b) => {
      const valA = a.金额 !== undefined ? a.金额 : (a.收入 || 0);
      const valB = b.金额 !== undefined ? b.金额 : (b.收入 || 0);
      return valB - valA;
    });
  }, [mode, multiStoreIds, multiMetricType, multiSubCategory, loadedStores]);

  const renderSingleStoreChart = () => {
    if (!singleStoreData.length) return <div className="flex h-full items-center justify-center text-slate-400">暂无数据</div>;

    const hasBoth = singleMetricType === 'both';
    
    if (singleChartType === 'pie') {
      const pieData = singleStoreData.filter(d => (d.金额 || d.收入 || d.支出) > 0);
      return (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie 
              data={pieData} 
              cx="50%" 
              cy="50%" 
              innerRadius={70} 
              outerRadius={110} 
              paddingAngle={2} 
              dataKey={hasBoth ? '金额' : '金额'}
              label={renderCustomizedLabel}
              labelLine={false}
              stroke="none"
            >
              {pieData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              verticalAlign="bottom" 
              align="center" 
              iconType="circle" 
              iconSize={8}
              wrapperStyle={{ fontSize: '12px', fontWeight: '600', paddingTop: '20px', color: '#64748b' }} 
            />
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
            <Legend 
              verticalAlign="top" 
              align="right" 
              iconType="circle" 
              iconSize={8}
              wrapperStyle={{ fontSize: '12px', fontWeight: '600', paddingBottom: '20px', color: '#64748b' }} 
            />
            {hasBoth ? (
              <>
                <Bar dataKey="收入" fill="#d96e42" radius={[4, 4, 0, 0]} barSize={20} name="总收入" />
                <Line type="monotone" dataKey="支出" stroke="#5c829e" strokeWidth={2} dot={{ r: 4 }} name="总支出趋势" />
              </>
            ) : (
              <>
                <Bar dataKey="金额" fill="#d96e42" radius={[4, 4, 0, 0]} barSize={32} name="核算金额" />
                <Line type="monotone" dataKey="金额" stroke="#5c829e" strokeWidth={2} dot={{ r: 4 }} name="金额趋势" />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    const ChartComponent = singleChartType === 'line' ? LineChart : BarChart;
    const DataComponent = singleChartType === 'line' ? Line : Bar;
    const dataProps = (color) => singleChartType === 'line' 
      ? { stroke: color, strokeWidth: 2, dot: { r: 4 } }
      : { fill: color, radius: [4, 4, 0, 0] };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={singleStoreData} margin={{ top: 20, right: 30, left: 0, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e0d8" />
          <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={60} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={(v) => formatCurrency(v).replace('¥', '')} />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            verticalAlign="top" 
            align="right" 
            iconType="circle" 
            iconSize={8}
            wrapperStyle={{ fontSize: '12px', fontWeight: '600', paddingBottom: '20px', color: '#64748b' }} 
          />
          {hasBoth ? (
            <>
              <DataComponent type="monotone" dataKey="收入" name="总收入" {...dataProps("#d96e42")} />
              <DataComponent type="monotone" dataKey="支出" name="总支出" {...dataProps("#5c829e")} />
            </>
          ) : (
            <DataComponent type="monotone" dataKey="金额" name="核算金额" {...dataProps("#d96e42")} />
          )}
        </ChartComponent>
      </ResponsiveContainer>
    );
  };

  const renderMultiStoreChart = () => {
    if (!multiStoreData.length) return <div className="flex h-full items-center justify-center text-slate-400">暂无数据</div>;

    const hasBoth = multiMetricType === 'both';
    const isRatio = multiMetricType === 'expense_ratio';
    const avgValue = !hasBoth && multiShowAverageLine ? calculateAverage(multiStoreData, '金额') : 0;

    const yAxisFormatter = (v) => isRatio ? `${v.toFixed(1)}%` : formatCurrency(v).replace('¥', '');

    const renderAverageLine = () => {
      if (hasBoth || !multiShowAverageLine) return null;
      return (
        <ReferenceLine 
          y={avgValue} 
          stroke="#ef4444" 
          strokeDasharray="5 5" 
          strokeWidth={2}
          label={{ 
            value: `平均: ${isRatio ? avgValue.toFixed(2) + '%' : formatCurrency(avgValue)}`, 
            position: 'insideBottomLeft', 
            fill: '#ef4444', 
            fontSize: 10,
            fontWeight: 'bold',
            dy: -10
          }} 
        />
      );
    };

    if (multiChartType === 'composed') {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={multiStoreData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e0d8" />
            <XAxis dataKey="storeName" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={yAxisFormatter} />
            <Tooltip content={<CustomTooltip />} />
            <Legend 
              verticalAlign="top" 
              align="right" 
              iconType="circle" 
              iconSize={8}
              wrapperStyle={{ fontSize: '12px', fontWeight: '600', paddingBottom: '20px', color: '#64748b' }} 
            />
            {renderAverageLine()}
            {hasBoth ? (
              <>
                <Bar dataKey="收入" fill="#d96e42" radius={[4, 4, 0, 0]} barSize={20} name="总收入" />
                <Line type="monotone" dataKey="支出" stroke="#5c829e" strokeWidth={2} dot={{ r: 4 }} name="总支出" />
              </>
            ) : (
              <>
                <Bar dataKey="金额" fill="#d96e42" radius={[4, 4, 0, 0]} barSize={32} name={isRatio ? `${multiSubCategory}比例` : multiSubCategory}>
                  {multiStoreData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
                <Line type="monotone" dataKey="金额" stroke="#5c829e" strokeWidth={2} dot={{ r: 4 }} name={isRatio ? `${multiSubCategory}比例曲线` : `${multiSubCategory}曲线`} />
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      );
    }

    const ChartComponent = multiChartType === 'line' ? LineChart : BarChart;
    const DataComponent = multiChartType === 'line' ? Line : Bar;
    const dataProps = (color) => multiChartType === 'line'
      ? { stroke: color, strokeWidth: 2, dot: { r: 4 } }
      : { fill: color, radius: [4, 4, 0, 0], barSize: 32 };

    return (
      <ResponsiveContainer width="100%" height="100%">
        <ChartComponent data={multiStoreData} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e0d8" />
          <XAxis dataKey="storeName" axisLine={false} tickLine={false} tick={{ fontSize: 12 }} dy={10} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11 }} tickFormatter={yAxisFormatter} />
          <Tooltip content={<CustomTooltip />} />
          <Legend 
            verticalAlign="top" 
            align="right" 
            iconType="circle" 
            iconSize={8}
            wrapperStyle={{ fontSize: '12px', fontWeight: '600', paddingBottom: '20px', color: '#64748b' }} 
          />
          {renderAverageLine()}
          <DataComponent 
            type="monotone" 
            dataKey={hasBoth ? "收入" : "金额"} 
            name={hasBoth ? "总收入" : (isRatio ? `${multiSubCategory}比例` : multiSubCategory)} 
            {...dataProps("#d96e42")}
          >
            {!hasBoth && multiChartType === 'bar' && multiStoreData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </DataComponent>
          {hasBoth && <DataComponent type="monotone" dataKey="支出" name="总支出" {...dataProps("#5c829e")} />}
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

              {singleMetricType === 'expense' && (
                <div className="flex items-center gap-4">
                  <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">明细</span>
                  <div className="flex flex-wrap gap-2">
                    <select 
                      value={singleExpenseCategory} 
                      onChange={(e) => setSingleExpenseCategory(e.target.value)}
                      className="border border-black/10 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-700 bg-[#fbf8f4] outline-none focus:border-[#d96e42]"
                    >
                      <option value="所有大类">所有大类</option>
                      {EXPENSE_CATEGORIES.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

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
                  {[
                    {id: 'income', label: '收入'}, 
                    {id: 'expense', label: '支出'}, 
                    {id: 'expense_ratio', label: '开支比例'},
                    {id: 'both', label: '收入和支出'}
                  ].map(opt => (
                    <button key={opt.id} onClick={() => { setMultiMetricType(opt.id); setMultiSubCategory(opt.id === 'expense_ratio' ? '门店宿舍租金' : '合计'); }} className={cn("px-3 py-1 text-[13px] font-medium rounded-full border transition-all", multiMetricType === opt.id ? "bg-[#d96e42]/10 border-[#d96e42] text-[#d96e42]" : "border-black/5 bg-white text-slate-600 hover:bg-slate-50")}>
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
                    {multiMetricType !== 'expense_ratio' && <option value="合计">合计</option>}
                    {(multiMetricType === 'income' ? INCOME_CATEGORIES : (multiMetricType === 'both' ? [...new Set([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES])] : EXPENSE_CATEGORIES)).map(cat => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">图表</span>
                <div className="flex flex-wrap gap-2">
                  {[{id: 'bar', label: '柱状图'}, {id: 'line', label: '折线图'}, {id: 'composed', label: '柱状图和折线图'}].map(opt => (
                    <button key={opt.id} onClick={() => setMultiChartType(opt.id)} className={cn("px-3 py-1 text-[13px] font-medium rounded-full border transition-all", multiChartType === opt.id ? "bg-[#5c829e]/10 border-[#5c829e] text-[#5c829e]" : "border-black/5 bg-white text-slate-600 hover:bg-slate-50")}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <span className="w-16 text-right text-[12px] font-bold text-slate-500 uppercase tracking-wider">辅助线</span>
                <div className="flex flex-wrap gap-2">
                  <button 
                    onClick={() => setMultiShowAverageLine(!multiShowAverageLine)} 
                    className={cn(
                      "px-3 py-1 text-[13px] font-medium rounded-full border transition-all flex items-center gap-1", 
                      multiShowAverageLine ? "bg-[#ef4444]/10 border-[#ef4444] text-[#ef4444]" : "border-black/5 bg-white text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    {multiShowAverageLine && <span className="material-symbols-outlined text-[14px]">insights</span>}
                    平均值基准线
                  </button>
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
