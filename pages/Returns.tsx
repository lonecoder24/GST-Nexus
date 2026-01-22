
import React, { useState, useRef, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { ReturnRecord, GSTReturnType } from '../types';
import { Upload, FileText, BarChart2, Calendar, AlertCircle, CheckCircle, Search, Trash2, Download, CloudDownload, X, Play, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, parseExcelDate, formatCurrency } from '../utils/formatting';

const Returns: React.FC = () => {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'list' | 'import' | 'analysis'>('list');
  const [selectedGstin, setSelectedGstin] = useState('');
  const [filterYear, setFilterYear] = useState('2023-24');
  
  // Fetch Modal State
  const [showFetchModal, setShowFetchModal] = useState(false);
  const [fetchParams, setFetchParams] = useState({
      gstin: '',
      date: new Date().toISOString().split('T')[0],
      email: '',
      gstUsername: '',
      stateCode: '',
      ipAddress: 'Fetching...'
  });
  const [isFetching, setIsFetching] = useState(false);

  const taxpayers = useLiveQuery(() => db.taxpayers.orderBy('tradeName').toArray()) || [];
  const returns = useLiveQuery(() => db.returns.toArray()) || [];

  const filteredReturns = returns.filter(r => 
    (!selectedGstin || r.gstin === selectedGstin) && 
    (!filterYear || r.financialYear === filterYear)
  ).sort((a,b) => new Date(b.filingDate).getTime() - new Date(a.filingDate).getTime());

  // Analysis Data
  const analysisData = React.useMemo(() => {
      const months = ['April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', 'January', 'February', 'March'];
      return months.map(month => {
          const monthReturns = filteredReturns.filter(r => r.period.startsWith(month));
          const gstr1 = monthReturns.find(r => r.returnType === 'GSTR-1');
          const gstr3b = monthReturns.find(r => r.returnType === 'GSTR-3B');
          const gstr2b = monthReturns.find(r => r.returnType === 'GSTR-2B');

          return {
              name: month,
              'GSTR-1 Liability': gstr1?.taxLiability || 0,
              'GSTR-3B Liability': gstr3b?.taxLiability || 0,
              'GSTR-3B ITC': gstr3b?.itcAvailable || 0,
              'GSTR-2B ITC': gstr2b?.itcAvailable || 0
          };
      });
  }, [filteredReturns]);

  useEffect(() => {
      if (showFetchModal) {
          fetch('https://api.ipify.org?format=json')
              .then(res => res.json())
              .then(data => setFetchParams(prev => ({ ...prev, ipAddress: data.ip })))
              .catch(() => setFetchParams(prev => ({ ...prev, ipAddress: '127.0.0.1' })));
      }
  }, [showFetchModal]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (evt) => {
          try {
              const bstr = evt.target?.result;
              const wb = XLSX.read(bstr, { type: 'binary' });
              const ws = wb.Sheets[wb.SheetNames[0]];
              const data = XLSX.utils.sheet_to_json<any>(ws);

              let count = 0;
              for (const row of data) {
                  if (row.gstin && row.returnType && row.period) {
                      await db.returns.add({
                          gstin: row.gstin,
                          returnType: row.returnType,
                          period: row.period,
                          financialYear: row.financialYear || '2023-24',
                          filingDate: parseExcelDate(row.filingDate), // Use Util
                          arn: row.arn,
                          taxableValue: parseFloat(row.taxableValue) || 0,
                          taxLiability: parseFloat(row.taxLiability) || 0,
                          itcAvailable: parseFloat(row.itcAvailable) || 0,
                          cashPaid: parseFloat(row.cashPaid) || 0,
                          status: 'Filed',
                          sourceFile: file.name
                      });
                      count++;
                  }
              }
              await db.auditLogs.add({
                  entityType: 'Return', entityId: 'BULK', action: 'Create', timestamp: new Date().toISOString(),
                  user: user?.username || 'System', details: `Imported ${count} returns from ${file.name}`
              });
              alert(`Successfully imported ${count} records.`);
              setActiveTab('list');
          } catch (e) {
              console.error(e);
              alert('Error processing file. Check template format.');
          }
      };
      reader.readAsBinaryString(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const downloadTemplate = () => {
      const data = [{
          gstin: "27ABCDE1234F1Z5", returnType: "GSTR-3B", period: "April-2023", financialYear: "2023-24",
          filingDate: "20-May-2023", arn: "AA2705230001234", taxableValue: 100000, taxLiability: 18000, itcAvailable: 12000, cashPaid: 6000
      }];
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, "Returns_Template");
      XLSX.writeFile(wb, "GSTNexus_Returns_Import_Template.xlsx");
  };

  const handleDelete = async (id: number) => {
      if (confirm('Delete this return record?')) {
          await db.returns.delete(id);
      }
  };

  // New Fetch Logic
  const handleOpenFetchModal = () => {
      // Auto-fill gstin if selected in filter
      if (selectedGstin) {
          const t = taxpayers.find(t => t.gstin === selectedGstin);
          setFetchParams({
              gstin: selectedGstin,
              date: new Date().toISOString().split('T')[0],
              email: t?.email || '',
              gstUsername: '',
              stateCode: selectedGstin.substring(0, 2),
              ipAddress: 'Fetching...'
          });
      }
      setShowFetchModal(true);
  };

  const handleExecuteFetch = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsFetching(true);
      
      // Simulate API delay
      setTimeout(async () => {
          // Generate a fake TXN ID
          const txnId = `TXN-${Math.floor(Math.random() * 1000000)}`;
          
          // Log the attempt
          await db.auditLogs.add({
              entityType: 'System', 
              entityId: 'API_FETCH', 
              action: 'Update', 
              timestamp: new Date().toISOString(),
              user: user?.username || 'System',
              details: JSON.stringify({
                  message: 'Initiated Data Fetch',
                  gstin: fetchParams.gstin,
                  date: fetchParams.date,
                  username: fetchParams.gstUsername,
                  state: fetchParams.stateCode,
                  ip: fetchParams.ipAddress,
                  txn: txnId,
                  status: 'Simulated Success'
              })
          });

          await db.returns.add({
              gstin: fetchParams.gstin,
              returnType: 'GSTR-1',
              period: `Month-${new Date(fetchParams.date).getMonth() + 1}`,
              financialYear: filterYear,
              filingDate: new Date().toISOString().split('T')[0],
              taxableValue: 0,
              taxLiability: 0,
              itcAvailable: 0,
              cashPaid: 0,
              status: 'Submitted',
              sourceFile: 'API Fetch'
          });

          setIsFetching(false);
          setShowFetchModal(false);
          alert(`API Request Queued (Simulated).\nTransaction ID: ${txnId}\n\nData would be fetched for GSTIN: ${fetchParams.gstin}`);
      }, 1500);
  };

  return (
    <div className="space-y-6 pb-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">Returns & Analysis</h2>
                <p className="text-slate-500 text-sm">Track filings and analyze liability vs ITC</p>
            </div>
            <div className="flex gap-2">
                <button onClick={handleOpenFetchModal} className="px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors bg-purple-600 text-white hover:bg-purple-700 shadow-sm">
                    <CloudDownload size={16}/> Fetch Online
                </button>
                <button onClick={() => setActiveTab('import')} className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'import' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                    <Upload size={16}/> Import
                </button>
                <button onClick={() => setActiveTab('analysis')} className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'analysis' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                    <BarChart2 size={16}/> Analysis
                </button>
                <button onClick={() => setActiveTab('list')} className={`px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors ${activeTab === 'list' ? 'bg-blue-600 text-white' : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'}`}>
                    <FileText size={16}/> Records
                </button>
            </div>
        </div>

        {/* Global Filter Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-4 items-center">
            <div className="flex-1 w-full">
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Select Taxpayer</label>
                <select className="w-full p-2 border rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none" value={selectedGstin} onChange={e => setSelectedGstin(e.target.value)}>
                    <option value="">All Taxpayers</option>
                    {taxpayers.map(t => <option key={t.id} value={t.gstin}>{t.tradeName} ({t.gstin})</option>)}
                </select>
            </div>
            <div className="w-full md:w-48">
                <label className="text-xs font-bold text-slate-500 uppercase mb-1 block">Financial Year</label>
                <select className="w-full p-2 border rounded-lg text-sm bg-slate-50 focus:ring-2 focus:ring-blue-500 outline-none" value={filterYear} onChange={e => setFilterYear(e.target.value)}>
                    <option>2024-25</option>
                    <option>2023-24</option>
                    <option>2022-23</option>
                    <option>2021-22</option>
                </select>
            </div>
        </div>

        {activeTab === 'import' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-8 text-center animate-in fade-in">
                <div className="max-w-md mx-auto space-y-6">
                    <div className="p-4 bg-blue-50 rounded-full w-20 h-20 flex items-center justify-center mx-auto text-blue-600">
                        <Upload size={32}/>
                    </div>
                    <div>
                        <h3 className="text-xl font-bold text-slate-800">Bulk Import Returns</h3>
                        <p className="text-slate-500 mt-2 text-sm">Upload Excel file containing GSTR-1, 3B, or 2B data to generate analysis.</p>
                    </div>
                    
                    <div className="space-y-3">
                        <button onClick={downloadTemplate} className="text-sm text-blue-600 hover:underline flex items-center justify-center gap-1 font-medium">
                            <Download size={14}/> Download Excel Template
                        </button>
                        
                        <div 
                            className="border-2 border-dashed border-slate-300 rounded-xl p-8 hover:bg-slate-50 transition-colors cursor-pointer"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <p className="text-sm font-bold text-slate-600">Click to Select File (.xlsx)</p>
                            <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
                        </div>
                    </div>
                </div>
            </div>
        )}

        {activeTab === 'list' && (
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4">GSTIN</th>
                            <th className="px-6 py-4">Period</th>
                            <th className="px-6 py-4">Type</th>
                            <th className="px-6 py-4 text-right">Tax Liability</th>
                            <th className="px-6 py-4 text-right">ITC Avail</th>
                            <th className="px-6 py-4 text-right">Cash Paid</th>
                            <th className="px-6 py-4 text-center">Status</th>
                            <th className="px-6 py-4 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {filteredReturns.map(r => (
                            <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 font-medium text-slate-800">{r.gstin}</td>
                                <td className="px-6 py-4 text-slate-600">{r.period}</td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-1 rounded text-xs font-semibold ${
                                        r.returnType === 'GSTR-1' ? 'bg-blue-100 text-blue-700' :
                                        r.returnType === 'GSTR-3B' ? 'bg-green-100 text-green-700' :
                                        'bg-purple-100 text-purple-700'
                                    }`}>{r.returnType}</span>
                                </td>
                                <td className="px-6 py-4 text-right">{formatCurrency(r.taxLiability)}</td>
                                <td className="px-6 py-4 text-right">{formatCurrency(r.itcAvailable)}</td>
                                <td className="px-6 py-4 text-right">{formatCurrency(r.cashPaid)}</td>
                                <td className="px-6 py-4 text-center">
                                    <span className="flex items-center justify-center gap-1 text-green-600 text-xs font-bold">
                                        <CheckCircle size={12}/> {r.status}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <button onClick={() => handleDelete(r.id!)} className="text-slate-400 hover:text-red-500"><Trash2 size={16}/></button>
                                </td>
                            </tr>
                        ))}
                        {filteredReturns.length === 0 && (
                            <tr><td colSpan={8} className="text-center py-8 text-slate-400">No records found. Import or Fetch data to see list.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        )}

        {/* ... (Analysis Tab - minor formatting) ... */}
        {activeTab === 'analysis' && (
            <div className="space-y-6 animate-in fade-in">
                {selectedGstin ? (
                    <>
                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-6">Tax Liability Comparison (GSTR-1 vs GSTR-3B)</h3>
                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analysisData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                        <Legend />
                                        <Bar dataKey="GSTR-1 Liability" fill="#3b82f6" name="GSTR-1 Liability" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="GSTR-3B Liability" fill="#10b981" name="GSTR-3B Liability" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                            <h3 className="font-bold text-slate-800 mb-6">ITC Utilization (GSTR-2B vs GSTR-3B)</h3>
                            <div className="h-80">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={analysisData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                                        <XAxis dataKey="name" />
                                        <YAxis />
                                        <Tooltip formatter={(value: number) => formatCurrency(value)} />
                                        <Legend />
                                        <Bar dataKey="GSTR-2B ITC" fill="#8b5cf6" name="GSTR-2B ITC (Auto)" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="GSTR-3B ITC" fill="#f59e0b" name="GSTR-3B ITC (Claimed)" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="bg-amber-50 p-8 rounded-xl border border-amber-200 text-center text-amber-800">
                        <AlertCircle size={32} className="mx-auto mb-2"/>
                        <p className="font-bold">Select a Taxpayer</p>
                        <p className="text-sm mt-1">Please select a GSTIN from the filter bar above to view analysis charts.</p>
                    </div>
                )}
            </div>
        )}

        {/* Fetch Online Modal */}
        {showFetchModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                            <CloudDownload className="text-purple-600"/> Fetch from GST Portal
                        </h3>
                        <button onClick={() => setShowFetchModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                    </div>
                    {/* ... (Form Content - Logic same, slight visual tweaks) ... */}
                    <form onSubmit={handleExecuteFetch} className="space-y-5">
                        <div className="p-4 bg-purple-50 rounded-lg border border-purple-100 text-sm text-purple-800 mb-4">
                            <p className="font-semibold mb-1">API Parameters</p>
                            <p className="text-xs opacity-90">Requests will be authenticated using credentials configured in Admin Settings.</p>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">GSTIN <span className="text-red-500">*</span></label>
                            <select 
                                required
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:ring-2 focus:ring-purple-500"
                                value={fetchParams.gstin} 
                                onChange={e => {
                                    const val = e.target.value;
                                    const t = taxpayers.find(tax => tax.gstin === val);
                                    setFetchParams(prev => ({...prev, gstin: val, email: t?.email || prev.email, stateCode: val.substring(0, 2)}));
                                }}
                            >
                                <option value="">Select Taxpayer</option>
                                {taxpayers.map(t => <option key={t.id} value={t.gstin}>{t.tradeName} ({t.gstin})</option>)}
                            </select>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Date <span className="text-red-500">*</span></label>
                                <input 
                                    type="date" 
                                    required 
                                    value={fetchParams.date} 
                                    onChange={e => setFetchParams({...fetchParams, date: e.target.value})} 
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">Email <span className="text-red-500">*</span></label>
                                <input 
                                    type="email" 
                                    required 
                                    placeholder="Registered Email"
                                    value={fetchParams.email} 
                                    onChange={e => setFetchParams({...fetchParams, email: e.target.value})} 
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-500"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-sm font-bold text-slate-700 mb-1">GST Username <span className="text-red-500">*</span></label>
                            <input 
                                type="text" 
                                required 
                                placeholder="Portal Username"
                                value={fetchParams.gstUsername} 
                                onChange={e => setFetchParams({...fetchParams, gstUsername: e.target.value})} 
                                className="w-full p-2.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-purple-500"
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">State Code</label>
                                <input 
                                    type="text" 
                                    readOnly 
                                    value={fetchParams.stateCode} 
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-slate-100 text-slate-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-slate-700 mb-1">IP Address</label>
                                <input 
                                    type="text" 
                                    readOnly 
                                    value={fetchParams.ipAddress} 
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm bg-slate-100 text-slate-500"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end pt-4">
                            <button 
                                type="submit" 
                                disabled={isFetching}
                                className={`w-full py-3 rounded-xl font-bold text-white shadow-lg transition-all flex justify-center items-center gap-2 ${isFetching ? 'bg-slate-400 cursor-not-allowed' : 'bg-purple-600 hover:bg-purple-700 shadow-purple-200'}`}
                            >
                                {isFetching ? 'Processing Request...' : <><Play size={18}/> Execute</>}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        )}
    </div>
  );
};

export default Returns;
