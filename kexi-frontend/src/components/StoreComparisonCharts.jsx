import React, { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  ComposedChart
} from 'recharts';

const formatCurrency = (value) => {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
};

const formatShortCurrency = (value) => {
  const numeric = Number(value || 0);
  if (Math.abs(numeric) >= 10000) {
    return `¥${(numeric / 10000).toFixed(1)}万`;
  }
  return formatCurrency(numeric);
};

const formatPercent = (value) => `${(Number(value || 0) * 100).toFixed(1)}%`;
const formatNumber = (value) => new Intl.NumberFormat('zh-CN').format(Number(value || 0));

const metricGroups = [
  {
    id: "performance",
    label: "经营表现",
    metrics: [
      { key: "revenue", label: "核算营收", type: "amount", formatter: formatShortCurrency, color: "#5c829e", yAxisId: "left" },
      { key: "grossRevenue", label: "总实收", type: "amount", formatter: formatShortCurrency, color: "#45637a", yAxisId: "left" },
      { key: "profit", label: "净利润", type: "amount", formatter: formatShortCurrency, color: "#d96e42", yAxisId: "left" },
      { key: "profitMargin", label: "利润率", type: "ratio", formatter: formatPercent, color: "#d4a04c", yAxisId: "right" },
    ],
  },
  {
    id: "efficiency",
    label: "成本效率",
    metrics: [
      { key: "cost", label: "总成本", type: "amount", formatter: formatShortCurrency, color: "#c66f70", yAxisId: "left" },
      { key: "avgCustomerCost", label: "单客成本", type: "amount", formatter: formatCurrency, color: "#8b739e", yAxisId: "left" },
      { key: "platformRevenueShare", label: "平台依赖度", type: "ratio", formatter: formatPercent, color: "#d96e42", yAxisId: "right" },
    ]
  },
  {
    id: "traffic",
    label: "客群资产",
    metrics: [
      { key: "customerCount", label: "总客流", type: "count", formatter: formatNumber, color: "#5c829e", yAxisId: "left" },
      { key: "avgTicket", label: "客单价", type: "amount", formatter: formatCurrency, color: "#d4a04c", yAxisId: "right" },
      { key: "newMembers", label: "新会员", type: "count", formatter: formatNumber, color: "#508b79", yAxisId: "left" },
      { key: "savingsAmount", label: "储蓄金额", type: "amount", formatter: formatShortCurrency, color: "#d96e42", yAxisId: "right" },
    ],
  },
];

function getStoreOverviewTier(score) {
  const numeric = Number(score || 0);
  if (numeric >= 80) return "excellent";
  if (numeric >= 60) return "stable";
  return "risk";
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 rounded-xl border border-black/5 shadow-lg">
        <p className="font-bold text-sm text-gray-800 mb-2">{label}</p>
        {payload.map((entry, index) => {
          let formatter = (v) => v;
          let realValue = entry.value;
          for (const group of metricGroups) {
            const m = group.metrics.find(x => x.key === entry.dataKey);
            if (m) { 
              formatter = m.formatter; 
              realValue = entry.payload[m.key];
              break; 
            }
          }
          return (
            <p key={index} className="text-sm flex items-center gap-2">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
              <span className="text-gray-600">{entry.name}:</span>
              <span className="font-bold text-gray-900">
                {formatter(realValue)}
              </span>
            </p>
          );
        })}
      </div>
    );
  }
  return null;
};

