
import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { NoticeStatus } from '../types';
import { Search, ChevronDown, ChevronRight, CheckCircle, AlertTriangle, Clock, ExternalLink, RefreshCw, AlertOctagon, Filter } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const SLA_DAYS = 7; // SLA Rule: Review within 7 days

const ClientStatus: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [showBreachesOnly, setShowBreachesOnly] = useState(false);
  const [expandedClients, setExpandedClients] = useState<number[]>([]);

  // Fetch data
  const taxpayers = useLiveQuery(() => db.taxpayers.orderBy('tradeName').toArray());
  const openNotices = useLiveQuery(() => db.notices.where('status').notEqual(NoticeStatus.CLOSED).toArray());

  // Helper to calculate days since a date
  const getDaysSince = (dateStr?: string) => {
      if (!dateStr) return Infinity; // Never checked
      const checked = new Date(dateStr);
      const today = new Date();
      const diffTime = Math.abs(today.getTime() - checked.getTime());
      return Math.floor(diffTime / (1000 * 60 * 60 * 24));
  };

  // Group data
  const clientData = React.useMemo(() => {
      if (!taxpayers || !openNotices) return [];

      const mapped = taxpayers.map(t => {
          const clientNotices = openNotices.filter(n => n.gstin === t.gstin);
          if (clientNotices.length === 0) return null; // Skip clients with no active notices

          let maxDaysSince = 0;
          let oldestCheckDate = '';
          let slaBreachCount = 0;

          clientNotices.forEach(n => {
              const days = getDaysSince(n.lastCheckedDate);
              if (days > maxDaysSince) {
                  maxDaysSince = days;
                  oldestCheckDate = n.lastCheckedDate || '';
              }
              if (days > SLA_DAYS) {
                  slaBreachCount++;
              }
          });

          return {
              ...t,
              notices: clientNotices,
              noticeCount: clientNotices.length,
              maxDaysSince,
              oldestCheckDate,
              slaBreachCount,
              hasBreach: slaBreachCount > 0
          };
      }).filter(Boolean) as any[]; // Remove nulls

      // Filter
      let filtered = mapped.filter(c => 
          c.tradeName.toLowerCase().includes(search.toLowerCase()) || 
          c.gstin.toLowerCase().includes(search.toLowerCase())
      );

      if (showBreachesOnly) {
          filtered = filtered.filter(c => c.hasBreach);
      }

      // Sort by urgency (Most days since check first)
      return filtered.sort((a, b) => b.maxDaysSince - a.maxDaysSince);

  }, [taxpayers, openNotices, search, showBreachesOnly]);

  const toggleExpand = (id: number) => {
      setExpandedClients(prev => prev.includes(id) ? prev.filter(cid => cid !== id) : [...prev, id]);
  };

  const handleMarkOneChecked = async (noticeId: number) => {
      const today = new Date().toISOString().split('T')[0];
      await db.notices.update(noticeId, { lastCheckedDate: today });
  };

  const handleMarkAllClientChecked = async (gstin: string) => {
      const today = new Date().toISOString().split('T')[0];
      if (confirm(`Mark all active notices for ${gstin} as checked today?`)) {
          const noticesToUpdate = openNotices?.filter(n => n.gstin === gstin) || [];
          for (const n of noticesToUpdate) {
              await db.notices.update(n.id!, { lastCheckedDate: today });
          }
          await db.auditLogs.add({
              entityType: 'Notice', entityId: 'BULK', action: 'Update', timestamp: new Date().toISOString(),
              user: user?.username || 'System', details: `Bulk marked 'Last Checked' for ${gstin}`
          });
      }
  };

  const getStatusColor = (days: number) => {
      if (days === Infinity) return 'text-slate-500 bg-slate-100 border-slate-200'; // Never
      if (days > SLA_DAYS) return 'text-red-700 bg-red-50 border-red-200'; // Breach
      if (days > 3) return 'text-amber-700 bg-amber-50 border-amber-200'; // Warning
      return 'text-green-700 bg-green-50 border-green-200'; // Compliant
  };

  const getStatusText = (days: number) => {
      if (days === Infinity) return 'Never Checked';
      if (days === 0) return 'Checked Today';
      if (days === 1) return 'Yesterday';
      return `${days} days ago`;
  };

  return (
    <div className="space-y-6 pb-10">
        <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">Status Tracker</h2>
                <p className="text-slate-500 text-sm">Monitor review frequency. <span className="font-semibold text-slate-700">SLA Rule: {SLA_DAYS} Days</span></p>
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
                <button 
                    onClick={() => setShowBreachesOnly(!showBreachesOnly)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        showBreachesOnly 
                        ? 'bg-red-50 border-red-200 text-red-700' 
                        : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                    }`}
                >
                    <Filter size={16}/> 
                    {showBreachesOnly ? 'Showing Breaches' : 'Show Breaches Only'}
                </button>
                <div className="relative flex-1 md:w-64">
                    <Search className="absolute left-3 top-2.5 text-slate-400" size={16}/>
                    <input 
                        type="text" 
                        placeholder="Search Client..." 
                        className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 grid grid-cols-12 text-xs font-bold text-slate-500 uppercase">
                <div className="col-span-5 md:col-span-4">Client Details</div>
                <div className="col-span-3 md:col-span-2 text-center">Active Notices</div>
                <div className="col-span-4 md:col-span-4 text-left">Review Status</div>
                <div className="hidden md:block md:col-span-2 text-right">Actions</div>
            </div>

            <div className="divide-y divide-slate-100">
                {clientData.length === 0 ? (
                    <div className="p-10 text-center text-slate-400">
                        {showBreachesOnly ? (
                            <>
                                <CheckCircle size={48} className="mx-auto mb-2 text-green-500 opacity-50"/>
                                <p className="text-slate-600 font-medium">No SLA breaches found.</p>
                                <p className="text-sm">Great job! All notices are being reviewed on time.</p>
                            </>
                        ) : (
                            <>
                                <CheckCircle size={48} className="mx-auto mb-2 opacity-20"/>
                                <p>No active clients found matching your search.</p>
                            </>
                        )}
                    </div>
                ) : (
                    clientData.map(client => {
                        const isExpanded = expandedClients.includes(client.id);
                        const statusClass = getStatusColor(client.maxDaysSince);
                        const isBreach = client.maxDaysSince > SLA_DAYS;
                        
                        return (
                            <div key={client.id} className="group">
                                {/* Parent Row */}
                                <div 
                                    className={`grid grid-cols-12 px-6 py-4 items-center cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/30' : 'hover:bg-slate-50'} ${isBreach ? 'bg-red-50/10' : ''}`}
                                    onClick={() => toggleExpand(client.id)}
                                >
                                    <div className="col-span-5 md:col-span-4 flex items-center gap-3">
                                        <button className="text-slate-400 hover:text-blue-600 transition-colors">
                                            {isExpanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
                                        </button>
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <h4 className="font-bold text-slate-800 text-sm">{client.tradeName}</h4>
                                                {client.hasBreach && (
                                                    <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded font-bold border border-red-200">
                                                        {client.slaBreachCount} Overdue
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-slate-500 font-mono">{client.gstin}</p>
                                        </div>
                                    </div>
                                    <div className="col-span-3 md:col-span-2 text-center">
                                        <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-full text-xs font-bold border border-slate-200">
                                            {client.noticeCount}
                                        </span>
                                    </div>
                                    <div className="col-span-4 md:col-span-4">
                                        <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusClass}`}>
                                            {client.maxDaysSince > SLA_DAYS ? <AlertOctagon size={12}/> : <CheckCircle size={12}/>}
                                            {client.maxDaysSince === Infinity ? 'Never Reviewed' : 
                                             client.maxDaysSince > SLA_DAYS ? `SLA Breach (${client.maxDaysSince} days)` : 
                                             client.maxDaysSince === 0 ? 'Up to Date' : 
                                             `Checked ${getStatusText(client.maxDaysSince)}`}
                                        </div>
                                    </div>
                                    <div className="hidden md:block md:col-span-2 text-right">
                                        <button 
                                            onClick={(e) => { e.stopPropagation(); handleMarkAllClientChecked(client.gstin); }}
                                            className="text-xs bg-white border border-slate-300 text-slate-700 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 px-3 py-1.5 rounded transition-all opacity-0 group-hover:opacity-100 flex items-center gap-1 ml-auto"
                                        >
                                            <RefreshCw size={12}/> Review All
                                        </button>
                                    </div>
                                </div>

                                {/* Child Rows (Notices) */}
                                {isExpanded && (
                                    <div className="bg-slate-50/50 border-y border-slate-100 px-6 py-2">
                                        <div className="ml-8 space-y-2 my-2">
                                            {client.notices.map((notice: any) => {
                                                const days = getDaysSince(notice.lastCheckedDate);
                                                const isNoticeBreach = days > SLA_DAYS;
                                                
                                                return (
                                                    <div key={notice.id} className={`flex justify-between items-center bg-white p-3 rounded-lg border shadow-sm ${isNoticeBreach ? 'border-red-200 ring-1 ring-red-50' : 'border-slate-200'}`}>
                                                        <div className="flex items-center gap-3">
                                                            <div className={`w-1.5 h-10 rounded-full ${notice.riskLevel === 'Critical' ? 'bg-red-500' : notice.riskLevel === 'High' ? 'bg-orange-500' : 'bg-green-500'}`}></div>
                                                            <div>
                                                                <p className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                                                                    {notice.noticeNumber}
                                                                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 rounded border border-slate-200">{notice.noticeType}</span>
                                                                </p>
                                                                <p className="text-xs text-slate-500 mt-0.5">Due: {notice.dueDate}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex items-center gap-4">
                                                            <div className="text-right">
                                                                <p className="text-[10px] text-slate-400 uppercase font-bold">Last Checked</p>
                                                                <p className={`text-xs font-medium ${isNoticeBreach ? 'text-red-700 font-bold' : 'text-slate-700'}`}>
                                                                    {days === Infinity ? 'Never' : getStatusText(days)}
                                                                </p>
                                                            </div>
                                                            <div className="flex gap-2">
                                                                <button 
                                                                    onClick={() => handleMarkOneChecked(notice.id)} 
                                                                    className="p-1.5 text-blue-600 hover:bg-blue-50 rounded border border-transparent hover:border-blue-100 transition-colors" 
                                                                    title="Mark Checked Today"
                                                                >
                                                                    <CheckCircle size={16}/>
                                                                </button>
                                                                <button 
                                                                    onClick={() => navigate(`/notices/${notice.id}`)}
                                                                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors"
                                                                    title="Open Notice"
                                                                >
                                                                    <ExternalLink size={16}/>
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    </div>
  );
};

export default ClientStatus;
