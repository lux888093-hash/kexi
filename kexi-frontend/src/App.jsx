import { Routes, Route } from "react-router-dom";
import Workspace from "./pages/Workspace";
import Dashboard from "./pages/Dashboard";
import KnowledgeBase from "./pages/KnowledgeBase";
import Financials from "./pages/Financials";
import Scheduling from "./pages/Scheduling";
import Settings from "./pages/Settings";
import DataParsing from "./pages/DataParsing";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Workspace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/knowledge" element={<KnowledgeBase />} />
      <Route path="/financials" element={<Financials />} />
      <Route path="/scheduling" element={<Scheduling />} />
      <Route path="/settings" element={<Settings />} />
      <Route path="/parsing" element={<DataParsing />} />
    </Routes>
  );
}

export default App;

