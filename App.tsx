
import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import NoticeList from './pages/NoticeList';
import NoticeDetail from './pages/NoticeDetail';
import TaxpayerList from './pages/TaxpayerList';
import TaxpayerDetail from './pages/TaxpayerDetail';
import AuditLogViewer from './pages/AuditLogViewer';
import Login from './pages/Login';
import AdminSettings from './pages/AdminSettings';
import Reports from './pages/Reports';
import Reconciliation from './pages/Reconciliation';
import CalendarView from './pages/CalendarView';
import { AuthProvider } from './contexts/AuthContext';
import { seedDatabase } from './db';

const App: React.FC = () => {
  useEffect(() => {
    // Initialize DB with sample data if empty
    seedDatabase();
  }, []);

  return (
    <AuthProvider>
      <Router>
        <Layout>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Dashboard />} />
            
            <Route path="/calendar" element={<CalendarView />} />
            <Route path="/notices" element={<NoticeList />} />
            <Route path="/notices/:id" element={<NoticeDetail />} />
            
            <Route path="/taxpayers" element={<TaxpayerList />} />
            <Route path="/taxpayers/:id" element={<TaxpayerDetail />} />
            
            <Route path="/audit-logs" element={<AuditLogViewer />} />
            
            <Route path="/admin" element={<AdminSettings />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/reconciliation" element={<Reconciliation />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </Router>
    </AuthProvider>
  );
};

export default App;
