
import React, { useEffect, useState, useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { NoticeStatus, RiskLevel, Notice } from '../types';
import StatsCard from '../components/StatsCard';
import { AlertTriangle, Clock, FileText, ArrowRight, TrendingUp, PieChart as PieIcon, Gavel, CalendarClock, CreditCard, ShieldAlert, UserX, PenTool, ChevronRight, Filter } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';
import { formatDate, formatCurrency } from '../utils/formatting';

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
      // Filter payments where the parent notice belongs to the selected track
      const validNoticeIds = new Set(filteredNotices.map(n => n.id));
      return payments.filter(p => validNoticeIds.has(p.noticeId));
  }, [payments, filteredNotices, selectedTrack]);

  // Query pending hearings (Filtered)
  const pendingHearings = useLiveQuery(async () => {
      const upcoming = await db.hearings
        .where('date')
        .aboveOrEqual(new Date().toISOString().split('T')[0])
        .limit(10) // Fetch a bit more to filter client-side
        .toArray();
      
      const enriched = await Promise.all(upcoming.map(async (h) => {
          const notice = await db.notices.get(h.noticeId);
          return { ...h, notice };
      }));
      
      // Filter by track if needed
      const trackFiltered = selectedTrack === 'All' 
        ? enriched 
        : enriched.filter(h => h.notice?.caseType === selectedTrack);

      return trackFiltered
        .sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime())
        .slice(0, 5);
  }, [selectedTrack, notices]); // Re-run when track changes

  const [stats, setStats] = useState({
    pending: 0,
    outstanding: 0,
    overdue: 0,
    monthRecovery: 0,
    totalDemand: 0,
    criticalRisk: 0,
    hearingsThisWeek: 0,
    unassigned: 0,
    drafting: 0
  });

  const [statusData, setStatusData] = useState<{name: string, value: number}[]>([]);

  useEffect(() => {
    if (filteredNotices && filteredPayments) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      
      // 1. Calculate Stats based on FILTERED data
      const activeNotices = filteredNotices.filter(n => n.status !== NoticeStatus.CLOSED);
      
      // Group by Case ID for accurate "Active Cases" count
      const caseGroups: Record<string, Notice[]> = {};
      activeNotices.forEach(n => {
          const key = n.arn && n.arn.trim() !== '' ? n.arn : `_NO_ARN_${n.id}`;
          if (!caseGroups[key]) caseGroups[key] = [];
          caseGroups[key].push(n);
      });

      const pendingCasesCount = Object.keys(caseGroups).length;

      // Status Distribution Logic
      const getPriority = (status: string) => {
          switch (status) {
              case NoticeStatus.APPEAL: return 5;
              case NoticeStatus.HEARING: return 4;
              case NoticeStatus.FILED: return 3;
              case NoticeStatus.DRAFTING: return 2;
              case NoticeStatus.RECEIVED: return 1;
              case NoticeStatus.ASSIGNED: return 1; 
              default: return 0;
          }
      };

      const statusCounts = { Received: 0, Drafting: 0, Filed: 0, Hearing: 0, Appeal: 0 };

      Object.values(caseGroups).forEach(group => {
          // Determine the "Dominant" status of a case group (highest priority)
          const representativeNotice = group.reduce((prev, curr) => 
              getPriority(curr.status) > getPriority(prev.status) ? curr : prev
          , group[0]);
          
          const s = representativeNotice.status;
          if (s === NoticeStatus.RECEIVED || s === NoticeStatus.ASSIGNED) statusCounts.Received++;
          else if (s === NoticeStatus.DRAFTING) statusCounts.Drafting++;
          else if (s === NoticeStatus.FILED) statusCounts.Filed++;
          else if (s === NoticeStatus.HEARING) statusCounts.Hearing++;
          else if (s === NoticeStatus.APPEAL) statusCounts.Appeal++;
      });

      setStatusData([
          { name: 'Received', value: statusCounts.Received },
          { name: 'Drafting', value: statusCounts.Drafting },
          { name: 'Filed', value: statusCounts.Filed },
          { name: 'Hearing', value: statusCounts.Hearing },
          { name: 'Appeal', value: statusCounts.Appeal },
      ]);

      const RESOLVED_STATUSES = [NoticeStatus.CLOSED, NoticeStatus.FILED, NoticeStatus.APPEAL, 'Order Passed'];
      const overdueCount = filteredNotices.filter(n => {
          const isResolved = RESOLVED_STATUSES.includes(n.status as any);
          return !isResolved && new Date(n.dueDate) < now;
      }).length;

      const totalDemand = filteredNotices.reduce((acc, curr) => acc + (curr.demandAmount || 0), 0);
      const totalPaid = filteredPayments.reduce((acc, curr) => acc + curr.amount, 0);
      
      const monthRec = filteredPayments.reduce((acc, p) => {
        const pDate = new Date(p.paymentDate);
        if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) return acc + p.amount;
        return acc;
      }, 0);

      const criticalCount = filteredNotices.filter(n => (n.riskLevel === RiskLevel.CRITICAL || n.riskLevel === RiskLevel.HIGH) && n.status !== NoticeStatus.CLOSED).length;
      
      // Hearing Count (Simpler approximation based on pendingHearings query result for "This Week")
      // In a real scenario, we'd query db with date range AND filter by noticeIds
      const hearingsThisWeek = pendingHearings?.length || 0; 

      const unassignedCount = filteredNotices.filter(n => !n.assignedTo && n.status !== NoticeStatus.CLOSED).length;
      const draftingCount = filteredNotices.filter(n => n.status === NoticeStatus.DRAFTING).length;

      setStats({
        pending: pendingCasesCount,
        outstanding: totalDemand - totalPaid,
        overdue: overdueCount,
        monthRecovery: monthRec,
        totalDemand: totalDemand,
        criticalRisk: criticalCount,
        hearingsThisWeek: hearingsThisWeek,
        unassigned: unassignedCount,
        drafting: draftingCount
      });
    }
  }, [filteredNotices, filteredPayments, pendingHearings]);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Dashboard</h1>
            <p className="text-slate-500 mt-1 flex items-center gap-2">
                Overview of your GST compliance and liability status
                <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full border border-blue-100 font-bold">{new Date().getFullYear()}</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
              {/* Case Track Filter */}
              <div className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 flex items-center gap-2 shadow-sm">
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

              <button onClick={() => navigate('/notices/new')} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-bold shadow-lg hover:bg-slate-800 transition-all flex items-center gap-2 text-sm">
                  <PenTool size={16}/> New Notice
              </button>
          </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatsCard 
          title="Active Cases" 
          value={stats.pending} 
          icon={FileText} 
          color="blue" 
          trend="Pending Proceedings"
          onClick={() => navigate('/notices')}
        />
        <StatsCard 
          title="Demand Payable" 
          value={formatCurrency(stats.outstanding)} 
          icon={AlertTriangle} 
          color="red" 
          trend="Total Liability"
          onClick={() => navigate('/reports')}
        />
        <StatsCard 
          title="Recovered (Month)" 
          value={formatCurrency(stats.monthRecovery)} 
          icon={TrendingUp} 
          color="green" 
          trend="Payments received"
          onClick={() => navigate('/reports')}
        />
        <StatsCard 
          title="Hearings (Upcoming)" 
          value={stats.hearingsThisWeek} 
          icon={CalendarClock} 
          color="purple" 
          trend="Next 7 Days"
          onClick={() => navigate('/calendar')}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Main Chart Section */}
          <div className="lg:col-span-2 space-y-8">
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><PieIcon size={20} className="text-blue-500"/> Workflow Status</h3>
                        <p className="text-sm text-slate-500">Distribution of cases in {selectedTrack === 'All' ? 'all tracks' : selectedTrack}</p>
                    </div>
                    <button onClick={() => navigate('/reports')} className="text-sm text-blue-600 font-bold hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">Full Report</button>
                </div>
                <div className="h-72 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={statusData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorBar" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.3}/>
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12, fontWeight: 500}} dy={10} />
                            <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                            <Tooltip 
                                cursor={{fill: '#f8fafc'}}
                                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', padding: '12px' }}
                            />
                            <Bar dataKey="value" fill="url(#colorBar)" radius={[6, 6, 0, 0]} barSize={40}>
                                {statusData.map((_, index) => (
                                    <Cell key={`cell-${index}`} fill={['#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af'][index % 5]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                      <h3 className="font-bold text-slate-800 flex items-center gap-2">
                          <FileText size={20} className="text-blue-500"/> Recent Activity
                      </h3>
                      <Link to="/notices" className="text-sm text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors font-medium">
                          View All <ArrowRight size={14}/>
                      </Link>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {filteredNotices?.sort((a, b) => b.id! - a.id!).slice(0, 5).map((notice) => (
                        <div key={notice.id} onClick={() => navigate(`/notices/${notice.id}`)} className="p-4 hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                                <div className={`w-2 h-10 rounded-full ${notice.riskLevel === 'Critical' ? 'bg-red-500' : notice.riskLevel === 'High' ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                                <div>
                                    <h4 className="font-bold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{notice.noticeNumber}</h4>
                                    <p className="text-xs text-slate-500">{notice.gstin} • {notice.caseType || 'General'}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className={`px-2.5 py-1 rounded-full text-xs font-bold border ${
                                    notice.status === NoticeStatus.HEARING ? 'bg-purple-50 text-purple-700 border-purple-100' : 
                                    notice.status === NoticeStatus.CLOSED ? 'bg-slate-100 text-slate-500 border-slate-200' :
                                    'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                    {notice.status}
                                </span>
                                <p className="text-[10px] text-slate-400 mt-1 font-medium">{formatDate(notice.dueDate)}</p>
                            </div>
                        </div>
                    ))}
                    {filteredNotices.length === 0 && (
                        <div className="p-6 text-center text-slate-400 text-sm">No notices found for this track.</div>
                    )}
                  </div>
              </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
              
              {/* Quick Action Cards */}
              <div className="grid grid-cols-2 gap-4">
                  <div className="bg-amber-50 p-5 rounded-2xl border border-amber-100 text-center cursor-pointer hover:bg-amber-100 transition-colors shadow-sm" onClick={() => navigate('/notices', { state: { status: 'Received' } })}>
                      <h4 className="text-2xl font-bold text-amber-700">{stats.unassigned}</h4>
                      <p className="text-xs font-bold text-amber-600 uppercase mt-1 tracking-wide">Unassigned</p>
                  </div>
                  <div className="bg-red-50 p-5 rounded-2xl border border-red-100 text-center cursor-pointer hover:bg-red-100 transition-colors shadow-sm" onClick={() => navigate('/notices')}>
                      <h4 className="text-2xl font-bold text-red-700">{stats.overdue}</h4>
                      <p className="text-xs font-bold text-red-600 uppercase mt-1 tracking-wide">Overdue</p>
                  </div>
              </div>

              {/* Hearings Card */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                 <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                     <Gavel size={20} className="text-purple-500"/> Upcoming Hearings
                 </h3>
                 <div className="space-y-3">
                     {pendingHearings && pendingHearings.length > 0 ? (
                         pendingHearings.map(h => (
                             <div key={h.id} onClick={() => navigate(`/notices/${h.noticeId}`)} className="p-3 bg-gradient-to-r from-purple-50 to-white border border-purple-100 rounded-xl cursor-pointer hover:shadow-sm transition-all group">
                                 <div className="flex justify-between items-center mb-1">
                                     <span className="text-[10px] font-bold text-purple-600 uppercase tracking-wider">
                                         {formatDate(h.date)}
                                     </span>
                                     <ChevronRight size={14} className="text-purple-300 group-hover:text-purple-500 transition-colors"/>
                                 </div>
                                 <p className="font-bold text-purple-900 text-sm truncate">{h.notice?.gstin || 'Unknown Taxpayer'}</p>
                                 <div className="flex justify-between items-center mt-1">
                                     <p className="text-xs text-purple-600 truncate max-w-[120px] font-medium">{h.venue}</p>
                                     <span className="text-[10px] bg-white px-2 py-0.5 rounded border border-purple-100 text-purple-500 font-bold">{h.time}</span>
                                 </div>
                             </div>
                         ))
                     ) : (
                         <div className="text-center py-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                             <Gavel size={32} className="mx-auto text-slate-300 mb-2"/>
                             <p className="text-sm text-slate-500 font-medium">No hearings scheduled</p>
                             <p className="text-xs text-slate-400">Next 7 days are clear</p>
                         </div>
                     )}
                 </div>
              </div>

              {/* Payments Card */}
              <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                 <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                     <CreditCard size={20} className="text-green-600"/> Latest Recoveries
                 </h3>
                 <div className="space-y-4">
                     {filteredPayments?.slice(0, 5).map(payment => (
                         <div key={payment.id} className="flex justify-between items-center pb-3 border-b border-slate-50 last:border-0 last:pb-0">
                             <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-xs">₹</div>
                                 <div>
                                     <p className="text-sm font-bold text-slate-700">{formatCurrency(payment.amount)}</p>
                                     <p className="text-[10px] text-slate-500 uppercase font-medium">{payment.majorHead}</p>
                                 </div>
                             </div>
                             <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono font-medium">
                                 {formatDate(payment.paymentDate)}
                             </span>
                         </div>
                     ))}
                     {!filteredPayments?.length && <p className="text-sm text-slate-400 text-center py-4">No payments recorded in this track.</p>}
                 </div>
              </div>
          </div>
      </div>
    </div>
  );
};

export default Dashboard;
