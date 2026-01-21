
import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { NoticeStatus, RiskLevel, Notice } from '../types';
import StatsCard from '../components/StatsCard';
import { AlertTriangle, Clock, FileText, ArrowRight, TrendingUp, PieChart as PieIcon, Gavel, CalendarClock, CreditCard, ShieldAlert, UserX, PenTool, ChevronRight } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { Link, useNavigate } from 'react-router-dom';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  
  // Queries
  const notices = useLiveQuery(() => db.notices.toArray());
  const payments = useLiveQuery(() => db.payments.toArray());
  const recentPayments = useLiveQuery(() => db.payments.orderBy('paymentDate').reverse().limit(5).toArray());
  
  // Query pending hearings from new table + join with notices
  const pendingHearings = useLiveQuery(async () => {
      const upcoming = await db.hearings
        .where('date')
        .aboveOrEqual(new Date().toISOString().split('T')[0]) // Filter past hearings? Or just show all upcoming
        .limit(5)
        .toArray();
      
      const enriched = await Promise.all(upcoming.map(async (h) => {
          const notice = await db.notices.get(h.noticeId);
          return { ...h, notice };
      }));
      
      return enriched.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  });

  // State for Stats
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

  // State for Chart Data
  const [statusData, setStatusData] = useState<{name: string, value: number}[]>([]);

  useEffect(() => {
    if (notices && payments) {
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const nextWeek = new Date(now);
      nextWeek.setDate(now.getDate() + 7);

      // Active Cases Calculation (Group by ARN)
      const activeNotices = notices.filter(n => n.status !== NoticeStatus.CLOSED);
      
      // Group active notices by ARN to determine Case Status
      const caseGroups: Record<string, Notice[]> = {};
      activeNotices.forEach(n => {
          const key = n.arn && n.arn.trim() !== '' ? n.arn : `_NO_ARN_${n.id}`;
          if (!caseGroups[key]) caseGroups[key] = [];
          caseGroups[key].push(n);
      });

      const pendingCasesCount = Object.keys(caseGroups).length;

      // Determine status for each Case (Priority: Appeal > Hearing > Filed > Drafting > Received)
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
          // Identify the most advanced status in the case
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

      const overdueCount = notices.filter(n => new Date(n.dueDate) < now && n.status !== NoticeStatus.CLOSED).length;
      const totalDemand = notices.reduce((acc, curr) => acc + (curr.demandAmount || 0), 0);
      const totalPaid = payments.reduce((acc, curr) => acc + curr.amount, 0);
      
      const monthRec = payments.reduce((acc, p) => {
        const pDate = new Date(p.paymentDate);
        if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) return acc + p.amount;
        return acc;
      }, 0);

      const criticalCount = notices.filter(n => (n.riskLevel === RiskLevel.CRITICAL || n.riskLevel === RiskLevel.HIGH) && n.status !== NoticeStatus.CLOSED).length;
      
      db.hearings.where('date').between(now.toISOString().split('T')[0], nextWeek.toISOString().split('T')[0], true, true).count().then(count => {
          setStats(prev => ({ ...prev, hearingsThisWeek: count }));
      });

      const unassignedCount = notices.filter(n => !n.assignedTo && n.status !== NoticeStatus.CLOSED).length;
      const draftingCount = notices.filter(n => n.status === NoticeStatus.DRAFTING).length;

      setStats(prev => ({
        ...prev,
        pending: pendingCasesCount,
        outstanding: totalDemand - totalPaid,
        overdue: overdueCount,
        monthRecovery: monthRec,
        totalDemand: totalDemand,
        criticalRisk: criticalCount,
        unassigned: unassignedCount,
        drafting: draftingCount
      }));
    }
  }, [notices, payments]);

  const formatCurrency = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumSignificantDigits: 3 }).format(amount);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Dashboard</h1>
            <p className="text-slate-500 mt-1 flex items-center gap-2">
                Overview of your GST compliance and liability status
                <span className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full border border-blue-100 font-medium">{new Date().getFullYear()}</span>
            </p>
          </div>
          <div className="flex gap-3">
              <button onClick={() => navigate('/notices/new')} className="bg-slate-900 text-white px-5 py-2.5 rounded-xl font-medium shadow-lg hover:bg-slate-800 transition-all flex items-center gap-2 text-sm">
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
          title="Hearings (7 Days)" 
          value={stats.hearingsThisWeek} 
          icon={CalendarClock} 
          color="purple" 
          trend="Upcoming Schedule"
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
                        <p className="text-sm text-slate-500">Distribution of active cases across stages</p>
                    </div>
                    <button onClick={() => navigate('/reports')} className="text-sm text-blue-600 font-medium hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">Full Report</button>
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
                      <Link to="/notices" className="text-sm text-slate-500 hover:text-blue-600 flex items-center gap-1 transition-colors">
                          View All <ArrowRight size={14}/>
                      </Link>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {notices?.sort((a, b) => b.id! - a.id!).slice(0, 5).map((notice) => (
                        <div key={notice.id} onClick={() => navigate(`/notices/${notice.id}`)} className="p-4 hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-between group">
                            <div className="flex items-center gap-4">
                                <div className={`w-2 h-10 rounded-full ${notice.riskLevel === 'Critical' ? 'bg-red-500' : notice.riskLevel === 'High' ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                                <div>
                                    <h4 className="font-semibold text-slate-800 text-sm group-hover:text-blue-600 transition-colors">{notice.noticeNumber}</h4>
                                    <p className="text-xs text-slate-500">{notice.gstin} • {notice.noticeType}</p>
                                </div>
                            </div>
                            <div className="text-right">
                                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${
                                    notice.status === NoticeStatus.HEARING ? 'bg-purple-50 text-purple-700 border-purple-100' : 
                                    notice.status === NoticeStatus.CLOSED ? 'bg-slate-100 text-slate-500 border-slate-200' :
                                    'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                    {notice.status}
                                </span>
                                <p className="text-[10px] text-slate-400 mt-1 font-medium">{new Date(notice.dueDate).toLocaleDateString('en-IN', {day:'numeric', month:'short'})}</p>
                            </div>
                        </div>
                    ))}
                  </div>
              </div>
          </div>

          {/* Right Column */}
          <div className="space-y-6">
              
              {/* Quick Action Cards */}
              <div className="grid grid-cols-2 gap-4">
                  <div className="bg-amber-50 p-4 rounded-2xl border border-amber-100 text-center cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => navigate('/notices', { state: { status: 'Received' } })}>
                      <h4 className="text-2xl font-bold text-amber-700">{stats.unassigned}</h4>
                      <p className="text-xs font-semibold text-amber-600 uppercase mt-1">Unassigned</p>
                  </div>
                  <div className="bg-red-50 p-4 rounded-2xl border border-red-100 text-center cursor-pointer hover:bg-red-100 transition-colors" onClick={() => navigate('/notices')}>
                      <h4 className="text-2xl font-bold text-red-700">{stats.overdue}</h4>
                      <p className="text-xs font-semibold text-red-600 uppercase mt-1">Overdue</p>
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
                                     <span className="text-[10px] font-bold text-purple-500 uppercase tracking-wider">
                                         {new Date(h.date).toLocaleDateString('en-IN', {weekday: 'short', day: 'numeric', month: 'short'})}
                                     </span>
                                     <ChevronRight size={14} className="text-purple-300 group-hover:text-purple-500 transition-colors"/>
                                 </div>
                                 <p className="font-semibold text-purple-900 text-sm truncate">{h.notice?.gstin || 'Unknown Taxpayer'}</p>
                                 <div className="flex justify-between items-center mt-1">
                                     <p className="text-xs text-purple-600 truncate max-w-[120px]">{h.venue}</p>
                                     <span className="text-[10px] bg-white px-1.5 rounded border border-purple-100 text-purple-400">{h.time}</span>
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
                     {recentPayments?.map(payment => (
                         <div key={payment.id} className="flex justify-between items-center pb-3 border-b border-slate-50 last:border-0 last:pb-0">
                             <div className="flex items-center gap-3">
                                 <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-xs">₹</div>
                                 <div>
                                     <p className="text-sm font-bold text-slate-700">{formatCurrency(payment.amount)}</p>
                                     <p className="text-[10px] text-slate-500 uppercase">{payment.majorHead}</p>
                                 </div>
                             </div>
                             <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-1 rounded font-mono">
                                 {new Date(payment.paymentDate).toLocaleDateString('en-IN', {day:'numeric', month:'short'})}
                             </span>
                         </div>
                     ))}
                     {!recentPayments?.length && <p className="text-sm text-slate-400 text-center py-4">No payments recorded</p>}
                 </div>
              </div>
          </div>
      </div>
    </div>
  );
};

export default Dashboard;
