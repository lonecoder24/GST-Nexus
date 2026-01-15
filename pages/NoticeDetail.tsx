
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Notice, NoticeStatus, RiskLevel, NoticeDefect, PaymentLog, TaxHeadValues, Taxpayer, DocumentMeta, Hearing, HearingStatus } from '../types';
import { Save, ArrowLeft, Clock, FileText, Plus, Trash2, IndianRupee, Wallet, Calculator, Building, HelpCircle, History, RefreshCw, FileDown, Activity, ClipboardList, ChevronUp, ChevronDown, Filter, CreditCard, AlertCircle, Phone, Mail, MapPin, Edit, X, FolderOpen, UploadCloud, ScanText, File as FileIcon, Search, Eye, Download, Scale, Gavel, Calendar } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const initialTaxHead: TaxHeadValues = { tax: 0, interest: 0, penalty: 0, lateFee: 0, others: 0 };
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;

const Tooltip: React.FC<{ text: string }> = ({ text }) => (
    <div className="group relative inline-block ml-1 align-middle">
        <HelpCircle size={14} className="text-slate-400 hover:text-blue-500 cursor-help" />
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-48 p-2 bg-slate-800 text-white text-xs rounded shadow-lg z-50 text-center pointer-events-none">
            {text}<div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800"></div>
        </div>
    </div>
);

// Helper to make logs readable
const formatLogDetails = (details: string): string => {
    try {
        if (!details.startsWith('{') && !details.startsWith('[')) return details;
        const obj = JSON.parse(details);
        if (obj.gstin && obj.noticeNumber) return `Details updated for Notice ${obj.noticeNumber}`;
        if (obj.gstin && obj.tradeName) return `Details updated for Taxpayer ${obj.tradeName}`;
        if (obj.date && obj.type) return `Hearing: ${obj.type} on ${obj.date}`;
        return Object.keys(obj).map(k => `${k}: ${obj[k]}`).join(', ');
    } catch (e) {
        return details;
    }
};

interface TimelineEvent {
    id: string;
    date: Date;
    type: 'NOTICE' | 'PAYMENT' | 'LOG';
    title: string;
    subtitle?: string;
    amount?: number;
    status?: string;
    refId: number;
    details?: string;
    risk?: string;
}

const NoticeDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, checkPermission } = useAuth();
  const isNew = id === 'new';
  const noticeId = isNew ? undefined : parseInt(id!);
  const docInputRef = useRef<HTMLInputElement>(null);
  
  const [activeTab, setActiveTab] = useState<'info' | 'defects' | 'hearings' | 'documents' | 'timeline' | 'audit'>('info');
  const [loading, setLoading] = useState(!isNew);
  const [gstinError, setGstinError] = useState('');
  const [timelineFilter, setTimelineFilter] = useState<'ALL' | 'MAJOR'>('MAJOR');
  const [docSearch, setDocSearch] = useState('');
  const [uploadCategory, setUploadCategory] = useState<'Notice Scan' | 'Evidence' | 'Reconciliation' | 'Ledger' | 'Other'>('Notice Scan');
  
  const [formData, setFormData] = useState<Partial<Notice>>({
    status: NoticeStatus.RECEIVED, riskLevel: RiskLevel.MEDIUM, demandAmount: 0, tags: []
  });

  const configTypes = useLiveQuery(() => db.appConfig.get({key: 'notice_types'}));
  const configStatuses = useLiveQuery(() => db.appConfig.get({key: 'notice_statuses'}));
  const configDefectTypes = useLiveQuery(() => db.appConfig.get({key: 'defect_types'}));
  const typeOptions = configTypes?.value || [];
  const statusOptions = configStatuses?.value || Object.values(NoticeStatus);
  const defectTypeOptions = configDefectTypes?.value || [];
  
  const taxpayersList = useLiveQuery(() => db.taxpayers.orderBy('tradeName').toArray()) || [];
  const usersList = useLiveQuery(() => db.users.filter(u => u.isActive === true).toArray()) || [];

  const defects = useLiveQuery(() => noticeId ? db.defects.where('noticeId').equals(noticeId).toArray() : [], [noticeId]);
  const payments = useLiveQuery(() => noticeId ? db.payments.where('noticeId').equals(noticeId).toArray() : [], [noticeId]);
  const hearings = useLiveQuery(() => noticeId ? db.hearings.where('noticeId').equals(noticeId).sortBy('date') : [], [noticeId]);
  
  const documents = useLiveQuery(async () => {
      if (!noticeId) return [];
      let docs = await db.documents.where('noticeId').equals(noticeId).reverse().toArray();
      if (docSearch) {
          const lower = docSearch.toLowerCase();
          docs = docs.filter(d => d.fileName.toLowerCase().includes(lower) || (d.ocrText && d.ocrText.toLowerCase().includes(lower)));
      }
      return docs;
  }, [noticeId, docSearch]);

  const auditLogs = useLiveQuery(async () => {
      if (noticeId) return await db.auditLogs.where('entityId').equals(noticeId).and(l => l.entityType === 'Notice').reverse().toArray();
      return [];
  }, [noticeId]);

  const timelineEvents = useLiveQuery(async () => {
      if (!formData.arn) return [];
      const relatedNotices = await db.notices.where('arn').equals(formData.arn).toArray();
      const events: TimelineEvent[] = [];

      for (const n of relatedNotices) {
          events.push({
              id: `notice-${n.id}`, date: new Date(n.dateOfIssue), type: 'NOTICE', title: `${n.noticeType} Issued`, subtitle: n.noticeNumber, status: n.status, refId: n.id!, risk: n.riskLevel, details: n.description
          });
          const payLogs = await db.payments.where('noticeId').equals(n.id!).toArray();
          payLogs.forEach(p => {
              events.push({ id: `pay-${p.id}`, date: new Date(p.paymentDate), type: 'PAYMENT', title: 'Payment Recorded', subtitle: `${p.majorHead} - ${p.minorHead}`, amount: p.amount, refId: n.id!, details: `Challan: ${p.challanNumber}` });
          });
          const logs = await db.auditLogs.where('entityType').equals('Notice').and(l => l.entityId === n.id!).toArray();
          logs.forEach(l => {
              if (l.action === 'Create') return; 
              events.push({ id: `log-${l.id}`, date: new Date(l.timestamp), type: 'LOG', title: `System: ${l.action}`, subtitle: l.user, refId: n.id!, details: formatLogDetails(l.details) });
          });
      }
      return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [formData.arn]);

  const [linkedTaxpayer, setLinkedTaxpayer] = useState<Taxpayer | null>(null);
  const [isEditingTaxpayer, setIsEditingTaxpayer] = useState(false);
  const [taxpayerData, setTaxpayerData] = useState<Partial<Taxpayer>>({});

  const [showDefectModal, setShowDefectModal] = useState(false);
  const [currentDefect, setCurrentDefect] = useState<Partial<NoticeDefect>>({ defectType: '', section: '', description: '', igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead } });

  // Calculator State (In Modal)
  const [calcRate, setCalcRate] = useState(18);
  const [calcFromDate, setCalcFromDate] = useState('');
  const [calcToDate, setCalcToDate] = useState(new Date().toISOString().split('T')[0]);
  const [showCalculator, setShowCalculator] = useState(false);

  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMatrix, setPaymentMatrix] = useState<{ igst: TaxHeadValues; cgst: TaxHeadValues; sgst: TaxHeadValues; cess: TaxHeadValues; challanNumber: string; paymentDate: string; bankName: string; refNumber: string; }>({
      igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead }, challanNumber: '', paymentDate: new Date().toISOString().split('T')[0], bankName: '', refNumber: ''
  });
  
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentLog | null>(null);
  const [selectedDefectId, setSelectedDefectId] = useState<number | undefined>(undefined);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncOptions, setSyncOptions] = useState({ gstin: true, riskLevel: true, assignedTo: false, status: false });
  const [showOCRModal, setShowOCRModal] = useState(false);
  const [currentDocForOCR, setCurrentDocForOCR] = useState<DocumentMeta | null>(null);
  const [ocrTextBuffer, setOcrTextBuffer] = useState('');

  // Hearing Modal State
  const [showHearingModal, setShowHearingModal] = useState(false);
  const [currentHearing, setCurrentHearing] = useState<Partial<Hearing>>({
      type: 'Personal Hearing',
      date: new Date().toISOString().split('T')[0],
      time: '11:00',
      status: HearingStatus.SCHEDULED,
      minutes: ''
  });

  // Permission Checks
  const canEdit = checkPermission('edit_notices') || (isNew && checkPermission('create_notices'));
  const canDelete = checkPermission('delete_notices');

  useEffect(() => {
    if (!isNew && id) {
      db.notices.get(parseInt(id)).then(notice => {
        if (notice) { setFormData(notice); }
        setLoading(false);
      });
    }
  }, [id, isNew]);

  useEffect(() => {
      if (formData.gstin) {
          if (formData.gstin.length === 15 && GSTIN_REGEX.test(formData.gstin)) {
                 setGstinError('');
                 db.taxpayers.where('gstin').equals(formData.gstin).first().then(t => { setLinkedTaxpayer(t || null); if(t) setTaxpayerData(t); else setTaxpayerData({ gstin: formData.gstin, tradeName: '', legalName: '', registeredAddress: '', mobile: '', email: '' }); });
          } else { setGstinError(formData.gstin.length !== 15 ? 'GSTIN must be 15 characters' : 'Invalid GSTIN format'); setLinkedTaxpayer(null); }
      }
  }, [formData.gstin]);

  const handleChange = (field: keyof Notice, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleSaveTaxpayer = async () => {
    if (!canEdit) return;
    if (!formData.gstin) return;
    try {
        if (linkedTaxpayer && linkedTaxpayer.id) {
            await db.taxpayers.update(linkedTaxpayer.id, taxpayerData);
            await db.auditLogs.add({ entityType: 'Taxpayer', entityId: linkedTaxpayer.id, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Updated details via Notice screen for ${taxpayerData.tradeName}` });
            alert('Taxpayer details updated');
        } else {
            const id = await db.taxpayers.add({ ...taxpayerData, gstin: formData.gstin, tradeName: taxpayerData.tradeName || 'Unknown', legalName: taxpayerData.legalName || '', mobile: taxpayerData.mobile || '', email: taxpayerData.email || '', registeredAddress: taxpayerData.registeredAddress || '', stateCode: formData.gstin.substring(0,2) } as Taxpayer);
            await db.auditLogs.add({ entityType: 'Taxpayer', entityId: id, action: 'Create', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Created taxpayer ${taxpayerData.tradeName} via Notice screen` });
             alert('Taxpayer created and linked');
        }
        const t = await db.taxpayers.where('gstin').equals(formData.gstin).first();
        setLinkedTaxpayer(t || null); setIsEditingTaxpayer(false);
    } catch (e) { console.error(e); alert('Error saving taxpayer details'); }
  };

  const handleSaveNotice = async () => {
    if (!canEdit) { alert("You do not have permission to edit this notice."); return; }
    try {
        if(!formData.gstin || !formData.noticeNumber) { alert("GSTIN and Notice Number are required"); return; }
        if (gstinError) { alert("Please correct GSTIN error"); return; }

        let savedId = formData.id;
        let logAction = isNew ? 'Create' : 'Update';
        let logDetails = '';

        if (isNew) {
            savedId = await db.notices.add(formData as Notice);
            logDetails = `Created new Notice ${formData.noticeNumber}`;
        } else {
            const oldNotice = await db.notices.get(savedId!);
            const changes: string[] = [];
            if (oldNotice) {
                if(oldNotice.status !== formData.status) changes.push(`Status changed from '${oldNotice.status}' to '${formData.status}'`);
                if(oldNotice.riskLevel !== formData.riskLevel) changes.push(`Risk Level changed to ${formData.riskLevel}`);
                if(oldNotice.dueDate !== formData.dueDate) changes.push(`Due Date updated to ${formData.dueDate}`);
                if(oldNotice.assignedTo !== formData.assignedTo) changes.push(`Assigned to ${formData.assignedTo || 'Unassigned'}`);
                if(oldNotice.demandAmount !== formData.demandAmount) changes.push(`Demand Amount updated to ${formData.demandAmount}`);
            }
            if (changes.length === 0) changes.push("Updated notice details");
            logDetails = changes.join(". ");
            await db.notices.update(savedId!, formData);
        }

        await db.auditLogs.add({ entityType: 'Notice', entityId: savedId!, action: logAction as any, timestamp: new Date().toISOString(), user: user?.username || 'System', details: logDetails });
        if(isNew) navigate(`/notices/${savedId}`); else alert('Saved successfully');
    } catch (e) { console.error(e); alert("Error saving notice"); }
  };

  const executeSync = async () => {
      if (!formData.arn) return;
      const linked = await db.notices.where('arn').equals(formData.arn).toArray();
      const targets = linked.filter(n => n.id !== noticeId);
      if (targets.length === 0) { alert("No other notices linked to this ARN."); setShowSyncModal(false); return; }
      const updates: Partial<Notice> = {};
      const updatedFields: string[] = [];
      if (syncOptions.gstin && formData.gstin) { updates.gstin = formData.gstin; updatedFields.push('GSTIN'); }
      if (syncOptions.riskLevel && formData.riskLevel) { updates.riskLevel = formData.riskLevel; updatedFields.push('Risk Level'); }
      if (syncOptions.assignedTo && formData.assignedTo) { updates.assignedTo = formData.assignedTo; updatedFields.push('Assigned To'); }
      if (syncOptions.status && formData.status) { updates.status = formData.status; updatedFields.push('Status'); }
      if (Object.keys(updates).length === 0) { alert("No fields selected for synchronization."); return; }
      for (const n of targets) {
          await db.notices.update(n.id!, updates);
          await db.auditLogs.add({ entityType: 'Notice', entityId: n.id!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Synced fields (${updatedFields.join(', ')}) from ARN Master` });
      }
      alert(`Successfully updated ${targets.length} linked notices.`); setShowSyncModal(false);
  };

  const handleUpdateInterestTillToday = async () => {
    // ... existing interest logic ...
    if (!canEdit) return;
    const rate = parseFloat(prompt("Enter Annual Interest Rate (%)", "18") || "0");
    if (!rate) return;

    if (!confirm(`Recalculate interest for all defects @ ${rate}% from Due Date till Today? This will overwrite existing interest values.`)) return;

    try {
        const today = new Date();
        const dueDate = new Date(formData.dueDate!); // Assuming dueDate exists
        if (isNaN(dueDate.getTime())) { alert("Notice Due Date is invalid."); return; }

        const diffTime = today.getTime() - dueDate.getTime();
        const days = Math.ceil(diffTime / (1000 * 3600 * 24));
        
        if (days <= 0) { alert("Due date is in the future or today. No interest applicable."); return; }

        const currentDefects = await db.defects.where('noticeId').equals(noticeId!).toArray();

        for (const defect of currentDefects) {
            const calc = (tax: number) => Math.round((tax * rate * days) / 36500);
            
            const updates = {
                igst: { ...defect.igst, interest: calc(defect.igst.tax) },
                cgst: { ...defect.cgst, interest: calc(defect.cgst.tax) },
                sgst: { ...defect.sgst, interest: calc(defect.sgst.tax) },
                cess: { ...defect.cess, interest: calc(defect.cess.tax) }
            };
            
            await db.defects.update(defect.id!, {
                ...updates,
                interestDemand: updates.igst.interest + updates.cgst.interest + updates.sgst.interest + updates.cess.interest,
            });
        }
        
        await updateTotalDemand(noticeId!); 
        await db.auditLogs.add({
            entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(),
            user: user?.username || 'System', details: `Bulk Interest Recalculation (Individual Notice) @ ${rate}%`
        });
        
        alert("Interest updated successfully.");
    } catch (e) {
        console.error(e);
        alert("Error updating interest.");
    }
  }

  // --- DEFECT MODAL LOGIC ---

  const handleEditDefect = (defect: NoticeDefect) => {
      setCurrentDefect({...defect});
      setShowDefectModal(true);
      setShowCalculator(false);
  };

  const handleSaveDefect = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      
      const sumField = (field: keyof TaxHeadValues) => (currentDefect.igst?.[field] || 0) + (currentDefect.cgst?.[field] || 0) + (currentDefect.sgst?.[field] || 0) + (currentDefect.cess?.[field] || 0);
      
      const defectPayload: any = {
          noticeId: noticeId!, 
          defectType: currentDefect.defectType || 'General', 
          section: currentDefect.section, 
          description: currentDefect.description,
          igst: currentDefect.igst || initialTaxHead, 
          cgst: currentDefect.cgst || initialTaxHead, 
          sgst: currentDefect.sgst || initialTaxHead, 
          cess: currentDefect.cess || initialTaxHead,
          taxDemand: sumField('tax'), 
          interestDemand: sumField('interest'), 
          penaltyDemand: sumField('penalty')
      };

      if (currentDefect.id) {
          // Update
          await db.defects.update(currentDefect.id, defectPayload);
          await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Updated Defect: ${currentDefect.defectType}` });
      } else {
          // Add
          await db.defects.add(defectPayload);
          await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Added Defect: ${currentDefect.defectType}` });
      }

      updateTotalDemand(noticeId!); 
      setShowDefectModal(false); 
      setShowCalculator(false);
      setCurrentDefect({ defectType: '', section: '', description: '', igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead } });
  };

  const handleDeleteDefect = async (id: number) => { 
      if (!canEdit) return;
      if(confirm('Delete?')) { await db.defects.delete(id); await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Deleted Defect #${id}` }); updateTotalDemand(noticeId!); } 
  };
  
  // Specific Interest Calculator in Modal
  const calculateModalInterest = () => {
      if (!calcFromDate || !calcToDate) { alert("Please select dates"); return; }
      
      const start = new Date(calcFromDate);
      const end = new Date(calcToDate);
      const diffTime = end.getTime() - start.getTime();
      const days = Math.ceil(diffTime / (1000 * 3600 * 24));

      if (days < 0) { alert("To Date cannot be before From Date"); return; }

      const calc = (tax: number) => Math.round((tax * calcRate * days) / 36500);

      setCurrentDefect(prev => ({
          ...prev,
          igst: { ...prev.igst!, interest: calc(prev.igst?.tax || 0) },
          cgst: { ...prev.cgst!, interest: calc(prev.cgst?.tax || 0) },
          sgst: { ...prev.sgst!, interest: calc(prev.sgst?.tax || 0) },
          cess: { ...prev.cess!, interest: calc(prev.cess?.tax || 0) }
      }));
  };

  const updateTotalDemand = async (nId: number) => {
      const all = await db.defects.where('noticeId').equals(nId).toArray();
      const total = all.reduce((acc, d) => { const sub = (h: TaxHeadValues) => h.tax + h.interest + h.penalty + h.lateFee + h.others; return acc + sub(d.igst) + sub(d.cgst) + sub(d.sgst) + sub(d.cess); }, 0);
      await db.notices.update(nId, { demandAmount: total }); setFormData(prev => ({ ...prev, demandAmount: total }));
  };

  // --- HEARING LOGIC ---
  const handleSaveHearing = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      if (!currentHearing.date || !currentHearing.time) { alert("Date and Time are required"); return; }

      const hearingPayload: any = {
          noticeId: noticeId!,
          date: currentHearing.date,
          time: currentHearing.time,
          venue: currentHearing.venue || 'TBD',
          type: currentHearing.type || 'Personal Hearing',
          attendees: currentHearing.attendees || '',
          status: currentHearing.status || HearingStatus.SCHEDULED,
          minutes: currentHearing.minutes || ''
      };

      if (currentHearing.id) {
          await db.hearings.update(currentHearing.id, hearingPayload);
          await db.auditLogs.add({ entityType: 'Hearing', entityId: currentHearing.id, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Updated Hearing: ${currentHearing.date}` });
      } else {
          const newId = await db.hearings.add(hearingPayload);
          await db.auditLogs.add({ entityType: 'Hearing', entityId: newId, action: 'Create', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Scheduled Hearing: ${currentHearing.date}` });
          
          // Optionally update notice status if it's the first hearing
          if (formData.status !== NoticeStatus.HEARING) {
              await db.notices.update(noticeId!, { status: NoticeStatus.HEARING });
              setFormData(prev => ({ ...prev, status: NoticeStatus.HEARING }));
          }
      }
      setShowHearingModal(false);
      setCurrentHearing({ type: 'Personal Hearing', date: new Date().toISOString().split('T')[0], time: '11:00', status: HearingStatus.SCHEDULED, minutes: '' });
  };

  const handleEditHearing = (h: Hearing) => {
      setCurrentHearing(h);
      setShowHearingModal(true);
  };

  const handleDeleteHearing = async (id: number) => {
      if(!canEdit) return;
      if(confirm('Delete this hearing record?')) {
          await db.hearings.delete(id);
          await db.auditLogs.add({ entityType: 'Hearing', entityId: id, action: 'Delete', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Deleted Hearing #${id}` });
      }
  };

  // ... (Keep existing payment handlers: handleSavePaymentMatrix, handleUpdatePayment, handleDeletePayment) ...
  const handleSavePaymentMatrix = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!canEdit) return;
      if (!paymentMatrix.challanNumber) { alert("Challan Number is required"); return; }
      const heads = ['IGST', 'CGST', 'SGST', 'Cess']; const fields = ['tax', 'interest', 'penalty', 'lateFee', 'others']; const minorMap: Record<string, any> = { tax: 'Tax', interest: 'Interest', penalty: 'Penalty', lateFee: 'Late Fee', others: 'Others' };
      let count = 0;
      for (const h of heads) {
          const headKey = h.toLowerCase() as any;
          for (const f of fields) {
              const amount = (paymentMatrix as any)[headKey][f];
              if (amount > 0) { await db.payments.add({ noticeId: noticeId!, defectId: selectedDefectId, majorHead: h as any, minorHead: minorMap[f], amount: amount, challanNumber: paymentMatrix.challanNumber, paymentReferenceNumber: paymentMatrix.refNumber, paymentDate: paymentMatrix.paymentDate, bankName: paymentMatrix.bankName }); count++; }
          }
      }
      if (count > 0) { await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Recorded ${count} payment entries` }); setShowPaymentModal(false); setPaymentMatrix({ igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead }, challanNumber: '', paymentDate: new Date().toISOString().split('T')[0], bankName: '', refNumber: '' }); } else alert("Enter at least one amount");
  };

  const handleUpdatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    if (!editingPayment || !editingPayment.id) return;
    try { await db.payments.update(editingPayment.id, editingPayment); await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Updated payment #${editingPayment.id}` }); setShowEditPaymentModal(false); setEditingPayment(null); } catch (err) { console.error(err); alert('Error updating payment'); }
  };

  const handleDeletePayment = async (payId: number) => { 
      if (!canEdit) return;
      if(confirm('Delete?')) { await db.payments.delete(payId); await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Deleted payment #${payId}` }); } 
    };
  const openEditPayment = (payment: PaymentLog) => { setEditingPayment({...payment}); setShowEditPaymentModal(true); };

  const exportHistoryPDF = () => { const doc = new jsPDF(); doc.setFontSize(18); doc.text(`Case Timeline - ID: ${formData.arn}`, 14, 20); doc.setFontSize(10); doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 28); const filtered = timelineEvents?.filter(e => timelineFilter === 'ALL' || e.type !== 'LOG') || []; const tableData = filtered.map(item => [ item.date.toISOString().split('T')[0], item.type, item.title, item.subtitle || '', formatLogDetails(item.details || '') ]); autoTable(doc, { startY: 35, head: [['Date', 'Type', 'Event', 'User/Ref', 'Details']], body: tableData }); doc.save(`CaseTimeline_${formData.arn}.pdf`); };
  const handleDefectMatrixChange = (head: 'igst' | 'cgst' | 'sgst' | 'cess', field: keyof TaxHeadValues, value: number) => { setCurrentDefect(prev => { const prevHead = prev[head] || { ...initialTaxHead }; return { ...prev, [head]: { ...prevHead, [field]: value } }; }); };
  const handlePaymentMatrixChange = (head: 'igst' | 'cgst' | 'sgst' | 'cess', field: keyof TaxHeadValues, value: number) => { setPaymentMatrix(prev => ({ ...prev, [head]: { ...prev[head], [field]: value } })); };
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

  // --- DOCUMENT HANDLERS ---
  const handleDocUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file && noticeId) {
          const reader = new FileReader();
          reader.onload = async (ev) => {
            // For offline usage, storing Blob directly in Dexie
            await db.documents.add({
                noticeId: noticeId,
                fileName: file.name,
                fileType: file.type,
                size: file.size,
                uploadDate: new Date().toISOString(),
                category: uploadCategory,
                fileData: new Blob([new Uint8Array(ev.target?.result as ArrayBuffer)], {type: file.type})
            });
            await db.auditLogs.add({ entityType: 'Document', entityId: noticeId, action: 'Create', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Uploaded ${file.name} to ${uploadCategory}` });
          };
          reader.readAsArrayBuffer(file);
      }
  };

  const deleteDocument = async (docId: number) => {
      if (!canEdit) return;
      if (confirm("Delete this document?")) {
          await db.documents.delete(docId);
          await db.auditLogs.add({ entityType: 'Document', entityId: noticeId!, action: 'Delete', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Deleted document #${docId}` });
      }
  };

  const openOCRModal = (doc: DocumentMeta) => {
      setCurrentDocForOCR(doc);
      setOcrTextBuffer(doc.ocrText || '');
      setShowOCRModal(true);
  };

  const saveOCRText = async () => {
      if (currentDocForOCR && currentDocForOCR.id) {
          await db.documents.update(currentDocForOCR.id, { ocrText: ocrTextBuffer });
          setShowOCRModal(false);
          await db.auditLogs.add({ entityType: 'Document', entityId: currentDocForOCR.id, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Updated OCR Text for ${currentDocForOCR.fileName}` });
      }
  };
  
  const simulateOCR = () => {
      const simulated = `[SCANNED TEXT DETECTED]\nDate: ${new Date().toLocaleDateString()}\nRef: ${currentDocForOCR?.fileName}\n\nNotice under Section 61 of CGST Act, 2017.\n\nDiscrepancy observed in GSTR-1 vs GSTR-3B for FY 2022-23.\nTaxpayer is requested to furnish explanation within 30 days.\n\n(This is auto-generated placeholder text to simulate OCR capability)`;
      setOcrTextBuffer(prev => prev ? prev + "\n\n" + simulated : simulated);
  };

  const downloadFile = (doc: DocumentMeta) => {
      if (doc.fileData) {
          const url = URL.createObjectURL(doc.fileData);
          const a = document.createElement('a');
          a.href = url;
          a.download = doc.fileName;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      } else {
          alert("File data not found offline.");
      }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/notices')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800"><ArrowLeft size={18} /> Back</button>
        {canEdit && (
            <button onClick={handleSaveNotice} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 shadow-sm"><Save size={18} /> Save</button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50/50">
            {[ {id: 'info', icon: FileText, label: 'Notice Info'}, {id: 'defects', icon: Wallet, label: 'Defects & Payments'}, {id: 'hearings', icon: Gavel, label: 'Hearings'}, {id: 'documents', icon: FolderOpen, label: 'Documents & Evidence'}, {id: 'timeline', icon: History, label: 'Case Timeline'}, {id: 'audit', icon: Activity, label: 'Audit Trail'} ].map(tab => (
                 <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} disabled={isNew && tab.id !== 'info'} className={`flex-1 py-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === tab.id ? 'border-blue-500 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'} ${(isNew && tab.id !== 'info') ? 'opacity-50' : ''}`}><tab.icon size={16}/> {tab.label}</button>
            ))}
        </div>

        <div className="p-8">
            {activeTab === 'info' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div><label className="block text-sm font-medium text-slate-700 mb-1">Select Taxpayer (GSTIN) <span className="text-red-500">*</span></label><div className="flex gap-2"><select disabled={!canEdit} value={formData.gstin || ''} onChange={(e) => handleChange('gstin', e.target.value)} className={`flex-1 p-2.5 border rounded-lg bg-white ${gstinError ? 'border-red-300' : 'border-slate-300'} disabled:bg-slate-100`}><option value="">-- Select Client --</option>{taxpayersList.map(t => (<option key={t.id} value={t.gstin}>{t.tradeName} - {t.gstin}</option>))}</select><Link to="/taxpayers/new" className="bg-slate-100 border border-slate-300 text-slate-600 p-2.5 rounded-lg hover:bg-slate-200" title="Add New Taxpayer"><Plus size={20}/></Link></div>{gstinError && <span className="text-xs text-red-500 mt-1 block">{gstinError}</span>}</div>
                            
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-2">
                                <div className="flex justify-between items-center mb-3"><h4 className="font-semibold text-slate-700 flex items-center gap-2 text-sm"><Building size={16}/> Taxpayer Details</h4><button onClick={() => setIsEditingTaxpayer(!isEditingTaxpayer)} className="text-xs text-blue-600 hover:underline">{isEditingTaxpayer ? 'Cancel' : (linkedTaxpayer ? 'Edit' : 'Add Details')}</button></div>
                                {isEditingTaxpayer ? (
                                    <div className="space-y-3 animate-in fade-in duration-200">
                                         <div><label className="text-xs text-slate-500 font-medium block mb-1">Trade Name</label><input disabled={!canEdit} placeholder="Trade Name" value={taxpayerData.tradeName || ''} onChange={e => setTaxpayerData({...taxpayerData, tradeName: e.target.value})} className="w-full p-2 border rounded text-sm bg-white disabled:bg-slate-100" /></div>
                                         {canEdit && <button onClick={handleSaveTaxpayer} className="w-full bg-blue-600 text-white py-1.5 rounded text-sm hover:bg-blue-700">Save Taxpayer Details</button>}
                                    </div>
                                ) : (linkedTaxpayer ? (<div className="text-sm space-y-1"><p className="font-bold text-slate-800">{linkedTaxpayer.tradeName}</p><p className="text-slate-500 text-xs">{linkedTaxpayer.legalName}</p><div className="flex items-start gap-2 text-slate-600 mt-2"><MapPin size={14} className="mt-0.5 text-slate-400 shrink-0"/><span className="text-xs">{linkedTaxpayer.registeredAddress || 'No Address'}</span></div></div>) : (<p className="text-xs text-slate-400 italic">No taxpayer linked.</p>))}
                            </div>

                            <div><div className="flex justify-between"><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Case ID (ARN)</label>{!isNew && formData.arn && canEdit && <button onClick={() => setShowSyncModal(true)} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><RefreshCw size={12}/> Sync Linked</button>}</div><input disabled={!canEdit} type="text" value={formData.arn || ''} onChange={(e) => handleChange('arn', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100" placeholder="ARN / Case Reference" /></div>
                            
                            <div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Current Status</label><select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100" value={formData.status || ''} onChange={(e) => handleChange('status', e.target.value)}>{statusOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}</select></div>

                            <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Risk Level</label><select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100" value={formData.riskLevel || ''} onChange={(e) => handleChange('riskLevel', e.target.value)}>{Object.values(RiskLevel).map((r: string) => <option key={r} value={r}>{r}</option>)}</select></div><div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Assigned To</label><select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100" value={formData.assignedTo || ''} onChange={(e) => handleChange('assignedTo', e.target.value)}><option value="">-- Unassigned --</option>{usersList.map((u: any) => <option key={u.id} value={u.username}>{u.fullName}</option>)}</select></div></div>
                        </div>
                        <div className="space-y-4">
                            <div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Notice Number <span className="text-red-500">*</span></label><input disabled={!canEdit} type="text" value={formData.noticeNumber || ''} onChange={(e) => handleChange('noticeNumber', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100" /></div>
                            <div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Notice Type</label><select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100" value={formData.noticeType || ''} onChange={(e) => handleChange('noticeType', e.target.value)}><option value="">Select Type</option>{typeOptions.map((t: string) => <option key={t} value={t}>{t}</option>)}</select></div>
                             <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Section</label><input disabled={!canEdit} type="text" value={formData.section || ''} onChange={(e) => handleChange('section', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100" /></div><div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Period</label><input disabled={!canEdit} type="text" value={formData.period || ''} onChange={(e) => handleChange('period', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100" /></div></div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6"><div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Date of Issue</label><input disabled={!canEdit} type="date" value={formData.dateOfIssue || ''} onChange={(e) => handleChange('dateOfIssue', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100" /></div><div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Due Date</label><input disabled={!canEdit} type="date" value={formData.dueDate || ''} onChange={(e) => handleChange('dueDate', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100" /></div></div>
                    <div><label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Description</label><textarea disabled={!canEdit} value={formData.description || ''} onChange={(e) => handleChange('description', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg h-32 resize-none disabled:bg-slate-100" /></div>
                </div>
            )}

            {/* NEW HEARINGS TAB */}
            {activeTab === 'hearings' && (
                <div className="animate-in fade-in duration-300 space-y-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">Personal Hearings</h3>
                            <p className="text-sm text-slate-500">Track hearing dates, adjournments, and proceedings.</p>
                        </div>
                        {canEdit && (
                            <button onClick={() => { setCurrentHearing({ type: 'Personal Hearing', date: new Date().toISOString().split('T')[0], time: '11:00', status: HearingStatus.SCHEDULED, minutes: '' }); setShowHearingModal(true); }} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2 shadow-sm">
                                <Plus size={16}/> Schedule Hearing
                            </button>
                        )}
                    </div>

                    <div className="space-y-4">
                        {hearings?.map((hearing) => (
                            <div key={hearing.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative">
                                <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-3">
                                    <div className="flex gap-4">
                                        <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-xl text-white shadow-sm ${
                                            hearing.status === HearingStatus.CONCLUDED ? 'bg-green-600' :
                                            hearing.status === HearingStatus.ADJOURNED ? 'bg-amber-500' :
                                            hearing.status === HearingStatus.CANCELLED ? 'bg-red-500' :
                                            'bg-purple-600'
                                        }`}>
                                            <span className="text-xs font-bold uppercase">{new Date(hearing.date).toLocaleString('default', {month:'short'})}</span>
                                            <span className="text-2xl font-bold">{new Date(hearing.date).getDate()}</span>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                                                {hearing.type} 
                                                <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${
                                                    hearing.status === HearingStatus.CONCLUDED ? 'bg-green-50 text-green-700 border-green-200' :
                                                    hearing.status === HearingStatus.ADJOURNED ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                    'bg-purple-50 text-purple-700 border-purple-200'
                                                }`}>{hearing.status}</span>
                                            </h4>
                                            <div className="flex flex-wrap gap-4 text-sm text-slate-600 mt-1">
                                                <div className="flex items-center gap-1"><Clock size={14}/> {hearing.time}</div>
                                                <div className="flex items-center gap-1"><MapPin size={14}/> {hearing.venue}</div>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">
                                        {canEdit && (
                                            <>
                                                <button onClick={() => handleEditHearing(hearing)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Edit size={16}/></button>
                                                <button onClick={() => handleDeleteHearing(hearing.id!)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={16}/></button>
                                            </>
                                        )}
                                    </div>
                                </div>
                                
                                {hearing.attendees && (
                                    <div className="mb-3 flex items-start gap-2">
                                        <span className="text-xs font-bold text-slate-500 uppercase mt-0.5">Attendees:</span>
                                        <p className="text-sm text-slate-700">{hearing.attendees}</p>
                                    </div>
                                )}

                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                                    <span className="text-xs font-bold text-slate-500 uppercase block mb-1">Minutes / Outcome:</span>
                                    <p className="text-sm text-slate-700 whitespace-pre-line">{hearing.minutes || 'No notes recorded.'}</p>
                                </div>
                            </div>
                        ))}
                        {hearings?.length === 0 && (
                            <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                                <Gavel size={48} className="mx-auto text-slate-300 mb-3"/>
                                <p className="text-slate-500 font-medium">No hearings scheduled yet.</p>
                                <p className="text-sm text-slate-400">Click "Schedule Hearing" to add one.</p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'defects' && (
                <div className="animate-in fade-in duration-300 space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="bg-red-50 p-4 rounded-xl border border-red-100 flex justify-between items-center"><div><p className="text-red-600 font-medium text-sm">Total Demand</p><p className="text-2xl font-bold text-red-700">{formatCurrency(formData.demandAmount || 0)}</p></div><div className="p-3 bg-red-100 rounded-lg text-red-600"><IndianRupee size={24} /></div></div>
                         <div className="bg-green-50 p-4 rounded-xl border border-green-100 flex justify-between items-center"><div><p className="text-green-600 font-medium text-sm">Total Paid</p><p className="text-2xl font-bold text-green-700">{formatCurrency(payments?.reduce((acc, p) => acc + p.amount, 0) || 0)}</p></div><div className="p-3 bg-green-100 rounded-lg text-green-600"><Wallet size={24} /></div></div>
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-slate-800">Defect Breakdown</h3>
                            <div className="flex gap-2">
                                {canEdit && (
                                    <>
                                        <button onClick={handleUpdateInterestTillToday} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-sm hover:bg-slate-50 font-medium"><Calculator size={16}/> Calculate Interest to Date</button>
                                        <button onClick={() => { setCurrentDefect({ defectType: '', section: '', description: '', igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead } }); setShowDefectModal(true); }} className="flex items-center gap-2 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-slate-700"><Plus size={16} /> Add Defect</button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="space-y-4">
                            {defects?.map(defect => {
                                const defectPayments = payments?.filter(p => p.defectId === defect.id);
                                const totalPaid = defectPayments?.reduce((sum, p) => sum + p.amount, 0) || 0;
                                const rowSum = (h: TaxHeadValues) => (h?.tax || 0) + (h?.interest || 0) + (h?.penalty || 0) + (h?.lateFee || 0) + (h?.others || 0);
                                const defectTotal = rowSum(defect.igst) + rowSum(defect.cgst) + rowSum(defect.sgst) + rowSum(defect.cess);
                                return (
                                    <div key={defect.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                                        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-start">
                                            <div><div className="font-semibold text-slate-800 flex items-center gap-2">{defect.defectType} <span className="text-xs bg-slate-200 px-2 py-0.5 rounded text-slate-600">{defect.section}</span></div><p className="text-sm text-slate-500 mt-1">{defect.description}</p></div>
                                            {canEdit && (
                                                <div className="flex gap-1">
                                                    <button onClick={() => handleEditDefect(defect)} className="text-slate-400 hover:text-blue-500 p-1"><Edit size={16}/></button>
                                                    <button onClick={() => handleDeleteDefect(defect.id!)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={16} /></button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-4 overflow-x-auto"><table className="w-full text-sm text-right border-collapse"><thead className="text-xs text-slate-500 bg-slate-50/50 border-b"><tr><th className="py-2 px-2 text-left">Head</th><th className="px-2">Tax</th><th className="px-2">Interest</th><th className="px-2">Penalty</th><th className="px-2">Late Fee</th><th className="px-2">Total</th></tr></thead><tbody className="divide-y divide-slate-100 text-slate-700 text-xs">{['igst', 'cgst', 'sgst', 'cess'].map(h => { const r = (defect as any)[h]; const t = rowSum(r); return t > 0 ? <tr key={h}><td className="py-2 px-2 text-left uppercase">{h}</td><td>{r.tax}</td><td>{r.interest}</td><td>{r.penalty}</td><td>{r.lateFee}</td><td className="font-medium bg-slate-50">{t}</td></tr> : null; })}</tbody><tfoot className="border-t border-slate-200 bg-slate-50 text-slate-900 font-semibold"><tr><td className="py-2 px-2 text-left">Total Demand: {formatCurrency(defectTotal)}</td><td colSpan={5} className="py-2 px-2 text-right">Balance: {formatCurrency(defectTotal - totalPaid)}</td></tr></tfoot></table></div>
                                        <div className="p-4 bg-slate-50/50 border-t border-slate-200"><div className="flex justify-between items-center mb-2"><h4 className="text-xs font-semibold uppercase text-slate-500">Payments</h4>{canEdit && <button onClick={() => { setSelectedDefectId(defect.id); setShowPaymentModal(true); }} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus size={12}/> Record Payment</button>}</div>{defectPayments?.length ? (<div className="space-y-1">{defectPayments.map(p => <div key={p.id} className="text-xs flex justify-between text-slate-600 border-b border-slate-100 pb-1 items-center"><span>{p.paymentDate} • {p.majorHead} {p.minorHead}</span><div className="flex items-center gap-3"><span className="font-medium">{formatCurrency(p.amount)}</span>{canEdit && <div className="flex gap-1"><button onClick={() => openEditPayment(p)} className="text-slate-400 hover:text-blue-500 p-0.5"><Edit size={12}/></button><button onClick={() => handleDeletePayment(p.id!)} className="text-slate-400 hover:text-red-500 p-0.5"><Trash2 size={12}/></button></div>}</div></div>)}</div>) : <p className="text-xs text-slate-400 italic">No payments.</p>}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
            
            {activeTab === 'documents' && (
                <div className="animate-in fade-in duration-300 space-y-6">
                    {/* ... (Existing Documents Tab) ... */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <div className="bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl p-5 text-white shadow-lg shadow-blue-200 relative overflow-hidden">
                            <h4 className="text-blue-100 text-sm font-medium">Total Documents</h4>
                            <p className="text-3xl font-bold mt-1">{documents?.length || 0}</p>
                            <FileIcon className="absolute bottom-4 right-4 text-white/20" size={48} />
                        </div>
                        <div className="bg-gradient-to-br from-emerald-500 to-green-600 rounded-xl p-5 text-white shadow-lg shadow-green-200 relative overflow-hidden">
                            <h4 className="text-green-100 text-sm font-medium">Evidence Files</h4>
                            <p className="text-3xl font-bold mt-1">{documents?.filter(d => d.category === 'Evidence').length || 0}</p>
                            <FolderOpen className="absolute bottom-4 right-4 text-white/20" size={48} />
                        </div>
                        <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-sm flex flex-col justify-center items-start gap-2">
                             <p className="text-sm text-slate-500 font-medium">Quick Actions</p>
                             <div className="flex gap-2 w-full">
                                <button onClick={() => navigate('/reconciliation', { state: { fromNotice: true, gstin: formData.gstin }})} className="flex-1 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold py-2 rounded-lg border border-slate-200 flex items-center justify-center gap-1 transition-colors">
                                    <Scale size={14}/> Reconciliation
                                </button>
                                {canEdit && (
                                <button onClick={() => docInputRef.current?.click()} className="flex-1 bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-semibold py-2 rounded-lg border border-blue-200 flex items-center justify-center gap-1 transition-colors">
                                    <UploadCloud size={14}/> Upload
                                </button>
                                )}
                             </div>
                        </div>
                    </div>

                    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col md:flex-row gap-4 justify-between items-center">
                            <div className="flex gap-2 w-full md:w-auto">
                                <input type="file" ref={docInputRef} className="hidden" onChange={handleDocUpload} />
                                {canEdit && (
                                    <>
                                        <select 
                                            value={uploadCategory} 
                                            onChange={(e) => setUploadCategory(e.target.value as any)}
                                            className="text-sm border border-slate-300 rounded-lg p-2 bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            <option>Notice Scan</option>
                                            <option>Evidence</option>
                                            <option>Reconciliation</option>
                                            <option>Ledger</option>
                                            <option>Other</option>
                                        </select>
                                        <button onClick={() => docInputRef.current?.click()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                                            <UploadCloud size={16}/> Upload New
                                        </button>
                                    </>
                                )}
                            </div>
                            <div className="relative w-full md:w-64">
                                <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
                                <input 
                                    type="text" 
                                    placeholder="Search documents & OCR text..." 
                                    className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                                    value={docSearch}
                                    onChange={(e) => setDocSearch(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="divide-y divide-slate-100">
                            {documents?.map(doc => (
                                <div key={doc.id} className="p-4 hover:bg-slate-50 transition-colors flex flex-col md:flex-row items-center gap-4 group">
                                    <div className={`p-3 rounded-lg ${
                                        doc.category === 'Notice Scan' ? 'bg-red-50 text-red-600' :
                                        doc.category === 'Evidence' ? 'bg-green-50 text-green-600' :
                                        doc.category === 'Reconciliation' ? 'bg-purple-50 text-purple-600' : 'bg-slate-100 text-slate-600'
                                    }`}>
                                        <FileText size={24}/>
                                    </div>
                                    <div className="flex-1 w-full text-center md:text-left">
                                        <h4 className="font-semibold text-slate-800 text-sm truncate">{doc.fileName}</h4>
                                        <div className="flex justify-center md:justify-start gap-3 mt-1 text-xs text-slate-500">
                                            <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200">{doc.category}</span>
                                            <span>{(doc.size / 1024).toFixed(1)} KB</span>
                                            <span>{new Date(doc.uploadDate).toLocaleDateString()}</span>
                                        </div>
                                        {doc.ocrText && <p className="text-xs text-slate-400 mt-1 truncate max-w-md italic">OCR Content available</p>}
                                    </div>
                                    <div className="flex gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => openOCRModal(doc)} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-100" title="View/Edit OCR Text">
                                            <ScanText size={18}/>
                                        </button>
                                        <button onClick={() => downloadFile(doc)} className="p-2 text-slate-500 hover:text-green-600 hover:bg-green-50 rounded-lg border border-transparent hover:border-green-100" title="Download">
                                            <Download size={18}/>
                                        </button>
                                        {canDelete && (
                                            <button onClick={() => deleteDocument(doc.id!)} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100" title="Delete">
                                                <Trash2 size={18}/>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {documents?.length === 0 && <div className="p-10 text-center text-slate-400">No documents found. Upload a file to get started.</div>}
                        </div>
                    </div>
                </div>
            )}
            
            {/* Timeline & Audit Tabs (Simplified for brevity as they remain largely same logic-wise, just showing the Documents tab integration mostly) */}
            {activeTab === 'timeline' && (
                <div className="animate-in fade-in duration-300">
                    <div className="mb-4 flex justify-between items-center"><h3 className="text-lg font-bold text-slate-800">Unified Case Timeline</h3><button onClick={exportHistoryPDF} className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded flex items-center gap-2 hover:bg-slate-50"><FileDown size={14}/> Export PDF</button></div>
                    {!formData.arn ? <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center text-amber-800">Case ID Missing</div> : <div className="relative border-l-2 border-slate-200 ml-4 space-y-0">{timelineEvents?.map((item) => (<div key={item.id} className="relative pl-8 pb-8 last:pb-0"><div className={`absolute -left-[11px] top-0 w-6 h-6 rounded-full border-4 border-white shadow-sm flex items-center justify-center ${item.type === 'NOTICE' ? 'bg-blue-600' : item.type === 'PAYMENT' ? 'bg-green-500' : 'bg-slate-300'}`}></div><div className="rounded-xl border p-4 bg-white"><div className="flex justify-between"><span className="text-xs font-bold uppercase text-slate-500">{item.type}</span><span className="text-xs text-slate-400">{item.date.toLocaleDateString()}</span></div><h4 className="font-bold text-slate-800 text-sm mt-1">{item.title}</h4><p className="text-xs text-slate-600">{item.subtitle}</p></div></div>))}</div>}
                </div>
            )}
            
            {activeTab === 'audit' && (
                 <div className="animate-in fade-in duration-300"><div className="overflow-hidden border border-slate-200 rounded-xl"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b"><tr><th className="px-6 py-3">Time</th><th className="px-6 py-3">User</th><th className="px-6 py-3">Action</th><th className="px-6 py-3">Details</th></tr></thead><tbody className="divide-y divide-slate-100">{auditLogs?.map(log => (<tr key={log.id}><td className="px-6 py-3 text-slate-600 text-xs">{new Date(log.timestamp).toLocaleString()}</td><td className="px-6 py-3 font-medium">{log.user}</td><td className="px-6 py-3"><span className="px-2 py-0.5 rounded text-xs bg-slate-100">{log.action}</span></td><td className="px-6 py-3 text-slate-500 truncate max-w-md" title={log.details}>{formatLogDetails(log.details)}</td></tr>))}</tbody></table></div></div>
            )}
        </div>
      </div>

      {/* Hearing Modal */}
      {showHearingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95">
                  <div className="p-5 border-b bg-slate-50 flex justify-between items-center">
                      <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Gavel className="text-purple-600"/> {currentHearing.id ? 'Edit Hearing' : 'Schedule Hearing'}</h3>
                      <button onClick={() => setShowHearingModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>
                  <form onSubmit={handleSaveHearing} className="p-6 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Date <span className="text-red-500">*</span></label>
                              <input type="date" required value={currentHearing.date || ''} onChange={e => setCurrentHearing({...currentHearing, date: e.target.value})} className="w-full p-2.5 border rounded-lg"/>
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Time <span className="text-red-500">*</span></label>
                              <input type="time" required value={currentHearing.time || ''} onChange={e => setCurrentHearing({...currentHearing, time: e.target.value})} className="w-full p-2.5 border rounded-lg"/>
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                              <select value={currentHearing.type || 'Personal Hearing'} onChange={e => setCurrentHearing({...currentHearing, type: e.target.value as any})} className="w-full p-2.5 border rounded-lg bg-white">
                                  <option>Personal Hearing</option>
                                  <option>Adjournment</option>
                                  <option>Final Hearing</option>
                              </select>
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                              <select value={currentHearing.status || HearingStatus.SCHEDULED} onChange={e => setCurrentHearing({...currentHearing, status: e.target.value as any})} className="w-full p-2.5 border rounded-lg bg-white">
                                  {Object.values(HearingStatus).map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                          </div>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Venue / Mode</label>
                          <input type="text" placeholder="e.g. Room 302, Virtual (Zoom)" value={currentHearing.venue || ''} onChange={e => setCurrentHearing({...currentHearing, venue: e.target.value})} className="w-full p-2.5 border rounded-lg"/>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Attendees (Staff / Client)</label>
                          <input type="text" placeholder="Who will attend?" value={currentHearing.attendees || ''} onChange={e => setCurrentHearing({...currentHearing, attendees: e.target.value})} className="w-full p-2.5 border rounded-lg"/>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Minutes / Outcome</label>
                          <textarea placeholder="Record discussion points or order details here..." value={currentHearing.minutes || ''} onChange={e => setCurrentHearing({...currentHearing, minutes: e.target.value})} className="w-full p-2.5 border rounded-lg h-32 resize-none"/>
                      </div>
                      <div className="flex justify-end pt-2">
                          <button type="submit" className="bg-purple-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-purple-700 shadow-sm">Save Hearing</button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {/* OCR Modal */}
      {showOCRModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                  <div className="p-5 border-b bg-slate-50 flex justify-between items-center">
                      <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><ScanText className="text-blue-600"/> OCR Text Extraction</h3>
                      <button onClick={() => setShowOCRModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>
                  <div className="p-6 flex-1 overflow-hidden flex flex-col">
                      <div className="mb-4">
                          <p className="text-sm font-medium text-slate-700">Filename: <span className="font-normal">{currentDocForOCR?.fileName}</span></p>
                          <p className="text-xs text-slate-500 mt-1">Extract text to make this document searchable.</p>
                      </div>
                      <textarea 
                          className="flex-1 w-full p-4 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-4"
                          placeholder="Extracted text will appear here..."
                          value={ocrTextBuffer}
                          onChange={(e) => setOcrTextBuffer(e.target.value)}
                      />
                      <div className="flex justify-between items-center">
                          <button onClick={simulateOCR} className="text-sm text-blue-600 font-medium hover:underline">Auto-Extract (Simulated)</button>
                          <div className="flex gap-3">
                              <button onClick={() => setShowOCRModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                              <button onClick={saveOCRText} className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm">Save Text</button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Sync, Defect, Payment Modals */}
      {showSyncModal && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md"><h3 className="font-bold text-lg mb-4">Sync Linked Notices</h3><div className="space-y-2 mb-6"><label className="flex items-center gap-2"><input type="checkbox" checked={syncOptions.gstin} onChange={e => setSyncOptions({...syncOptions, gstin: e.target.checked})}/> Taxpayer Details</label><label className="flex items-center gap-2"><input type="checkbox" checked={syncOptions.riskLevel} onChange={e => setSyncOptions({...syncOptions, riskLevel: e.target.checked})}/> Risk Level</label><label className="flex items-center gap-2"><input type="checkbox" checked={syncOptions.status} onChange={e => setSyncOptions({...syncOptions, status: e.target.checked})}/> Status</label></div><div className="flex justify-end gap-2"><button onClick={() => setShowSyncModal(false)} className="px-4 py-2 bg-slate-100 rounded text-sm">Cancel</button><button onClick={executeSync} className="px-4 py-2 bg-blue-600 text-white rounded text-sm">Sync</button></div></div></div>)}
      
      {showDefectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg mb-4 text-slate-800">{currentDefect.id ? 'Edit Defect' : 'Add New Defect'}</h3>
            <form onSubmit={handleSaveDefect}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-bold block mb-1 text-slate-600">Defect Type</label>
                  <select 
                    className="w-full border border-slate-300 p-2.5 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" 
                    value={currentDefect.defectType} 
                    onChange={e => setCurrentDefect({...currentDefect, defectType: e.target.value})}
                    required
                  >
                    <option value="">Select Defect Type</option>
                    {defectTypeOptions.map((t:any) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold block mb-1 text-slate-600">Section / Act</label>
                  <input 
                    className="w-full border border-slate-300 p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                    value={currentDefect.section} 
                    onChange={e => setCurrentDefect({...currentDefect, section: e.target.value})}
                    placeholder="e.g. Section 16(2)(c)"
                  />
                </div>
                <div className="md:col-span-2">
                   <label className="text-xs font-bold block mb-1 text-slate-600">Description / Remarks</label>
                   <textarea 
                     className="w-full border border-slate-300 p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-20" 
                     value={currentDefect.description} 
                     onChange={e => setCurrentDefect({...currentDefect, description: e.target.value})}
                     placeholder="Brief description of the discrepancy..."
                   />
                </div>
              </div>

              {/* Interest Calculator Section */}
              <div className="mb-6 border border-blue-100 bg-blue-50/50 rounded-xl overflow-hidden">
                  <div 
                    className="bg-blue-50 px-4 py-2 border-b border-blue-100 flex justify-between items-center cursor-pointer"
                    onClick={() => setShowCalculator(!showCalculator)}
                  >
                      <h4 className="text-sm font-bold text-blue-700 flex items-center gap-2"><Calculator size={14}/> Interest Calculator</h4>
                      <span className="text-xs text-blue-600">{showCalculator ? 'Hide' : 'Show'}</span>
                  </div>
                  {showCalculator && (
                      <div className="p-4 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                          <div>
                              <label className="text-xs font-bold text-slate-600 block mb-1">From Date</label>
                              <input type="date" value={calcFromDate} onChange={e => setCalcFromDate(e.target.value)} className="w-full p-2 text-sm border rounded bg-white"/>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-600 block mb-1">To Date</label>
                              <input type="date" value={calcToDate} onChange={e => setCalcToDate(e.target.value)} className="w-full p-2 text-sm border rounded bg-white"/>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-600 block mb-1">Rate (%)</label>
                              <input type="number" value={calcRate} onChange={e => setCalcRate(parseFloat(e.target.value))} className="w-full p-2 text-sm border rounded bg-white"/>
                          </div>
                          <button type="button" onClick={calculateModalInterest} className="bg-blue-600 text-white px-3 py-2 rounded text-sm font-medium hover:bg-blue-700">Calculate & Apply</button>
                          <div className="md:col-span-4 text-xs text-slate-500 italic mt-1">
                              * Applies formula (Tax Amount × Rate × Days / 36500) to 'Interest' fields below based on respective 'Tax' values.
                          </div>
                      </div>
                  )}
              </div>

              <div className="border rounded-xl overflow-hidden mb-6">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200">
                    <h4 className="text-sm font-bold text-slate-700">Demand Details</h4>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-500 text-xs uppercase font-semibold">
                        <tr>
                            <th className="px-4 py-3 text-left">Head</th>
                            <th className="px-2 py-3 text-right">Tax</th>
                            <th className="px-2 py-3 text-right">Interest</th>
                            <th className="px-2 py-3 text-right">Penalty</th>
                            <th className="px-2 py-3 text-right">Late Fee</th>
                            <th className="px-2 py-3 text-right">Others</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {(['igst', 'cgst', 'sgst', 'cess'] as const).map(head => (
                            <tr key={head} className="hover:bg-slate-50">
                                <td className="px-4 py-2 font-bold text-slate-600 uppercase">{head}</td>
                                {['tax', 'interest', 'penalty', 'lateFee', 'others'].map((field) => (
                                    <td key={field} className="px-2 py-2">
                                        <input 
                                            type="number" 
                                            className="w-full text-right p-1.5 border border-slate-200 rounded focus:border-blue-500 outline-none text-slate-700 font-mono"
                                            value={(currentDefect as any)[head]?.[field] || 0}
                                            onChange={e => handleDefectMatrixChange(head, field as any, parseFloat(e.target.value) || 0)}
                                            onFocus={e => e.target.select()}
                                        />
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
                <button type="button" onClick={() => setShowDefectModal(false)} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" className="px-5 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-2"><Save size={16}/> {currentDefect.id ? 'Update Defect' : 'Add Defect'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {showPaymentModal && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"><div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl p-6"><h3 className="font-bold text-lg mb-4">Record Payment</h3><form onSubmit={handleSavePaymentMatrix}><div className="mb-4"><label className="text-xs font-bold block">Challan No</label><input required className="w-full border p-2 rounded" value={paymentMatrix.challanNumber} onChange={e => setPaymentMatrix({...paymentMatrix, challanNumber: e.target.value})}/></div><div className="flex justify-end gap-2"><button type="button" onClick={() => setShowPaymentModal(false)} className="px-4 py-2 bg-slate-100 rounded text-sm">Cancel</button><button type="submit" className="px-4 py-2 bg-green-600 text-white rounded text-sm">Save</button></div></form></div></div>)}

    </div>
  );
};

export default NoticeDetail;