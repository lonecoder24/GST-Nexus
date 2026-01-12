import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Notice, PaymentLog, NoticeDefect, Taxpayer } from '../types';
import { FileDown, PieChart, BarChart, FileText, Users, AlertCircle, Layers, ArrowUpDown, ChevronUp, ChevronDown, ListFilter } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ResponsiveContainer, BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';

interface ArnData {
  arn: string;
  count: number;
  demand: number;
  paid: number;
  statuses: Set<string>;
}

interface DefectData {
  type: string;
  count: number;
  demand: number;
}

const Reports: React.FC = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'clients' | 'cases' | 'defects' | 'status'>('clients');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

    // Data Fetching
    const notices = useLiveQuery(() => db.notices.toArray()) || [];
    const payments = useLiveQuery(() => db.payments.toArray()) || [];
    const taxpayers = useLiveQuery(() => db.taxpayers.toArray()) || [];
    const defects = useLiveQuery(() => db.defects.toArray()) || [];

    // Pre-calculate payments per notice for efficiency
    const paymentMap = React.useMemo(() => {
        return payments.reduce((acc, p) => {
            acc[p.noticeId] = (acc[p.noticeId] || 0) + p.amount;
            return acc;
        }, {} as Record<number, number>);
    }, [payments]);

    // --- Report Calculations ---

    const rawClientReport = taxpayers.map(t => {
        const clientNotices = notices.filter(n => n.gstin === t.gstin);
        const noticeIds = new Set(clientNotices.map(n => n.id));
        const clientPayments = payments.filter(p => noticeIds.has(p.noticeId));

        const totalDemand = clientNotices.reduce((sum, n) => sum + (n.demandAmount || 0), 0);
        const totalPaid = clientPayments.reduce((sum, p) => sum + p.amount, 0);

        // Status Breakdown for this client
        const statusMap = clientNotices.reduce((acc, n) => {
            acc[n.status] = (acc[n.status] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        
        const statusStr = Object.entries(statusMap).map(([k, v]) => `${k} (${v})`).join(', ');

        return {
            id: t.id,
            tradeName: t.tradeName,
            gstin: t.gstin,
            noticesCount: clientNotices.length,
            totalDemand,
            totalPaid,
            outstanding: totalDemand - totalPaid,
            statusStr
        };
    });

    // Sort Client Report
    const clientReport = React.useMemo(() => {
        let sorted = [...rawClientReport];
        if (sortConfig) {
            sorted.sort((a, b) => {
                const aValue = (a as any)[sortConfig.key];
                const bValue = (b as any)[sortConfig.key];
                if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        } else {
            sorted.sort((a, b) => b.outstanding - a.outstanding); // Default sort
        }
        return sorted;
    }, [rawClientReport, sortConfig]);


    const arnReport = Object.entries(
        notices.reduce((acc, n) => {
            const key = n.arn || 'No ARN';
            if (!acc[key]) acc[key] = { arn: key, count: 0, demand: 0, paid: 0, statuses: new Set<string>() };
            acc[key].count++;
            acc[key].demand += (n.demandAmount || 0);
            acc[key].statuses.add(n.status);
            return acc;
        }, {} as Record<string, ArnData>)
    ).map(([key, val]: [string, ArnData]) => {
        // Calculate paid for this ARN
        const relatedNoticeIds = new Set(notices.filter(n => (n.arn || 'No ARN') === key).map(n => n.id));
        const paid = payments.filter(p => relatedNoticeIds.has(p.noticeId)).reduce((sum, p) => sum + p.amount, 0);
        return { ...val, paid, outstanding: val.demand - paid, statusStr: Array.from(val.statuses).join(', ') };
    }).sort((a, b) => b.demand - a.demand);

    const defectReport = Object.entries(
        defects.reduce((acc, d) => {
            const key = d.defectType || 'Unknown';
            if (!acc[key]) acc[key] = { type: key, count: 0, demand: 0 };
            acc[key].count++;
            acc[key].demand += ((d.taxDemand || 0) + (d.interestDemand || 0) + (d.penaltyDemand || 0));
            return acc;
        }, {} as Record<string, DefectData>)
    ).map(([_, val]: [string, DefectData]) => val).sort((a, b) => b.count - a.count);

    // Status Wise Summary Report
    const statusReport = React.useMemo(() => {
        const stats = notices.reduce((acc, n) => {
            const key = n.status || 'Unknown';
            if (!acc[key]) acc[key] = { status: key, count: 0, demand: 0, paid: 0 };
            acc[key].count++;
            acc[key].demand += (n.demandAmount || 0);
            acc[key].paid += (paymentMap[n.id!] || 0);
            return acc;
        }, {} as Record<string, any>);

        return Object.values(stats).map((val: any) => ({
            ...val,
            outstanding: val.demand - val.paid
        })).sort((a: any, b: any) => b.count - a.count);
    }, [notices, paymentMap]);

    // --- Export Functions ---

    const exportToExcel = () => {
        const wb = XLSX.utils.book_new();
        
        if (activeTab === 'clients') {
            const ws = XLSX.utils.json_to_sheet(clientReport);
            XLSX.utils.book_append_sheet(wb, ws, "Client Report");
        } else if (activeTab === 'cases') {
            const ws = XLSX.utils.json_to_sheet(arnReport.map(r => ({...r, statuses: undefined, status: r.statusStr})));
            XLSX.utils.book_append_sheet(wb, ws, "Case ARN Report");
        } else if (activeTab === 'defects') {
            const ws = XLSX.utils.json_to_sheet(defectReport);
            XLSX.utils.book_append_sheet(wb, ws, "Defect Analysis");
        } else if (activeTab === 'status') {
            const ws = XLSX.utils.json_to_sheet(statusReport);
            XLSX.utils.book_append_sheet(wb, ws, "Status Summary");
        }

        XLSX.writeFile(wb, `GST_Nexus_Report_${activeTab}_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    const handleSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'desc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const SortIcon = ({ column }: { column: string }) => {
        if (sortConfig?.key !== column) return <ArrowUpDown size={12} className="opacity-30 inline ml-1" />;
        return sortConfig.direction === 'asc' ? <ChevronUp size={12} className="inline ml-1" /> : <ChevronDown size={12} className="inline ml-1" />;
    };

    // --- Chart Data Helpers ---
    const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ef4444', '#a855f7'];
    const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="space-y-6 pb-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800">Reports & Analytics</h2>
                    <p className="text-slate-500 text-sm">Deep dive into compliance data, liabilities, and trends</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={exportToExcel} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all">
                        <FileDown size={18} /> Export Excel
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
                    {[
                        { id: 'clients', label: 'Client Wise', icon: Users },
                        { id: 'status', label: 'Status Summary', icon: ListFilter },
                        { id: 'cases', label: 'Case / ARN Wise', icon: Layers },
                        { id: 'defects', label: 'Defect Analysis', icon: AlertCircle },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)}
                            className={`flex-1 py-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 min-w-[140px] ${
                                activeTab === tab.id ? 'border-blue-500 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100 hover:text-slate-700'
                            }`}
                        >
                            <tab.icon size={16} /> {tab.label}
                        </button>
                    ))}
                </div>

                <div className="p-6">
                    {activeTab === 'clients' && (
                        <div className="space-y-8 animate-in fade-in">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-4">
                                    <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><BarChart size={16}/> Top 5 Clients by Outstanding Liability <span className="text-xs font-normal text-slate-400 ml-2">(Click bar to view notices)</span></h3>
                                    <div className="h-64 cursor-pointer">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ReBarChart 
                                                data={clientReport.slice(0, 5)} 
                                                layout="vertical" 
                                                margin={{top: 5, right: 30, left: 40, bottom: 5}}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="tradeName" type="category" width={100} tick={{fontSize: 10}} />
                                                <ReTooltip formatter={(value: number) => formatCurrency(value)} />
                                                <Bar 
                                                    dataKey="outstanding" 
                                                    fill="#ef4444" 
                                                    radius={[0, 4, 4, 0]} 
                                                    barSize={20} 
                                                    name="Outstanding" 
                                                    onClick={(data: any) => navigate('/notices', { state: { gstin: data.gstin } })}
                                                />
                                            </ReBarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="bg-blue-50 p-4 rounded-xl border border-blue-100">
                                        <p className="text-blue-600 text-xs font-bold uppercase">Total Clients</p>
                                        <p className="text-2xl font-bold text-blue-800">{clientReport.length}</p>
                                    </div>
                                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-100">
                                        <p className="text-amber-600 text-xs font-bold uppercase">Total Outstanding</p>
                                        <p className="text-2xl font-bold text-amber-800">{formatCurrency(clientReport.reduce((a,b) => a + b.outstanding, 0))}</p>
                                    </div>
                                </div>
                            </div>

                            <div className="overflow-x-auto border rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold cursor-pointer select-none">
                                        <tr>
                                            <th className="px-4 py-3 hover:bg-slate-100" onClick={() => handleSort('tradeName')}>Client Name <SortIcon column="tradeName"/></th>
                                            <th className="px-4 py-3 hover:bg-slate-100" onClick={() => handleSort('gstin')}>GSTIN <SortIcon column="gstin"/></th>
                                            <th className="px-4 py-3 text-center hover:bg-slate-100" onClick={() => handleSort('noticesCount')}>Notices <SortIcon column="noticesCount"/></th>
                                            <th className="px-4 py-3 hover:bg-slate-100">Status Summary</th>
                                            <th className="px-4 py-3 text-right hover:bg-slate-100" onClick={() => handleSort('totalDemand')}>Total Demand <SortIcon column="totalDemand"/></th>
                                            <th className="px-4 py-3 text-right hover:bg-slate-100" onClick={() => handleSort('totalPaid')}>Paid <SortIcon column="totalPaid"/></th>
                                            <th className="px-4 py-3 text-right hover:bg-slate-100" onClick={() => handleSort('outstanding')}>Outstanding <SortIcon column="outstanding"/></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {clientReport.map(c => (
                                            <tr key={c.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate('/notices', { state: { gstin: c.gstin } })}>
                                                <td className="px-4 py-3 font-medium text-slate-800">{c.tradeName}</td>
                                                <td className="px-4 py-3 font-mono text-slate-500 text-xs">{c.gstin}</td>
                                                <td className="px-4 py-3 text-center">{c.noticesCount}</td>
                                                <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate" title={c.statusStr}>{c.statusStr}</td>
                                                <td className="px-4 py-3 text-right">{formatCurrency(c.totalDemand)}</td>
                                                <td className="px-4 py-3 text-right text-green-600">{formatCurrency(c.totalPaid)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(c.outstanding)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'status' && (
                        <div className="space-y-8 animate-in fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="bg-white p-4 border rounded-xl">
                                    <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><PieChart size={16}/> Notice Distribution by Status <span className="text-xs font-normal text-slate-400">(Click slice to view)</span></h3>
                                    <div className="h-64 cursor-pointer">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <RePieChart>
                                                <Pie 
                                                    data={statusReport} 
                                                    dataKey="count" 
                                                    nameKey="status" 
                                                    cx="50%" 
                                                    cy="50%" 
                                                    outerRadius={80} 
                                                    label={(entry) => entry.value > 0 ? entry.value : ''}
                                                    onClick={(data: any) => navigate('/notices', { state: { status: data.status } })}
                                                >
                                                    {statusReport.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                                </Pie>
                                                <ReTooltip />
                                                <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: '10px'}}/>
                                            </RePieChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                                <div className="bg-white p-4 border rounded-xl">
                                    <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><BarChart size={16}/> Liability by Status <span className="text-xs font-normal text-slate-400">(Click bar to view)</span></h3>
                                    <div className="h-64 cursor-pointer">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ReBarChart 
                                                data={statusReport} 
                                                layout="vertical" 
                                                margin={{top: 5, right: 30, left: 40, bottom: 5}}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="status" type="category" width={120} tick={{fontSize: 9}} />
                                                <ReTooltip formatter={(value: number) => formatCurrency(value)} />
                                                <Bar 
                                                    dataKey="demand" 
                                                    fill="#8884d8" 
                                                    radius={[0, 4, 4, 0]} 
                                                    barSize={15} 
                                                    name="Total Demand"
                                                    onClick={(data: any) => navigate('/notices', { state: { status: data.status } })}
                                                />
                                            </ReBarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="overflow-x-auto border rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3 text-center">Notice Count</th>
                                            <th className="px-4 py-3 text-right">Total Demand</th>
                                            <th className="px-4 py-3 text-right">Paid</th>
                                            <th className="px-4 py-3 text-right">Outstanding</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {statusReport.map((s, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate('/notices', { state: { status: s.status } })}>
                                                <td className="px-4 py-3 font-medium text-slate-800">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs border ${
                                                        s.status === 'Closed' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600 border-blue-100'
                                                    }`}>{s.status}</span>
                                                </td>
                                                <td className="px-4 py-3 text-center">{s.count}</td>
                                                <td className="px-4 py-3 text-right font-medium text-slate-700">{formatCurrency(s.demand)}</td>
                                                <td className="px-4 py-3 text-right text-green-600">{formatCurrency(s.paid)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-red-600">{formatCurrency(s.outstanding)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'cases' && (
                        <div className="space-y-6 animate-in fade-in">
                             <div className="overflow-x-auto border rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr>
                                            <th className="px-4 py-3">Case ID (ARN)</th>
                                            <th className="px-4 py-3 text-center">Notices</th>
                                            <th className="px-4 py-3">Status Breakdown</th>
                                            <th className="px-4 py-3 text-right">Total Demand</th>
                                            <th className="px-4 py-3 text-right">Paid</th>
                                            <th className="px-4 py-3 text-right">Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {arnReport.map((c, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate('/notices', { state: { gstin: c.arn } })}>
                                                <td className="px-4 py-3 font-medium text-slate-800">{c.arn}</td>
                                                <td className="px-4 py-3 text-center">{c.count}</td>
                                                <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate" title={c.statusStr}>{c.statusStr}</td>
                                                <td className="px-4 py-3 text-right">{formatCurrency(c.demand)}</td>
                                                <td className="px-4 py-3 text-right text-green-600">{formatCurrency(c.paid)}</td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-800">{formatCurrency(c.outstanding)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'defects' && (
                        <div className="space-y-8 animate-in fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                <div className="bg-white p-4 border rounded-xl">
                                    <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><PieChart size={16}/> Defect Frequency <span className="text-xs font-normal text-slate-400">(Click to view)</span></h3>
                                    <div className="h-64 cursor-pointer">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <RePieChart>
                                                <Pie 
                                                    data={defectReport} 
                                                    dataKey="count" 
                                                    nameKey="type" 
                                                    cx="50%" 
                                                    cy="50%" 
                                                    outerRadius={80} 
                                                    label={(entry) => entry.value > 0 ? entry.value : ''}
                                                    onClick={(data: any) => navigate('/notices', { state: { defectType: data.type } })}
                                                >
                                                    {defectReport.map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                                </Pie>
                                                <ReTooltip />
                                                <Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: '10px'}}/>
                                            </RePieChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                                <div className="bg-white p-4 border rounded-xl">
                                    <h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><BarChart size={16}/> Demand by Defect Type <span className="text-xs font-normal text-slate-400">(Click to view)</span></h3>
                                    <div className="h-64 cursor-pointer">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ReBarChart 
                                                data={defectReport.slice(0, 6)} 
                                                layout="vertical" 
                                                margin={{top: 5, right: 30, left: 40, bottom: 5}}
                                            >
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="type" type="category" width={120} tick={{fontSize: 9}} />
                                                <ReTooltip formatter={(value: number) => formatCurrency(value)} />
                                                <Bar 
                                                    dataKey="demand" 
                                                    fill="#8884d8" 
                                                    radius={[0, 4, 4, 0]} 
                                                    barSize={15} 
                                                    onClick={(data: any) => navigate('/notices', { state: { defectType: data.type } })}
                                                />
                                            </ReBarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                            
                            <div className="overflow-x-auto border rounded-lg">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr>
                                            <th className="px-4 py-3">Defect Type</th>
                                            <th className="px-4 py-3 text-center">Frequency</th>
                                            <th className="px-4 py-3 text-right">Total Demand Generated</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {defectReport.map((d, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate('/notices', { state: { defectType: d.type } })}>
                                                <td className="px-4 py-3 font-medium text-slate-800">{d.type}</td>
                                                <td className="px-4 py-3 text-center">{d.count}</td>
                                                <td className="px-4 py-3 text-right font-bold text-slate-700">{formatCurrency(d.demand)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Reports;