export default function StoreComparisonCharts({ stores, activeStoreId }) {
  const [activeGroupId, setActiveGroupId] = useState(metricGroups[0].id);
  const [activeMetricKey, setActiveMetricKey] = useState(metricGroups[0].metrics[0].key);

  const loadedStores = useMemo(() => {
    return (stores || [])
      .filter((store) => store.isLoaded && store.reportCount > 0)
      .map((store) => ({
        ...store,
        revenue: Number(store.revenue || 0),
        grossRevenue: Number(store.grossRevenue || 0),
        cost: Number(store.cost || 0),
        profit: Number(store.profit || 0),
        profitMargin: Number(store.profitMargin || 0),
        customerCount: Number(store.customerCount || 0),
        avgTicket: Number(store.avgTicket || 0),
        avgCustomerCost: Number(store.avgCustomerCost || 0),
        newMembers: Number(store.newMembers || 0),
        savingsAmount: Number(store.savingsAmount || 0),
        platformRevenueShare: Number(store.platformRevenueShare || 0),
        healthScore: Number(store.healthScore || 0),
        tier: getStoreOverviewTier(store.healthScore),
      }));
  }, [stores]);

  const visibleStores = loadedStores;

  const activeGroup = metricGroups.find((g) => g.id === activeGroupId) || metricGroups[0];
  const activeMetric = activeGroup.metrics.find((m) => m.key === activeMetricKey) || activeGroup.metrics[0];
  const barData = useMemo(
    () =>
      [...visibleStores].sort(
        (left, right) => right[activeMetric.key] - left[activeMetric.key],
      ),
    [activeMetric.key, visibleStores],
  );

  const handleGroupChange = (groupId) => {
    const group = metricGroups.find((g) => g.id === groupId);
    setActiveGroupId(groupId);
    setActiveMetricKey(group.metrics[0].key);
  };

  if (!stores || !stores.length) {
    return <div className="flex h-[320px] items-center justify-center rounded-[24px] bg-[#f7f2eb] text-sm text-slate-500">当前没有可展示的门店数据。</div>;
  }

  if (!loadedStores.length) {
    return <div className="flex h-[320px] items-center justify-center rounded-[24px] bg-[#f7f2eb] text-sm text-slate-500">门店尚未导入可分析的数据。</div>;
  }

  if (!visibleStores.length) {
    return (
      <div className="flex flex-col items-center justify-center h-[320px] rounded-[24px] bg-[#f8f2eb]">
        <p className="text-base font-bold text-[#171412]">当前筛选下没有命中的门店</p>
      </div>
    );
  }

  const pieData = visibleStores
    .filter(s => s[activeMetric.key] > 0)
    .sort((a, b) => b[activeMetric.key] - a[activeMetric.key])
    .map(store => ({
      name: store.storeName.replace(/店$/, ""),
      value: store[activeMetric.key]
    }));
  
  const totalPieValue = pieData.reduce((sum, item) => sum + item.value, 0);
  
  const COLORS = ['#5c829e', '#d96e42', '#d4a04c', '#508b79', '#c66f70', '#8b739e', '#45637a', '#a88661', '#759068'];

  const hasRightAxis = activeGroup.metrics.some(m => m.yAxisId === 'right');
  const leftAxisMetric = activeGroup.metrics.find(m => m.yAxisId === 'left');
  const rightAxisMetric = activeGroup.metrics.find(m => m.yAxisId === 'right');

  return (
    <div className="flex flex-col gap-5">
      {/* Compact Filters */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 bg-[#fcfaf7] border border-black/5 rounded-[20px] px-5 py-3.5 shadow-sm">
        {/* Data Category */}
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 shrink-0">维度</span>
          <div className="flex bg-[#f2ebe1] p-0.5 rounded-lg shadow-inner">
            {metricGroups.map(g => (
              <button
                key={g.id}
                className={`px-3 py-1 text-[12px] font-bold rounded-md transition-all duration-200 ${
                  activeGroupId === g.id 
                    ? 'bg-white text-[#171412] shadow-sm' 
                    : 'text-slate-500 hover:text-[#171412]'
                }`}
                onClick={() => handleGroupChange(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>

        <div className="w-[1px] h-4 bg-black/10 hidden md:block"></div>

        {/* Core Metrics */}
        <div className="flex items-center gap-3 flex-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400 shrink-0">指标</span>
          <div className="flex flex-wrap gap-1.5">
            {activeGroup.metrics.map(m => {
              const isActive = activeMetricKey === m.key;
              return (
                <button
                  key={m.key}
                  className={`px-3 py-1 text-[12px] font-bold rounded-full transition-all duration-200 ${
                    isActive
                      ? 'text-white shadow-md'
                      : 'bg-[#f7f2eb] border border-transparent text-slate-600 hover:bg-[#efe7dd]'
                  }`}
                  style={isActive ? { backgroundColor: m.color } : {}}
                  onClick={() => setActiveMetricKey(m.key)}
                >
                  {m.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Charts Area */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        
        {/* Left Column: Line/Area Chart for overarching trend across stores */}
        <div className="bg-[#fcfaf7] rounded-[24px] p-5 shadow-[0_4px_24px_rgba(22,20,18,0.03)] border border-black/5 flex flex-col">
          <h3 className="text-base font-bold text-[#171412] mb-1">各店多维表现对比</h3>
          <p className="text-xs text-slate-500 mb-5">展现门店在 {activeGroup.label} 分类下的综合轮廓</p>
          <div className="flex-1 min-h-[340px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visibleStores} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e0d8" />
                <XAxis dataKey="storeName" tickFormatter={(v) => v.replace(/店$/, "")} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} dy={10} />
                <YAxis 
                  yAxisId="left" 
                  domain={['dataMin * 0.8', 'dataMax * 1.2']} 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fontSize: 11, fill: '#aaa' }} 
                  tickFormatter={(v) => leftAxisMetric?.type === 'ratio' ? `${(v*100).toFixed(0)}%` : formatShortCurrency(v).replace('¥', '')} 
                />
                {hasRightAxis && (
                  <YAxis 
                    yAxisId="right" 
                    orientation="right" 
                    domain={['dataMin * 0.8', 'dataMax * 1.2']} 
                    axisLine={false} 
                    tickLine={false} 
                    tick={{ fontSize: 11, fill: '#aaa' }} 
                    tickFormatter={(v) => rightAxisMetric?.type === 'ratio' ? `${(v*100).toFixed(0)}%` : formatShortCurrency(v).replace('¥', '')} 
                  />
                )}
                <Tooltip content={<CustomTooltip />} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />
                
                {activeGroup.metrics.map((metric, i) => {
                  if (i === 0) {
                    return <Area key={metric.key} yAxisId={metric.yAxisId} type="monotone" dataKey={metric.key} name={metric.label} fill={`${metric.color}15`} stroke={metric.color} strokeWidth={3} activeDot={{ r: 6, strokeWidth: 0 }} />;
                  }
                  return <Line key={metric.key} yAxisId={metric.yAxisId} type="monotone" dataKey={metric.key} name={metric.label} stroke={metric.color} strokeWidth={2.5} strokeDasharray={i === 1 ? "6 4" : i === 2 ? "3 3" : "8 6"} dot={{ r: 3, strokeWidth: 1.5 }} activeDot={{ r: 5, strokeWidth: 0 }} />;
                })}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Column: Bar and Pie for the specific activeMetric */}
        <div className="flex flex-col gap-5">
          {/* Bar Chart */}
          <div className="bg-[#fcfaf7] rounded-[24px] p-5 shadow-[0_4px_24px_rgba(22,20,18,0.03)] border border-black/5 flex-1 flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-base font-bold text-[#171412]">[{activeMetric.label}] 门店排行</h3>
                <p className="text-[11px] text-slate-500 mt-1">直接对比各店在此指标下的高低顺序</p>
              </div>
              <span className="text-[11px] font-bold text={activeMetric.color} bg={activeMetric.color}/10 px-2 py-1 rounded-lg shrink-0" style={{ color: activeMetric.color, backgroundColor: `${activeMetric.color}15` }}>柱状图对比</span>
            </div>
            <div className="h-[220px] flex-1">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={barData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }} barSize={32}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e0d8" />
                  <XAxis dataKey="storeName" tickFormatter={(v) => v.replace(/店$/, "")} axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} dy={10} />
                  <YAxis domain={[0, 'dataMax * 1.1']} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#aaa' }} tickFormatter={(v) => activeMetric.type === 'ratio' ? `${(v*100).toFixed(0)}%` : formatShortCurrency(v).replace('¥','')} />
                  <Tooltip cursor={{ fill: 'transparent' }} content={<CustomTooltip />} />
                  <Bar dataKey={activeMetric.key} name={activeMetric.label} radius={[6, 6, 0, 0]}>
                    {barData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.storeId === activeStoreId ? activeMetric.color : `${activeMetric.color}80`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Pie Chart */}
          {activeMetric.type !== 'ratio' && (
            <div className="bg-[#fcfaf7] rounded-[24px] p-5 shadow-[0_4px_24px_rgba(22,20,18,0.03)] border border-black/5 flex-1 flex items-center gap-4">
              <div className="flex-1 h-[140px] relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={68}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                      isAnimationActive={true}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => activeMetric.formatter(value)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-[1.3] pl-2 border-l border-black/5">
                <h3 className="text-sm font-bold text-[#171412] mb-1">[{activeMetric.label}] 结构占比</h3>
                <p className="text-[11px] text-slate-500 mb-3">贡献度分布 (筛选内门店)</p>
                <div className="space-y-1.5 max-h-[110px] overflow-y-auto pr-2 custom-scrollbar">
                  {pieData.map((entry, index) => {
                    const percentage = totalPieValue > 0 ? ((entry.value / totalPieValue) * 100).toFixed(1) : 0;
                    return (
                      <div key={index} className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shadow-sm shrink-0" style={{ backgroundColor: COLORS[index % COLORS.length] }}></span>
                          <span className="text-slate-600 truncate max-w-[65px] font-medium" title={entry.name}>{entry.name}</span>
                          <span className="text-slate-400 min-w-[32px]">{percentage}%</span>
                        </div>
                        <span className="font-bold text-[#171412] tabular-nums">{activeMetric.formatter(entry.value)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
