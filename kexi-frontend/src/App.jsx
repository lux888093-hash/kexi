import { Routes, Route } from 'react-router-dom';
import Workspace from './pages/Workspace';
import Dashboard from './pages/Dashboard';
import KnowledgeBase from './pages/KnowledgeBase';
import Financials from './pages/Financials';
import Scheduling from './pages/Scheduling';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Workspace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/knowledge" element={<KnowledgeBase />} />
      <Route path="/financials" element={<Financials />} />
      <Route path="/scheduling" element={<Scheduling />} />
    </Routes>
  );
}

export default App;