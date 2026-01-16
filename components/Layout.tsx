
import React, { useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FileText, Users, FileSpreadsheet, Settings, LogOut, Activity, Scale, Calendar, BarChart3, Clock } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { checkAndGenerateNotifications } from '../db';
import NotificationCenter from './NotificationCenter';
import { UserRole } from '../types';

interface LayoutProps {
  children: React.ReactNode;
}

const Layout: React.FC<LayoutProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isLoading } = useAuth();

  useEffect(() => {
    // Run notification check on mount
    checkAndGenerateNotifications();
  }, []);

  if (isLoading) return <div className="flex h-screen items-center justify-center">Loading...</div>;

  // Don't show layout on Login page
  if (location.pathname === '/login') return <>{children}</>;

  // Redirect to login if not authenticated
  if (!user) {
     navigate('/login');
     return null;
  }

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Calendar, label: 'Calendar', path: '/calendar' },
    { icon: FileText, label: 'Notices', path: '/notices' },
    { icon: Clock, label: 'Time Sheet', path: '/timesheets' },
    { icon: BarChart3, label: 'Returns', path: '/returns' },
    { icon: Users, label: 'Taxpayers', path: '/taxpayers' },
    { icon: Scale, label: 'Reconciliation', path: '/reconciliation' },
    { icon: Activity, label: 'Audit Logs', path: '/audit-logs' },
    { icon: FileSpreadsheet, label: 'Reports', path: '/reports' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen w-screen bg-gray-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-white flex flex-col shadow-xl z-20">
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center font-bold">G</div>
            <span className="text-xl font-bold tracking-tight">GST Nexus</span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Offline Edition v1.0</p>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-700 space-y-2">
          {user.role === UserRole.ADMIN && (
            <Link to="/admin" className="flex items-center gap-3 px-4 py-2 w-full text-sm font-medium text-slate-400 hover:text-white transition-colors">
              <Settings size={18} />
              Admin Panel
            </Link>
          )}
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 px-4 py-2 w-full text-sm font-medium text-red-400 hover:text-red-300 hover:bg-slate-800 rounded transition-colors"
          >
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Header */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm z-10">
          <h1 className="text-xl font-semibold text-slate-800">
            {navItems.find(i => i.path === location.pathname)?.label || 
             (location.pathname.startsWith('/admin') ? 'Administration' : 
              location.pathname.startsWith('/notices/') ? 'Notice Detail' :
              location.pathname.startsWith('/taxpayers/') ? 'Taxpayer Detail' :
              'GST Nexus')}
          </h1>
          <div className="flex items-center gap-6">
             <NotificationCenter />
             
             <div className="h-6 w-px bg-gray-200"></div>

             <div className="flex items-center gap-3">
                <div className="text-right hidden sm:block">
                    <p className="text-sm font-medium text-slate-800">{user.fullName}</p>
                    <p className="text-xs text-slate-500">{user.role}</p>
                </div>
                <div className="w-9 h-9 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-bold border border-blue-200">
                    {user.fullName.charAt(0)}
                </div>
             </div>
          </div>
        </header>

        {/* Scrollable Content Area */}
        <div className="flex-1 overflow-y-auto p-8 scroll-smooth">
          {children}
        </div>
      </main>
    </div>
  );
};

export default Layout;
