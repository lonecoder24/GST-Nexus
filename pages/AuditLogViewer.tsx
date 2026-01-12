
import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Search, Activity, Filter, Clock } from 'lucide-react';

const AuditLogViewer: React.FC = () => {
  const [filterType, setFilterType] = useState('All');
  const [search, setSearch] = useState('');

  const logs = useLiveQuery(async () => {
      let collection = db.auditLogs.reverse(); // Newest first
      let result = await collection.toArray();

      if (filterType !== 'All') {
          result = result.filter(l => l.entityType === filterType);
      }
      if (search) {
          const lower = search.toLowerCase();
          result = result.filter(l => 
            l.user.toLowerCase().includes(lower) || 
            l.details.toLowerCase().includes(lower) ||
            String(l.entityId).includes(lower)
          );
      }
      return result;
  }, [filterType, search]);

  const formatDetails = (details: string) => {
    try {
        if (!details.startsWith('{') && !details.startsWith('[')) return details;
        const obj = JSON.parse(details);
        
        // Handle Admin User Creation Logs
        if (obj.message) return obj.message;

        // Handle Notice Objects
        if (obj.noticeNumber && obj.gstin) {
            return `Details updated for Notice ${obj.noticeNumber}`;
        }
        
        // Handle Taxpayer Objects
        if (obj.gstin && obj.tradeName) {
            return `Details updated for Taxpayer ${obj.tradeName}`;
        }

        // Generic Key-Value fallback
        return (
            <div className="text-xs text-slate-500">
                {Object.keys(obj).slice(0, 3).map(k => (
                    <span key={k} className="mr-2 inline-block bg-slate-100 px-1 rounded">
                        {k}: {typeof obj[k] === 'object' ? '...' : obj[k]}
                    </span>
                ))}
                {Object.keys(obj).length > 3 && <span>...</span>}
            </div>
        );
    } catch (e) {
        return details;
    }
  };

  return (
    <div className="space-y-6">
        <div className="flex items-center gap-3">
             <div className="p-2 bg-slate-800 text-white rounded-lg"><Activity size={24}/></div>
             <div>
                 <h2 className="text-2xl font-bold text-slate-800">System Audit Logs</h2>
                 <p className="text-slate-500 text-sm">Track all user activities and data changes</p>
             </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row gap-4 justify-between bg-slate-50">
                <div className="flex items-center gap-2 bg-white px-3 py-2 rounded border border-slate-300 w-full md:w-64">
                    <Search size={16} className="text-slate-400"/>
                    <input 
                        type="text" placeholder="Search logs..." 
                        className="bg-transparent outline-none text-sm w-full"
                        value={search} onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Filter size={16} className="text-slate-500"/>
                    <select 
                        className="bg-white border border-slate-300 text-sm rounded p-2 outline-none"
                        value={filterType} onChange={e => setFilterType(e.target.value)}
                    >
                        <option value="All">All Entities</option>
                        <option value="Notice">Notice</option>
                        <option value="Payment">Payment</option>
                        <option value="Taxpayer">Taxpayer</option>
                        <option value="Auth">Auth</option>
                        <option value="System">System</option>
                    </select>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-3">Timestamp</th>
                            <th className="px-6 py-3">User</th>
                            <th className="px-6 py-3">Action</th>
                            <th className="px-6 py-3">Entity</th>
                            <th className="px-6 py-3">Details</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {logs?.map(log => (
                            <tr key={log.id} className="hover:bg-slate-50">
                                <td className="px-6 py-3 whitespace-nowrap text-slate-600">
                                    <div className="flex items-center gap-2">
                                        <Clock size={14} className="text-slate-400"/>
                                        {new Date(log.timestamp).toLocaleString()}
                                    </div>
                                </td>
                                <td className="px-6 py-3 font-medium text-slate-800">{log.user}</td>
                                <td className="px-6 py-3">
                                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                                        log.action === 'Create' ? 'bg-green-100 text-green-700' :
                                        log.action === 'Delete' ? 'bg-red-100 text-red-700' :
                                        log.action === 'Update' ? 'bg-blue-100 text-blue-700' :
                                        'bg-slate-100 text-slate-600'
                                    }`}>
                                        {log.action}
                                    </span>
                                </td>
                                <td className="px-6 py-3">
                                    <span className="text-slate-600">{log.entityType}</span>
                                    <span className="text-xs text-slate-400 ml-1">#{log.entityId}</span>
                                </td>
                                <td className="px-6 py-3">
                                    <div className="truncate max-w-lg text-slate-500" title={typeof log.details === 'string' ? log.details : 'Details'}>
                                        {formatDetails(log.details)}
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {logs?.length === 0 && (
                            <tr><td colSpan={5} className="px-6 py-8 text-center text-slate-400">No logs found matching criteria.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    </div>
  );
};

export default AuditLogViewer;
