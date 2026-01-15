
import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { ReconciliationRecord, ReconciliationRow } from '../types';
import { FileDown, Scale, Plus, ArrowLeft, Save, Trash2, Edit, Calculator, FileText, Layers, TrendingUp, AlertCircle, Upload } from 'lucide-react';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { Link } from 'react-router-dom';

const MONTHS = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];

const initialRows: ReconciliationRow[] = MONTHS.map(m => ({ period: m, sourceA: 0, sourceB: 0, diff: 0, remarks: '' }));

const Reconciliation: React.FC = () => {
    const { user } = useAuth();
    const [view, setView] = useState<'list' | 'edit'>('list');
    const [activeSubTab, setActiveSubTab] = useState<'all' | 'gstr1' | 'gstr3b' | 'itc'>('all');
    const fileInputRef = useRef<HTMLInputElement>(null);
    
    const [formData, setFormData] = useState<Partial<ReconciliationRecord>>({
        rows: JSON.parse(JSON.stringify(initialRows)),
        type: 'Turnover (GSTR-1 vs Books)',
        financialYear: '2023-24'
    });

    const taxpayers = useLiveQuery(() => db.taxpayers.orderBy('tradeName').toArray());
    const reconciliations = useLiveQuery(() => db.reconciliations.reverse().toArray());
    
    // Filtered list based on active tab
    const filteredReconciliations = reconciliations?.filter(rec => {
        if (activeSubTab === 'all') return true;
        if (activeSubTab === 'gstr1') return rec.type === 'Turnover (GSTR-1 vs Books)';
        if (activeSubTab === 'gstr3b') return rec.type === 'Tax Liability (GSTR-3B vs Books)';
        if (activeSubTab === 'itc') return rec.type === 'ITC (GSTR-2B vs Books)';
        return true;
    });

    // Derived state for linked notices based on selected GSTIN
    const [linkedNotices, setLinkedNotices] = useState<any[]>([]);

    useEffect(() => {
        if (formData.gstin) {
            db.notices.where('gstin').equals(formData.gstin).toArray().then(setLinkedNotices);
        } else {
            setLinkedNotices([]);
        }
    }, [formData.gstin]);

    const handleCreateNew = () => {
        let defaultType: any = 'Turnover (GSTR-1 vs Books)';
        if (activeSubTab === 'gstr3b') defaultType = 'Tax Liability (GSTR-3B vs Books)';
        if (activeSubTab === 'itc') defaultType = 'ITC (GSTR-2B vs Books)';

        setFormData({
            rows: JSON.parse(JSON.stringify(initialRows)),
            type: defaultType,
            financialYear: '2023-24',
            gstin: '',
            noticeId: undefined
        });
        setView('edit');
    };

    const handleEdit = (record: ReconciliationRecord) => {
        setFormData(JSON.parse(JSON.stringify(record))); // Deep copy
        setView('edit');
    };

    const handleDelete = async (id: number) => {
        if (confirm('Are you sure you want to delete this worksheet?')) {
            await db.reconciliations.delete(id);
            await db.auditLogs.add({
                entityType: 'Reconciliation', entityId: id, action: 'Delete', timestamp: new Date().toISOString(),
                user: user?.username || 'System', details: 'Deleted reconciliation worksheet'
            });
        }
    };

    const handleCellChange = (index: number, field: keyof ReconciliationRow, value: any) => {
        const newRows = [...(formData.rows || [])];
        const numValue = field === 'sourceA' || field === 'sourceB' ? (parseFloat(value) || 0) : value;
        
        newRows[index] = { ...newRows[index], [field]: numValue };
        
        // Auto calculate diff if sourceA or sourceB changed
        if (field === 'sourceA' || field === 'sourceB') {
            newRows[index].diff = newRows[index].sourceA - newRows[index].sourceB;
        }
        setFormData({ ...formData, rows: newRows });
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
    
        const reader = new FileReader();
        reader.onload = (evt) => {
          try {
            const bstr = evt.target?.result;
            const wb = XLSX.read(bstr, { type: 'binary' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const data = XLSX.utils.sheet_to_json<any>(ws);
    
            // Map Excel data to rows using fuzzy matching for columns
            const mappedRows = initialRows.map(row => {
                const found = data.find((d: any) => {
                    const p = String(d.Period || d.Month || '').toLowerCase();
                    return p.includes(row.period.toLowerCase());
                });
                
                if (found) {
                    const valA = found['GSTR-1'] || found['GSTR-3B'] || found['Portal'] || found['Source A'] || found['GSTR1'] || 0;
                    const valB = found['Books'] || found['Tally'] || found['Source B'] || found['Ledger'] || 0;
                    const remarks = found['Remarks'] || found['Reason'] || found['Note'] || '';

                    return {
                        ...row,
                        sourceA: parseFloat(valA) || 0,
                        sourceB: parseFloat(valB) || 0,
                        diff: (parseFloat(valA) || 0) - (parseFloat(valB) || 0),
                        remarks: String(remarks)
                    };
                }
                return row;
            });
    
            setFormData(prev => ({ ...prev, rows: mappedRows }));
            alert("Data imported successfully! Please verify the mapped values.");
          } catch (err) {
            console.error(err);
            alert("Error parsing file. Please ensure columns are named like: 'Period', 'Portal', 'Books'.");
          }
        };
        reader.readAsBinaryString(file);
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleSave = async () => {
        if (!formData.gstin) { alert('Please select a Client/Taxpayer'); return; }
        
        try {
            const dataToSave = {
                ...formData,
                updatedAt: new Date().toISOString(),
                lastModifiedBy: user?.username || 'System'
            } as ReconciliationRecord;

            if (formData.id) {
                await db.reconciliations.update(formData.id, dataToSave as any);
                await db.auditLogs.add({
                    entityType: 'Reconciliation', entityId: formData.id, action: 'Update', timestamp: new Date().toISOString(),
                    user: user?.username || 'System', details: `Updated ${formData.type} for ${formData.gstin}`
                });
            } else {
                const id = await db.reconciliations.add(dataToSave);
                await db.auditLogs.add({
                    entityType: 'Reconciliation', entityId: id, action: 'Create', timestamp: new Date().toISOString(),
                    user: user?.username || 'System', details: `Created ${formData.type} for ${formData.gstin}`
                });
            }
            setView('list');
        } catch (e) {
            console.error(e);
            alert('Error saving reconciliation.');
        }
    };

    const exportToExcel = () => {
        const rows = formData.rows?.map(r => ({
            Period: r.period,
            [`${formData.type?.includes('GSTR-1') ? 'GSTR-1' : formData.type?.includes('GSTR-3B') ? 'GSTR-3B' : 'Portal'}`]: r.sourceA,
            Books: r.sourceB,
            Difference: r.diff,
            Remarks: r.remarks
        }));
        
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows || []);
        
        const totalA = formData.rows?.reduce((sum, r) => sum + r.sourceA, 0);
        const totalB = formData.rows?.reduce((sum, r) => sum + r.sourceB, 0);
        const totalDiff = formData.rows?.reduce((sum, r) => sum + r.diff, 0);
        
        XLSX.utils.sheet_add_json(ws, [{
            Period: 'TOTAL',
            [`${formData.type?.includes('GSTR-1') ? 'GSTR-1' : 'Portal'}`]: totalA,
            Books: totalB,
            Difference: totalDiff,
            Remarks: ''
        }], {skipHeader: true, origin: -1});

        XLSX.utils.book_append_sheet(wb, ws, "Reconciliation");
        XLSX.writeFile(wb, `Recon_${formData.gstin}_${formData.financialYear}.xlsx`);
    };

    const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(val);

    if (view === 'list') {
        return (
            <div className="space-y-6 pb-10">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800">Reconciliation Worksheets</h2>
                        <p className="text-slate-500 text-sm">Create and manage supporting workings for notices (GSTR vs Books)</p>
                    </div>
                    <button onClick={handleCreateNew} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all">
                        <Plus size={18} /> New Reconciliation
                    </button>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="flex border-b border-slate-200 overflow-x-auto">
                        <button onClick={() => setActiveSubTab('all')} className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${activeSubTab === 'all' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <Layers size={16}/> All Worksheets
                        </button>
                        <button onClick={() => setActiveSubTab('gstr1')} className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${activeSubTab === 'gstr1' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <FileText size={16}/> GSTR-1 vs Books
                        </button>
                        <button onClick={() => setActiveSubTab('gstr3b')} className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${activeSubTab === 'gstr3b' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <TrendingUp size={16}/> GSTR-3B vs Books
                        </button>
                        <button onClick={() => setActiveSubTab('itc')} className={`flex items-center gap-2 px-6 py-4 text-sm font-medium transition-colors ${activeSubTab === 'itc' ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/50' : 'text-slate-600 hover:bg-slate-50'}`}>
                            <AlertCircle size={16}/> ITC (2B vs Books)
                        </button>
                    </div>

                    <div className="p-4 grid grid-cols-1 gap-4">
                        {filteredReconciliations?.map(rec => {
                            const taxpayer = taxpayers?.find(t => t.gstin === rec.gstin);
                            const totalDiff = rec.rows.reduce((acc, r) => acc + r.diff, 0);
                            return (
                                <div key={rec.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4 hover:shadow-md transition-shadow">
                                    <div className="flex items-start gap-4 flex-1">
                                        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-lg"><Scale size={24}/></div>
                                        <div>
                                            <h3 className="font-bold text-slate-800">{rec.type}</h3>
                                            <p className="text-sm text-slate-600 font-medium">{taxpayer?.tradeName} <span className="font-normal text-slate-400">({rec.gstin})</span></p>
                                            <div className="flex gap-3 mt-1 text-xs text-slate-500">
                                                <span className="bg-slate-100 px-2 py-0.5 rounded">FY {rec.financialYear}</span>
                                                {rec.noticeId && <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">Linked to Notice</span>}
                                                <span>Updated: {new Date(rec.updatedAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right px-4 border-l border-slate-100">
                                        <p className="text-xs text-slate-500 uppercase font-bold">Net Difference</p>
                                        <p className={`text-lg font-bold ${totalDiff === 0 ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(totalDiff)}</p>
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => handleEdit(rec)} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors" title="Edit"><Edit size={18}/></button>
                                        <button onClick={() => handleDelete(rec.id!)} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors" title="Delete"><Trash2 size={18}/></button>
                                    </div>
                                </div>
                            );
                        })}
                        {filteredReconciliations?.length === 0 && <div className="text-center py-12 text-slate-400">No reconciliation worksheets found in this category.</div>}
                    </div>
                </div>
            </div>
        );
    }

    // EDIT VIEW
    const totalSourceA = formData.rows?.reduce((sum, r) => sum + r.sourceA, 0) || 0;
    const totalSourceB = formData.rows?.reduce((sum, r) => sum + r.sourceB, 0) || 0;
    const totalDiff = formData.rows?.reduce((sum, r) => sum + r.diff, 0) || 0;

    return (
        <div className="space-y-6 pb-10">
            <div className="flex items-center justify-between">
                <button onClick={() => setView('list')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800"><ArrowLeft size={18} /> Back to List</button>
                <div className="flex gap-2">
                    <button onClick={() => fileInputRef.current?.click()} className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 shadow-sm">
                        <Upload size={18} /> Import Excel
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" accept=".xlsx, .xls" />
                    
                    <button onClick={exportToExcel} className="bg-white border border-slate-300 text-slate-700 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 shadow-sm">
                        <FileDown size={18} /> Export Excel
                    </button>
                    <button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm">
                        <Save size={18} /> Save Worksheet
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 animate-in fade-in slide-in-from-bottom-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Client / Taxpayer</label>
                        <select className="w-full p-2 border border-slate-300 rounded text-sm bg-white" value={formData.gstin} onChange={e => setFormData({...formData, gstin: e.target.value})}>
                            <option value="">-- Select Client --</option>
                            {taxpayers?.map(t => <option key={t.id} value={t.gstin}>{t.tradeName} ({t.gstin})</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Link Notice (Optional)</label>
                        <select className="w-full p-2 border border-slate-300 rounded text-sm bg-white" value={formData.noticeId || ''} onChange={e => setFormData({...formData, noticeId: e.target.value ? parseInt(e.target.value) : undefined})}>
                            <option value="">-- None --</option>
                            {linkedNotices.map(n => <option key={n.id} value={n.id}>{n.noticeNumber} - {n.noticeType}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Reconciliation Type</label>
                        <select className="w-full p-2 border border-slate-300 rounded text-sm bg-white" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value as any})}>
                            <option>Turnover (GSTR-1 vs Books)</option>
                            <option>Tax Liability (GSTR-3B vs Books)</option>
                            <option>ITC (GSTR-2B vs Books)</option>
                            <option>E-Way Bill vs GSTR-1</option>
                            <option>Custom</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Financial Year</label>
                        <select className="w-full p-2 border border-slate-300 rounded text-sm bg-white" value={formData.financialYear} onChange={e => setFormData({...formData, financialYear: e.target.value})}>
                            <option>2024-25</option>
                            <option>2023-24</option>
                            <option>2022-23</option>
                            <option>2021-22</option>
                            <option>2020-21</option>
                            <option>2019-20</option>
                            <option>2018-19</option>
                            <option>2017-18</option>
                        </select>
                    </div>
                </div>

                <div className="overflow-x-auto border rounded-lg">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-600 uppercase text-xs font-bold">
                            <tr>
                                <th className="px-4 py-3 w-32">Period</th>
                                <th className="px-4 py-3 w-40 text-right">{formData.type?.includes('GSTR-1') ? 'GSTR-1 / Portal' : formData.type?.includes('GSTR-3B') ? 'GSTR-3B' : formData.type?.includes('ITC') ? 'GSTR-2B' : 'Portal Value'}</th>
                                <th className="px-4 py-3 w-40 text-right">As per Books</th>
                                <th className="px-4 py-3 w-40 text-right">Difference</th>
                                <th className="px-4 py-3">Remarks / Reason</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {formData.rows?.map((row, idx) => (
                                <tr key={idx} className="hover:bg-slate-50">
                                    <td className="px-4 py-2 font-medium text-slate-700 bg-slate-50/50">{row.period}</td>
                                    <td className="px-4 py-2">
                                        <input type="number" className="w-full text-right p-1.5 border border-slate-200 rounded focus:border-blue-500 outline-none" value={row.sourceA} onChange={e => handleCellChange(idx, 'sourceA', e.target.value)} />
                                    </td>
                                    <td className="px-4 py-2">
                                        <input type="number" className="w-full text-right p-1.5 border border-slate-200 rounded focus:border-blue-500 outline-none" value={row.sourceB} onChange={e => handleCellChange(idx, 'sourceB', e.target.value)} />
                                    </td>
                                    <td className="px-4 py-2 text-right font-medium">
                                        <span className={row.diff !== 0 ? 'text-red-600' : 'text-green-600'}>{formatCurrency(row.diff)}</span>
                                    </td>
                                    <td className="px-4 py-2">
                                        <input type="text" className="w-full p-1.5 border border-slate-200 rounded focus:border-blue-500 outline-none" value={row.remarks} onChange={e => handleCellChange(idx, 'remarks', e.target.value)} placeholder="Reason..." />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot className="bg-slate-100 font-bold text-slate-800 border-t-2 border-slate-200">
                            <tr>
                                <td className="px-4 py-3">TOTAL</td>
                                <td className="px-4 py-3 text-right">{formatCurrency(totalSourceA)}</td>
                                <td className="px-4 py-3 text-right">{formatCurrency(totalSourceB)}</td>
                                <td className={`px-4 py-3 text-right ${totalDiff !== 0 ? 'text-red-600' : 'text-green-600'}`}>{formatCurrency(totalDiff)}</td>
                                <td className="px-4 py-3 text-xs font-normal text-slate-500 italic">Net discrepancy</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default Reconciliation;
