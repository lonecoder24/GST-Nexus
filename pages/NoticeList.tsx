
import React, { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Notice, NoticeStatus, RiskLevel } from '../types';
import { Plus, Search, Filter, Calendar, AlertCircle, X, Trash2, Upload, FileSpreadsheet, Download, Layers } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';

const NoticeList: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Initialize filters from navigation state if present
  const initialState = location.state as { gstin?: string, defectType?: string, status?: string } | null;
  
  const [showAdvanced, setShowAdvanced] = useState(!!initialState?.defectType || !!initialState?.status);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importType, setImportType] = useState<'notice' | 'defect' | 'payment'>('notice');

  // Filter State
  const [textSearch, setTextSearch] = useState(initialState?.gstin || '');
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(initialState?.status ? [initialState.status] : []);
  const [selectedRisks, setSelectedRisks] = useState<string[]>([]);
  const [dateType, setDateType] = useState<'issue' | 'due'>('due');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  
  const [selectedSection, setSelectedSection] = useState('');
  const [selectedDefectType, setSelectedDefectType] = useState(initialState?.defectType || '');
  const [groupBy, setGroupBy] = useState<'none' | 'noticeType' | 'arn'>('none');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const users = useLiveQuery(() => db.users.filter(u => u.isActive === true).toArray());
  const configStatuses = useLiveQuery(() => db.appConfig.get({key: 'notice_statuses'}));
  const configDefectTypes = useLiveQuery(() => db.appConfig.get({key: 'defect_types'}));
  
  const statusOptions = configStatuses?.value || Object.values(NoticeStatus);
  const defectTypeOptions = configDefectTypes?.value || [];

  const uniqueSections = useLiveQuery(async () => {
      const allNotices = await db.notices.toArray();
      const sections = new Set(allNotices.map(n => n.section).filter(Boolean));
      return Array.from(sections).sort();
  });

  const notices = useLiveQuery(async () => {
    let collection = db.notices.toCollection();
    let result = await collection.toArray();
    
    if (textSearch) {
      const lower = textSearch.toLowerCase();
      result = result.filter(n => 
        n.noticeNumber.toLowerCase().includes(lower) ||
        n.gstin.toLowerCase().includes(lower) ||
        n.section.toLowerCase().includes(lower) ||
        (n.arn && n.arn.toLowerCase().includes(lower))
      );
    }
    if (selectedStatuses.length > 0) result = result.filter(n => selectedStatuses.includes(n.status));
    if (selectedRisks.length > 0) result = result.filter(n => selectedRisks.includes(n.riskLevel));
    if (assignedTo) result = result.filter(n => n.assignedTo === assignedTo);
    if (selectedSection) result = result.filter(n => n.section === selectedSection);
    if (dateFrom) result = result.filter(n => (dateType === 'due' ? n.dueDate : n.dateOfIssue) >= dateFrom);
    if (dateTo) result = result.filter(n => (dateType === 'due' ? n.dueDate : n.dateOfIssue) <= dateTo);
    if (selectedDefectType) {
        const matchingDefects = await db.defects.where('defectType').equals(selectedDefectType).toArray();
        const noticeIdsWithDefect = new Set(matchingDefects.map(d => d.noticeId));
        result = result.filter(n => noticeIdsWithDefect.has(n.id!));
    }
    return result.sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());
  }, [textSearch, selectedStatuses, selectedRisks, assignedTo, dateFrom, dateTo, dateType, selectedSection, selectedDefectType]);

  const handleDelete = async (id: number) => {
    if(confirm('Are you sure you want to delete this notice?')) {
        const notice = await db.notices.get(id);
        await db.notices.delete(id);
        await db.defects.where('noticeId').equals(id).delete();
        await db.payments.where('noticeId').equals(id).delete();
        
        // Log deletion
        await db.auditLogs.add({
            entityType: 'Notice',
            entityId: id,
            action: 'Delete',
            timestamp: new Date().toISOString(),
            user: user?.username || 'System',
            details: `Deleted notice ${notice?.noticeNumber || id}`
        });
    }
  };

  const handleBulkDelete = async () => {
      if (confirm(`Are you sure you want to delete ${selectedIds.length} selected notices?`)) {
          const timestamp = new Date().toISOString();
          const username = user?.username || 'System';

          for (const nid of selectedIds) {
             const notice = await db.notices.get(nid);
             await db.notices.delete(nid);
             await db.defects.where('noticeId').equals(nid).delete();
             await db.payments.where('noticeId').equals(nid).delete(); 
             
             await db.auditLogs.add({
                entityType: 'Notice',
                entityId: nid,
                action: 'Delete',
                timestamp,
                user: username,
                details: `Bulk deleted notice ${notice?.noticeNumber || nid}`
             });
          }
          setSelectedIds([]);
      }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
      if (confirm(`Change status of ${selectedIds.length} notices to "${newStatus}"?`)) {
          const timestamp = new Date().toISOString();
          const username = user?.username || 'System';

          for (const id of selectedIds) {
              const notice = await db.notices.get(id);
              if (notice) {
                  await db.notices.update(id, { status: newStatus });
                  await db.auditLogs.add({
                      entityType: 'Notice',
                      entityId: id,
                      action: 'StatusChange',
                      timestamp,
                      user: username,
                      details: `Bulk status change: '${notice.status}' ➔ '${newStatus}'`
                  });
              }
          }
          setSelectedIds([]);
      }
  };

  const toggleSelection = (list: string[], item: string, setter: (val: string[]) => void) => {
    list.includes(item) ? setter(list.filter(i => i !== item)) : setter([...list, item]);
  };
  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.checked && notices) setSelectedIds(notices.map(n => n.id!)); else setSelectedIds([]);
  };
  const handleRowSelect = (id: number) => {
      selectedIds.includes(id) ? setSelectedIds(selectedIds.filter(sid => sid !== id)) : setSelectedIds([...selectedIds, id]);
  };

  // --- IMPORT LOGIC ---
  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    let ws, filename;

    if (importType === 'notice') {
        ws = XLSX.utils.json_to_sheet([{
          gstin: "27ABCDE1234F1Z5", caseId: "ARN123", noticeNumber: "DIN20230001", noticeType: "ASMT-10", section: "61", period: "FY 2022-23", dateOfIssue: "2023-10-01", dueDate: "2023-10-30", issuingAuthority: "Sup. Range 1", demandAmount: 50000, description: "Desc...", riskLevel: "High"
        }]);
        filename = "Import_Notices.xlsx";
    } else if (importType === 'defect') {
        ws = XLSX.utils.json_to_sheet([{
            noticeNumber: "DIN20230001", defectType: "ITC Mismatch", section: "16(2)(c)", description: "Desc...", 
            igstTax: 1000, igstInterest: 100, cgstTax: 500, cgstInterest: 50, sgstTax: 500, sgstInterest: 50
        }]);
        filename = "Import_Defects.xlsx";
    } else {
        ws = XLSX.utils.json_to_sheet([{
            noticeNumber: "DIN20230001", challanNumber: "CPIN123", paymentDate: "2023-10-10", amount: 10000, majorHead: "IGST", minorHead: "Tax", bank: "HDFC"
        }]);
        filename = "Import_Payments.xlsx";
    }

    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, filename);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const data = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]]);
        let count = 0, skipped = 0;

        for (const row of data) {
           if (importType === 'notice') {
               if(row.gstin && row.noticeNumber) {
                 await db.notices.add({
                    gstin: row.gstin, arn: row.caseId || row.arn, noticeNumber: row.noticeNumber, noticeType: row.noticeType || 'General', section: row.section || '', period: row.period || '', dateOfIssue: row.dateOfIssue || new Date().toISOString().split('T')[0], dueDate: row.dueDate || new Date().toISOString().split('T')[0], issuingAuthority: row.issuingAuthority || 'System', demandAmount: Number(row.demandAmount) || 0, riskLevel: (row.riskLevel as RiskLevel) || RiskLevel.MEDIUM, status: NoticeStatus.RECEIVED, description: row.description || 'Imported', receivedDate: new Date().toISOString().split('T')[0]
                 });
                 count++;
               } else skipped++;
           } 
           else if (importType === 'defect') {
               if(row.noticeNumber) {
                   const notice = await db.notices.where('noticeNumber').equals(row.noticeNumber).first();
                   if(notice) {
                       await db.defects.add({
                           noticeId: notice.id!, defectType: row.defectType || 'General', section: row.section || '', description: row.description || '',
                           igst: { tax: row.igstTax||0, interest: row.igstInterest||0, penalty: row.igstPenalty||0, lateFee: 0, others: 0 },
                           cgst: { tax: row.cgstTax||0, interest: row.cgstInterest||0, penalty: row.cgstPenalty||0, lateFee: 0, others: 0 },
                           sgst: { tax: row.sgstTax||0, interest: row.sgstInterest||0, penalty: row.sgstPenalty||0, lateFee: 0, others: 0 },
                           cess: { tax: row.cessTax||0, interest: row.cessInterest||0, penalty: row.cessPenalty||0, lateFee: 0, others: 0 },
                           taxDemand: 0, interestDemand: 0, penaltyDemand: 0 // Will recalculate later
                       });
                       count++;
                   } else skipped++;
               }
           }
           else if (importType === 'payment') {
               if(row.noticeNumber && row.amount) {
                   const notice = await db.notices.where('noticeNumber').equals(row.noticeNumber).first();
                   if(notice) {
                       await db.payments.add({
                           noticeId: notice.id!, amount: row.amount, challanNumber: row.challanNumber || '', paymentDate: row.paymentDate || new Date().toISOString(), majorHead: row.majorHead || 'IGST', minorHead: row.minorHead || 'Tax', bankName: row.bank || ''
                       });
                       count++;
                   } else skipped++;
               }
           }
        }
        alert(`Imported: ${count}. Skipped/Failed: ${skipped}`);
        setShowImportModal(false);
      } catch (err) {
        console.error(err);
        alert('Error parsing Excel file.');
      }
    };
    reader.readAsBinaryString(file);
  };

  const groupedNotices = (): Record<string, Notice[]> => {
    if (!notices) return {};
    if (groupBy === 'none') return { 'All Notices': notices };
    return notices.reduce((acc, notice) => {
      const key = groupBy === 'noticeType' ? (notice.noticeType || 'Other') : groupBy === 'arn' ? (notice.arn || 'No Case ID') : 'All';
      if (!acc[key]) acc[key] = []; acc[key].push(notice); return acc;
    }, {} as Record<string, Notice[]>);
  };

  const clearFilters = () => {
    setTextSearch(''); setSelectedStatuses([]); setSelectedRisks([]); setDateFrom('');
    setDateTo(''); setAssignedTo(''); setSelectedSection(''); setSelectedDefectType('');
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-slate-800">Notices Registry</h2><p className="text-slate-500 text-sm">Manage and track all GST proceedings</p></div>
        <div className="flex gap-2">
            <button onClick={() => setShowImportModal(true)} className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 shadow-sm transition-all"><Upload size={18} /> Import Data</button>
            <button onClick={() => setShowAdvanced(!showAdvanced)} className={`px-4 py-2 rounded-lg flex items-center gap-2 border transition-all ${showAdvanced ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}><Filter size={18} /> Filters</button>
            <Link to="/notices/new" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all"><Plus size={18} /> New Notice</Link>
        </div>
      </div>

      {selectedIds.length > 0 && (
          <div className="bg-slate-800 text-white p-3 rounded-lg flex items-center justify-between shadow-lg animate-in slide-in-from-top-2">
              <span className="font-semibold text-sm px-2 bg-slate-700 rounded">{selectedIds.length} Selected</span>
              <div className="flex items-center gap-3">
                  <div className="flex items-center bg-slate-700 rounded overflow-hidden">
                      <span className="px-3 text-xs text-slate-300 border-r border-slate-600">Set Status</span>
                      <select className="bg-slate-700 text-white text-xs p-2 outline-none cursor-pointer hover:bg-slate-600" onChange={(e) => { if (e.target.value) handleBulkStatusChange(e.target.value); e.target.value = ''; }}>
                          <option value="">Choose...</option>{statusOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}
                      </select>
                  </div>
                  <button onClick={handleBulkDelete} className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded text-xs font-medium"><Trash2 size={14} /> Delete</button>
                  <button onClick={() => setSelectedIds([])} className="p-1.5 hover:bg-slate-700 rounded"><X size={16} /></button>
              </div>
          </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 h-full min-h-0">
        {showAdvanced && (
            <div className="w-full lg:w-72 bg-white p-5 rounded-xl shadow-sm border border-slate-200 overflow-y-auto flex-shrink-0 animate-in fade-in slide-in-from-left-4 duration-200">
                <div className="flex justify-between items-center mb-4"><h3 className="font-semibold text-slate-800">Filters</h3><button onClick={clearFilters} className="text-xs text-blue-600 hover:underline">Clear</button></div>
                <div className="space-y-4">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200"><label className="text-xs font-bold text-slate-700 uppercase mb-2 block flex items-center gap-2"><Layers size={12}/> Group View</label><select className="w-full p-2 text-sm border border-slate-300 rounded bg-white" value={groupBy} onChange={(e: any) => setGroupBy(e.target.value)}><option value="none">No Grouping</option><option value="noticeType">By Notice Type</option><option value="arn">By Case ID (ARN)</option></select></div>
                    
                    {/* Defect Type Filter (Shown first if selected via state) */}
                    <div>
                        <label className="text-xs font-medium text-slate-500 uppercase mb-1 block">Defect Type</label>
                        <select className="w-full p-2 text-sm border border-slate-300 rounded bg-white" value={selectedDefectType} onChange={(e) => setSelectedDefectType(e.target.value)}>
                            <option value="">All Defects</option>
                            {defectTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    <div><div className="relative"><Search className="absolute left-3 top-2.5 text-slate-400" size={16} /><input type="text" placeholder="Search by Notice #, GSTIN, ARN..." className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-blue-500 outline-none" value={textSearch} onChange={(e) => setTextSearch(e.target.value)} /></div></div>
                    
                    {/* Risk Filter */}
                    <div>
                        <label className="text-xs font-medium text-slate-500 uppercase mb-1 block">Risk Level</label>
                        <div className="space-y-1 border border-slate-100 rounded p-2 bg-white max-h-32 overflow-y-auto">
                            {Object.values(RiskLevel).map((risk) => (
                                <label key={risk} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded">
                                    <input type="checkbox" checked={selectedRisks.includes(risk)} onChange={() => toggleSelection(selectedRisks, risk, setSelectedRisks)} className="rounded border-slate-300 text-blue-600" />
                                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${risk === RiskLevel.CRITICAL ? 'bg-red-100 text-red-700' : risk === RiskLevel.HIGH ? 'bg-orange-100 text-orange-700' : risk === RiskLevel.MEDIUM ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{risk}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div><label className="text-xs font-medium text-slate-500 uppercase mb-1 block">Assigned To</label><select className="w-full p-2 text-sm border border-slate-300 rounded bg-white" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}><option value="">All Users</option>{users?.map(u => <option key={u.id} value={u.username}>{u.fullName}</option>)}</select></div>
                    <div><label className="text-xs font-medium text-slate-500 uppercase mb-1 block">Status</label><div className="space-y-1 max-h-32 overflow-y-auto border border-slate-100 rounded p-2">{statusOptions.map((status: string) => (<label key={status} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1 rounded"><input type="checkbox" checked={selectedStatuses.includes(status)} onChange={() => toggleSelection(selectedStatuses, status, setSelectedStatuses)} className="rounded border-slate-300 text-blue-600" /><span className="text-xs text-slate-700">{status}</span></label>))}</div></div>
                </div>
            </div>
        )}

        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
            <div className="overflow-auto flex-1">
                {Object.entries(groupedNotices()).map(([groupName, groupItems]) => (
                    <div key={groupName}>
                        {groupBy !== 'none' && <div className="bg-slate-100 px-4 py-2 font-bold text-slate-700 text-sm border-b border-slate-200 sticky top-0 z-10">{groupName} <span className="font-normal text-slate-500 text-xs ml-2">({groupItems.length})</span></div>}
                        <table className="w-full text-left text-sm">
                            {groupBy === 'none' && <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-xs sticky top-0 z-10 shadow-sm"><tr><th className="px-4 py-4 w-10"><input type="checkbox" onChange={handleSelectAll} checked={notices && notices.length > 0 && selectedIds.length === notices.length} /></th><th className="px-6 py-4">Risk</th><th className="px-6 py-4">Notice Details</th><th className="px-6 py-4">Dates</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Assigned</th><th className="px-6 py-4 text-right">Actions</th></tr></thead>}
                            <tbody className="divide-y divide-slate-100">{groupItems.map((notice) => {
                                const assignedUser = users?.find(u => u.username === notice.assignedTo);
                                const assignedLabel = assignedUser ? assignedUser.fullName : notice.assignedTo;
                                return (
                                <tr key={notice.id} className={`hover:bg-slate-50 cursor-pointer ${selectedIds.includes(notice.id!) ? 'bg-blue-50/50' : ''}`} onClick={() => navigate(`/notices/${notice.id}`)}><td className="px-4 py-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selectedIds.includes(notice.id!)} onChange={() => handleRowSelect(notice.id!)} /></td><td className="px-6 py-4"><div className={`w-3 h-3 rounded-full ${notice.riskLevel === RiskLevel.CRITICAL ? 'bg-red-500 shadow-red-200' : notice.riskLevel === RiskLevel.HIGH ? 'bg-orange-500' : notice.riskLevel === RiskLevel.MEDIUM ? 'bg-amber-400' : 'bg-green-500'}`} title={notice.riskLevel}></div></td><td className="px-6 py-4"><div className="font-medium text-slate-900">{notice.noticeNumber}</div>{notice.arn && <div className="text-slate-500 text-xs mt-0.5">Case ID: {notice.arn}</div>}<div className="text-slate-500 text-xs mt-1 font-mono">{notice.gstin}</div><div className="flex gap-1 mt-1"><span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs border border-slate-200">{notice.noticeType || 'General'}</span><span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-xs border border-slate-200">{notice.section}</span></div></td><td className="px-6 py-4"><div className="text-xs text-slate-600">Issued: {notice.dateOfIssue}</div><div className={`flex items-center gap-1 mt-1 font-medium ${new Date(notice.dueDate) < new Date() && notice.status !== 'Closed' ? 'text-red-600' : 'text-slate-600'}`}><Calendar size={12} /> {notice.dueDate}</div></td><td className="px-6 py-4"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${notice.status === 'Closed' ? 'bg-slate-100 text-slate-600' : notice.status === 'Hearing Scheduled' ? 'bg-purple-100 text-purple-700' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>{notice.status}</span></td><td className="px-6 py-4">{notice.assignedTo ? <span className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-600 truncate max-w-[120px] block" title={assignedLabel}>{assignedLabel}</span> : <span className="text-xs text-slate-400 italic">Unassigned</span>}</td><td className="px-6 py-4 text-right"><button onClick={(e) => { e.stopPropagation(); navigate(`/notices/${notice.id}`); }} className="text-blue-600 hover:text-blue-800 text-xs font-medium mr-3">Edit</button><button onClick={(e) => { e.stopPropagation(); handleDelete(notice.id!); }} className="text-red-500 hover:text-red-700 text-xs font-medium">Delete</button></td></tr>
                            )})}</tbody>
                        </table>
                    </div>
                ))}
                {!notices?.length && <div className="p-12 text-center text-slate-400"><AlertCircle size={48} className="mx-auto mb-2 opacity-50"/>No notices found.</div>}
            </div>
            <div className="bg-slate-50 p-2 border-t border-slate-200 text-xs text-slate-500 text-right">Total Records: {notices?.length || 0}</div>
        </div>
      </div>

      {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-6"><h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><FileSpreadsheet className="text-green-600"/> Bulk Data Import</h3><button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button></div>
                  <div className="space-y-6">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-2">Select Data Type</label>
                          <div className="flex gap-2">
                              {(['notice', 'defect', 'payment'] as const).map(t => (
                                  <button key={t} onClick={() => setImportType(t)} className={`flex-1 py-2 text-sm rounded border capitalize ${importType === t ? 'bg-blue-50 border-blue-500 text-blue-700 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{t}s</button>
                              ))}
                          </div>
                      </div>
                      <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                          <p className="text-sm text-blue-800 mb-3">1. Download the template for {importType}s.</p>
                          <button onClick={downloadTemplate} className="text-xs bg-white border border-blue-200 text-blue-700 px-3 py-2 rounded flex items-center gap-2 hover:bg-blue-50"><Download size={14}/> Download Template (.xlsx)</button>
                      </div>
                      <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                          <Upload size={32} className="mx-auto text-slate-400 mb-2"/><p className="text-sm font-medium text-slate-600">Click to upload Excel file</p><input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default NoticeList;
