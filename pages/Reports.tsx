
import React, { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { FileDown, PieChart, BarChart, FileText, Users, AlertCircle, Layers, ArrowUpDown, ChevronUp, ChevronDown, ListFilter, ArrowRight, User, Database, Link as LinkIcon, ExternalLink, Map } from 'lucide-react';
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

    const rawClientReport = taxpayers.map(t => {
        const clientNotices = notices.filter(n => n.gstin === t.gstin);
        const totalDemand = clientNotices.reduce((sum, n) => sum + (n.demandAmount || 0), 0);
        const noticeIds = new Set(clientNotices.map(n => n.id));
        const totalPaid = payments.filter(p => noticeIds.has(p.noticeId)).reduce((sum, p) => sum + p.amount, 0);
        const statusMap = clientNotices.reduce((acc, n) => { acc[n.status] = (acc[n.status] || 0) + 1; return acc; }, {} as Record<string, number>);
        return { id: t.id, tradeName: t.tradeName, gstin: t.gstin, noticesCount: clientNotices.length, totalDemand, totalPaid, outstanding: totalDemand - totalPaid, statusStr: Object.entries(statusMap).map(([k, v]) => `${k} (${v})`).join(', ') };
    });

    const clientReport = React.useMemo(() => {
        let sorted = [...rawClientReport];
        if (sortConfig) {
            sorted.sort((a, b) => {
                const aValue = (a as any)[sortConfig.key]; const bValue = (b as any)[sortConfig.key];
                return (aValue < bValue ? -1 : 1) * (sortConfig.direction === 'asc' ? 1 : -1);
            });
        } else sorted.sort((a, b) => b.outstanding - a.outstanding);
        return sorted;
    }, [rawClientReport, sortConfig]);

    const arnReport = Object.entries(notices.reduce((acc, n) => {
            const key = n.arn || 'No ARN';
            if (!acc[key]) acc[key] = { arn: key, count: 0, demand: 0, paid: 0, statuses: new Set<string>() };
            acc[key].count++; acc[key].demand += (n.demandAmount || 0); acc[key].statuses.add(n.status);
            return acc;
        }, {} as Record<string, ArnData>)).map(([key, val]: [string, ArnData]) => {
        const relatedNoticeIds = new Set(notices.filter(n => (n.arn || 'No ARN') === key).map(n => n.id));
        const paid = payments.filter(p => relatedNoticeIds.has(p.noticeId)).reduce((sum, p) => sum + p.amount, 0);
        return { ...val, paid, outstanding: val.demand - paid, statusStr: Array.from(val.statuses).join(', ') };
    }).sort((a, b) => b.demand - a.demand);

    const defectReport = Object.entries(defects.reduce((acc, d) => {
            const key = d.defectType || 'Unknown';
            if (!acc[key]) acc[key] = { type: key, count: 0, demand: 0 };
            acc[key].count++; acc[key].demand += ((d.taxDemand || 0) + (d.interestDemand || 0) + (d.penaltyDemand || 0));
            return acc;
        }, {} as Record<string, DefectData>)).map(([_, val]: [string, DefectData]) => val).sort((a, b) => b.count - a.count);

    const statusReport = React.useMemo(() => {
        const stats = notices.reduce((acc, n) => {
            const key = n.status || 'Unknown';
            if (!acc[key]) acc[key] = { status: key, count: 0, demand: 0, paid: 0 };
            acc[key].count++; acc[key].demand += (n.demandAmount || 0); acc[key].paid += (paymentMap[n.id!] || 0);
            return acc;
        }, {} as Record<string, any>);
        return Object.values(stats).map((val: any) => ({ ...val, outstanding: val.demand - val.paid })).sort((a: any, b: any) => b.count - a.count);
    }, [notices, paymentMap]);

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

        return Object.values(stats)
            .map(c => ({...c, outstanding: c.demand - c.paid}))
            .sort((a,b) => b.demand - a.demand);
    }, [taxpayers, notices, payments]);

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
                {activeTab !== 'powerbi' && (
                    <button onClick={exportToExcel} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all"><FileDown size={18} /> Export Excel</button>
                )}
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
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button onClick={() => navigate('/notices', { state: { gstin: c.gstin } })} className="p-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100" title="View Notices"><FileText size={16}/></button>
                                                        <button onClick={() => navigate(`/taxpayers/${c.id}`)} className="p-1.5 bg-slate-100 text-slate-600 rounded hover:bg-slate-200" title="View Profile"><User size={16}/></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                    
                    {activeTab === 'jurisdiction' && (
                        <div className="space-y-6 animate-in fade-in">
                            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm mb-6">
                                <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2"><PieChart size={16}/> Liability by State Circle</h3>
                                <div className="h-72">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <ReBarChart data={circleReport.slice(0, 10)} margin={{top: 20, right: 30, left: 20, bottom: 5}}>
                                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                            <XAxis dataKey="circle" fontSize={11} tick={{fill: '#64748b'}} interval={0} angle={-15} textAnchor="end" height={60} />
                                            <YAxis fontSize={11} tick={{fill: '#64748b'}} />
                                            <ReTooltip formatter={(value: number) => formatCurrency(value)} />
                                            <Legend />
                                            <Bar dataKey="demand" fill="#8884d8" name="Total Demand" radius={[4, 4, 0, 0]} barSize={30} />
                                            <Bar dataKey="outstanding" fill="#ef4444" name="Outstanding" radius={[4, 4, 0, 0]} barSize={30} />
                                        </ReBarChart>
                                    </ResponsiveContainer>
                                </div>
                            </div>

                            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr>
                                            <th className="px-6 py-4">State Circle / Zone</th>
                                            <th className="px-6 py-4 text-center">Clients</th>
                                            <th className="px-6 py-4 text-center">Notices</th>
                                            <th className="px-6 py-4 text-right">Total Demand</th>
                                            <th className="px-6 py-4 text-right">Paid</th>
                                            <th className="px-6 py-4 text-right">Outstanding</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {circleReport.map((c, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50">
                                                <td className="px-6 py-4 font-bold text-slate-800">{c.circle}</td>
                                                <td className="px-6 py-4 text-center">{c.clientCount}</td>
                                                <td className="px-6 py-4 text-center">{c.noticeCount}</td>
                                                <td className="px-6 py-4 text-right">{formatCurrency(c.demand)}</td>
                                                <td className="px-6 py-4 text-right text-green-600">{formatCurrency(c.paid)}</td>
                                                <td className="px-6 py-4 text-right font-bold text-red-600">{formatCurrency(c.outstanding)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'cases' && (
                        <div className="space-y-6 animate-in fade-in">
                             <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                        <tr><th className="px-6 py-4">Case ID (ARN)</th><th className="px-6 py-4 text-center">Notices</th><th className="px-6 py-4">Breakdown</th><th className="px-6 py-4 text-right">Paid</th><th className="px-6 py-4 text-right">Balance</th><th className="px-6 py-4 text-right">View</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {arnReport.map((c, idx) => (
                                            <tr key={idx} className="hover:bg-slate-50 cursor-pointer group" onClick={() => navigate('/notices', { state: { gstin: c.arn } })}>
                                                <td className="px-6 py-4 font-bold text-slate-800 font-mono">{c.arn}</td>
                                                <td className="px-6 py-4 text-center">{c.count}</td>
                                                <td className="px-6 py-4 text-xs text-slate-500 max-w-xs truncate">{c.statusStr}</td>
                                                <td className="px-6 py-4 text-right text-green-600 font-medium">{formatCurrency(c.paid)}</td>
                                                <td className="px-6 py-4 text-right font-bold text-slate-800">{formatCurrency(c.outstanding)}</td>
                                                <td className="px-6 py-4 text-right"><ArrowRight size={16} className="text-slate-300 group-hover:text-blue-500 ml-auto"/></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {(activeTab === 'status' || activeTab === 'defects') && (
                        <div className="space-y-6 animate-in fade-in">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
                                <div className="bg-white p-4 border rounded-xl shadow-sm"><h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><PieChart size={16}/> {activeTab === 'status' ? 'Status' : 'Defect'} Distribution</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><RePieChart><Pie data={activeTab === 'status' ? statusReport : defectReport} dataKey="count" nameKey={activeTab === 'status' ? 'status' : 'type'} cx="50%" cy="50%" outerRadius={80} onClick={(data: any) => navigate('/notices', activeTab === 'status' ? { state: { status: data.status } } : { state: { defectType: data.type } })}>{(activeTab === 'status' ? statusReport : defectReport).map((_, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}</Pie><ReTooltip /><Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize: '11px'}}/></RePieChart></ResponsiveContainer></div></div>
                                <div className="bg-white p-4 border rounded-xl shadow-sm"><h3 className="text-sm font-bold text-slate-700 mb-2 flex items-center gap-2"><BarChart size={16}/> Liability Analysis</h3><div className="h-64"><ResponsiveContainer width="100%" height="100%"><ReBarChart data={(activeTab === 'status' ? statusReport : defectReport).slice(0, 6)} layout="vertical" margin={{top: 5, right: 30, left: 40, bottom: 5}}><CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} /><XAxis type="number" hide /><YAxis dataKey={activeTab === 'status' ? 'status' : 'type'} type="category" width={120} tick={{fontSize: 10}} /><ReTooltip formatter={(value: number) => formatCurrency(value)} /><Bar dataKey="demand" fill="#8884d8" radius={[0, 4, 4, 0]} barSize={20} onClick={(data: any) => navigate('/notices', activeTab === 'status' ? { state: { status: data.status } } : { state: { defectType: data.type } })}/></ReBarChart></ResponsiveContainer></div></div>
                            </div>
                            <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold"><tr><th className="px-6 py-4">{activeTab === 'status' ? 'Status' : 'Defect Type'}</th><th className="px-6 py-4 text-center">Count</th><th className="px-6 py-4 text-right">Demand</th>{activeTab === 'status' && <><th className="px-6 py-4 text-right">Paid</th><th className="px-6 py-4 text-right">Outstanding</th></>}</tr></thead>
                                    <tbody className="divide-y divide-slate-100">{ (activeTab === 'status' ? statusReport : defectReport).map((r: any, idx) => (<tr key={idx} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate('/notices', activeTab === 'status' ? { state: { status: r.status } } : { state: { defectType: r.type } })}><td className="px-6 py-4 font-medium text-slate-800">{activeTab === 'status' ? r.status : r.type}</td><td className="px-6 py-4 text-center">{r.count}</td><td className="px-6 py-4 text-right">{formatCurrency(r.demand)}</td>{activeTab === 'status' && <><td className="px-6 py-4 text-right text-green-600">{formatCurrency(r.paid)}</td><td className="px-6 py-4 text-right font-bold text-red-600">{formatCurrency(r.outstanding)}</td></>}</tr>))}</tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {activeTab === 'powerbi' && (
                        <div className="space-y-8 animate-in fade-in">
                            {/* Data Export Section */}
                            <div className="bg-gradient-to-br from-yellow-50 to-orange-50 p-6 rounded-2xl border border-yellow-200">
                                <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                                    <div className="flex items-start gap-4">
                                        <div className="p-3 bg-yellow-400 text-yellow-900 rounded-xl shadow-sm"><Database size={28}/></div>
                                        <div>
                                            <h3 className="text-lg font-bold text-yellow-900">Get Data for Power BI Desktop</h3>
                                            <p className="text-yellow-800 text-sm mt-1 max-w-lg">
                                                Since this is an offline application, direct database connections aren't possible. 
                                                Export your data as a structured JSON file and load it into Power BI Desktop using the JSON connector.
                                            </p>
                                        </div>
                                    </div>
                                    <button 
                                        onClick={exportPowerBIData}
                                        className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-6 rounded-xl shadow-lg shadow-yellow-200 transition-all flex items-center gap-2 whitespace-nowrap"
                                    >
                                        <FileDown size={20}/> Download Dataset
                                    </button>
                                </div>
                            </div>

                            {/* Embed Section */}
                            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <div className="p-6 border-b border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-slate-50">
                                    <div>
                                        <h3 className="font-bold text-slate-800 flex items-center gap-2"><LinkIcon size={18}/> Embed Published Report</h3>
                                        <p className="text-xs text-slate-500 mt-1">Paste your "Publish to Web" URL to view your online dashboard here.</p>
                                    </div>
                                    <div className="flex gap-2 w-full md:w-auto">
                                        <input 
                                            type="text" 
                                            placeholder="https://app.powerbi.com/view?r=..." 
                                            value={powerBiUrl}
                                            onChange={(e) => setPowerBiUrl(e.target.value)}
                                            className="flex-1 md:w-80 text-sm border border-slate-300 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-blue-500"
                                        />
                                        <button onClick={savePowerBiUrl} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Save</button>
                                    </div>
                                </div>
                                <div className="bg-slate-100 min-h-[500px] flex items-center justify-center relative">
                                    {powerBiUrl ? (
                                        <iframe 
                                            title="Power BI Report"
                                            width="100%" 
                                            height="600" 
                                            src={powerBiUrl} 
                                            frameBorder="0" 
                                            allowFullScreen={true}
                                            className="w-full h-full"
                                        ></iframe>
                                    ) : (
                                        <div className="text-center p-10">
                                            <BarChart size={48} className="mx-auto text-slate-300 mb-4"/>
                                            <h4 className="text-lg font-bold text-slate-500">No Report Configured</h4>
                                            <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto">
                                                Enter a valid Power BI Embed URL above to view your analytics dashboard within the app.
                                            </p>
                                            <a href="https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-publish-to-web" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-600 text-xs mt-4 hover:underline">
                                                How to get an Embed URL <ExternalLink size={10}/>
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Reports;
