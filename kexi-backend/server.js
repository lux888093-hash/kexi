const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(bodyParser.json());

// --- Mock Data ---

// Dashboard & Stats
app.get('/api/stats', (req, res) => {
  res.json({
    today_appointments: 42,
    today_revenue: 15280,
    today_customers: 58,
    growth: { appointments: 12, revenue: 8.4, customers: -3.2 }
  });
});

// Financials
app.get('/api/financials/summary', (req, res) => {
  res.json({
    monthly_revenue: 128500,
    monthly_costs: 45200,
    net_profit: 83300,
    revenue_growth: 12.5,
    cost_reduction: 2.3,
    profit_growth: 15.8
  });
});

app.get('/api/financials/transactions', (req, res) => {
  res.json([
    { date: '2023-11-24 14:20', category: '金牌头疗套餐', id: 'TRX-982134', status: '已完成', amount: 398.00, type: 'income' },
    { date: '2023-11-24 11:05', category: '按摩精油补货', id: 'TRX-982130', status: '已完成', amount: -2450.00, type: 'expense' },
    { date: '2023-11-23 18:45', category: '年度VIP储值', id: 'TRX-982128', status: '处理中', amount: 5000.00, type: 'income' }
  ]);
});

// Scheduling
app.get('/api/scheduling/today', (req, res) => {
  res.json([
    { time: '14:00 - 15:30', customer: '王小姐', phone: '138****8899', service: '深层舒压头疗', therapist: 'Lily', status: 'checked_in' },
    { time: '15:45 - 17:00', customer: '李先生', phone: '139****1234', service: '中药熏蒸SPA', therapist: 'Emma', status: 'waiting' },
    { time: '11:00 - 12:30', customer: '陈小姐', phone: '136****5566', service: '头皮养护理疗', therapist: 'Sofia', status: 'completed' }
  ]);
});

// AI Chat (Mock Integration)
app.post('/api/chat', async (req, res) => {
  const { message, agent } = req.body;
  console.log(`Received message for ${agent}: ${message}`);
  
  // Placeholder response logic
  let responseText = `您好！关于您咨询的“${message}”，作为您的“${agent}”，我正在为您分析门店数据...`;
  
  if (message.includes('压力') || message.includes('紧')) {
    responseText = "很遗憾听到您感到不适。在高压下这很常见。让我们试试这三个简单的步骤：1. 颈部倾斜 2. 转肩运动 3. 深呼吸。您想让我引导您进行一次5分钟的练习吗？";
  } else if (message.includes('利润') || message.includes('赚')) {
    responseText = "本月利润率提升了5%，主要归功于“头皮深度护理”项目的销售增长。建议继续保持高利润项目的推广。";
  }

  res.json({
    reply: responseText,
    agent: agent || '默认智能体'
  });
});

app.listen(PORT, () => {
  console.log(`Kexi Backend running on http://localhost:${PORT}`);
});
