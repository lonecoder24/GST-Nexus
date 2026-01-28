
import React, { useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { NoticeStatus, RiskLevel, Notice } from '../types';
import StatsCard from '../components/StatsCard';
import { AlertTriangle, Clock, FileText, ArrowRight, TrendingUp, PieChart as PieIcon, Gavel, CalendarClock, CreditCard, ShieldAlert, UserX, PenTool, ChevronRight, Filter, Gavel as GavelIcon, Activity } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate, formatCurrency } from '../utils/formatting';

const ORDER_TYPES = ['DRC-07', 'DRC-08', 'ASMT-13', 'ASMT-15', 'Appeal Order', 'Rectification Order', 'Order Passed'];
const CONTESTED_STATUSES = ['Appeal Filed', 'Rectification Filed', 'Closed', 'Paid'];

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [selectedTrack, setSelectedTrack] = useState<string>('All');
  
  // Queries
  const notices = useLiveQuery(() => db.notices.toArray()) || [];
  const payments = useLiveQuery(() => db.payments.toArray()) || [];
  const configCaseTypes = useLiveQuery(() => db.appConfig.get({key: 'case_types'}));
  
  const caseTrackOptions = configCaseTypes?.value || [];

  // Filter Data based on Selected Track
  const filteredNotices = useMemo(() => {
      if (selectedTrack === 'All') return notices;
      return notices.filter(n => n.caseType === selectedTrack);
  }, [notices, selectedTrack]);

  const filteredPayments = useMemo(() => {
      if (selectedTrack === 'All') return payments;
      const validNoticeIds = new Set(filteredNotices.map(n => n.id));
      return payments.filter(p => validNoticeIds.has(p.noticeId));
  }, [payments, filteredNotices, selectedTrack]);

  const expiringOrders = useMemo(() => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      return notices.filter(n => 
          ORDER_TYPES.includes(n.noticeType) && 
          !CONTESTED_STATUSES.includes(n.status) &&
          n.dateOfIssue
      ).map(n => {
          const deadline = new Date(n.dateOfIssue);
          deadline.setDate(deadline.getDate() + 90);
          const daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 3600 * 24));
          return { ...n, deadline, daysLeft };
      }).sort((a, b) => a.daysLeft - b.daysLeft);
  }, [notices]);

  // Query pending hearings (Filtered)
  const pendingHearings = useLiveQuery(async () => {
      const upcoming = await db.hearings
        .where('date')
        .aboveOrEqual(new Date().toISOString().split('T')[0])
        .limit(10)
        .toArray();
      
      const enriched = await Promise.all(upcoming.map(async (h) => {
          const notice = await db.notices.get(h.noticeId);
          return { ...h, notice };
      }));
      
      const trackFiltered = selectedTrack === 'All' 
        ? enriched 
        : enriched.filter(h => h.notice?.caseType === selectedTrack);

      return trackFiltered
        .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 5);
  }, [selectedTrack]);

  const { stats, statusData, riskData } = useMemo(() => {
    const calculatedStats = {
      pending: 0,
      outstanding: 0,
      overdue: 0,
      monthRecovery: 0,
      totalDemand: 0,
      criticalRisk: 0,
      hearingsThisWeek: 0,
      unassigned: 0,
      drafting: 0,
      expiringOrdersCount: 0
    };
    let chartData: {name: string, value: number}[] = [];
    let riskChartData: {name: string, value: number}[] = [];

    if (filteredNotices && filteredPayments) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      
      const activeNotices = filteredNotices.filter(n => n.status !== NoticeStatus.CLOSED);
      
      const caseGroups: Record<string, Notice[]> = {};
      activeNotices.forEach(n => {
          const key = n.arn && n.arn.trim() !== '' ? n.arn : `_NO_ARN_${n.id}`;
          if (!caseGroups[key]) caseGroups[key] = [];
          caseGroups[key].push(n);
      });

      calculatedStats.pending = Object.keys(caseGroups).length;

      const statusCounts = { Received: 0, Drafting: 0, Filed: 0, Hearing: 0, Appeal: 0, Other: 0 };

      filteredNotices.forEach(n => {
          if (n.status === NoticeStatus.CLOSED) return;
          if (statusCounts.hasOwnProperty(n.status)) {
              statusCounts[n.status as keyof typeof statusCounts]++;
          } else if (n.status === NoticeStatus.ASSIGNED) {
              statusCounts.Received++;
          } else {
              statusCounts.Other++;
          }
      });

      chartData = [
          { name: 'Received', value: statusCounts.Received },
          { name: 'Drafting', value: statusCounts.Drafting },
          { name: 'Filed', value: statusCounts.Filed },
          { name: 'Hearing', value: statusCounts.Hearing },
          { name: 'Appeal', value: statusCounts.Appeal },
      ].filter(i => i.value > 0);

      // Risk Distribution
      const riskCounts = { Low: 0, Medium: 0, High: 0, Critical: 0 };
      activeNotices.forEach(n => {
          if (n.riskLevel === RiskLevel.LOW) riskCounts.Low++;
          else if (n.riskLevel === RiskLevel.MEDIUM) riskCounts.Medium++;
          else if (n.riskLevel === RiskLevel.HIGH) riskCounts.High++;
          else if (n.riskLevel === RiskLevel.CRITICAL) riskCounts.Critical++;
      });
      
      riskChartData = [
          { name: 'Low', value: riskCounts.Low },
          { name: 'Medium', value: riskCounts.Medium },
          { name: 'High', value: riskCounts.High },
          { name: 'Critical', value: riskCounts.Critical },
      ].filter(i => i.value > 0);


      const RESOLVED_STATUSES = [NoticeStatus.CLOSED, NoticeStatus.FILED, NoticeStatus.APPEAL, 'Order Passed', 'Appeal Filed', 'Rectification Filed'];
      calculatedStats.overdue = filteredNotices.filter(n => {
          const isResolved = RESOLVED_STATUSES.includes(n.status as any);
          return !isResolved && new Date(n.dueDate) < now;
      }).length;

      const activeDemand = filteredNotices.reduce((acc, curr) => acc + (curr.demandAmount || 0), 0);
      calculatedStats.totalDemand = activeDemand;
      
      const totalPaid = filteredPayments.reduce((acc, curr) => acc + curr.amount, 0);
      calculatedStats.outstanding = Math.max(0, activeDemand - totalPaid);
      
      calculatedStats.monthRecovery = filteredPayments.reduce((acc, p) => {
        const pDate = new Date(p.paymentDate);
        if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) return acc + p.amount;
        return acc;
      }, 0);

      calculatedStats.criticalRisk = filteredNotices.filter(n => (n.riskLevel === RiskLevel.CRITICAL || n.riskLevel === RiskLevel.HIGH) && n.status !== NoticeStatus.CLOSED).length;
      calculatedStats.hearingsThisWeek = pendingHearings?.length || 0; 
      calculatedStats.unassigned = filteredNotices.filter(n => !n.assignedTo && n.status !== NoticeStatus.CLOSED).length;
      calculatedStats.drafting = filteredNotices.filter(n => n.status === NoticeStatus.DRAFTING).length;
      calculatedStats.expiringOrdersCount = expiringOrders.filter(o => o.daysLeft <= 30).length;
    }

    return { stats: calculatedStats, statusData: chartData, riskData: riskChartData };
  }, [filteredNotices, filteredPayments, expiringOrders, pendingHearings]);

  const COLORS = ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444'];
  const RISK_COLORS = ['#10b981', '#f59e0b', '#f97316', '#ef4444'];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Dashboard</h1>
            <p className="text-slate-500 mt-2 flex items-center gap-2">
                <CalendarClock size={16}/>
                {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-2 flex items-center gap-2 shadow-sm transition-shadow hover:shadow-md">
                  <Filter size={16} className="text-slate-400"/>
                  <select 
                    value={selectedTrack} 
                    onChange={(e) => setSelectedTrack(e.target.value)}
                    className="bg-transparent text-sm font-semibold text-slate-700 outline-none cursor-pointer min-w-[150px]"
                  >
                      <option value="All">All Case Tracks</option>
                      {caseTrackOptions.map(opt => (
                          <option key={opt} value={opt}>{opt}</option>
                      ))}
                  </select>
              </div>

              <button onClick={() => navigate('/notices/new')} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg hover:bg-slate-800 transition-all flex items-center gap-2 text-sm hover:translate-y-[-1px]">
                  <PenTool size={16}/> New Notice
              </button>
          </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard 
          title="Active Cases" 
          value={stats.pending} 
          icon={FileText} 
          color="blue" 
          trend="Proceedings"
          onClick={() => navigate('/notices')}
        />
        <StatsCard 
          title="Outstanding Demand" 
          value={formatCurrency(stats.outstanding)} 
          icon={AlertTriangle} 
          color="red" 
          trend="Recoverable"
          onClick={() => navigate('/reports')}
        />
        <StatsCard 
          title="Upcoming Hearings" 
          value={stats.hearingsThisWeek} 
          icon={GavelIcon} 
          color="purple" 
          trend="This Week"
          onClick={() => navigate('/calendar')}
        />
        <StatsCard 
          title="Critical Risk" 
          value={stats.criticalRisk} 
          icon={ShieldAlert} 
          color="amber" 
          trend="High Priority"
          onClick={() => navigate('/notices', { state: { riskLevel: 'Critical' } })}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left Column (Main Content) */}
          <div className="lg:col-span-2 space-y-8">
              
              {/* Critical Alerts / Expiring Orders */}
              {expiringOrders.length > 0 && (
                  <div className="bg-white rounded-2xl shadow-sm border border-orange-100 overflow-hidden relative">
                      <div className="absolute top-0 left-0 w-1 h-full bg-orange-500"></div>
                      <div className="p-5 border-b border-orange-100 flex justify-between items-center bg-orange-50/30">
                          <h3 className="font-bold text-slate-800 flex items-center gap-2">
                              <AlertTriangle size={20} className="text-orange-500"/> Expiring Appeal/Contest Windows
                          </h3>
                          <span className="bg-orange-100 text-orange-700 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide">Action Required</span>
                      </div>
                      <div className="divide-y divide-slate-100">
                          {expiringOrders.slice(0, 3).map(order => (
                              <div key={order.id} onClick={() => navigate(`/notices/${order.id}`)} className="p-4 hover:bg-orange-50/20 cursor-pointer transition-colors flex items-center justify-between group">
                                  <div className="flex items-center gap-4">
                                      <div className={`flex flex-col items-center justify-center w-14 h-14 rounded-xl text-white font-bold shadow-sm ${order.daysLeft <= 15 ? 'bg-red-500' : order.daysLeft <= 30 ? 'bg-orange-500' : 'bg-blue-500'}`}>
                                          <span className="text-xl leading-none">{order.daysLeft}</span>
                                          <span className="text-[9px] uppercase font-medium opacity-90">Days</span>
                                      </div>
                                      <div>
                                          <h4 className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{order.noticeNumber}</h4>
                                          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
                                              <span className="font-medium bg-slate-100 px-1.5 py-0.5 rounded text-slate-600">{order.noticeType}</span>
                                              <span>•</span>
                                              <span>{order.gstin}</span>
                                          </div>
                                      </div>
                                  </div>
                                  <div className="text-right">
                                      <p className="text-[10px] font-bold text-slate-400 uppercase">Deadline</p>
                                      <p className={`text-sm font-bold ${order.daysLeft <= 15 ? 'text-red-600' : 'text-slate-700'}`}>{formatDate(order.deadline.toISOString())}</p>
                                  </div>
                              </div>
                          ))}
                      </div>
                      {expiringOrders.length > 3 && (
                          <div className="bg-slate-50 p-2 text-center text-xs text-slate-500 font-medium cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => navigate('/notices')}>
                              View {expiringOrders.length - 3} more expiring orders
                          </div>
                      )}
                  </div>
              )}

              {/* Charts Section - Side by Side */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Status Distribution */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
                      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <PieIcon size={18} className="text-blue-500"/> Workflow Status
                      </h3>
                      <div className="h-64 w-full flex-1">
                          <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                  <Pie
                                      data={statusData}
                                      cx="50%"
                                      cy="50%"
                                      innerRadius={60}
                                      outerRadius={80}
                                      paddingAngle={5}
                                      dataKey="value"
                                  >
                                      {statusData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                      ))}
                                  </Pie>
                                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}/>
                                  <Legend wrapperStyle={{ fontSize: '11px', marginTop: '10px' }} iconType="circle"/>
                              </PieChart>
                          </ResponsiveContainer>
                      </div>
                  </div>

                  {/* Risk Analysis */}
                  <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col">
                      <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                          <ShieldAlert size={18} className="text-red-500"/> Risk Profile
                      </h3>
                      <div className="h-64 w-full flex-1">
                          <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={riskData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                  <XAxis type="number" hide/>
                                  <YAxis dataKey="name" type="category" width={60} tick={{fontSize: 11, fontWeight: 600}} axisLine={false} tickLine={false}/>
                                  <Tooltip cursor={{fill: 'transparent'}} contentStyle={{ borderRadius: '8px' }}/>
                                  <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                      {riskData.map((entry, index) => (
                                          <Cell key={`cell-${index}`} fill={RISK_COLORS[index % RISK_COLORS.length]} />
                                      ))}
                                  </Bar>
                              </BarChart>
                          </ResponsiveContainer>
                      </div>
                  </div>
              </div>

              {/* Recent Activity */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                          <Activity size={20} className="text-blue-500"/> Recent Activity
                      </h3>
                      <Link to="/notices" className="text-xs font-bold text-blue-600 hover:text-blue-800 flex items-center gap-1 transition-colors bg-blue-50 px-3 py-1.5 rounded-lg">
                          View Registry <ArrowRight size={12}/>
                      </Link>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {filteredNotices?.sort((a, b) => b.id! - a.id!).slice(0, 5).map((notice) => (
                        <div key={notice.id} onClick={() => navigate(`/notices/${notice.id}`)} className="p-4 hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white shadow-sm ${notice.riskLevel === 'Critical' ? 'bg-red-500' : notice.riskLevel === 'High' ? 'bg-orange-500' : 'bg-blue-500'}`}>
                                    <FileText size={18}/>
                                </div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h4 className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{notice.noticeNumber}</h4>
                                        {notice.isOverdue && <span className="bg-red-100 text-red-600 text-[10px] px-1.5 rounded font-bold">OVERDUE</span>}
                                    </div>
                                    <p className="text-xs text-slate-500 mt-0.5">{notice.gstin} • {notice.caseType || 'General'}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold border uppercase tracking-wide ${
                                    notice.status === NoticeStatus.HEARING ? 'bg-purple-50 text-purple-700 border-purple-100' : 
                                    notice.status === NoticeStatus.CLOSED ? 'bg-slate-100 text-slate-500 border-slate-200' :
                                    'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                    {notice.status}
                                </span>
                                <p className="text-[10px] text-slate-400 mt-1 font-medium">Due: {formatDate(notice.dueDate)}</p>
                            </div>
                        </div>
                    ))}
                    {filteredNotices.length === 0 && (
                        <div className="p-12 text-center text-slate-400 text-sm italic">No notices found for this track. Create one to get started.</div>
                    )}
                  </div>
              </div>
          </div>

          {/* Right Column (Sidebar Widgets) */}
          <div className="space-y-6">
              
              {/* Quick Status Widgets */}
              <div className="grid grid-cols-2 gap-4">
                  <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100 text-center cursor-pointer hover:bg-blue-100 transition-colors shadow-sm" onClick={() => navigate('/notices', { state: { status: 'Drafting' } })}>
                      <h4 className="text-3xl font-extrabold text-blue-700">{stats.drafting}</h4>
                      <p className="text-xs font-bold text-blue-600 uppercase mt-1 tracking-wide">Drafting</p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-2xl border border-red-100 text-center cursor-pointer hover:bg-red-100 transition-colors shadow-sm" onClick={() => navigate('/notices')}>
                      <h4 className="text-3xl font-extrabold text-red-700">{stats.overdue}</h4>
                      <p className="text-xs font-bold text-red-600 uppercase mt-1 tracking-wide">Overdue</p>
                  </div>
              </div>

              {/* Hearings List */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                 <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-purple-50/50">
                     <h3 className="font-bold text-slate-800 flex items-center gap-2">
                         <Gavel size={18} className="text-purple-600"/> Hearings
                     </h3>
                     <span className="text-xs font-bold text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">Next 7 Days</span>
                 </div>
                 <div className="p-0">
                     {pendingHearings && pendingHearings.length > 0 ? (
                         <div className="divide-y divide-slate-50">
                             {pendingHearings.map(h => (
                                 <div key={h.id} onClick={() => navigate(`/notices/${h.noticeId}`)} className="p-4 hover:bg-purple-50/30 cursor-pointer transition-all group flex items-center gap-3">
                                     <div className="flex-shrink-0 w-12 h-12 bg-white border-2 border-purple-100 rounded-xl flex flex-col items-center justify-center text-purple-700">
                                         <span className="text-[9px] font-bold uppercase">{new Date(h.date).toLocaleString('default', {month:'short'})}</span>
                                         <span className="text-lg font-bold leading-none">{new Date(h.date).getDate()}</span>
                                     </div>
                                     <div className="min-w-0 flex-1">
                                         <p className="font-bold text-slate-800 text-xs truncate group-hover:text-purple-700 transition-colors">{h.notice?.gstin || 'Unknown Taxpayer'}</p>
                                         <p className="text-[10px] text-slate-500 mt-0.5 truncate">{h.venue}</p>
                                         <div className="flex items-center gap-2 mt-1">
                                             <span className="text-[9px] bg-purple-100 px-1.5 py-0.5 rounded text-purple-700 font-bold">{h.time}</span>
                                             <span className="text-[9px] text-slate-400">{h.type}</span>
                                         </div>
                                     </div>
                                 </div>
                             ))}
                         </div>
                     ) : (
                         <div className="text-center py-10 px-6">
                             <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                                <Gavel size={20} className="text-slate-300"/>
                             </div>
                             <p className="text-sm text-slate-500 font-medium">No hearings scheduled</p>
                             <p className="text-xs text-slate-400 mt-1">Your calendar is clear for the week.</p>
                         </div>
                     )}
                 </div>
              </div>

              {/* Recoveries List */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                 <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-green-50/50">
                     <h3 className="font-bold text-slate-800 flex items-center gap-2">
                         <CreditCard size={18} className="text-green-600"/> Recoveries
                     </h3>
                 </div>
                 <div className="p-0">
                     {filteredPayments && filteredPayments.length > 0 ? (
                         <div className="divide-y divide-slate-50">
                             {filteredPayments.slice(0, 5).map(payment => (
                                 <div key={payment.id} className="p-4 flex justify-between items-center hover:bg-green-50/30 transition-colors">
                                     <div className="flex items-center gap-3">
                                         <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-xs shadow-sm">₹</div>
                                         <div>
                                             <p className="text-xs font-bold text-slate-700">{formatCurrency(payment.amount)}</p>
                                             <p className="text-[10px] text-slate-500 uppercase font-medium">{payment.majorHead}</p>
                                         </div>
                                     </div>
                                     <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono font-medium border border-slate-200">
                                         {formatDate(payment.paymentDate)}
                                     </span>
                                 </div>
                             ))}
                         </div>
                     ) : (
                         <p className="text-xs text-slate-400 text-center py-8 italic">No payments recorded recently.</p>
                     )}
                 </div>
              </div>
          </div>
      </div>
    </div>
  );
};

export default Dashboard;
