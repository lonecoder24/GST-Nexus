
import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { FileDown, PieChart, BarChart, FileText, Users, AlertCircle, Layers, ArrowUpDown, ChevronUp, ChevronDown, ListFilter, ArrowRight, User, Database, Link as LinkIcon, ExternalLink, Map, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ResponsiveContainer, BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend, PieChart as RePieChart, Pie, Cell } from 'recharts';
import { useNavigate } from 'react-router-dom';

interface ArnData { arn: string; count: number; demand: number; paid: number; statuses: Set<string>; }
interface DefectData { type: string; count: number; demand: number; }
interface CircleData { circle: string; clientCount: number; noticeCount: number; demand: number; paid: number; }

const Reports: React.FC = () => {
    const navigate = useNavigate();
    const [activeTab, setActiveTab] = useState<'clients' | 'cases' | 'defects' | 'status' | 'powerbi' | 'jurisdiction'>('clients');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [powerBiUrl, setPowerBiUrl] = useState('');
    const [searchTerm, setSearchTerm] = useState('');

    const notices = useLiveQuery(() => db.notices.toArray()) || [];
    const payments = useLiveQuery(() => db.payments.toArray()) || [];
    const taxpayers = useLiveQuery(() => db.taxpayers.toArray()) || [];
    const defects = useLiveQuery(() => db.defects.toArray()) || [];

    useEffect(() => {
        const storedUrl = localStorage.getItem('powerbi_embed_url');
        if (storedUrl) setPowerBiUrl(storedUrl);
    }, []);

    const savePowerBiUrl = () => {
        localStorage.setItem('powerbi_embed_url', powerBiUrl);
        alert('URL Saved');
    };

    const paymentMap = React.useMemo(() => {
        return payments.reduce((acc, p) => { acc[p.noticeId] = (acc[p.noticeId] || 0) + p.amount; return acc; }, {} as Record<number, number>);
    }, [payments]);

    const rawClientReport = React.useMemo(() => {
        return taxpayers.map(t => {
            const clientNotices = notices.filter(n => n.gstin === t.gstin);
            const totalDemand = clientNotices.reduce((sum, n) => sum + (n.demandAmount || 0), 0);
            const noticeIds = new Set(clientNotices.map(n => n.id));
            const totalPaid = payments.filter(p => noticeIds.has(p.noticeId)).reduce((sum, p) => sum + p.amount, 0);
            const statusMap = clientNotices.reduce((acc, n) => { acc[n.status] = (acc[n.status] || 0) + 1; return acc; }, {} as Record<string, number>);
            return { id: t.id, tradeName: t.tradeName, gstin: t.gstin, noticesCount: clientNotices.length, totalDemand, totalPaid, outstanding: totalDemand - totalPaid, statusStr: Object.entries(statusMap).map(([k, v]) => `${k} (${v})`).join(', ') };
        });
    }, [taxpayers, notices, payments]);

    const clientReport = React.useMemo(() => {
        let filtered = [...rawClientReport];
        
        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            filtered = filtered.filter(c => 
                c.tradeName.toLowerCase().includes(lower) || 
                c.gstin.toLowerCase().includes(lower)
            );
        }

        if (sortConfig) {
            filtered.sort((a, b) => {
                const aValue = (a as any)[sortConfig.key]; const bValue = (b as any)[sortConfig.key];
                return (aValue < bValue ? -1 : 1) * (sortConfig.direction === 'asc' ? 1 : -1);
            });
        } else filtered.sort((a, b) => b.outstanding - a.outstanding);
        return filtered;
    }, [rawClientReport, sortConfig, searchTerm]);

    const arnReport = React.useMemo(() => {
        const raw = Object.entries(notices.reduce((acc, n) => {
            const key = n.arn || 'No ARN';
            if (!acc[key]) acc[key] = { arn: key, count: 0, demand: 0, paid: 0, statuses: new Set<string>() };
            acc[key].count++; acc[key].demand += (n.demandAmount || 0); acc[key].statuses.add(n.status);
            return acc;
        }, {} as Record<string, ArnData>)).map(([key, val]: [string, ArnData]) => {
            const relatedNoticeIds = new Set(notices.filter(n => (n.arn || 'No ARN') === key).map(n => n.id));
            const paid = payments.filter(p => relatedNoticeIds.has(p.noticeId)).reduce((sum, p) => sum + p.amount, 0);
            return { ...val, paid, outstanding: val.demand - paid, statusStr: Array.from(val.statuses).join(', ') };
        }).sort((a, b) => b.demand - a.demand);

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            return raw.filter(r => r.arn.toLowerCase().includes(lower) || r.statusStr.toLowerCase().includes(lower));
        }
        return raw;
    }, [notices, payments, searchTerm]);

    const defectReport = React.useMemo(() => {
        const raw = Object.entries(defects.reduce((acc, d) => {
            const key = d.defectType || 'Unknown';
            if (!acc[key]) acc[key] = { type: key, count: 0, demand: 0 };
            acc[key].count++; acc[key].demand += ((d.taxDemand || 0) + (d.interestDemand || 0) + (d.penaltyDemand || 0));
            return acc;
        }, {} as Record<string, DefectData>)).map(([_, val]: [string, DefectData]) => val).sort((a, b) => b.count - a.count);

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            return raw.filter(d => d.type.toLowerCase().includes(lower));
        }
        return raw;
    }, [defects, searchTerm]);

    const statusReport = React.useMemo(() => {
        const stats = notices.reduce((acc, n) => {
            const key = n.status || 'Unknown';
            if (!acc[key]) acc[key] = { status: key, count: 0, demand: 0, paid: 0 };
            acc[key].count++; acc[key].demand += (n.demandAmount || 0); acc[key].paid += (paymentMap[n.id!] || 0);
            return acc;
        }, {} as Record<string, any>);
        const data = Object.values(stats).map((val: any) => ({ ...val, outstanding: val.demand - val.paid })).sort((a: any, b: any) => b.count - a.count);

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            return data.filter((s: any) => s.status.toLowerCase().includes(lower));
        }
        return data;
    }, [notices, paymentMap, searchTerm]);

    // Circle / Jurisdiction Report Logic
    const circleReport = React.useMemo(() => {
        const stats: Record<string, CircleData> = {};
        
        taxpayers.forEach(t => {
            const circle = t.stateCircle || 'Unmapped Circle';
            if (!stats[circle]) {
                stats[circle] = { circle, clientCount: 0, noticeCount: 0, demand: 0, paid: 0 };
            }
            stats[circle].clientCount++;
            
            // Find notices for this taxpayer
            const clientNotices = notices.filter(n => n.gstin === t.gstin);
            stats[circle].noticeCount += clientNotices.length;
            
            const demand = clientNotices.reduce((sum, n) => sum + (n.demandAmount || 0), 0);
            stats[circle].demand += demand;
            
            // Find paid
            const noticeIds = new Set(clientNotices.map(n => n.id));
            const paid = payments.filter(p => noticeIds.has(p.noticeId)).reduce((sum, p) => sum + p.amount, 0);
            stats[circle].paid += paid;
        });

        const data = Object.values(stats)
            .map(c => ({...c, outstanding: c.demand - c.paid}))
            .sort((a,b) => b.demand - a.demand);

        if (searchTerm) {
            const lower = searchTerm.toLowerCase();
            return data.filter(c => c.circle.toLowerCase().includes(lower));
        }
        return data;
    }, [taxpayers, notices, payments, searchTerm]);

    const exportToExcel = () => {
        const wb = XLSX.utils.book_new();
        let ws;
        if (activeTab === 'clients') ws = XLSX.utils.json_to_sheet(clientReport);
        else if (activeTab === 'cases') ws = XLSX.utils.json_to_sheet(arnReport.map(r => ({...r, statuses: undefined, status: r.statusStr})));
        else if (activeTab === 'defects') ws = XLSX.utils.json_to_sheet(defectReport);
        else if (activeTab === 'jurisdiction') ws = XLSX.utils.json_to_sheet(circleReport);
        else ws = XLSX.utils.json_to_sheet(statusReport);
        XLSX.utils.book_append_sheet(wb, ws, "Report");
        XLSX.writeFile(wb, `GST_Nexus_Report_${activeTab}.xlsx`);
    };
    
    const exportPowerBIData = () => {
        const data = {
            notices,
            defects,
            payments,
            taxpayers,
            generatedAt: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `GST_Nexus_PowerBI_Data_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const handleSort = (key: string) => setSortConfig({ key, direction: sortConfig?.key === key && sortConfig.direction === 'desc' ? 'asc' : 'desc' });
    const SortIcon = ({ column }: { column: string }) => sortConfig?.key !== column ? <ArrowUpDown size={12} className="opacity-30 inline ml-1" /> : sortConfig.direction === 'asc' ? <ChevronUp size={12} className="inline ml-1" /> : <ChevronDown size={12} className="inline ml-1" />;
    const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1'];
    const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(val);

    return (
        <div className="space-y-6 pb-10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div><h2 className="text-2xl font-bold text-slate-800">Reports & Analytics</h2><p className="text-slate-500 text-sm">Comprehensive compliance data</p></div>
                <div className="flex flex-col md:flex-row gap-2 w-full md:w-auto">
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                        <input 
                            type="text" 
                            placeholder="Search reports..." 
                            className="pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-full md:w-64"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    {activeTab !== 'powerbi' && (
                        <button onClick={exportToExcel} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all whitespace-nowrap"><FileDown size={18} /> Export Excel</button>
                    )}
                </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[600px]">
                <div className="flex border-b border-slate-200 bg-slate-50 overflow-x-auto">
                    {[ { id: 'clients', label: 'Client Wise', icon: Users }, { id: 'jurisdiction', label: 'Jurisdiction', icon: Map }, { id: 'status', label: 'Status Summary', icon: ListFilter }, { id: 'cases', label: 'Case / ARN Wise', icon: Layers }, { id: 'defects', label: 'Defect Analysis', icon: AlertCircle }, { id: 'powerbi', label: 'Power BI', icon: BarChart } ].map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} className={`flex-1 py-4 text-sm font-semibold border-b-2 transition-colors flex items-center justify-center gap-2 min-w-[140px] ${activeTab === tab.id ? 'border-blue-600 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'}`}><tab.icon size={16} /> {tab.label}</button>
                    ))}
                </div>

                <div className="p-6">
                    {activeTab === 'clients' && (
                        <div className="space-y-6 animate-in fade-in">
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                                    <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><BarChart size={16}/> Liability by Client <span className="text-xs font-normal text-slate-400 ml-2">(Click bar to view notices)</span></h3>
                                    <div className="h-64 cursor-pointer">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <ReBarChart data={clientReport.slice(0, 5)} layout="vertical" margin={{top: 5, right: 30, left: 40, bottom: 5}}>
                                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                                                <XAxis type="number" hide />
                                                <YAxis dataKey="tradeName" type="category" width={100} tick={{fontSize: 10}} />
                                                <ReTooltip formatter={(value: number) => formatCurrency(value)} />
                                                <Bar dataKey="outstanding" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={24} name="Outstanding" onClick={(data: any) => navigate('/notices', { state: { gstin: data.gstin } })}/>
                                            </ReBarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    <div className="bg-blue-50 p-5 rounded-2xl border border-blue-100 text-center"><p className="text-blue-600 text-xs font-bold uppercase tracking-wider">Total Clients</p><p className="text-3xl font-bold text-blue-800 mt-2">{clientReport.length}</p></div>
                                    <div className="bg-amber-50 p-5 rounded-2xl border border-amber-100 text-center"><p className="text-amber-600 text-xs font-bold uppercase tracking-wider">Total Outstanding</p><p className="text-3xl font-bold text-amber-800 mt-2">{formatCurrency(clientReport.reduce((a,b) => a + b.outstanding, 0))}</p></div>
                                </div>
                            </div>
                            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr><th className="px-6 py-4 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('tradeName')}>Client <SortIcon column="tradeName"/></th><th className="px-6 py-4 cursor-pointer hover:bg-slate-100 text-center" onClick={() => handleSort('noticesCount')}>Notices <SortIcon column="noticesCount"/></th><th className="px-6 py-4">Summary</th><th className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('outstanding')}>Liability <SortIcon column="outstanding"/></th><th className="px-6 py-4 text-right">Actions</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {clientReport.map(c => (
                                            <tr key={c.id} className="hover:bg-slate-50 transition-colors group">
                                                <td className="px-6 py-4"><div className="font-bold text-slate-800">{c.tradeName}</div><div className="text-xs font-mono text-slate-500 mt-0.5">{c.gstin}</div></td>
                                                <td className="px-6 py-4 text-center font-medium">{c.noticesCount}</td>
                                                <td className="px-6 py-4 text-xs text-slate-600 max-w-xs truncate" title={c.statusStr}>{c.statusStr}</td>
                                                <td className="px-6 py-4 text-right"><div className="font-bold text-red-600">{formatCurrency(c.outstanding)}</div><div className="text-[10px] text-slate-400">Total: {formatCurrency(c.totalDemand)}</div></td>
                                                <td className="px-6 py-4 text-right"><button onClick={() => navigate('/notices', { state: { gstin: c.gstin } })} className="text-xs bg-slate-100 hover:bg-blue-100 hover:text-blue-700 px-3 py-1.5 rounded transition-colors font-medium">View Cases</button></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'jurisdiction' && (
                        <div className="animate-in fade-in space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {circleReport.map((circle, idx) => (
                                    <div key={idx} className="bg-white border border-slate-200 rounded-xl p-5 hover:shadow-md transition-shadow relative overflow-hidden">
                                        <div className="absolute top-0 right-0 w-20 h-20 bg-slate-50 rounded-bl-full -mr-4 -mt-4 z-0"></div>
                                        <div className="relative z-10">
                                            <h4 className="font-bold text-slate-800 mb-2 truncate" title={circle.circle}>{circle.circle}</h4>
                                            <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                                                <div><p className="text-slate-500 text-xs">Clients</p><p className="font-bold">{circle.clientCount}</p></div>
                                                <div><p className="text-slate-500 text-xs">Notices</p><p className="font-bold">{circle.noticeCount}</p></div>
                                            </div>
                                            <div className="border-t border-slate-100 pt-3">
                                                <p className="text-xs text-slate-500 uppercase font-bold">Total Demand</p>
                                                <p className="text-lg font-bold text-slate-700">{formatCurrency(circle.demand)}</p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {circleReport.length === 0 && <div className="text-center py-10 text-slate-400">No jurisdiction data found.</div>}
                        </div>
                    )}

                    {activeTab === 'cases' && (
                        <div className="animate-in fade-in">
                            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr><th className="px-6 py-4">Case ID (ARN)</th><th className="px-6 py-4 text-center">Notices</th><th className="px-6 py-4 text-right">Total Demand</th><th className="px-6 py-4 text-right">Paid</th><th className="px-6 py-4 text-right">Outstanding</th><th className="px-6 py-4">Status</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {arnReport.map((r, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4 font-mono font-medium text-slate-700">{r.arn}</td>
                                                <td className="px-6 py-4 text-center">{r.count}</td>
                                                <td className="px-6 py-4 text-right font-medium">{formatCurrency(r.demand)}</td>
                                                <td className="px-6 py-4 text-right text-green-600">{formatCurrency(r.paid)}</td>
                                                <td className="px-6 py-4 text-right font-bold text-red-600">{formatCurrency(r.outstanding)}</td>
                                                <td className="px-6 py-4 text-xs text-slate-500 max-w-xs truncate">{r.statusStr}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'defects' && (
                        <div className="animate-in fade-in grid grid-cols-1 lg:grid-cols-2 gap-8">
                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <RePieChart>
                                        <Pie data={defectReport} cx="50%" cy="50%" outerRadius={80} fill="#8884d8" dataKey="count" nameKey="type" label={({name, percent}) => `${name} ${(percent * 100).toFixed(0)}%`}>
                                            {defectReport.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
                                        </Pie>
                                        <ReTooltip />
                                        <Legend />
                                    </RePieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm h-fit">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr><th className="px-6 py-4">Defect Type</th><th className="px-6 py-4 text-center">Frequency</th><th className="px-6 py-4 text-right">Total Demand</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {defectReport.map((d, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4 font-medium text-slate-700">{d.type}</td>
                                                <td className="px-6 py-4 text-center">{d.count}</td>
                                                <td className="px-6 py-4 text-right font-mono">{formatCurrency(d.demand)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'status' && (
                        <div className="animate-in fade-in">
                            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr><th className="px-6 py-4">Status</th><th className="px-6 py-4 text-center">Count</th><th className="px-6 py-4 text-right">Total Demand</th><th className="px-6 py-4 text-right">Collected</th><th className="px-6 py-4 text-right">Pending</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {statusReport.map((s, i) => (
                                            <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4"><span className="px-3 py-1 bg-slate-100 rounded-full text-xs font-bold text-slate-700 border border-slate-200">{s.status}</span></td>
                                                <td className="px-6 py-4 text-center font-medium">{s.count}</td>
                                                <td className="px-6 py-4 text-right">{formatCurrency(s.demand)}</td>
                                                <td className="px-6 py-4 text-right text-green-600">{formatCurrency(s.paid)}</td>
                                                <td className="px-6 py-4 text-right font-bold text-red-600">{formatCurrency(s.outstanding)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'powerbi' && (
                        <div className="animate-in fade-in">
                            <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
                                <div>
                                    <h3 className="font-bold text-slate-800 flex items-center gap-2"><Database size={20} className="text-blue-600"/> Data Source</h3>
                                    <p className="text-sm text-slate-500 mt-1">Export local JSON data for Power BI Desktop ingestion.</p>
                                </div>
                                <button onClick={exportPowerBIData} className="bg-slate-900 text-white px-5 py-2.5 rounded-lg flex items-center gap-2 text-sm font-medium hover:bg-slate-800 transition-all shadow-lg"><FileDown size={18}/> Download Data JSON</button>
                            </div>
                            <div className="space-y-4">
                                <label className="block text-sm font-bold text-slate-700">Embed Power BI Report URL (Publish to Web)</label>
                                <div className="flex gap-2">
                                    <input type="url" placeholder="https://app.powerbi.com/view?r=..." className="flex-1 p-3 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-yellow-500" value={powerBiUrl} onChange={e => setPowerBiUrl(e.target.value)} />
                                    <button onClick={savePowerBiUrl} className="bg-yellow-500 text-white px-6 py-3 rounded-lg font-bold hover:bg-yellow-600 transition-colors">Save URL</button>
                                </div>
                                {powerBiUrl ? (
                                    <iframe title="PowerBI Report" width="100%" height="600" src={powerBiUrl} frameBorder="0" allowFullScreen={true} className="rounded-xl border border-slate-200 shadow-sm mt-4 bg-slate-100"></iframe>
                                ) : (
                                    <div className="h-96 bg-slate-100 rounded-xl border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-400 flex-col gap-2">
                                        <BarChart size={48} className="opacity-50"/>
                                        <p>Enter a Power BI Embed URL to visualize reports here.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Reports;
