
import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { TeamTimeSheet, UserRole } from '../types';
import { Plus, Clock, Calendar, Briefcase, FileText, BarChart2, Trash2, X, Save, User, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, PieChart, Pie, Cell } from 'recharts';

const TimeSheet: React.FC = () => {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'my_logs' | 'team_logs' | 'reports'>('my_logs');
  const [showLogModal, setShowLogModal] = useState(false);
  
  // Form State
  const [logData, setLogData] = useState<Partial<TeamTimeSheet>>({
      date: new Date().toISOString().split('T')[0],
      hoursSpent: 1,
      description: ''
  });
  
  // Data Fetching
  const notices = useLiveQuery(() => db.notices.where('status').notEqual('Closed').toArray()) || [];
  const defects = useLiveQuery(() => logData.noticeId ? db.defects.where('noticeId').equals(logData.noticeId!).toArray() : [], [logData.noticeId]) || [];
  
  const myLogs = useLiveQuery(() => user ? db.timeSheets.where('teamMember').equals(user.username).reverse().toArray() : [], [user]);
  const allLogs = useLiveQuery(() => db.timeSheets.reverse().toArray()) || [];
  const allUsers = useLiveQuery(() => db.users.toArray()) || [];

  // Filter state for Team Logs
  const [teamFilter, setTeamFilter] = useState({ member: '', month: new Date().toISOString().slice(0, 7) });

  const filteredTeamLogs = allLogs.filter(log => {
      const matchMember = teamFilter.member ? log.teamMember === teamFilter.member : true;
      const matchMonth = log.date.startsWith(teamFilter.month);
      return matchMember && matchMonth;
  });

  // Report Data
  const executiveProductivity = React.useMemo(() => {
      const stats: Record<string, number> = {};
      allLogs.forEach(log => {
          stats[log.teamMember] = (stats[log.teamMember] || 0) + log.hoursSpent;
      });
      return Object.entries(stats).map(([name, hours]) => ({ name, hours }));
  }, [allLogs]);

  const clientAnalysis = React.useMemo(() => {
      // Need to join with Notices to get Taxpayer info (GSTIN)
      // Since this is client-side, we can do it inefficiently for small datasets or map it
      // Let's create a map of noticeId -> gstin first
      // Note: `notices` above only has OPEN notices. We need ALL notices for accurate historical reporting.
      // Ideally we should query all notices, but for now we might miss closed ones if we rely on `notices` var.
      // Let's fetch basic notice info for mapping.
      return []; // Placeholder until async load
  }, [allLogs]);

  // Async Effect for Client Analysis (requires notice lookup)
  const [clientChartData, setClientChartData] = useState<{name: string, hours: number}[]>([]);
  useEffect(() => {
      const generateClientData = async () => {
          const stats: Record<string, number> = {};
          for (const log of allLogs) {
              const notice = await db.notices.get(log.noticeId);
              if (notice) {
                  const label = notice.gstin; // Or trade name if available
                  stats[label] = (stats[label] || 0) + log.hoursSpent;
              }
          }
          const data = Object.entries(stats)
              .map(([name, hours]) => ({ name, hours }))
              .sort((a,b) => b.hours - a.hours)
              .slice(0, 10); // Top 10
          setClientChartData(data);
      };
      if (activeTab === 'reports') generateClientData();
  }, [activeTab, allLogs]);


  const handleSaveLog = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!user || !logData.noticeId || !logData.hoursSpent) {
          alert("Please fill required fields");
          return;
      }

      try {
          await db.timeSheets.add({
              noticeId: logData.noticeId,
              defectId: logData.defectId,
              teamMember: user.username,
              date: logData.date!,
              hoursSpent: parseFloat(logData.hoursSpent.toString()),
              description: logData.description || ''
          });
          
          await db.auditLogs.add({
              entityType: 'TimeSheet', entityId: 'LOG', action: 'Create', timestamp: new Date().toISOString(),
              user: user.username, details: `Logged ${logData.hoursSpent}h for Notice #${logData.noticeId}`
          });

          setShowLogModal(false);
          setLogData({ date: new Date().toISOString().split('T')[0], hoursSpent: 1, description: '', noticeId: undefined, defectId: undefined });
      } catch (e) {
          console.error(e);
          alert("Error saving log.");
      }
  };

  const handleDeleteLog = async (id: number) => {
      if (confirm("Delete this entry?")) {
          await db.timeSheets.delete(id);
      }
  };

  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

  return (
    <div className="space-y-6 pb-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">Time Sheet & Work Log</h2>
                <p className="text-slate-500 text-sm">Track time spent on notices and compliance tasks</p>
            </div>
            <div className="flex gap-2">
                <button onClick={() => setShowLogModal(true)} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all font-medium">
                    <Plus size={18} /> Log Work
                </button>
            </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden min-h-[600px]">
            <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
                <button onClick={() => setActiveTab('my_logs')} className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'my_logs' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>
                    <User size={16}/> My Logs
                </button>
                {(user?.role === UserRole.ADMIN || user?.role === UserRole.SENIOR_ASSOCIATE) && (
                    <button onClick={() => setActiveTab('team_logs')} className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'team_logs' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>
                        <Briefcase size={16}/> Team Logs
                    </button>
                )}
                <button onClick={() => setActiveTab('reports')} className={`px-6 py-4 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'reports' ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}>
                    <BarChart2 size={16}/> Reports
                </button>
            </div>

            <div className="p-6">
                {activeTab === 'my_logs' && (
                    <div className="space-y-4 animate-in fade-in">
                        <div className="flex items-center gap-4 mb-4 p-4 bg-blue-50 border border-blue-100 rounded-xl">
                            <div className="p-3 bg-blue-200 text-blue-700 rounded-full"><Clock size={24}/></div>
                            <div>
                                <h3 className="text-lg font-bold text-blue-800">Total Hours Logged</h3>
                                <p className="text-sm text-blue-600">You have logged <b>{myLogs?.reduce((acc, l) => acc + l.hoursSpent, 0).toFixed(1)} hours</b> in total.</p>
                            </div>
                        </div>

                        <div className="overflow-hidden border border-slate-200 rounded-xl">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="px-6 py-3">Date</th>
                                        <th className="px-6 py-3">Notice</th>
                                        <th className="px-6 py-3">Description</th>
                                        <th className="px-6 py-3 text-right">Hours</th>
                                        <th className="px-6 py-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {myLogs?.map(log => {
                                        const notice = notices.find(n => n.id === log.noticeId);
                                        return (
                                            <tr key={log.id} className="hover:bg-slate-50">
                                                <td className="px-6 py-3 font-medium text-slate-700">{log.date}</td>
                                                <td className="px-6 py-3">
                                                    {notice ? (
                                                        <div>
                                                            <div className="font-semibold text-slate-800">{notice.noticeNumber}</div>
                                                            <div className="text-xs text-slate-500">{notice.gstin}</div>
                                                        </div>
                                                    ) : <span className="text-slate-400 italic">Notice #{log.noticeId}</span>}
                                                </td>
                                                <td className="px-6 py-3 text-slate-600 max-w-xs truncate" title={log.description}>{log.description}</td>
                                                <td className="px-6 py-3 text-right font-bold text-slate-700">{log.hoursSpent}</td>
                                                <td className="px-6 py-3 text-right">
                                                    <button onClick={() => handleDeleteLog(log.id!)} className="text-slate-400 hover:text-red-500"><Trash2 size={16}/></button>
                                                </td>
                                            </tr>
                                        )
                                    })}
                                    {myLogs?.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">No logs found.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'team_logs' && (
                    <div className="space-y-6 animate-in fade-in">
                        <div className="flex gap-4 items-end bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Team Member</label>
                                <select className="p-2 border rounded text-sm min-w-[200px]" value={teamFilter.member} onChange={e => setTeamFilter({...teamFilter, member: e.target.value})}>
                                    <option value="">All Members</option>
                                    {allUsers.map(u => <option key={u.id} value={u.username}>{u.fullName}</option>)}
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Month</label>
                                <input type="month" className="p-2 border rounded text-sm" value={teamFilter.month} onChange={e => setTeamFilter({...teamFilter, month: e.target.value})} />
                            </div>
                        </div>

                        <div className="overflow-hidden border border-slate-200 rounded-xl">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold border-b border-slate-200">
                                    <tr>
                                        <th className="px-6 py-3">Date</th>
                                        <th className="px-6 py-3">Member</th>
                                        <th className="px-6 py-3">Notice</th>
                                        <th className="px-6 py-3">Description</th>
                                        <th className="px-6 py-3 text-right">Hours</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredTeamLogs.map(log => (
                                        <tr key={log.id} className="hover:bg-slate-50">
                                            <td className="px-6 py-3 text-slate-600">{log.date}</td>
                                            <td className="px-6 py-3 font-medium text-blue-700">{log.teamMember}</td>
                                            <td className="px-6 py-3 text-xs text-slate-500">Notice #{log.noticeId}</td>
                                            <td className="px-6 py-3 text-slate-600 max-w-xs truncate">{log.description}</td>
                                            <td className="px-6 py-3 text-right font-bold text-slate-700">{log.hoursSpent}</td>
                                        </tr>
                                    ))}
                                    {filteredTeamLogs.length === 0 && <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">No logs found matching filters.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {activeTab === 'reports' && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 animate-in fade-in">
                        <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
                            <h3 className="font-bold text-slate-700 mb-6 flex items-center gap-2"><BarChart2 size={18}/> Executive Productivity (Total Hours)</h3>
                            <div className="h-72">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={executiveProductivity} layout="vertical" margin={{top: 5, right: 30, left: 20, bottom: 5}}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                        <XAxis type="number" />
                                        <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} />
                                        <Tooltip />
                                        <Bar dataKey="hours" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={24} name="Hours Worked" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white p-4 border border-slate-200 rounded-xl shadow-sm">
                            <h3 className="font-bold text-slate-700 mb-6 flex items-center gap-2"><Briefcase size={18}/> Client-wise Time Cost (Top 10)</h3>
                            <div className="h-72">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={clientChartData} dataKey="hours" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#8884d8" label>
                                            {clientChartData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend wrapperStyle={{fontSize: '11px'}} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>

        {/* LOG WORK MODAL */}
        {showLogModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Clock className="text-blue-600"/> Log Work</h3>
                        <button onClick={() => setShowLogModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                    </div>
                    
                    <form onSubmit={handleSaveLog} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                                <input type="date" required value={logData.date} onChange={e => setLogData({...logData, date: e.target.value})} className="w-full p-2.5 border rounded-lg"/>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Hours Spent</label>
                                <input type="number" step="0.5" required value={logData.hoursSpent} onChange={e => setLogData({...logData, hoursSpent: parseFloat(e.target.value)})} className="w-full p-2.5 border rounded-lg"/>
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Select Notice <span className="text-red-500">*</span></label>
                            <select required value={logData.noticeId || ''} onChange={e => setLogData({...logData, noticeId: parseInt(e.target.value), defectId: undefined})} className="w-full p-2.5 border rounded-lg bg-white">
                                <option value="">-- Choose Notice --</option>
                                {notices.map(n => <option key={n.id} value={n.id}>{n.noticeNumber} - {n.gstin}</option>)}
                            </select>
                        </div>

                        {logData.noticeId && defects.length > 0 && (
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Related Defect (Optional)</label>
                                <select value={logData.defectId || ''} onChange={e => setLogData({...logData, defectId: parseInt(e.target.value)})} className="w-full p-2.5 border rounded-lg bg-white">
                                    <option value="">-- General Work --</option>
                                    {defects.map(d => <option key={d.id} value={d.id}>{d.defectType}</option>)}
                                </select>
                            </div>
                        )}

                        <div>
                            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                            <textarea required placeholder="What did you work on?" rows={3} value={logData.description} onChange={e => setLogData({...logData, description: e.target.value})} className="w-full p-2.5 border rounded-lg resize-none"></textarea>
                        </div>

                        <div className="flex justify-end pt-2">
                            <button type="submit" className="bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-blue-700 shadow-sm flex items-center gap-2">
                                <Save size={18}/> Save Log
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )}
    </div>
  );
};

export default TimeSheet;
