
import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Notice, NoticeStatus, RiskLevel, NoticeDefect, PaymentLog, TaxHeadValues, Taxpayer, DocumentMeta, Hearing, HearingStatus, TeamTimeSheet } from '../types';
import { Save, ArrowLeft, ArrowRight, Clock, FileText, Plus, Trash2, IndianRupee, Wallet, Calculator, Building, HelpCircle, History, RefreshCw, FileDown, Activity, ClipboardList, ChevronUp, ChevronDown, Filter, CreditCard, AlertCircle, Phone, Mail, MapPin, Edit, X, FolderOpen, UploadCloud, ScanText, File as FileIcon, Search, Eye, Download, Scale, Gavel, Calendar, CheckSquare, ShieldCheck, Link as LinkIcon, Split, ExternalLink, Receipt, Hourglass, Gavel as GavelIcon, ShieldAlert } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { formatDate, formatCurrency } from '../utils/formatting';

const initialTaxHead: TaxHeadValues = { tax: 0, interest: 0, penalty: 0, lateFee: 0, others: 0 };
const GSTIN_REGEX = /^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/;
const ORDER_TYPES = ['DRC-07', 'DRC-08', 'ASMT-13', 'ASMT-15', 'Appeal Order', 'Rectification Order', 'Order Passed'];

const Tooltip: React.FC<{ text: string }> = ({ text }) => (
    <div className="group relative inline-block ml-1 align-middle">
        <HelpCircle size={14} className="text-slate-400 hover:text-blue-500 cursor-help transition-colors" />
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-64 p-2.5 bg-slate-800 text-white text-xs rounded-lg shadow-xl z-50 text-center pointer-events-none font-medium leading-relaxed">
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
        if (obj.date && obj.type) return `Hearing: ${obj.type} on ${formatDate(obj.date)}`;
        return Object.keys(obj).map(k => `${k}: ${obj[k]}`).join(', ');
    } catch (e) {
        return details;
    }
};

interface TimelineEvent {
    id: string;
    date: Date;
    type: 'NOTICE' | 'PAYMENT' | 'LOG' | 'HEARING' | 'REPLY';
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
  
  const [activeTab, setActiveTab] = useState<'info' | 'defects' | 'hearings' | 'documents' | 'history' | 'audit' | 'time'>('info');
  const [loading, setLoading] = useState(!isNew);
  const [gstinError, setGstinError] = useState('');
  const [timelineFilter, setTimelineFilter] = useState<'ALL' | 'MAJOR'>('MAJOR');
  const [docSearch, setDocSearch] = useState('');
  const [uploadCategory, setUploadCategory] = useState<'Notice Scan' | 'Evidence' | 'Reconciliation' | 'Ledger' | 'Other'>('Notice Scan');
  
  const [formData, setFormData] = useState<Partial<Notice>>({
    status: NoticeStatus.RECEIVED, riskLevel: RiskLevel.MEDIUM, demandAmount: 0, tags: [], issuingAuthority: '', linkedCaseId: '', budgetedHours: 0
  });

  const configTypes = useLiveQuery(() => db.appConfig.get({key: 'notice_types'}));
  const configCaseTypes = useLiveQuery(() => db.appConfig.get({key: 'case_types'}));
  const configStatuses = useLiveQuery(() => db.appConfig.get({key: 'notice_statuses'}));
  const configDefectTypes = useLiveQuery(() => db.appConfig.get({key: 'defect_types'}));
  const configPeriods = useLiveQuery(() => db.appConfig.get({key: 'notice_periods'}));
  
  const typeOptions = configTypes?.value || [];
  const caseTypeOptions = configCaseTypes?.value || [];
  const statusOptions = configStatuses?.value || Object.values(NoticeStatus);
  const defectTypeOptions = configDefectTypes?.value || [];
  const periodOptions = configPeriods?.value || [];
  
  const taxpayersList = useLiveQuery(() => db.taxpayers.orderBy('tradeName').toArray()) || [];
  const usersList = useLiveQuery(() => db.users.filter(u => u.isActive === true).toArray()) || [];

  const defects = useLiveQuery(() => noticeId ? db.defects.where('noticeId').equals(noticeId).toArray() : [], [noticeId]);
  const payments = useLiveQuery(() => noticeId ? db.payments.where('noticeId').equals(noticeId).toArray() : [], [noticeId]);
  const hearings = useLiveQuery(() => noticeId ? db.hearings.where('noticeId').equals(noticeId).sortBy('date') : [], [noticeId]);
  const timeLogs = useLiveQuery(() => noticeId ? db.timeSheets.where('noticeId').equals(noticeId).reverse().sortBy('date') : [], [noticeId]);
  
  // Query to find notices that link TO this notice (Escalations)
  const escalatedCases = useLiveQuery(async () => {
      if (!formData.arn) return [];
      return await db.notices.where('linkedCaseId').equals(formData.arn).toArray();
  }, [formData.arn]);

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
          const nDate = new Date(n.dateOfIssue);
          if (!isNaN(nDate.getTime())) {
              events.push({
                  id: `notice-${n.id}`, date: nDate, type: 'NOTICE', 
                  title: `${n.noticeType} Issued`, subtitle: n.noticeNumber, status: n.status, 
                  refId: n.id!, risk: n.riskLevel, details: n.description
              });
          }

          const payLogs = await db.payments.where('noticeId').equals(n.id!).toArray();
          payLogs.forEach(p => {
              const pDate = new Date(p.paymentDate);
              if (!isNaN(pDate.getTime())) {
                  events.push({ 
                      id: `pay-${p.id}`, date: pDate, type: 'PAYMENT', 
                      title: 'Payment Recorded', subtitle: `${p.majorHead} - ${p.minorHead}`, amount: p.amount, 
                      refId: n.id!, details: `Challan: ${p.challanNumber}` 
                  });
              }
          });

          const hearingLogs = await db.hearings.where('noticeId').equals(n.id!).toArray();
          hearingLogs.forEach(h => {
              const hDate = new Date(h.date);
              if (!isNaN(hDate.getTime())) {
                  events.push({
                      id: `hearing-${h.id}`, date: hDate, type: 'HEARING',
                      title: `Hearing: ${h.type}`, subtitle: h.status, refId: n.id!,
                      details: `Time: ${h.time}, Venue: ${h.venue}. Outcome: ${h.minutes || 'N/A'}`
                  });
              }
          });

