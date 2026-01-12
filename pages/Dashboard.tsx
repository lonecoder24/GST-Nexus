
import React, { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { NoticeStatus, RiskLevel } from '../types';
import StatsCard from '../components/StatsCard';
import { AlertTriangle, CheckCircle, Clock, FileText, Activity, ArrowRight, TrendingUp, IndianRupee, PieChart as PieIcon, Gavel, Calendar, CreditCard, ShieldAlert, UserX, PenTool, CalendarClock } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  
  // Queries
  const notices = useLiveQuery(() => db.notices.toArray());
  const payments = useLiveQuery(() => db.payments.toArray());
  const recentPayments = useLiveQuery(() => db.payments.orderBy('paymentDate').reverse().limit(5).toArray());
  const hearings = useLiveQuery(() => db.notices.where('status').equals(NoticeStatus.HEARING).toArray());

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

  useEffect(() => {
    if (notices && payments) {
      const now = new Date();
      // Reset time to start of day for accurate comparison
      now.setHours(0, 0, 0, 0);
      
      const currentMonth = now.getMonth();
      const currentYear = now.getFullYear();
      const nextWeek = new Date(now);
      nextWeek.setDate(now.getDate() + 7);

      // 1. Pending Notices (Not Closed)
      const pendingCount = notices.filter(n => n.status !== NoticeStatus.CLOSED).length;

      // 2. Overdue
      const overdueCount = notices.filter(n => new Date(n.dueDate) < now && n.status !== NoticeStatus.CLOSED).length;

      // 3. Financials
      const totalDemand = notices.reduce((acc, curr) => acc + (curr.demandAmount || 0), 0);
      const totalPaid = payments.reduce((acc, curr) => acc + curr.amount, 0);
      
      // 4. Month Recovery
      const monthRec = payments.reduce((acc, p) => {
        const pDate = new Date(p.paymentDate);
        if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) {
            return acc + p.amount;
        }
        return acc;
      }, 0);

      // 5. Critical Risk (High or Critical & Not Closed)
      const criticalCount = notices.filter(n => 
          (n.riskLevel === RiskLevel.CRITICAL || n.riskLevel === RiskLevel.HIGH) && 
          n.status !== NoticeStatus.CLOSED
      ).length;

      // 6. Hearings Next 7 Days
      const hearingsCount = notices.filter(n => {
          if (n.status !== NoticeStatus.HEARING) return false;
          const d = new Date(n.dueDate);
          return d >= now && d <= nextWeek;
      }).length;

      // 7. Unassigned
      const unassignedCount = notices.filter(n => !n.assignedTo && n.status !== NoticeStatus.CLOSED).length;

      // 8. In Drafting
      const draftingCount = notices.filter(n => n.status === NoticeStatus.DRAFTING).length;

      setStats({
        pending: pendingCount,
        outstanding: totalDemand - totalPaid,
        overdue: overdueCount,
        monthRecovery: monthRec,
        totalDemand: totalDemand,
        criticalRisk: criticalCount,
        hearingsThisWeek: hearingsCount,
        unassigned: unassignedCount,
        drafting: draftingCount
      });
    }
  }, [notices, payments]);

  // Chart Data: Status Distribution
  const statusData = [
    { name: 'Received', value: notices?.filter(n => n.status === NoticeStatus.RECEIVED).length || 0 },
    { name: 'Drafting', value: notices?.filter(n => n.status === NoticeStatus.DRAFTING).length || 0 },
    { name: 'Filed', value: notices?.filter(n => n.status === NoticeStatus.FILED).length || 0 },
    { name: 'Hearing', value: notices?.filter(n => n.status === NoticeStatus.HEARING).length || 0 },
    { name: 'Appeal', value: notices?.filter(n => n.status === NoticeStatus.APPEAL).length || 0 },
  ];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumSignificantDigits: 3 }).format(amount);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      {/* Welcome Section */}
      <div className="flex justify-between items-end">
          <div>
            <h1 className="text-2xl font-bold text-slate-800 tracking-tight">
                Dashboard Overview
            </h1>
            <p className="text-slate-500 text-sm mt-1">
                Overview of GST compliance, recovery, and hearing schedules.
            </p>
          </div>
          <div className="text-right hidden sm:block">
              <span className="text-sm font-medium text-slate-600 bg-white px-3 py-1 rounded-full border border-slate-200 shadow-sm">
                {new Date().toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </span>
          </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
        {/* Row 1 */}
        <StatsCard 
          title="Notices Pending" 
          value={stats.pending} 
          icon={FileText} 
          color="blue" 
          trend="Active proceedings"
        />
        <StatsCard 
          title="Demand Payable" 
          value={formatCurrency(stats.outstanding)} 
          icon={AlertTriangle} 
          color="amber" 
          trend="Outstanding Liability"
        />
        <StatsCard 
          title="Recovered (This Month)" 
          value={formatCurrency(stats.monthRecovery)} 
          icon={TrendingUp} 
          color="green" 
          trend="Payments received"
        />
        <StatsCard 
          title="Overdue Notices" 
          value={stats.overdue} 
          icon={Clock} 
          color="red" 
          trend="Action required immediately"
        />

        {/* Row 2 */}
        <StatsCard 
          title="Critical Risk Cases" 
          value={stats.criticalRisk} 
          icon={ShieldAlert} 
          color="red" 
          trend="High Exposure Active"
        />
         <StatsCard 
          title="Hearings (Next 7 Days)" 
          value={stats.hearingsThisWeek} 
          icon={CalendarClock} 
          color="blue" 
          trend="Upcoming Schedule"
        />
        <StatsCard 
          title="Unassigned Cases" 
          value={stats.unassigned} 
          icon={UserX} 
          color="amber" 
          trend="Needs allocation"
        />
         <StatsCard 
          title="In Drafting" 
          value={stats.drafting} 
          icon={PenTool} 
          color="blue" 
          trend="Replies in progress"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Charts & Graphs */}
          <div className="lg:col-span-2 space-y-6">
              
              {/* Status Distribution Chart */}
              <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                        <PieIcon size={18} className="text-slate-400"/> Status Distribution
                    </h3>
                </div>
                <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={statusData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 11}} dy={10} />
                            <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 11}} />
                            <Tooltip 
                                cursor={{fill: '#f8fafc'}}
                                contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            />
                            <Bar dataKey="value" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40}>
                                {statusData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={['#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'][index % 5]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>
              </div>

              {/* Recent Notices List */}
              <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                          <FileText size={18} className="text-slate-400"/> Recent Notices
                      </h3>
                      <Link to="/notices" className="text-xs text-blue-600 font-medium hover:underline flex items-center gap-1">
                          View All <ArrowRight size={12}/>
                      </Link>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                        <thead className="text-xs text-slate-400 uppercase bg-slate-50 border-b border-slate-100">
                            <tr>
                                <th className="px-3 py-2 font-medium">Notice #</th>
                                <th className="px-3 py-2 font-medium">GSTIN</th>
                                <th className="px-3 py-2 font-medium">Due Date</th>
                                <th className="px-3 py-2 font-medium">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {notices
                                ?.sort((a, b) => b.id! - a.id!)
                                .slice(0, 5)
                                .map((notice) => (
                                <tr key={notice.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-3 py-3 font-medium text-slate-900">{notice.noticeNumber}</td>
                                    <td className="px-3 py-3 text-slate-500 text-xs font-mono">{notice.gstin}</td>
                                    <td className="px-3 py-3 text-slate-600 text-xs">
                                        {new Date(notice.dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                                    </td>
                                    <td className="px-3 py-3">
                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase border
                                            ${notice.status === NoticeStatus.CLOSED ? 'bg-slate-100 text-slate-500 border-slate-200' : 
                                              notice.status === NoticeStatus.HEARING ? 'bg-purple-50 text-purple-700 border-purple-100' : 
                                              'bg-blue-50 text-blue-600 border-blue-100'}`}>
                                            {notice.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                            {!notices?.length && <tr><td colSpan={4} className="text-center py-4 text-slate-400 text-xs">No notices found</td></tr>}
                        </tbody>
                    </table>
                  </div>
              </div>
          </div>

          {/* Right Column: Hearings & Payments */}
          <div className="space-y-6">
              
              {/* Upcoming Hearings */}
              <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                 <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                     <Gavel size={18} className="text-purple-500"/> Upcoming Hearings
                 </h3>
                 <div className="space-y-3">
                     {hearings && hearings.length > 0 ? (
                         hearings.slice(0, 4).map(notice => (
                             <div key={notice.id} className="p-3 bg-purple-50 border border-purple-100 rounded-lg">
                                 <div className="flex justify-between items-start mb-1">
                                     <span className="font-medium text-purple-900 text-sm">{notice.noticeNumber}</span>
                                     <span className="text-[10px] bg-white px-1.5 py-0.5 rounded text-purple-600 border border-purple-100">
                                         {new Date(notice.dueDate).toLocaleDateString('en-IN', {day: '2-digit', month: 'short'})}
                                     </span>
                                 </div>
                                 <p className="text-xs text-purple-700 truncate">{notice.issuingAuthority}</p>
                                 <Link to={`/notices/${notice.id}`} className="text-[10px] text-purple-600 underline mt-1 block">View Details</Link>
                             </div>
                         ))
                     ) : (
                         <div className="text-center py-6 bg-slate-50 rounded-lg border border-dashed border-slate-200">
                             <Gavel size={24} className="mx-auto text-slate-300 mb-2"/>
                             <p className="text-xs text-slate-500">No hearings scheduled</p>
                         </div>
                     )}
                 </div>
              </div>

              {/* Recent Payments */}
              <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                 <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                     <CreditCard size={18} className="text-green-600"/> Recent Payments
                 </h3>
                 <div className="space-y-0 divide-y divide-slate-50">
                     {recentPayments && recentPayments.length > 0 ? (
                         recentPayments.map(payment => (
                             <div key={payment.id} className="py-3 flex justify-between items-center">
                                 <div>
                                     <p className="text-sm font-medium text-slate-800">{formatCurrency(payment.amount)}</p>
                                     <p className="text-[10px] text-slate-500 uppercase">{payment.majorHead} - {payment.minorHead} • {new Date(payment.paymentDate).toLocaleDateString()}</p>
                                 </div>
                                 <div className="text-right">
                                     <span className="text-[10px] text-slate-400 font-mono block">{payment.challanNumber.slice(0, 10)}...</span>
                                 </div>
                             </div>
                         ))
                     ) : (
                         <div className="text-center py-6 text-slate-400 text-xs">
                             No recent payments recorded
                         </div>
                     )}
                 </div>
                 {recentPayments && recentPayments.length > 0 && (
                     <div className="mt-4 pt-3 border-t border-slate-100 text-center">
                         <span className="text-xs text-green-600 font-medium">
                            Total Recovered: {formatCurrency(stats.monthRecovery)} (This Month)
                         </span>
                     </div>
                 )}
              </div>
          </div>
      </div>
    </div>
  );
};

export default Dashboard;
