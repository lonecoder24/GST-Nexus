
import React, { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Notice, NoticeStatus, RiskLevel } from '../types';
import { Plus, Search, Filter, Calendar, AlertCircle, X, Trash2, Upload, FileSpreadsheet, Download, Layers, Paperclip, UploadCloud, FolderOpen, Split, ChevronDown, ChevronRight, Briefcase } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { useAuth } from '../contexts/AuthContext';
import { formatDate, parseExcelDate, formatCurrency } from '../utils/formatting';

const NoticeList: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, checkPermission } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bulkUploadRef = useRef<HTMLInputElement>(null);
  
  // Initialize filters
  const initialState = location.state as { gstin?: string, defectType?: string, status?: string } | null;
  
  const [showAdvanced, setShowAdvanced] = useState(!!initialState?.defectType || !!initialState?.status);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importType, setImportType] = useState<'notice' | 'defect' | 'payment'>('notice');
  const [isBulkUploading, setIsBulkUploading] = useState(false);

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
  const [selectedCaseType, setSelectedCaseType] = useState('');
  
  const [groupBy, setGroupBy] = useState<'none' | 'noticeType' | 'arn' | 'caseType'>('none');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]); // For hierarchical view

  const users = useLiveQuery(() => db.users.filter(u => u.isActive === true).toArray());
  const taxpayers = useLiveQuery(() => db.taxpayers.toArray()) || [];
  const configStatuses = useLiveQuery(() => db.appConfig.get({key: 'notice_statuses'}));
  const configDefectTypes = useLiveQuery(() => db.appConfig.get({key: 'defect_types'}));
  const configCaseTypes = useLiveQuery(() => db.appConfig.get({key: 'case_types'}));
  
  const statusOptions = configStatuses?.value || Object.values(NoticeStatus);
  const defectTypeOptions = configDefectTypes?.value || [];
  const caseTypeOptions = configCaseTypes?.value || [];

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
    if (selectedCaseType) result = result.filter(n => n.caseType === selectedCaseType);
    
    if (selectedDefectType) {
        const matchingDefects = await db.defects.where('defectType').equals(selectedDefectType).toArray();
        const noticeIdsWithDefect = new Set(matchingDefects.map(d => d.noticeId));
        result = result.filter(n => noticeIdsWithDefect.has(n.id!));
    }
    return result.sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime());
  }, [textSearch, selectedStatuses, selectedRisks, assignedTo, dateFrom, dateTo, dateType, selectedSection, selectedDefectType, selectedCaseType, taxpayers]);

  // Actions
  const handleDelete = async (id: number) => {
    if(confirm('Are you sure you want to delete this notice?')) {
        await db.notices.delete(id);
        await db.defects.where('noticeId').equals(id).delete();
        await db.payments.where('noticeId').equals(id).delete();
        await db.auditLogs.add({
            entityType: 'Notice', entityId: id, action: 'Delete', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Deleted notice`
        });
    }
  };

  const handleBulkDelete = async () => {
      if (confirm(`Delete ${selectedIds.length} notices?`)) {
          for (const nid of selectedIds) {
             await db.notices.delete(nid);
             await db.defects.where('noticeId').equals(nid).delete();
             await db.payments.where('noticeId').equals(nid).delete(); 
          }
          setSelectedIds([]);
      }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
      if (confirm(`Change status of ${selectedIds.length} notices to "${newStatus}"?`)) {
          const timestamp = new Date().toISOString();
          for (const id of selectedIds) {
              await db.notices.update(id, { status: newStatus });
              await db.auditLogs.add({ entityType: 'Notice', entityId: id, action: 'StatusChange', timestamp, user: user?.username || 'System', details: `Bulk status change to '${newStatus}'` });
          }
          setSelectedIds([]);
      }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      setIsBulkUploading(true);
      try {
          const timestamp = new Date().toISOString();
          for (const noticeId of selectedIds) {
              for (let i = 0; i < files.length; i++) {
                  const file = files[i];
                  const arrayBuffer = await file.arrayBuffer();
                  await db.documents.add({
                      noticeId: noticeId, fileName: file.name, fileType: file.type, size: file.size, uploadDate: timestamp, category: 'Other',
                      fileData: new Blob([new Uint8Array(arrayBuffer)], {type: file.type})
                  });
              }
          }
          alert('Files attached successfully.');
      } catch (error) { alert("Error during bulk upload."); } 
      finally { setIsBulkUploading(false); if (bulkUploadRef.current) bulkUploadRef.current.value = ''; setSelectedIds([]); }
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

  const toggleExpand = (id: string) => {
      setExpandedGroups(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  // Grouping Logic
  const groupedNotices = (): Record<string, Notice[]> => {
    if (!notices) return {};
    if (groupBy === 'none') return { 'All Notices': notices };
    return notices.reduce((acc, notice) => {
      let key = 'All';
      if (groupBy === 'noticeType') key = notice.noticeType || 'Other';
      else if (groupBy === 'arn') key = notice.arn || 'No Case ID';
      else if (groupBy === 'caseType') key = notice.caseType || 'Uncategorized';
      
      if (!acc[key]) acc[key] = []; acc[key].push(notice); return acc;
    }, {} as Record<string, Notice[]>);
  };

  const groupedByTrackAndCase = () => {
      if (!notices) return {};
      // Group 1: Case Type (Track)
      const byTrack = notices.reduce((acc, notice) => {
          const track = notice.caseType || 'Uncategorized';
          if (!acc[track]) acc[track] = {};
          
          // Group 2: ARN (Case ID)
          const arn = notice.arn || 'No Case ID';
          if (!acc[track][arn]) acc[track][arn] = [];
          
          acc[track][arn].push(notice);
          return acc;
      }, {} as Record<string, Record<string, Notice[]>>);
      return byTrack;
  };

  const getGroupSummary = (groupNotices: Notice[]) => {
      if (groupBy !== 'arn') return null;
      const firstNotice = groupNotices[0];
      if (!firstNotice) return null;
      const taxpayer = taxpayers.find(t => t.gstin === firstNotice.gstin);
      const clientName = taxpayer ? taxpayer.tradeName : firstNotice.gstin;
      const totalDemand = groupNotices.reduce((acc, n) => acc + (n.demandAmount || 0), 0);
      const statusCounts = groupNotices.reduce((acc, n) => { acc[n.status] = (acc[n.status] || 0) + 1; return acc; }, {} as Record<string, number>);
      const statusSummary = Object.entries(statusCounts).map(([status, count]) => `${status} (${count})`).join(', ');
      return { clientName, totalDemand, statusSummary };
  };

  const clearFilters = () => {
    setTextSearch(''); setSelectedStatuses([]); setSelectedRisks([]); setDateFrom('');
    setDateTo(''); setAssignedTo(''); setSelectedSection(''); setSelectedDefectType(''); setSelectedCaseType('');
  };

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();
    let data: any[] = [];
    let filename = "Template.xlsx";

    if (importType === 'notice') {
        data = [{
            gstin: "27ABCDE1234F1Z5",
            arn: "AD2704230001234",
            noticeNumber: "DIN2023101055",
            noticeType: "ASMT-10",
            caseType: "Assessment Proceedings",
            section: "Section 61",
            period: "FY 2021-22",
            dateOfIssue: "2023-10-01",
            dueDate: "2023-11-01",
            demandAmount: 50000,
            riskLevel: "High",
            status: "Received",
            description: "ITC Mismatch",
            assignedTo: "admin"
        }];
        filename = "Notices_Import_Template.xlsx";
    } else if (importType === 'defect') {
        data = [{
            noticeNumber: "DIN2023101055", // Lookup key
            defectType: "ITC Mismatch",
            section: "16(2)(c)",
            description: "GSTR-2A vs 3B",
            taxDemand: 10000,
            interestDemand: 500,
            penaltyDemand: 0
        }];
        filename = "Defects_Import_Template.xlsx";
    } else if (importType === 'payment') {
        data = [{
            noticeNumber: "DIN2023101055", // Lookup key
            amount: 10500,
            paymentDate: "2023-10-15",
            challanNumber: "CPIN12345",
            majorHead: "IGST",
            minorHead: "Tax",
            bankName: "HDFC"
        }];
        filename = "Payments_Import_Template.xlsx";
    }

    const ws = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, filename);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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
            let skipped = 0;
            const timestamp = new Date().toISOString();

            if (importType === 'notice') {
                for (const row of data) {
                    if (!row.noticeNumber || !row.gstin) { skipped++; continue; }
                    
                    // Check duplicate
                    const existing = await db.notices.where('noticeNumber').equals(row.noticeNumber).first();
                    if (existing) { skipped++; continue; }

                    await db.notices.add({
                        gstin: row.gstin,
                        arn: row.arn || '',
                        noticeNumber: row.noticeNumber,
                        noticeType: row.noticeType || 'General',
                        caseType: row.caseType || 'General',
                        section: row.section || '',
                        period: row.period || '',
                        dateOfIssue: parseExcelDate(row.dateOfIssue),
                        dueDate: parseExcelDate(row.dueDate),
                        receivedDate: new Date().toISOString().split('T')[0],
                        issuingAuthority: row.issuingAuthority || 'Officer',
                        demandAmount: parseFloat(row.demandAmount) || 0,
                        riskLevel: (row.riskLevel as RiskLevel) || RiskLevel.MEDIUM,
                        status: row.status || NoticeStatus.RECEIVED,
                        description: row.description || '',
                        assignedTo: row.assignedTo || '',
                        tags: [],
                        lastCheckedDate: new Date().toISOString().split('T')[0]
                    });
                    count++;
                }
            } else if (importType === 'defect') {
                for (const row of data) {
                    if (!row.noticeNumber) { skipped++; continue; }
                    const notice = await db.notices.where('noticeNumber').equals(row.noticeNumber).first();
                    if (!notice) { skipped++; continue; }

                    await db.defects.add({
                        noticeId: notice.id!,
                        defectType: row.defectType || 'General',
                        section: row.section || '',
                        description: row.description || '',
                        taxDemand: parseFloat(row.taxDemand) || 0,
                        interestDemand: parseFloat(row.interestDemand) || 0,
                        penaltyDemand: parseFloat(row.penaltyDemand) || 0,
                        // Defaults for granular
                        igst: { tax: 0, interest: 0, penalty: 0, lateFee: 0, others: 0 },
                        cgst: { tax: 0, interest: 0, penalty: 0, lateFee: 0, others: 0 },
                        sgst: { tax: 0, interest: 0, penalty: 0, lateFee: 0, others: 0 },
                        cess: { tax: 0, interest: 0, penalty: 0, lateFee: 0, others: 0 }
                    });
                    count++;
                }
            } else if (importType === 'payment') {
                for (const row of data) {
                    if (!row.noticeNumber) { skipped++; continue; }
                    const notice = await db.notices.where('noticeNumber').equals(row.noticeNumber).first();
                    if (!notice) { skipped++; continue; }

                    await db.payments.add({
                        noticeId: notice.id!,
                        amount: parseFloat(row.amount) || 0,
                        paymentDate: parseExcelDate(row.paymentDate),
                        challanNumber: row.challanNumber || '',
                        majorHead: row.majorHead || 'IGST',
                        minorHead: row.minorHead || 'Tax',
                        bankName: row.bankName || ''
                    });
                    count++;
                }
            }

            if (count > 0) {
                 await db.auditLogs.add({
                    entityType: 'System', entityId: 'IMPORT', action: 'Create', timestamp,
                    user: user?.username || 'System', details: `Imported ${count} ${importType}s. Skipped ${skipped}.`
                });
            }
            
            alert(`Import Successful.\nAdded: ${count}\nSkipped: ${skipped}`);
            setShowImportModal(false);
        } catch (error) {
            console.error(error);
            alert('Error processing file. Please ensure format matches template.');
        }
    };
    reader.readAsBinaryString(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const renderNoticeRow = (notice: Notice, showCheckbox: boolean = true) => {
      const assignedUser = users?.find(u => u.username === notice.assignedTo);
      return (
        <tr key={notice.id} className={`hover:bg-slate-50 cursor-pointer transition-colors ${selectedIds.includes(notice.id!) ? 'bg-blue-50/40' : ''}`} onClick={() => navigate(`/notices/${notice.id}`)}>
            {showCheckbox && (
                <td className="px-4 py-4 w-12 text-center align-top pt-5" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selectedIds.includes(notice.id!)} onChange={() => handleRowSelect(notice.id!)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"/>
                </td>
            )}
            <td className="px-6 py-4 align-top w-20 pt-5"><div className={`w-3 h-3 mx-auto rounded-full ${notice.riskLevel === RiskLevel.CRITICAL ? 'bg-red-500 shadow-red-200 shadow-sm' : notice.riskLevel === RiskLevel.HIGH ? 'bg-orange-500' : notice.riskLevel === RiskLevel.MEDIUM ? 'bg-amber-400' : 'bg-green-500'}`} title={notice.riskLevel}></div></td>
            <td className="px-6 py-4">
                <div className="font-bold text-slate-800 text-base">{notice.noticeNumber}</div>
                <div className="text-slate-500 text-xs mt-1 font-mono">{notice.gstin}</div>
                <div className="flex flex-wrap gap-2 mt-2">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] border border-slate-200 font-medium">{notice.noticeType || 'General'}</span>
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] border border-slate-200">{notice.section}</span>
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] border border-slate-200">{notice.period}</span>
                </div>
            </td>
            <td className="px-6 py-4 align-top">
                <div className="text-xs text-slate-500 mb-1">Issued: {formatDate(notice.dateOfIssue)}</div>
                <div className={`flex items-center gap-1.5 font-medium text-sm ${new Date(notice.dueDate) < new Date() && notice.status !== 'Closed' ? 'text-red-600' : 'text-slate-700'}`}><Calendar size={14} /> {formatDate(notice.dueDate)}</div>
            </td>
            <td className="px-6 py-4 align-top"><span className={`px-3 py-1 rounded-full text-xs font-semibold border ${notice.status === 'Closed' ? 'bg-slate-100 text-slate-600 border-slate-200' : notice.status === 'Hearing Scheduled' ? 'bg-purple-50 text-purple-700 border-purple-200' : 'bg-blue-50 text-blue-600 border-blue-200'}`}>{notice.status}</span></td>
            <td className="px-6 py-4 align-top">{notice.assignedTo ? <span className="text-xs bg-slate-100 px-2 py-1 rounded text-slate-600 truncate max-w-[120px] block border border-slate-200 font-medium" title={assignedUser?.fullName}>{assignedUser?.fullName || notice.assignedTo}</span> : <span className="text-xs text-slate-400 italic">Unassigned</span>}</td>
            <td className="px-6 py-4 text-right align-top">
                <div className="flex flex-col gap-2 items-end">
                    <button onClick={(e) => { e.stopPropagation(); navigate(`/notices/${notice.id}`); }} className="text-blue-600 hover:text-blue-800 text-xs font-semibold border border-blue-100 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">Edit</button>
                    {checkPermission('delete_notices') && (
                        <button onClick={(e) => { e.stopPropagation(); handleDelete(notice.id!); }} className="text-red-500 hover:text-red-700 text-xs font-medium hover:underline">Delete</button>
                    )}
                </div>
            </td>
        </tr>
      );
  }

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div><h2 className="text-2xl font-bold text-slate-800 tracking-tight">Notices Registry</h2><p className="text-slate-500 text-sm">Manage and track all GST proceedings</p></div>
        <div className="flex gap-3">
            {checkPermission('create_notices') && (
                <>
                <button onClick={() => setShowImportModal(true)} className="px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg flex items-center gap-2 shadow-sm transition-all font-medium"><Upload size={18} /> Import Data</button>
                <Link to="/notices/new" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg flex items-center gap-2 shadow-sm transition-all font-medium"><Plus size={18} /> New Notice</Link>
                </>
            )}
            <button onClick={() => setShowAdvanced(!showAdvanced)} className={`px-4 py-2.5 rounded-lg flex items-center gap-2 border transition-all font-medium ${showAdvanced ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}><Filter size={18} /> Filters</button>
        </div>
      </div>

      {selectedIds.length > 0 && (
          <div className="bg-slate-900 text-white p-3 rounded-lg flex items-center justify-between shadow-lg animate-in slide-in-from-top-2">
              <span className="font-semibold text-sm px-2 bg-slate-800 rounded py-1">{selectedIds.length} Selected</span>
              <div className="flex items-center gap-3">
                  <button onClick={() => bulkUploadRef.current?.click()} className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded-md text-xs font-medium transition-colors">
                      {isBulkUploading ? 'Uploading...' : <><Paperclip size={14}/> Attach Files</>}
                  </button>
                  <input type="file" ref={bulkUploadRef} className="hidden" multiple onChange={handleBulkUpload} />

                  <div className="flex items-center bg-slate-800 rounded-md overflow-hidden border border-slate-700">
                      <span className="px-3 text-xs text-slate-300 border-r border-slate-700 py-1.5">Set Status</span>
                      <select className="bg-slate-800 text-white text-xs p-1.5 outline-none cursor-pointer hover:bg-slate-700" onChange={(e) => { if (e.target.value) handleBulkStatusChange(e.target.value); e.target.value = ''; }}>
                          <option value="">Choose...</option>{statusOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}
                      </select>
                  </div>
                  
                  {checkPermission('delete_notices') && (
                      <button onClick={handleBulkDelete} className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-700 rounded-md text-xs font-medium transition-colors"><Trash2 size={14} /> Delete</button>
                  )}
                  <button onClick={() => setSelectedIds([])} className="p-1.5 hover:bg-slate-800 rounded-md transition-colors"><X size={16} /></button>
              </div>
          </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 h-full min-h-0">
        {showAdvanced && (
            <div className="w-full lg:w-80 bg-white p-6 rounded-xl shadow-sm border border-slate-200 overflow-y-auto flex-shrink-0 animate-in fade-in slide-in-from-left-4 duration-200">
                <div className="flex justify-between items-center mb-6"><h3 className="font-bold text-slate-800">Advanced Filters</h3><button onClick={clearFilters} className="text-xs text-blue-600 hover:underline font-medium">Clear All</button></div>
                <div className="space-y-5">
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <label className="text-xs font-bold text-slate-700 uppercase mb-2 block flex items-center gap-2"><Layers size={14}/> Group View</label>
                        <select className="w-full p-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={groupBy} onChange={(e: any) => setGroupBy(e.target.value)}>
                            <option value="none">No Grouping</option>
                            <option value="caseType">By Case Track (Hierarchy)</option>
                            <option value="arn">By Case ID (ARN)</option>
                            <option value="noticeType">By Notice Type</option>
                        </select>
                    </div>
                    
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Case Track</label>
                        <select className="w-full p-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={selectedCaseType} onChange={(e) => setSelectedCaseType(e.target.value)}>
                            <option value="">All Tracks</option>
                            {caseTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Defect Type</label>
                        <select className="w-full p-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={selectedDefectType} onChange={(e) => setSelectedDefectType(e.target.value)}>
                            <option value="">All Defects</option>
                            {defectTypeOptions.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    <div><div className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={16} /><input type="text" placeholder="Search Ref, GSTIN..." className="w-full pl-10 pr-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" value={textSearch} onChange={(e) => setTextSearch(e.target.value)} /></div></div>
                    
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Risk Level</label>
                        <div className="space-y-1.5 border border-slate-200 rounded-lg p-3 bg-white max-h-40 overflow-y-auto">
                            {Object.values(RiskLevel).map((risk) => (
                                <label key={risk} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded transition-colors">
                                    <input type="checkbox" checked={selectedRisks.includes(risk)} onChange={() => toggleSelection(selectedRisks, risk, setSelectedRisks)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4" />
                                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${risk === RiskLevel.CRITICAL ? 'bg-red-100 text-red-700' : risk === RiskLevel.HIGH ? 'bg-orange-100 text-orange-700' : risk === RiskLevel.MEDIUM ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>{risk}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div><label className="text-xs font-bold text-slate-500 uppercase mb-1.5 block">Assigned To</label><select className="w-full p-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}><option value="">All Users</option>{users?.map(u => <option key={u.id} value={u.username}>{u.fullName}</option>)}</select></div>
                    <div><label className="text-xs font-bold text-slate-500 uppercase mb-2 block">Status</label><div className="space-y-1.5 max-h-40 overflow-y-auto border border-slate-200 rounded-lg p-3 bg-white">{statusOptions.map((status: string) => (<label key={status} className="flex items-center gap-2 cursor-pointer hover:bg-slate-50 p-1.5 rounded transition-colors"><input type="checkbox" checked={selectedStatuses.includes(status)} onChange={() => toggleSelection(selectedStatuses, status, setSelectedStatuses)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4" /><span className="text-xs font-medium text-slate-700">{status}</span></label>))}</div></div>
                </div>
            </div>
        )}

        <div className="flex-1 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col shadow-sm">
            <div className="overflow-auto flex-1 bg-slate-50/50">
                {groupBy === 'caseType' ? (
                    <div className="p-4 space-y-6">
                        {Object.entries(groupedByTrackAndCase()).map(([track, cases]) => (
                            <div key={track} className="space-y-3">
                                <div className="flex items-center gap-2 px-2">
                                    <div className="bg-blue-100 text-blue-700 p-1.5 rounded-lg"><Split size={18}/></div>
                                    <h3 className="font-bold text-lg text-slate-800">{track}</h3>
                                    <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full font-bold">{Object.keys(cases).length} Cases</span>
                                </div>
                                <div className="space-y-4 pl-4">
                                    {Object.entries(cases).map(([arn, groupNotices]) => {
                                        const summary = getGroupSummary(groupNotices);
                                        const isExpanded = expandedGroups.includes(arn) || groupNotices.length <= 2; // Auto expand small groups
                                        const isUncategorized = arn === 'No Case ID';

                                        return (
                                            <div key={arn} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                                <div 
                                                    className="px-6 py-4 bg-white border-b border-slate-100 flex flex-col sm:flex-row justify-between sm:items-center gap-4 cursor-pointer hover:bg-slate-50 transition-colors"
                                                    onClick={() => toggleExpand(arn)}
                                                >
                                                    <div className="flex items-start gap-4">
                                                        <button className="text-slate-400 mt-1">
                                                            {isExpanded ? <ChevronDown size={20}/> : <ChevronRight size={20}/>}
                                                        </button>
                                                        <div>
                                                            <div className="flex items-center gap-2">
                                                                <Briefcase size={16} className="text-slate-400"/>
                                                                <h4 className={`font-bold text-base ${isUncategorized ? 'text-slate-500 italic' : 'text-slate-800 font-mono'}`}>
                                                                    {isUncategorized ? 'Unlinked Notices' : arn}
                                                                </h4>
                                                            </div>
                                                            {summary && (
                                                                <div className="mt-1 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-sm">
                                                                    <span className="font-semibold text-blue-700">{summary.clientName}</span>
                                                                    <span className="hidden sm:inline text-slate-300">|</span>
                                                                    <span className="text-slate-500">{groupNotices.length} Notices</span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    
                                                    {summary && !isUncategorized && (
                                                        <div className="flex items-center gap-4">
                                                            <div className="text-right">
                                                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Liability</p>
                                                                <p className="font-bold text-slate-800">{formatCurrency(summary.totalDemand)}</p>
                                                            </div>
                                                            <div className="h-8 w-px bg-slate-200 hidden sm:block"></div>
                                                            <div className="text-right hidden sm:block">
                                                                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Status</p>
                                                                <p className="text-xs text-slate-600 max-w-[150px] truncate">{summary.statusSummary}</p>
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Notice Rows */}
                                                {isExpanded && (
                                                    <table className="w-full text-left text-sm border-t border-slate-100">
                                                        <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                                                            <tr>
                                                                <th className="px-4 py-3 w-12 text-center">
                                                                    <input type="checkbox" className="rounded border-slate-300" disabled/>
                                                                </th>
                                                                <th className="px-6 py-3 w-20">Risk</th>
                                                                <th className="px-6 py-3">Notice Detail</th>
                                                                <th className="px-6 py-3">Dates</th>
                                                                <th className="px-6 py-3">Status</th>
                                                                <th className="px-6 py-3">Assigned</th>
                                                                <th className="px-6 py-3 text-right">Action</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100">
                                                            {groupNotices.map(notice => renderNoticeRow(notice))}
                                                        </tbody>
                                                    </table>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                        {Object.keys(groupedByTrackAndCase()).length === 0 && (
                            <div className="p-16 text-center text-slate-400">
                                <AlertCircle size={48} className="mx-auto mb-3 opacity-50"/>
                                No notices found.
                            </div>
                        )}
                    </div>
                ) : (
                    <>
                        {Object.entries(groupedNotices()).map(([groupName, groupItems]) => {
                            const summary = groupBy === 'arn' ? getGroupSummary(groupItems) : null;
                            const isUncategorized = groupName === 'No Case ID' || groupName === 'Uncategorized';
                            const groupNoticeIds = groupItems.map(n => n.id!);
                            const isGroupSelected = groupNoticeIds.every(id => selectedIds.includes(id));

                            const handleGroupSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
                                if (e.target.checked) {
                                    const toAdd = groupNoticeIds.filter(id => !selectedIds.includes(id));
                                    setSelectedIds([...selectedIds, ...toAdd]);
                                } else {
                                    setSelectedIds(selectedIds.filter(id => !groupNoticeIds.includes(id)));
                                }
                            };

                            return (
                            <div key={groupName} className="mb-4 last:mb-0 bg-white border-y first:border-t-0 last:border-b-0 border-slate-200">
                                {groupBy !== 'none' && (
                                    <div className={`px-6 py-3 border-b border-slate-200 flex flex-col sm:flex-row justify-between sm:items-center gap-2 sticky top-0 z-10 ${isUncategorized ? 'bg-slate-100' : 'bg-blue-50/50'}`}>
                                        <div className="flex items-center gap-4">
                                            <input type="checkbox" checked={isGroupSelected} onChange={handleGroupSelect} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer" />
                                            <div className="flex items-center gap-3">
                                                <div className={`p-1.5 rounded-lg ${isUncategorized ? 'bg-slate-200 text-slate-500' : 'bg-white text-blue-600 border border-blue-200'}`}>
                                                    {groupBy === 'arn' ? <FolderOpen size={16}/> : <Layers size={16}/>}
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-slate-800 text-sm">{groupBy === 'arn' ? (isUncategorized ? 'Unlinked Notices' : `Case ID: ${groupName}`) : groupName}</h3>
                                                    {summary && <p className="text-xs text-slate-600 font-medium">{summary.clientName}</p>}
                                                </div>
                                            </div>
                                        </div>
                                        {summary && !isUncategorized && (
                                            <div className="text-right bg-white px-3 py-1.5 rounded-lg border border-blue-200/50 shadow-sm">
                                                <span className="block text-xs font-bold text-slate-700">Total: {formatCurrency(summary.totalDemand)}</span>
                                                <span className="block text-[10px] text-slate-500">{summary.statusSummary}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                                <table className="w-full text-left text-sm">
                                    {groupBy === 'none' && <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-xs font-bold sticky top-0 z-10 shadow-sm"><tr><th className="px-4 py-4 w-12 text-center"><input type="checkbox" onChange={handleSelectAll} checked={notices && notices.length > 0 && selectedIds.length === notices.length} className="rounded border-slate-300" /></th><th className="px-6 py-4">Risk</th><th className="px-6 py-4">Notice Ref No</th><th className="px-6 py-4">Dates</th><th className="px-6 py-4">Status</th><th className="px-6 py-4">Assigned</th><th className="px-6 py-4 text-right">Actions</th></tr></thead>}
                                    <tbody className="divide-y divide-slate-100">{groupItems.map((notice) => renderNoticeRow(notice, groupBy === 'none'))}</tbody>
                                </table>
                            </div>
                            )
                        })}
                        {!notices?.length && <div className="p-16 text-center text-slate-400"><AlertCircle size={48} className="mx-auto mb-3 opacity-50"/>No notices found. Try adjusting filters.</div>}
                    </>
                )}
            </div>
            <div className="bg-slate-50 p-3 border-t border-slate-200 text-xs text-slate-500 text-right font-medium">Total Records: {notices?.length || 0}</div>
        </div>
      </div>
      
      {/* Import Modal - Unchanged */}
      {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-8 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-8"><h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><FileSpreadsheet className="text-green-600"/> Bulk Data Import</h3><button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button></div>
                  <div className="space-y-6">
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-3">Select Data Type</label>
                          <div className="flex gap-3">
                              {(['notice', 'defect', 'payment'] as const).map(t => (
                                  <button key={t} onClick={() => setImportType(t)} className={`flex-1 py-3 text-sm rounded-xl border transition-all capitalize font-medium ${importType === t ? 'bg-blue-50 border-blue-500 text-blue-700 ring-2 ring-blue-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{t}s</button>
                              ))}
                          </div>
                      </div>
                      <div className="bg-blue-50 p-5 rounded-xl border border-blue-100 flex justify-between items-center">
                          <div>
                              <p className="text-sm font-bold text-blue-800">1. Download Template</p>
                              <p className="text-xs text-blue-600 mt-1">Use this .xlsx file to structure your data.</p>
                          </div>
                          <button onClick={downloadTemplate} className="text-xs bg-white border border-blue-200 text-blue-700 px-3 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-50 shadow-sm font-medium"><Download size={14}/> Download</button>
                      </div>
                      <div className="border-2 border-dashed border-slate-300 rounded-xl p-10 text-center hover:bg-slate-50 transition-colors cursor-pointer group" onClick={() => fileInputRef.current?.click()}>
                          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3 group-hover:bg-white group-hover:shadow-sm transition-all"><Upload size={24} className="text-slate-400 group-hover:text-blue-500"/></div>
                          <p className="text-sm font-bold text-slate-700">Click to upload Excel file</p>
                          <p className="text-xs text-slate-500 mt-1">Supports .xlsx, .xls (Max 5MB)</p>
                          <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default NoticeList;