          const logs = await db.auditLogs.where('entityType').equals('Notice').and(l => l.entityId === n.id!).toArray();
          logs.forEach(l => {
              if (l.action === 'Create') return; 
              const lDate = new Date(l.timestamp);
              if (!isNaN(lDate.getTime())) {
                  let isReply = l.details.includes("'Reply Filed'") || l.details.includes('"Reply Filed"');
                  events.push({ 
                      id: `log-${l.id}`, date: lDate, type: isReply ? 'REPLY' : 'LOG', 
                      title: isReply ? 'Reply Filed' : `System: ${l.action}`, subtitle: l.user, 
                      refId: n.id!, details: formatLogDetails(l.details) 
                  });
              }
          });
      }
      return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [formData.arn]);

  const [linkedTaxpayer, setLinkedTaxpayer] = useState<Taxpayer | null>(null);
  const [isEditingTaxpayer, setIsEditingTaxpayer] = useState(false);
  const [taxpayerData, setTaxpayerData] = useState<Partial<Taxpayer>>({});

  const [showDefectModal, setShowDefectModal] = useState(false);
  const [currentDefect, setCurrentDefect] = useState<Partial<NoticeDefect>>({ defectType: '', section: '', description: '', igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead } });

  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [waiverDetails, setWaiverDetails] = useState({ id: 0, date: new Date().toISOString().split('T')[0], reason: '' });
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

  const [showHearingModal, setShowHearingModal] = useState(false);
  const [currentHearing, setCurrentHearing] = useState<Partial<Hearing>>({
      type: 'Personal Hearing', date: new Date().toISOString().split('T')[0], time: '11:00', status: HearingStatus.SCHEDULED, minutes: ''
  });

  const finalTypeOptions = useMemo(() => {
      const opts = [...typeOptions];
      if (formData.noticeType && !opts.includes(formData.noticeType)) opts.push(formData.noticeType);
      return opts;
  }, [typeOptions, formData.noticeType]);

  const finalPeriodOptions = useMemo(() => {
      const opts = [...periodOptions];
      if (formData.period && !opts.includes(formData.period)) opts.push(formData.period);
      return opts;
  }, [periodOptions, formData.period]);

  const finalTaxpayerOptions = useMemo(() => {
      const exists = taxpayersList.find(t => t.gstin === formData.gstin);
      if (formData.gstin && !exists) {
          return [...taxpayersList, { id: -1, gstin: formData.gstin, tradeName: 'Unregistered Taxpayer (Imported)', legalName: '', mobile: '', email: '', registeredAddress: '', stateCode: '' } as Taxpayer];
      }
      return taxpayersList;
  }, [taxpayersList, formData.gstin]);

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
                 db.taxpayers.where('gstin').equals(formData.gstin).first().then(t => { 
                     setLinkedTaxpayer(t || null); 
                     if(t) setTaxpayerData(t); 
                     else setTaxpayerData({ gstin: formData.gstin, tradeName: '', legalName: '', registeredAddress: '', mobile: '', email: '' }); 
                 });
          } else { setGstinError(formData.gstin.length !== 15 ? 'GSTIN must be 15 characters' : 'Invalid GSTIN format'); setLinkedTaxpayer(null); }
      }
  }, [formData.gstin]);

  // --- NEW: CONTEST TRACKER LOGIC ---
  const contestInfo = useMemo(() => {
      if (!formData.noticeType || !formData.dateOfIssue || !ORDER_TYPES.includes(formData.noticeType)) return null;
      if (['Appeal Filed', 'Rectification Filed', 'Closed', 'Paid'].includes(formData.status || '')) return null;

      const issueDate = new Date(formData.dateOfIssue);
      const deadline = new Date(issueDate);
      deadline.setDate(issueDate.getDate() + 90);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const daysRemaining = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 3600 * 24));
      
      return {
          deadline,
          daysRemaining,
          isExpired: daysRemaining <= 0,
          isCritical: daysRemaining > 0 && daysRemaining <= 15,
          isWarning: daysRemaining > 15 && daysRemaining <= 30
      };
  }, [formData.noticeType, formData.dateOfIssue, formData.status]);

  const handleQuickStatusUpdate = async (newStatus: string) => {
      if (!noticeId) return;
      if (confirm(`Update status to "${newStatus}"? This will stop contest alerts.`)) {
          await db.notices.update(noticeId, { status: newStatus });
          setFormData(prev => ({ ...prev, status: newStatus }));
          await db.auditLogs.add({
              entityType: 'Notice', entityId: noticeId, action: 'StatusChange', timestamp: new Date().toISOString(),
              user: user?.username || 'System', details: `Status updated via Contest Tracker to ${newStatus}`
          });
      }
  };

  const handleChange = (field: keyof Notice, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleMarkAsChecked = () => {
      const today = new Date().toISOString().split('T')[0];
      setFormData(prev => ({ ...prev, lastCheckedDate: today }));
  };

  const handleSaveTaxpayer = async () => {
      try {
          if (!formData.gstin) return;
          if (linkedTaxpayer && linkedTaxpayer.id) {
              await db.taxpayers.update(linkedTaxpayer.id, taxpayerData);
          } else {
              await db.taxpayers.add(taxpayerData as Taxpayer);
          }
          const updated = await db.taxpayers.where('gstin').equals(formData.gstin).first();
          setLinkedTaxpayer(updated || null);
          setIsEditingTaxpayer(false);
          alert('Taxpayer saved.');
      } catch (e) {
          console.error(e);
          alert('Error saving taxpayer.');
      }
  };

  const handleSaveNotice = async () => {
      try {
          if (!formData.gstin || !formData.noticeNumber) {
              alert('GSTIN and Notice Number are required.');
              return;
          }
          
          const payload = { ...formData } as Notice;
          let newId = noticeId;

          if (isNew) {
              newId = await db.notices.add(payload);
              await db.auditLogs.add({
                  entityType: 'Notice', entityId: newId, action: 'Create', timestamp: new Date().toISOString(),
                  user: user?.username || 'System', details: `Created Notice ${payload.noticeNumber}`
              });
              alert('Notice Created!');
              navigate(`/notices/${newId}`, { replace: true });
          } else {
              await db.notices.update(noticeId!, payload as any);
              await db.auditLogs.add({
                  entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(),
                  user: user?.username || 'System', details: `Updated Notice ${payload.noticeNumber}`
              });
              alert('Notice Updated!');
          }
      } catch (e) {
          console.error(e);
          alert('Error saving notice.');
      }
  };

  const handleAddQuickLog = async () => {
      const hours = prompt("Enter hours worked:");
      const desc = prompt("Enter description:");
      if(hours && desc && noticeId) {
          await db.timeSheets.add({
              noticeId,
              teamMember: user?.username || 'System',
              date: new Date().toISOString().split('T')[0],
              hoursSpent: parseFloat(hours),
              description: desc
          });
          alert('Log added.');
      }
  };

  const executeSync = async () => {
      if (!formData.arn) return;
      try {
          const linked = await db.notices.where('arn').equals(formData.arn!).toArray();
          let count = 0;
          for (const n of linked) {
              if (n.id === noticeId) continue;
              const updates: any = {};
              if (syncOptions.gstin && formData.gstin) updates.gstin = formData.gstin;
              if (syncOptions.riskLevel && formData.riskLevel) updates.riskLevel = formData.riskLevel;
              if (syncOptions.status && formData.status) updates.status = formData.status;
              
              if (Object.keys(updates).length > 0) {
                  await db.notices.update(n.id!, updates);
                  count++;
              }
          }
          alert(`Synced ${count} linked notices.`);
          setShowSyncModal(false);
      } catch (e) {
          console.error(e);
          alert('Sync failed.');
      }
  };

  const handleSaveDefect = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!noticeId) return;
      
      const headSum = (h: TaxHeadValues) => (h.tax || 0) + (h.interest || 0) + (h.penalty || 0) + (h.lateFee || 0) + (h.others || 0);
      const total = headSum(currentDefect.igst!) + headSum(currentDefect.cgst!) + headSum(currentDefect.sgst!) + headSum(currentDefect.cess!);

      currentDefect.taxDemand = (currentDefect.igst?.tax||0) + (currentDefect.cgst?.tax||0) + (currentDefect.sgst?.tax||0) + (currentDefect.cess?.tax||0);
      currentDefect.interestDemand = (currentDefect.igst?.interest||0) + (currentDefect.cgst?.interest||0) + (currentDefect.sgst?.interest||0) + (currentDefect.cess?.interest||0);
      currentDefect.penaltyDemand = (currentDefect.igst?.penalty||0) + (currentDefect.cgst?.penalty||0) + (currentDefect.sgst?.penalty||0) + (currentDefect.cess?.penalty||0);

      try {
          if (currentDefect.id) {
              await db.defects.update(currentDefect.id, currentDefect);
          } else {
              await db.defects.add({ ...currentDefect, noticeId } as NoticeDefect);
          }
          await updateTotalDemand(noticeId);
          setShowDefectModal(false);
      } catch (e) { console.error(e); alert('Error saving defect.'); }
  };

  const handleEditDefect = (defect: NoticeDefect) => { setCurrentDefect({...defect}); setShowDefectModal(true); setShowCalculator(false); };
  
  const handleDeleteDefect = async (id: number) => {
      if (confirm('Delete defect?')) {
          await db.defects.delete(id);
          await updateTotalDemand(noticeId!);
      }
  };

  const handleOpenWaiverModal = (id: number) => { setWaiverDetails({ id, date: new Date().toISOString().split('T')[0], reason: '' }); setShowWaiverModal(true); };
  
  const handleWaiveDefect = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          await db.defects.update(waiverDetails.id, {
              status: 'Waived',
              waiverDate: waiverDetails.date,
              waiverReason: waiverDetails.reason
          });
          
          await db.auditLogs.add({
              entityType: 'Defect', entityId: waiverDetails.id, action: 'Update', timestamp: new Date().toISOString(),
              user: user?.username || 'System', details: `Defect Waived: ${waiverDetails.reason}`
          });

          setShowWaiverModal(false);
          if (noticeId) await updateTotalDemand(noticeId);
      } catch (e) { console.error(e); alert('Error waiving defect.'); }
  };

  const calculateModalInterest = () => {
      if (!calcFromDate || !calcToDate) return;
      const days = Math.ceil((new Date(calcToDate).getTime() - new Date(calcFromDate).getTime()) / (1000 * 3600 * 24));
      if (days <= 0) { alert('Invalid date range'); return; }

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
      const allDefects = await db.defects.where('noticeId').equals(nId).toArray();
      const total = allDefects.reduce((acc, d) => {
          if (d.status === 'Waived') return acc;
          const sumHead = (h: any) => (h.tax || 0) + (h.interest || 0) + (h.penalty || 0) + (h.lateFee || 0) + (h.others || 0);
          return acc + sumHead(d.igst) + sumHead(d.cgst) + sumHead(d.sgst) + sumHead(d.cess);
      }, 0);
      await db.notices.update(nId, { demandAmount: total });
      setFormData(prev => ({ ...prev, demandAmount: total }));
  };

  const handleSaveHearing = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!noticeId) return;
      try {
          if (currentHearing.id) {
              await db.hearings.update(currentHearing.id, currentHearing);
          } else {
              await db.hearings.add({ ...currentHearing, noticeId } as Hearing);
          }
          
          if (formData.status !== NoticeStatus.HEARING && formData.status !== NoticeStatus.CLOSED) {
              await db.notices.update(noticeId, { status: NoticeStatus.HEARING });
              setFormData(prev => ({ ...prev, status: NoticeStatus.HEARING }));
          }

          setShowHearingModal(false);
      } catch (e) { console.error(e); alert('Error saving hearing.'); }
  };

  const handleEditHearing = (h: Hearing) => { setCurrentHearing(h); setShowHearingModal(true); };
  
  const handleDeleteHearing = async (id: number) => {
      if (confirm('Delete this hearing?')) { await db.hearings.delete(id); }
  };

  const handleSavePaymentMatrix = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!noticeId) return;
      try {
          const heads = ['igst', 'cgst', 'sgst', 'cess'] as const;
          const types = ['tax', 'interest', 'penalty', 'lateFee', 'others'] as const;
          
          let count = 0;
          for (const head of heads) {
              for (const type of types) {
                  const val = (paymentMatrix as any)[head]?.[type];
                  if (val && val > 0) {
                      await db.payments.add({
                          noticeId,
                          defectId: selectedDefectId,
                          majorHead: head.toUpperCase() as any,
                          minorHead: type.charAt(0).toUpperCase() + type.slice(1) as any,
                          amount: val,
                          challanNumber: paymentMatrix.challanNumber,
                          paymentDate: paymentMatrix.paymentDate,
                          bankName: paymentMatrix.bankName,
                          notes: paymentMatrix.refNumber
                      });
                      count++;
                  }
              }
          }
          
          if (count > 0) {
              setShowPaymentModal(false);
              alert(`${count} payment entries recorded.`);
              setPaymentMatrix({ igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead }, challanNumber: '', paymentDate: new Date().toISOString().split('T')[0], bankName: '', refNumber: '' });
          } else {
              alert('No non-zero amounts entered.');
          }
      } catch (e) { console.error(e); alert('Error recording payment.'); }
  };

  const handleDeletePayment = async (payId: number) => { if(confirm('Delete payment?')) await db.payments.delete(payId); };
  const openEditPayment = (payment: PaymentLog) => { setEditingPayment({...payment}); setShowEditPaymentModal(true); };

  const exportHistoryPDF = () => {
      const doc = new jsPDF();
      doc.text(`Case History: ${formData.noticeNumber}`, 14, 15);
      
      const tableData = timelineEvents?.map(e => [
          formatDate(e.date.toISOString()),
          e.type,
          e.title,
          e.details || '-'
      ]);

      autoTable(doc, {
          startY: 20,
          head: [['Date', 'Type', 'Event', 'Details']],
          body: tableData,
      });
      doc.save(`CaseHistory_${formData.noticeNumber}.pdf`);
  };

  const handleDefectMatrixChange = (head: 'igst' | 'cgst' | 'sgst' | 'cess', field: keyof TaxHeadValues, value: number) => { setCurrentDefect(prev => { const prevHead = prev[head] || { ...initialTaxHead }; return { ...prev, [head]: { ...prevHead, [field]: value } }; }); };
  const handlePaymentMatrixChange = (head: 'igst' | 'cgst' | 'sgst' | 'cess', field: keyof TaxHeadValues, value: number) => { setPaymentMatrix(prev => ({ ...prev, [head]: { ...prev[head], [field]: value } })); };
  
  const handleDocUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || !files.length || !noticeId) return;
      try {
          for (let i = 0; i < files.length; i++) {
              const file = files[i];
              await db.documents.add({
                  noticeId,
                  fileName: file.name,
                  fileType: file.type,
                  size: file.size,
                  category: uploadCategory,
                  uploadDate: new Date().toISOString(),
                  fileData: file
              });
          }
      } catch (e) { console.error(e); alert('Upload failed'); }
  };

  const deleteDocument = async (docId: number) => { if(confirm('Delete file?')) await db.documents.delete(docId); };
  
  const openOCRModal = (doc: DocumentMeta) => { setCurrentDocForOCR(doc); setOcrTextBuffer(doc.ocrText || ''); setShowOCRModal(true); };
  const saveOCRText = async () => {
      if (currentDocForOCR) {
          await db.documents.update(currentDocForOCR.id!, { ocrText: ocrTextBuffer });
          setShowOCRModal(false);
      }
  };
  const simulateOCR = () => { setOcrTextBuffer(`Scanned Text from ${currentDocForOCR?.fileName}...\n\nDIN: ${formData.noticeNumber}\nDate: ${formData.dateOfIssue}\n\nThis is a simulated OCR result.`); };
  
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
      } else { alert('File data not available locally.'); }
  };

  const handleUpdateInterestTillToday = async () => {
      if (!defects || defects.length === 0) return;
      if (confirm("Recalculate interest for all defects till today (18%)?")) {
          const today = new Date();
          let updated = false;
          for (const defect of defects) {
              const baseDateStr = formData.dueDate || formData.dateOfIssue;
              if (!baseDateStr) continue;
              
              const days = Math.ceil((today.getTime() - new Date(baseDateStr).getTime()) / (1000 * 3600 * 24));
              if (days <= 0) continue;

              const calc = (tax: number) => Math.round((tax * 18 * days) / 36500);
              
              await db.defects.update(defect.id!, {
                  igst: { ...defect.igst, interest: calc(defect.igst.tax) },
                  cgst: { ...defect.cgst, interest: calc(defect.cgst.tax) },
                  sgst: { ...defect.sgst, interest: calc(defect.sgst.tax) },
                  cess: { ...defect.cess, interest: calc(defect.cess.tax) },
                  interestDemand: calc(defect.igst.tax) + calc(defect.cgst.tax) + calc(defect.sgst.tax) + calc(defect.cess.tax)
              });
              updated = true;
          }
          if (updated) {
              await updateTotalDemand(noticeId!);
              alert('Interest updated.');
          }
      }
  };

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;

  const totalHoursWorked = timeLogs?.reduce((acc, log) => acc + log.hoursSpent, 0) || 0;
  const progressPercent = formData.budgetedHours ? Math.min(100, (totalHoursWorked / formData.budgetedHours) * 100) : 0;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      {/* NEW: Contest Tracker Banner */}
      {contestInfo && (
          <div className={`p-4 rounded-xl border-2 flex flex-col md:flex-row items-center justify-between gap-4 animate-in slide-in-from-top duration-500 ${
              contestInfo.isExpired ? 'bg-red-50 border-red-200 text-red-800' : 
              contestInfo.isCritical ? 'bg-orange-50 border-orange-200 text-orange-800' :
              'bg-blue-50 border-blue-200 text-blue-800'
          }`}>
              <div className="flex items-center gap-4">
                  <div className={`p-3 rounded-full ${
                      contestInfo.isExpired ? 'bg-red-200 text-red-700' : 
                      contestInfo.isCritical ? 'bg-orange-200 text-orange-700' :
                      'bg-blue-200 text-blue-700'
                  }`}>
                      <GavelIcon size={24}/>
                  </div>
                  <div>
                      <h3 className="font-bold flex items-center gap-2">
                          Contest Tracker: {formData.noticeType} Order 
                          {contestInfo.isExpired && <span className="bg-red-600 text-white text-[10px] px-2 py-0.5 rounded-full uppercase tracking-widest">Expired</span>}
                      </h3>
                      <p className="text-sm font-medium">
                          {contestInfo.isExpired 
                            ? `Contest period ended on ${formatDate(contestInfo.deadline.toISOString())}.`
                            : `${contestInfo.daysRemaining} days remaining to file Appeal or Rectification (Deadline: ${formatDate(contestInfo.deadline.toISOString())}).`
                          }
                      </p>
                  </div>
              </div>
              {!contestInfo.isExpired && (
                  <div className="flex gap-2">
                      <button 
                        onClick={() => handleQuickStatusUpdate('Appeal Filed')}
                        className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5"
                      >
                          <ArrowRight size={14} className="text-blue-500"/> Mark Appeal Filed
                      </button>
                      <button 
                        onClick={() => handleQuickStatusUpdate('Rectification Filed')}
                        className="bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5"
                      >
                          <ShieldAlert size={14} className="text-orange-500"/> Mark Rectification Filed
                      </button>
                  </div>
              )}
          </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/notices')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium transition-colors"><ArrowLeft size={18} /> Back</button>
        {canEdit && (
            <div className="flex gap-2">
                {!isNew && (
                    <button 
                        onClick={() => navigate('/billing', { state: { createFromNotice: formData } })}
                        className="flex items-center gap-2 bg-green-600 text-white px-4 py-2.5 rounded-lg hover:bg-green-700 shadow-sm transition-all font-medium"
                    >
                        <Receipt size={18} /> Generate Invoice
                    </button>
                )}
                <button onClick={handleSaveNotice} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 shadow-sm transition-all font-medium"><Save size={18} /> Save</button>
            </div>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50/50">
            {[ 
                {id: 'info', icon: FileText, label: 'Notice Info'}, 
                {id: 'defects', icon: Wallet, label: 'Defects & Payments'}, 
                {id: 'time', icon: Hourglass, label: 'Time & Planning'},
                {id: 'hearings', icon: Gavel, label: 'Hearings'}, 
                {id: 'documents', icon: FolderOpen, label: 'Documents'}, 
                {id: 'history', icon: History, label: 'Case History'}, 
                {id: 'audit', icon: Activity, label: 'Audit Trail'} 
            ].map(tab => (
                 <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} disabled={isNew && tab.id !== 'info'} className={`flex-1 py-4 text-sm font-semibold border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === tab.id ? 'border-blue-500 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'} ${(isNew && tab.id !== 'info') ? 'opacity-50 cursor-not-allowed' : ''}`}><tab.icon size={16}/> {tab.label}</button>
            ))}
        </div>

        <div className="p-8">
            {activeTab === 'info' && (
                <div className="space-y-8 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="space-y-6">
                            <div><label className="block text-sm font-bold text-slate-700 mb-1">Select Taxpayer (GSTIN) <span className="text-red-500">*</span> <Tooltip text="The registered taxpayer for whom this notice is issued."/></label><div className="flex gap-2"><select disabled={!canEdit} value={formData.gstin || ''} onChange={(e) => handleChange('gstin', e.target.value)} className={`flex-1 p-2.5 border rounded-lg bg-white ${gstinError ? 'border-red-300' : 'border-slate-300'} disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none transition-shadow`}><option value="">-- Select Client --</option>{finalTaxpayerOptions.map(t => (<option key={t.id} value={t.gstin}>{t.tradeName} - {t.gstin}</option>))}</select><Link to="/taxpayers/new" className="bg-slate-100 border border-slate-300 text-slate-600 p-2.5 rounded-lg hover:bg-slate-200" title="Add New Taxpayer"><Plus size={20}/></Link></div>{gstinError && <span className="text-xs text-red-500 mt-1 block">{gstinError}</span>}</div>
                            
                            <div className="bg-blue-50 border border-blue-100 p-4 rounded-xl">
                                <div className="flex justify-between">
                                    <label className="block text-sm font-bold text-blue-800 flex items-center gap-1 mb-2">
                                        <LinkIcon size={16}/> Case ID (ARN) <Tooltip text="The unique ID linking ASMT-10, DRC-01, and Appeal notices for the same proceeding."/>
                                    </label>
                                    {!isNew && formData.arn && canEdit && <button onClick={() => setShowSyncModal(true)} className="text-xs text-blue-600 hover:underline flex items-center gap-1 font-medium"><RefreshCw size={12}/> Sync Linked</button>}
                                </div>
                                <input disabled={!canEdit} type="text" value={formData.arn || ''} onChange={(e) => handleChange('arn', e.target.value)} className="w-full p-2.5 border border-blue-200 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none font-medium" placeholder="ARN / Unified Case Ref" />
                                
                                <div className="mt-4 pt-4 border-t border-blue-200">
                                    <label className="block text-xs font-bold text-blue-800 mb-1">Previous / Related Case ID (Manual Link)</label>
                                    <div className="flex gap-2">
                                        <input 
                                            disabled={!canEdit}
                                            type="text" 
                                            value={formData.linkedCaseId || ''} 
                                            onChange={(e) => handleChange('linkedCaseId', e.target.value)} 
                                            className="flex-1 p-2 text-sm border border-blue-200 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" 
                                            placeholder="e.g. Previous ASMT ARN" 
                                        />
                                        {formData.linkedCaseId && (
                                            <button 
                                                onClick={() => navigate('/notices', { state: { gstin: formData.linkedCaseId } })}
                                                className="bg-white text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-50 text-xs font-medium flex items-center gap-1"
                                                title="View Linked Case"
                                            >
                                                View <ExternalLink size={12}/>
                                            </button>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-blue-600 mt-1">
                                        Use this to link an escalated case (e.g. DRC-01) to its origin (e.g. ASMT-10).
                                    </p>
                                </div>

                                {escalatedCases && escalatedCases.length > 0 && (
                                    <div className="mt-3 pt-3 border-t border-blue-200">
                                        <label className="block text-xs font-bold text-blue-800 mb-1">Escalated / Linked Cases:</label>
                                        <div className="space-y-1">
                                            {escalatedCases.map(ec => (
                                                <div key={ec.id} className="flex justify-between items-center text-xs bg-white p-2 rounded border border-blue-200">
                                                    <span className="font-mono text-blue-700">{ec.noticeNumber} ({ec.noticeType})</span>
                                                    <Link to={`/notices/${ec.id}`} className="text-blue-600 hover:underline flex items-center gap-1">
                                                        Go <ArrowRight size={10}/>
                                                    </Link>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5">
                                <div className="flex justify-between items-center mb-3"><h4 className="font-bold text-slate-700 flex items-center gap-2 text-sm"><Building size={16}/> Taxpayer Details</h4><button onClick={() => setIsEditingTaxpayer(!isEditingTaxpayer)} className="text-xs text-blue-600 hover:underline font-medium">{isEditingTaxpayer ? 'Cancel' : (linkedTaxpayer ? 'Edit' : 'Add Details')}</button></div>
                                {isEditingTaxpayer ? (
                                    <div className="space-y-3 animate-in fade-in duration-200">
                                         <input className="w-full p-2 border rounded text-sm" placeholder="Trade Name" value={taxpayerData.tradeName || ''} onChange={e => setTaxpayerData({...taxpayerData, tradeName: e.target.value})} />
                                         <input className="w-full p-2 border rounded text-sm" placeholder="Legal Name" value={taxpayerData.legalName || ''} onChange={e => setTaxpayerData({...taxpayerData, legalName: e.target.value})} />
                                         <input className="w-full p-2 border rounded text-sm" placeholder="Address" value={taxpayerData.registeredAddress || ''} onChange={e => setTaxpayerData({...taxpayerData, registeredAddress: e.target.value})} />
                                         <div className="grid grid-cols-2 gap-2">
                                            <input className="w-full p-2 border rounded text-sm" placeholder="Mobile" value={taxpayerData.mobile || ''} onChange={e => setTaxpayerData({...taxpayerData, mobile: e.target.value})} />
                                            <input className="w-full p-2 border rounded text-sm" placeholder="Email" value={taxpayerData.email || ''} onChange={e => setTaxpayerData({...taxpayerData, email: e.target.value})} />
                                         </div>
                                         {canEdit && <button onClick={handleSaveTaxpayer} className="w-full bg-blue-600 text-white py-2 rounded-lg text-sm hover:bg-blue-700 font-medium">Save Taxpayer Details</button>}
                                    </div>
                                ) : (linkedTaxpayer ? (
                                    <div className="text-sm space-y-2">
                                        <div>
                                            <p className="font-bold text-slate-800 text-base">{linkedTaxpayer.tradeName}</p>
                                            <p className="text-slate-500 text-xs">{linkedTaxpayer.legalName}</p>
                                        </div>
                                        <div className="flex items-start gap-2 text-slate-600">
                                            <MapPin size={14} className="mt-0.5 text-slate-400 shrink-0"/>
                                            <span className="text-xs">{linkedTaxpayer.registeredAddress || 'No Address'}</span>
                                        </div>
                                    </div>
                                ) : (<p className="text-xs text-slate-400 italic">No taxpayer linked.</p>))}
                            </div>
                        </div>
                        <div className="space-y-6">
                            <div><label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Notice Reference No <span className="text-red-500">*</span> <Tooltip text="DIN, SCN Number, or unique reference from the document."/></label><input disabled={!canEdit} type="text" placeholder="DIN / SCN Number" value={formData.noticeNumber || ''} onChange={(e) => handleChange('noticeNumber', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" /></div>
                            
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Notice Type</label>
                                    <select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" value={formData.noticeType || ''} onChange={(e) => handleChange('noticeType', e.target.value)}>
                                        <option value="">Select Type</option>
                                        {finalTypeOptions.map((t: string) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1"><Split size={14}/> Case Track</label>
                                    <select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" value={formData.caseType || ''} onChange={(e) => handleChange('caseType', e.target.value)}>
                                        <option value="">Uncategorized</option>
                                        {caseTypeOptions.map((t: string) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Issuing Authority / Designation <Tooltip text="The officer who issued this specific notice."/></label>
                                <input disabled={!canEdit} type="text" placeholder="e.g. State Tax Officer / Superintendent" value={formData.issuingAuthority || ''} onChange={(e) => handleChange('issuingAuthority', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                            </div>

                            <div><label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Current Status</label><select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" value={formData.status || ''} onChange={(e) => handleChange('status', e.target.value)}>{statusOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}</select></div>
                            <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Risk Level</label><select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" value={formData.riskLevel || ''} onChange={(e) => handleChange('riskLevel', e.target.value)}>{Object.values(RiskLevel).map((r: string) => <option key={r} value={r}>{r}</option>)}</select></div><div><label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Assigned To</label><select disabled={!canEdit} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" value={formData.assignedTo || ''} onChange={(e) => handleChange('assignedTo', e.target.value)}><option value="">-- Unassigned --</option>{usersList.map((u: any) => <option key={u.id} value={u.username}>{u.fullName}</option>)}</select></div></div>
                             <div className="grid grid-cols-2 gap-4">
                                 <div>
                                     <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Section <Tooltip text="The specific legal section under CGST/SGST Act. Format: Alphanumeric."/></label>
                                     <input disabled={!canEdit} type="text" value={formData.section || ''} onChange={(e) => handleChange('section', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                                 </div>
                                 <div>
                                     <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Period <Tooltip text="The Financial Year relevant to this notice."/></label>
                                     <select 
                                        disabled={!canEdit} 
                                        value={formData.period || ''} 
                                        onChange={(e) => handleChange('period', e.target.value)} 
                                        className="w-full p-2.5 border border-slate-300 rounded-lg bg-white disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none"
                                     >
                                        <option value="">Select Period</option>
                                        {finalPeriodOptions.map((p: string) => <option key={p} value={p}>{p}</option>)}
                                     </select>
                                 </div>
                             </div>
                             <div className="grid grid-cols-2 gap-4">
                                 <div>
                                     <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Last Checked Date <Tooltip text="Review date for SLA tracking."/></label>
                                     <div className="flex gap-2">
                                         <input 
                                            disabled={!canEdit} 
                                            type="date" 
                                            value={formData.lastCheckedDate || ''} 
                                            onChange={(e) => handleChange('lastCheckedDate', e.target.value)} 
                                            className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" 
                                         />
                                         {canEdit && (
                                             <button 
                                                type="button" 
                                                onClick={handleMarkAsChecked}
                                                className="p-2.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                                                title="Mark as Checked Today"
                                             >
                                                 <CheckSquare size={18} />
                                             </button>
                                         )}
                                     </div>
                                 </div>
                                 <div>
                                     <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Budgeted Hours <Tooltip text="Estimated time for this notice."/></label>
                                     <input 
                                        type="number" 
                                        min="0"
                                        step="0.5"
                                        disabled={!canEdit} 
                                        value={formData.budgetedHours || ''} 
                                        onChange={(e) => handleChange('budgetedHours', parseFloat(e.target.value))} 
                                        className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" 
                                        placeholder="Plan (e.g. 10.0)"
                                     />
                                 </div>
                             </div>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Date of Issue <Tooltip text="Date on the notice document."/></label>
                            <input disabled={!canEdit} type="date" value={formData.dateOfIssue || ''} onChange={(e) => handleChange('dateOfIssue', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                        <div>
                            <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Due Date <Tooltip text="Deadline for reply or payment."/></label>
                            <input disabled={!canEdit} type="date" value={formData.dueDate || ''} onChange={(e) => handleChange('dueDate', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-slate-700 flex items-center gap-1 mb-1">Description</label>
                        <textarea disabled={!canEdit} value={formData.description || ''} onChange={(e) => handleChange('description', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg h-32 resize-none disabled:bg-slate-100 focus:ring-2 focus:ring-blue-500 outline-none" />
                    </div>
                </div>
            )}

            {activeTab === 'time' && (
                <div className="animate-in fade-in duration-300 space-y-8">
                    <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                        <div className="flex justify-between items-end mb-4">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Time Budget Analysis</h3>
                                <p className="text-sm text-slate-500">Track actual hours worked against planned budget.</p>
                            </div>
                            <div className="text-right">
                                <p className="text-2xl font-bold text-blue-700">{totalHoursWorked.toFixed(1)} <span className="text-sm font-normal text-slate-500">/ {formData.budgetedHours || 0} Hours</span></p>
                            </div>
                        </div>
                        
                        <div className="h-4 w-full bg-slate-100 rounded-full overflow-hidden">
                            <div 
                                className={`h-full transition-all duration-500 ${progressPercent > 100 ? 'bg-red-500' : progressPercent > 80 ? 'bg-amber-500' : 'bg-blue-500'}`} 
                                style={{width: `${Math.min(progressPercent, 100)}%`}}
                            ></div>
                        </div>
                        {progressPercent > 100 && (
                            <p className="text-xs text-red-600 mt-2 font-medium flex items-center gap-1"><AlertCircle size={12}/> Budget exceeded by {((totalHoursWorked - (formData.budgetedHours || 0))).toFixed(1)} hours.</p>
                        )}
                    </div>

                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-bold text-slate-800">Work Logs</h3>
                        {canEdit && (
                            <button onClick={handleAddQuickLog} className="flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm hover:bg-slate-700 font-medium transition-colors">
                                <Plus size={16}/> Quick Log
                            </button>
                        )}
                    </div>

                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold border-b">
                                <tr>
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">User</th>
                                    <th className="px-4 py-3">Description</th>
                                    <th className="px-4 py-3 text-right">Hours</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {timeLogs?.map(log => (
                                    <tr key={log.id}>
                                        <td className="px-4 py-3 font-medium text-slate-700">{formatDate(log.date)}</td>
                                        <td className="px-4 py-3 text-slate-600">{log.teamMember}</td>
                                        <td className="px-4 py-3 text-slate-600">{log.description}</td>
                                        <td className="px-4 py-3 text-right font-bold">{log.hoursSpent}</td>
                                    </tr>
                                ))}
                                {!timeLogs?.length && <tr><td colSpan={4} className="text-center py-6 text-slate-400">No time logs recorded.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {activeTab === 'hearings' && (
                <div className="animate-in fade-in duration-300 space-y-6">
                    <div className="flex justify-between items-center">
                        <div><h3 className="text-lg font-bold text-slate-800">Personal Hearings</h3><p className="text-sm text-slate-500">Track hearing dates, adjournments, and proceedings.</p></div>
                        {canEdit && <button onClick={() => { setCurrentHearing({ type: 'Personal Hearing', date: new Date().toISOString().split('T')[0], time: '11:00', status: HearingStatus.SCHEDULED, minutes: '' }); setShowHearingModal(true); }} className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 flex items-center gap-2 shadow-sm transition-all"><Plus size={16}/> Schedule Hearing</button>}
                    </div>
                    <div className="space-y-4">
                        {hearings?.map((hearing) => (
                            <div key={hearing.id} className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow relative">
                                <div className="flex flex-col md:flex-row justify-between md:items-start gap-4 mb-3">
                                    <div className="flex gap-4">
                                        <div className={`flex flex-col items-center justify-center w-16 h-16 rounded-xl text-white shadow-sm ${hearing.status === HearingStatus.CONCLUDED ? 'bg-green-600' : hearing.status === HearingStatus.ADJOURNED ? 'bg-amber-500' : hearing.status === HearingStatus.CANCELLED ? 'bg-red-500' : 'bg-purple-600'}`}>
                                            <span className="text-xs font-bold uppercase">{new Date(hearing.date).toLocaleString('default', {month:'short'})}</span>
                                            <span className="text-2xl font-bold">{new Date(hearing.date).getDate()}</span>
                                        </div>
                                        <div>
                                            <h4 className="font-bold text-slate-800 text-lg flex items-center gap-2">{hearing.type} <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full border ${hearing.status === HearingStatus.CONCLUDED ? 'bg-green-50 text-green-700 border-green-200' : hearing.status === HearingStatus.ADJOURNED ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>{hearing.status}</span></h4>
                                            <div className="flex flex-wrap gap-4 text-sm text-slate-600 mt-1"><div className="flex items-center gap-1"><Clock size={14}/> {hearing.time}</div><div className="flex items-center gap-1"><MapPin size={14}/> {hearing.venue}</div></div>
                                        </div>
                                    </div>
                                    <div className="flex gap-2">{canEdit && (<><button onClick={() => handleEditHearing(hearing)} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><Edit size={16}/></button><button onClick={() => handleDeleteHearing(hearing.id!)} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={16}/></button></>)}</div>
                                </div>
                                {hearing.attendees && <div className="mb-3 flex items-start gap-2"><span className="text-xs font-bold text-slate-500 uppercase mt-0.5">Attendees:</span><p className="text-sm text-slate-700">{hearing.attendees}</p></div>}
                                <div className="bg-slate-50 p-3 rounded-lg border border-slate-100"><span className="text-xs font-bold text-slate-500 uppercase block mb-1">Minutes / Outcome:</span><p className="text-sm text-slate-700 whitespace-pre-line">{hearing.minutes || 'No notes recorded.'}</p></div>
                            </div>
                        ))}
                        {hearings?.length === 0 && <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300"><Gavel size={48} className="mx-auto text-slate-300 mb-3"/><p className="text-slate-500 font-medium">No hearings scheduled yet.</p></div>}
                    </div>
                </div>
            )}

            {activeTab === 'defects' && (
                <div className="animate-in fade-in duration-300 space-y-8">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                         <div className="bg-red-50 p-5 rounded-2xl border border-red-100 flex justify-between items-center shadow-sm"><div><p className="text-red-600 font-bold text-sm uppercase tracking-wider">Active Demand <Tooltip text="Total tax + interest + penalty (Excluding Waived)."/></p><p className="text-3xl font-bold text-red-700 mt-1">{formatCurrency(formData.demandAmount || 0)}</p></div><div className="p-3 bg-red-100 rounded-xl text-red-600"><IndianRupee size={28} /></div></div>
                         <div className="bg-green-50 p-5 rounded-2xl border border-green-100 flex justify-between items-center shadow-sm"><div><p className="text-green-600 font-bold text-sm uppercase tracking-wider">Total Paid</p><p className="text-3xl font-bold text-green-700 mt-1">{formatCurrency(payments?.reduce((acc, p) => acc + p.amount, 0) || 0)}</p></div><div className="p-3 bg-green-100 rounded-xl text-green-600"><Wallet size={28} /></div></div>
                    </div>
                    <div>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-lg font-bold text-slate-800">Defect Breakdown</h3>
                            <div className="flex gap-2">
                                {canEdit && (
                                    <>
                                        <button onClick={handleUpdateInterestTillToday} className="flex items-center gap-2 bg-white border border-slate-300 text-slate-700 px-3 py-2 rounded-lg text-sm hover:bg-slate-50 font-medium transition-colors"><Calculator size={16}/> Calculate Interest to Date</button>
                                        <button onClick={() => { setCurrentDefect({ defectType: '', section: '', description: '', igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead } }); setShowDefectModal(true); }} className="flex items-center gap-2 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm hover:bg-slate-700 font-medium transition-colors"><Plus size={16} /> Add Defect</button>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="space-y-4">
                            {defects?.map(defect => {
                                const isWaived = defect.status === 'Waived';
                                const defectPayments = payments?.filter(p => p.defectId === defect.id);
                                const totalPaid = defectPayments?.reduce((sum, p) => sum + p.amount, 0) || 0;
                                const rowSum = (h: TaxHeadValues) => (h?.tax || 0) + (h?.interest || 0) + (h?.penalty || 0) + (h?.lateFee || 0) + (h?.others || 0);
                                const defectTotal = rowSum(defect.igst) + rowSum(defect.cgst) + rowSum(defect.sgst) + rowSum(defect.cess);
                                const balance = isWaived ? 0 : Math.max(0, defectTotal - totalPaid);

                                return (
                                    <div key={defect.id} className={`border rounded-xl overflow-hidden shadow-sm transition-shadow hover:shadow-md ${isWaived ? 'border-green-200 bg-green-50/10' : 'border-slate-200 bg-white'}`}>
                                        <div className={`px-5 py-4 border-b flex justify-between items-start ${isWaived ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'}`}>
                                            <div>
                                                <div className="font-bold text-slate-800 flex items-center gap-2 text-base">
                                                    {defect.defectType} 
                                                    <span className="text-xs bg-slate-200 px-2 py-0.5 rounded text-slate-600 border border-slate-300 font-medium">{defect.section}</span>
                                                    {isWaived && <span className="text-xs bg-green-200 text-green-800 px-2 py-0.5 rounded font-bold border border-green-300">WAIVED</span>}
                                                </div>
                                                <p className="text-sm text-slate-600 mt-1">{defect.description}</p>
                                                {isWaived && (
                                                    <div className="text-xs text-green-700 mt-2 p-2 bg-green-100 rounded border border-green-200 font-medium">
                                                        <strong>Waived on {formatDate(defect.waiverDate)}</strong>: {defect.waiverReason}
                                                    </div>
                                                )}
                                            </div>
                                            {canEdit && (
                                                <div className="flex gap-1">
                                                    {!isWaived && (
                                                        <button onClick={() => handleOpenWaiverModal(defect.id!)} className="text-slate-400 hover:text-green-600 p-2 rounded hover:bg-green-50 transition-colors" title="Waive Demand (Reply Accepted)">
                                                            <ShieldCheck size={18}/>
                                                        </button>
                                                    )}
                                                    <button onClick={() => handleEditDefect(defect)} className="text-slate-400 hover:text-blue-500 p-2 rounded hover:bg-blue-50 transition-colors"><Edit size={18}/></button>
                                                    <button onClick={() => handleDeleteDefect(defect.id!)} className="text-slate-400 hover:text-red-500 p-2 rounded hover:bg-red-50 transition-colors"><Trash2 size={18} /></button>
                                                </div>
                                            )}
                                        </div>
                                        <div className="p-0 overflow-x-auto"><table className="w-full text-sm text-right border-collapse"><thead className="text-xs text-slate-500 bg-slate-50/50 border-b"><tr><th className="py-2 px-4 text-left">Head</th><th className="px-4">Tax</th><th className="px-4">Interest</th><th className="px-4">Penalty</th><th className="px-4">Late Fee</th><th className="px-4 font-bold bg-slate-50">Total</th></tr></thead><tbody className={`divide-y divide-slate-100 text-slate-700 text-xs ${isWaived ? 'line-through opacity-50' : ''}`}>{['igst', 'cgst', 'sgst', 'cess'].map(h => { const r = (defect as any)[h]; const t = rowSum(r); return t > 0 ? <tr key={h}><td className="py-2 px-4 text-left uppercase font-bold text-slate-500">{h}</td><td className="px-4">{formatCurrency(r.tax)}</td><td className="px-4">{formatCurrency(r.interest)}</td><td className="px-4">{formatCurrency(r.penalty)}</td><td className="px-4">{formatCurrency(r.lateFee)}</td><td className="px-4 font-bold bg-slate-50 text-slate-800">{formatCurrency(t)}</td></tr> : null; })}</tbody><tfoot className="border-t border-slate-200 bg-slate-50 text-slate-900 font-bold"><tr><td className="py-3 px-4 text-left">Total {isWaived ? 'Original' : 'Active'} Demand: {formatCurrency(defectTotal)}</td><td colSpan={5} className="py-3 px-4 text-right text-base">Balance: <span className={balance > 0 ? "text-red-600" : "text-green-600"}>{formatCurrency(balance)}</span></td></tr></tfoot></table></div>
                                        {!isWaived && (
                                            <div className="p-4 bg-slate-50/30 border-t border-slate-200"><div className="flex justify-between items-center mb-2"><h4 className="text-xs font-bold uppercase text-slate-500 tracking-wide">Payments Recorded</h4>{canEdit && <button onClick={() => { setSelectedDefectId(defect.id); setShowPaymentModal(true); }} className="text-xs text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1 hover:underline"><Plus size={12}/> Record Payment</button>}</div>{defectPayments?.length ? (<div className="space-y-1">{defectPayments.map(p => <div key={p.id} className="text-xs flex justify-between text-slate-600 border-b border-slate-200 pb-1.5 items-center last:border-0"><span><span className="font-bold text-slate-700">{formatDate(p.paymentDate)}</span> • {p.majorHead} {p.minorHead}</span><div className="flex items-center gap-3"><span className="font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded border border-green-100">{formatCurrency(p.amount)}</span>{canEdit && <div className="flex gap-1"><button onClick={() => openEditPayment(p)} className="text-slate-400 hover:text-blue-500 p-0.5"><Edit size={12}/></button><button onClick={() => handleDeletePayment(p.id!)} className="text-slate-400 hover:text-red-500 p-0.5"><Trash2 size={12}/></button></div>}</div></div>)}</div>) : <p className="text-xs text-slate-400 italic">No payments recorded for this defect.</p>}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
            
            {activeTab === 'history' && (
                <div className="animate-in fade-in duration-300">
                    <div className="mb-6 flex justify-between items-center"><h3 className="text-lg font-bold text-slate-800">Unified Case History</h3><button onClick={exportHistoryPDF} className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded-lg flex items-center gap-2 hover:bg-slate-50 font-medium transition-colors"><FileDown size={14}/> Export PDF</button></div>
                    {!formData.arn ? <div className="bg-amber-50 border border-amber-200 rounded-xl p-8 text-center text-amber-800">Case ID Missing. Events cannot be linked.</div> : <div className="relative border-l-2 border-slate-200 ml-4 space-y-8 py-2">{timelineEvents?.map((item) => (<div key={item.id} className="relative pl-8"><div className={`absolute -left-[11px] top-0 w-6 h-6 rounded-full border-4 border-white shadow-sm flex items-center justify-center ${item.type === 'NOTICE' ? 'bg-blue-600' : item.type === 'PAYMENT' ? 'bg-green-500' : item.type === 'HEARING' ? 'bg-purple-500' : item.type === 'REPLY' ? 'bg-amber-500' : 'bg-slate-400'}`}></div><div className="rounded-xl border border-slate-200 p-5 bg-white shadow-sm hover:shadow-md transition-shadow"><div className="flex justify-between mb-1"><span className="text-xs font-bold uppercase text-slate-500 tracking-wide">{item.type}</span><span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded">{formatDate(item.date.toISOString())}</span></div><h4 className="font-bold text-slate-800 text-sm mt-1">{item.title}</h4><p className="text-xs text-slate-600 font-medium">{item.subtitle}</p>{item.details && <p className="text-xs text-slate-500 mt-2 border-t border-slate-100 pt-2 leading-relaxed">{item.details}</p>}</div></div>))}</div>}
                </div>
            )}
            
            {activeTab === 'audit' && (
                 <div className="animate-in fade-in duration-300"><div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm"><table className="w-full text-sm text-left"><thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b font-bold"><tr><th className="px-6 py-3">Time</th><th className="px-6 py-3">User</th><th className="px-6 py-3">Action</th><th className="px-6 py-3">Details</th></tr></thead><tbody className="divide-y divide-slate-100">{auditLogs?.map(log => (<tr key={log.id} className="hover:bg-slate-50 transition-colors"><td className="px-6 py-3 text-slate-600 text-xs">{new Date(log.timestamp).toLocaleString()}</td><td className="px-6 py-3 font-medium">{log.user}</td><td className="px-6 py-3"><span className="px-2 py-0.5 rounded text-xs bg-slate-100 font-medium text-slate-700">{log.action}</span></td><td className="px-6 py-3 text-slate-500 truncate max-w-md" title={log.details}>{formatLogDetails(log.details)}</td></tr>))}</tbody></table></div></div>
            )}
            
            {activeTab === 'documents' && (
                <div className="animate-in fade-in duration-300 space-y-6">
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
                                            <span className="bg-slate-100 px-2 py-0.5 rounded border border-slate-200 font-medium">{doc.category}</span>
                                            <span>{(doc.size / 1024).toFixed(1)} KB</span>
                                            <span>{formatDate(doc.uploadDate)}</span>
                                        </div>
                                        {doc.ocrText && <p className="text-xs text-slate-400 mt-1 truncate max-w-md italic">OCR Content available</p>}
                                    </div>
                                    <div className="flex gap-2 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button onClick={() => openOCRModal(doc)} className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg border border-transparent hover:border-blue-100 transition-colors" title="View/Edit OCR Text">
                                            <ScanText size={18}/>
                                        </button>
                                        <button onClick={() => downloadFile(doc)} className="p-2 text-slate-500 hover:text-green-600 hover:bg-green-50 rounded-lg border border-transparent hover:border-green-100 transition-colors" title="Download">
                                            <Download size={18}/>
                                        </button>
                                        {canDelete && (
                                            <button onClick={() => deleteDocument(doc.id!)} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg border border-transparent hover:border-red-100 transition-colors" title="Delete">
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
        </div>
      </div>

      {showHearingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95">
                  <div className="p-5 border-b bg-slate-50 flex justify-between items-center rounded-t-2xl">
                      <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><Gavel className="text-purple-600"/> {currentHearing.id ? 'Edit Hearing' : 'Schedule Hearing'}</h3>
                      <button onClick={() => setShowHearingModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>
                  <form onSubmit={handleSaveHearing} className="p-6 space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                              <label className="block text-sm font-bold text-slate-700 mb-1">Date <span className="text-red-500">*</span></label>
                              <input type="date" required value={currentHearing.date || ''} onChange={e => setCurrentHearing({...currentHearing, date: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"/>
                          </div>
                          <div>
                              <label className="block text-sm font-bold text-slate-700 mb-1">Time <span className="text-red-500">*</span></label>
                              <input type="time" required value={currentHearing.time || ''} onChange={e => setCurrentHearing({...currentHearing, time: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"/>
                          </div>
                          <div>
                              <label className="block text-sm font-bold text-slate-700 mb-1">Type</label>
                              <select value={currentHearing.type || 'Personal Hearing'} onChange={e => setCurrentHearing({...currentHearing, type: e.target.value as any})} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-purple-500">
                                  <option>Personal Hearing</option>
                                  <option>Adjournment</option>
                                  <option>Final Hearing</option>
                              </select>
                          </div>
                          <div>
                              <label className="block text-sm font-bold text-slate-700 mb-1">Status</label>
                              <select value={currentHearing.status || HearingStatus.SCHEDULED} onChange={e => setCurrentHearing({...currentHearing, status: e.target.value as any})} className="w-full p-2.5 border border-slate-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-purple-500">
                                  {Object.values(HearingStatus).map(s => <option key={s} value={s}>{s}</option>)}
                              </select>
                          </div>
                      </div>
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Venue / Mode</label>
                          <input type="text" placeholder="e.g. Room 302, Virtual (Zoom)" value={currentHearing.venue || ''} onChange={e => setCurrentHearing({...currentHearing, venue: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"/>
                      </div>
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Attendees (Staff / Client)</label>
                          <input type="text" placeholder="Who will attend?" value={currentHearing.attendees || ''} onChange={e => setCurrentHearing({...currentHearing, attendees: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-purple-500"/>
                      </div>
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-1">Minutes / Outcome</label>
                          <textarea placeholder="Record discussion points or order details here..." value={currentHearing.minutes || ''} onChange={e => setCurrentHearing({...currentHearing, minutes: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg h-32 resize-none outline-none focus:ring-2 focus:ring-purple-500"/>
                      </div>
                      <div className="flex justify-end pt-2">
                          <button type="submit" className="bg-purple-600 text-white px-6 py-2.5 rounded-lg font-medium hover:bg-purple-700 shadow-sm transition-all">Save Hearing</button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {showOCRModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl animate-in zoom-in-95 flex flex-col max-h-[90vh]">
                  <div className="p-5 border-b bg-slate-50 flex justify-between items-center rounded-t-2xl">
                      <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2"><ScanText className="text-blue-600"/> OCR Text Extraction</h3>
                      <button onClick={() => setShowOCRModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>
                  <div className="p-6 flex-1 overflow-hidden flex flex-col">
                      <div className="mb-4">
                          <p className="text-sm font-bold text-slate-700">Filename: <span className="font-normal">{currentDocForOCR?.fileName}</span></p>
                          <p className="text-xs text-slate-500 mt-1">Extract text to make this document searchable.</p>
                      </div>
                      <textarea 
                          className="flex-1 w-full p-4 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none resize-none mb-4"
                          placeholder="Extracted text will appear here..."
                          value={ocrTextBuffer}
                          onChange={(e) => setOcrTextBuffer(e.target.value)}
                      />
                      <div className="flex justify-between items-center">
                          <button onClick={simulateOCR} className="text-sm text-blue-600 font-bold hover:underline">Auto-Extract (Simulated)</button>
                          <div className="flex gap-3">
                              <button onClick={() => setShowOCRModal(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg font-medium">Cancel</button>
                              <button onClick={saveOCRText} className="px-4 py-2 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded-lg shadow-sm font-medium">Save Text</button>
                          </div>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {showSyncModal && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"><div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md animate-in zoom-in-95"><h3 className="font-bold text-lg mb-4 text-slate-800">Sync Linked Notices</h3><div className="space-y-3 mb-6"><label className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer"><input type="checkbox" checked={syncOptions.gstin} onChange={e => setSyncOptions({...syncOptions, gstin: e.target.checked})} className="w-5 h-5 rounded text-blue-600"/> <span className="text-sm font-medium">Taxpayer Details</span></label><label className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer"><input type="checkbox" checked={syncOptions.riskLevel} onChange={e => setSyncOptions({...syncOptions, riskLevel: e.target.checked})} className="w-5 h-5 rounded text-blue-600"/> <span className="text-sm font-medium">Risk Level</span></label><label className="flex items-center gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer"><input type="checkbox" checked={syncOptions.status} onChange={e => setSyncOptions({...syncOptions, status: e.target.checked})} className="w-5 h-5 rounded text-blue-600"/> <span className="text-sm font-medium">Status</span></label></div><div className="flex justify-end gap-3"><button onClick={() => setShowSyncModal(false)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">Cancel</button><button onClick={executeSync} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm">Sync Now</button></div></div></div>)}
      
      {showDefectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl p-8 max-h-[90vh] overflow-y-auto animate-in zoom-in-95">
            <h3 className="font-bold text-xl mb-6 text-slate-800">{currentDefect.id ? 'Edit Defect' : 'Add New Defect'}</h3>
            <form onSubmit={handleSaveDefect}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div>
                  <label className="text-sm font-bold block mb-1.5 text-slate-700">Defect Type</label>
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
                  <label className="text-sm font-bold block mb-1.5 text-slate-700">Section / Act</label>
                  <input 
                    className="w-full border border-slate-300 p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                    value={currentDefect.section} 
                    onChange={e => setCurrentDefect({...currentDefect, section: e.target.value})}
                    placeholder="e.g. Section 16(2)(c)"
                  />
                </div>
                <div className="md:col-span-2">
                   <label className="text-sm font-bold block mb-1.5 text-slate-700">Description / Remarks</label>
                   <textarea 
                     className="w-full border border-slate-300 p-2.5 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none h-24" 
                     value={currentDefect.description} 
                     onChange={e => setCurrentDefect({...currentDefect, description: e.target.value})}
                     placeholder="Brief description of the discrepancy..."
                   />
                </div>
              </div>

              <div className="mb-6 border border-blue-100 bg-blue-50/50 rounded-xl overflow-hidden">
                  <div 
                    className="bg-blue-50 px-5 py-3 border-b border-blue-100 flex justify-between items-center cursor-pointer"
                    onClick={() => setShowCalculator(!showCalculator)}
                  >
                      <h4 className="text-sm font-bold text-blue-800 flex items-center gap-2"><Calculator size={16}/> Interest Calculator</h4>
                      <span className="text-xs text-blue-600 font-medium">{showCalculator ? 'Hide' : 'Show'}</span>
                  </div>
                  {showCalculator && (
                      <div className="p-5 grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                          <div>
                              <label className="text-xs font-bold text-slate-600 block mb-1 uppercase">From Date</label>
                              <input type="date" value={calcFromDate} onChange={e => setCalcFromDate(e.target.value)} className="w-full p-2 text-sm border border-blue-200 rounded-lg bg-white"/>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-600 block mb-1 uppercase">To Date</label>
                              <input type="date" value={calcToDate} onChange={e => setCalcToDate(e.target.value)} className="w-full p-2 text-sm border border-blue-200 rounded-lg bg-white"/>
                          </div>
                          <div>
                              <label className="text-xs font-bold text-slate-600 block mb-1 uppercase">Rate (%)</label>
                              <input type="number" value={calcRate} onChange={e => setCalcRate(parseFloat(e.target.value))} className="w-full p-2 text-sm border border-blue-200 rounded-lg bg-white"/>
                          </div>
                          <button type="button" onClick={calculateModalInterest} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 shadow-sm transition-all h-[38px]">Calculate & Apply</button>
                      </div>
                  )}
              </div>

              <div className="border rounded-xl overflow-hidden mb-6 shadow-sm">
                <div className="bg-slate-50 px-5 py-3 border-b border-slate-200">
                    <h4 className="text-sm font-bold text-slate-700">Demand Details</h4>
                </div>
                <table className="w-full text-sm">
                    <thead className="bg-white text-slate-500 text-xs uppercase font-bold border-b border-slate-100">
                        <tr>
                            <th className="px-5 py-3 text-left">Head</th>
                            <th className="px-2 py-3 text-right">Tax</th>
                            <th className="px-2 py-3 text-right">Interest</th>
                            <th className="px-2 py-3 text-right">Penalty</th>
                            <th className="px-2 py-3 text-right">Late Fee</th>
                            <th className="px-2 py-3 text-right">Others</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {(['igst', 'cgst', 'sgst', 'cess'] as const).map(head => (
                            <tr key={head} className="hover:bg-slate-50 transition-colors">
                                <td className="px-5 py-2.5 font-bold text-slate-600 uppercase">{head}</td>
                                {['tax', 'interest', 'penalty', 'lateFee', 'others'].map((field) => (
                                    <td key={field} className="px-2 py-2">
                                        <input 
                                            type="number" 
                                            className="w-full text-right p-2 border border-slate-200 rounded focus:border-blue-500 outline-none text-slate-800 font-mono text-sm transition-all focus:ring-1 focus:ring-blue-500"
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

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowDefectModal(false)} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" className="px-6 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-bold hover:bg-blue-700 shadow-sm transition-colors flex items-center gap-2"><Save size={18}/> {currentDefect.id ? 'Update Defect' : 'Add Defect'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {showWaiverModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><ShieldCheck className="text-green-600"/> Waive Demand</h3>
                      <button onClick={() => setShowWaiverModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                  </div>
                  <form onSubmit={handleWaiveDefect}>
                      <div className="mb-4">
                          <label className="block text-sm font-bold text-slate-700 mb-1">Waiver Date</label>
                          <input type="date" required value={waiverDetails.date} onChange={e => setWaiverDetails({...waiverDetails, date: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-green-500"/>
                      </div>
                      <div className="mb-6">
                          <label className="block text-sm font-bold text-slate-700 mb-1">Reason / Order Details</label>
                          <textarea required value={waiverDetails.reason} onChange={e => setWaiverDetails({...waiverDetails, reason: e.target.value})} className="w-full p-2.5 border border-slate-300 rounded-lg h-24 resize-none outline-none focus:ring-2 focus:ring-green-500" placeholder="e.g. Reply accepted vide Order No..."/>
                      </div>
                      <div className="flex justify-end gap-3">
                          <button type="button" onClick={() => setShowWaiverModal(false)} className="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">Cancel</button>
                          <button type="submit" className="px-6 py-2 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 shadow-sm transition-colors">Confirm Waiver</button>
                      </div>
                  </form>
              </div>
          </div>
      )}

      {showPaymentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl p-8 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-6">
                <h3 className="font-bold text-xl text-slate-800 flex items-center gap-2">
                <Wallet className="text-green-600" /> Record Payment
                </h3>
                <button onClick={() => setShowPaymentModal(false)}>
                <X size={20} className="text-slate-400 hover:text-slate-600" />
                </button>
            </div>
            <form onSubmit={handleSavePaymentMatrix}>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 bg-slate-50 p-5 rounded-xl border border-slate-200">
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Payment Date</label>
                    <input type="date" required className="w-full p-2 border border-slate-300 rounded-lg text-sm bg-white" value={paymentMatrix.paymentDate} onChange={e => setPaymentMatrix({...paymentMatrix, paymentDate: e.target.value})} />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Challan / CPIN No</label>
                    <input type="text" required className="w-full p-2 border border-slate-300 rounded-lg text-sm" placeholder="CPIN..." value={paymentMatrix.challanNumber} onChange={e => setPaymentMatrix({...paymentMatrix, challanNumber: e.target.value})} />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Bank Name</label>
                    <input type="text" className="w-full p-2 border border-slate-300 rounded-lg text-sm" placeholder="HDFC, SBI..." value={paymentMatrix.bankName} onChange={e => setPaymentMatrix({...paymentMatrix, bankName: e.target.value})} />
                </div>
                <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Ref / CIN</label>
                    <input type="text" className="w-full p-2 border border-slate-300 rounded-lg text-sm" placeholder="Reference #" value={paymentMatrix.refNumber} onChange={e => setPaymentMatrix({...paymentMatrix, refNumber: e.target.value})} />
                </div>
                </div>

                <div className="border border-slate-200 rounded-xl overflow-hidden mb-6 shadow-sm">
                <table className="w-full text-sm">
                    <thead className="bg-slate-100 text-slate-600 text-xs uppercase font-bold">
                    <tr>
                        <th className="px-5 py-3 text-left">Head</th>
                        <th className="px-2 py-3 text-right text-blue-700">Tax</th>
                        <th className="px-2 py-3 text-right text-amber-700">Interest</th>
                        <th className="px-2 py-3 text-right text-red-700">Penalty</th>
                        <th className="px-2 py-3 text-right text-purple-700">Late Fee</th>
                        <th className="px-2 py-3 text-right text-slate-700">Others</th>
                    </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                    {(['igst', 'cgst', 'sgst', 'cess'] as const).map(head => (
                        <tr key={head} className="hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-2 font-bold text-slate-700 uppercase">{head}</td>
                        {['tax', 'interest', 'penalty', 'lateFee', 'others'].map((field) => (
                            <td key={field} className="px-2 py-2">
                            <input 
                                type="number" 
                                min="0"
                                className="w-full text-right p-2 border border-slate-200 rounded focus:border-blue-500 outline-none focus:ring-1 focus:ring-blue-200 transition-all font-mono text-sm"
                                placeholder="0"
                                value={(paymentMatrix as any)[head]?.[field] || ''}
                                onChange={e => handlePaymentMatrixChange(head, field as any, parseFloat(e.target.value) || 0)}
                                onFocus={e => e.target.select()}
                            />
                            </td>
                        ))}
                        </tr>
                    ))}
                    </tbody>
                </table>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setShowPaymentModal(false)} className="px-5 py-2.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-50 transition-colors">Cancel</button>
                <button type="submit" className="px-6 py-2.5 bg-green-600 text-white rounded-lg text-sm font-bold hover:bg-green-700 shadow-sm transition-colors flex items-center gap-2">
                    <Save size={18} /> Record Payment
                </button>
                </div>
            </form>
            </div>
        </div>
        )}
    </div>
  );
};

export default NoticeDetail;
