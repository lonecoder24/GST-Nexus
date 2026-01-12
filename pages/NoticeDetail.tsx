
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Notice, NoticeStatus, RiskLevel, NoticeDefect, PaymentLog, TaxHeadValues, Taxpayer, MajorTaxHead, MinorTaxHead } from '../types';
import { Save, ArrowLeft, Clock, FileText, Plus, Trash2, IndianRupee, Wallet, Calculator, Calendar, Building, Info, HelpCircle, History, RefreshCw, FileDown, Activity, ClipboardList, ChevronUp, ChevronDown, Filter, CreditCard, AlertCircle, Phone, Mail, MapPin, Edit, X, CheckSquare, Square } from 'lucide-react';
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
        // Handle specific object types if recognized, else generic summary
        if (obj.gstin && obj.noticeNumber) {
            return `Details updated for Notice ${obj.noticeNumber}`; // Generic JSON dump fallback
        }
        // If it's a diff object or simple JSON
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
  const { user } = useAuth();
  const isNew = id === 'new';
  const noticeId = isNew ? undefined : parseInt(id!);
  
  const [activeTab, setActiveTab] = useState<'info' | 'defects' | 'timeline' | 'audit'>('info');
  const [loading, setLoading] = useState(!isNew);
  const [gstinError, setGstinError] = useState('');
  const [timelineFilter, setTimelineFilter] = useState<'ALL' | 'MAJOR'>('MAJOR');
  
  const [formData, setFormData] = useState<Partial<Notice>>({
    status: NoticeStatus.RECEIVED, riskLevel: RiskLevel.MEDIUM, demandAmount: 0, tags: []
  });

  const configTypes = useLiveQuery(() => db.appConfig.get({key: 'notice_types'}));
  const configStatuses = useLiveQuery(() => db.appConfig.get({key: 'notice_statuses'}));
  const configDefectTypes = useLiveQuery(() => db.appConfig.get({key: 'defect_types'}));
  const typeOptions = configTypes?.value || [];
  const statusOptions = configStatuses?.value || Object.values(NoticeStatus);
  const defectTypeOptions = configDefectTypes?.value || [];
  
  // Fetch Taxpayers for Dropdown
  const taxpayersList = useLiveQuery(() => db.taxpayers.orderBy('tradeName').toArray()) || [];
  // Fetch active users for assignment
  const usersList = useLiveQuery(() => db.users.filter(u => u.isActive === true).toArray()) || [];

  const defects = useLiveQuery(() => noticeId ? db.defects.where('noticeId').equals(noticeId).toArray() : [], [noticeId]);
  const payments = useLiveQuery(() => noticeId ? db.payments.where('noticeId').equals(noticeId).toArray() : [], [noticeId]);
  
  const auditLogs = useLiveQuery(async () => {
      if (noticeId) return await db.auditLogs.where('entityId').equals(noticeId).and(l => l.entityType === 'Notice').reverse().toArray();
      return [];
  }, [noticeId]);

  // Unified Timeline Query
  const timelineEvents = useLiveQuery(async () => {
      if (!formData.arn) return [];
      const relatedNotices = await db.notices.where('arn').equals(formData.arn).toArray();
      const events: TimelineEvent[] = [];

      for (const n of relatedNotices) {
          // 1. Notice Creation
          events.push({
              id: `notice-${n.id}`,
              date: new Date(n.dateOfIssue),
              type: 'NOTICE',
              title: `${n.noticeType} Issued`,
              subtitle: n.noticeNumber,
              status: n.status,
              refId: n.id!,
              risk: n.riskLevel,
              details: n.description
          });

          // 2. Payments linked to this notice
          const payLogs = await db.payments.where('noticeId').equals(n.id!).toArray();
          payLogs.forEach(p => {
              events.push({
                  id: `pay-${p.id}`,
                  date: new Date(p.paymentDate),
                  type: 'PAYMENT',
                  title: 'Payment Recorded',
                  subtitle: `${p.majorHead} - ${p.minorHead}`,
                  amount: p.amount,
                  refId: n.id!,
                  details: `Challan: ${p.challanNumber}`
              });
          });

          // 3. Audit Logs (Status Changes & Updates)
          const logs = await db.auditLogs.where('entityType').equals('Notice').and(l => l.entityId === n.id!).toArray();
          logs.forEach(l => {
              if (l.action === 'Create') return; // Skip create as we have Notice event
              events.push({
                  id: `log-${l.id}`,
                  date: new Date(l.timestamp),
                  type: 'LOG',
                  title: `System: ${l.action}`,
                  subtitle: l.user,
                  refId: n.id!,
                  details: formatLogDetails(l.details)
              });
          });
      }

      return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [formData.arn]);

  const [linkedTaxpayer, setLinkedTaxpayer] = useState<Taxpayer | null>(null);
  const [isEditingTaxpayer, setIsEditingTaxpayer] = useState(false);
  const [taxpayerData, setTaxpayerData] = useState<Partial<Taxpayer>>({});

  const [showDefectModal, setShowDefectModal] = useState(false);
  const [currentDefect, setCurrentDefect] = useState<Partial<NoticeDefect>>({
      defectType: '', section: '', description: '',
      igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead }
  });

  const [calcRate, setCalcRate] = useState(18);
  const [calcFromDate, setCalcFromDate] = useState('');
  const [calcToDate, setCalcToDate] = useState(new Date().toISOString().split('T')[0]);
  const [isTillDate, setIsTillDate] = useState(true);
  const [showCalculator, setShowCalculator] = useState(false);

  // Payment Add Modal State
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentMatrix, setPaymentMatrix] = useState<{
      igst: TaxHeadValues; cgst: TaxHeadValues; sgst: TaxHeadValues; cess: TaxHeadValues;
      challanNumber: string; paymentDate: string; bankName: string; refNumber: string;
  }>({
      igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead },
      challanNumber: '', paymentDate: new Date().toISOString().split('T')[0], bankName: '', refNumber: ''
  });
  
  // Payment Edit Modal State
  const [showEditPaymentModal, setShowEditPaymentModal] = useState(false);
  const [editingPayment, setEditingPayment] = useState<PaymentLog | null>(null);
  const [selectedDefectId, setSelectedDefectId] = useState<number | undefined>(undefined);

  // Sync Modal State
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncOptions, setSyncOptions] = useState({
      gstin: true,
      riskLevel: true,
      assignedTo: false,
      status: false
  });

  useEffect(() => {
    if (!isNew && id) {
      db.notices.get(parseInt(id)).then(notice => {
        if (notice) {
            setFormData(notice);
            // Taxpayer fetch is handled in the GSTIN effect below
        }
        setLoading(false);
      });
    }
  }, [id, isNew]);

  useEffect(() => {
      if (formData.gstin) {
          if (formData.gstin.length === 15) {
             if (GSTIN_REGEX.test(formData.gstin)) {
                 setGstinError('');
                 db.taxpayers.where('gstin').equals(formData.gstin).first().then(t => {
                     setLinkedTaxpayer(t || null);
                     if(t) setTaxpayerData(t);
                     else setTaxpayerData({ gstin: formData.gstin, tradeName: '', legalName: '', registeredAddress: '', mobile: '', email: '' });
                 });
             } else {
                 setGstinError('Invalid GSTIN format');
                 setLinkedTaxpayer(null);
             }
          } else {
              setGstinError('GSTIN must be 15 characters');
          }
      }
  }, [formData.gstin]);

  const handleChange = (field: keyof Notice, value: any) => setFormData(prev => ({ ...prev, [field]: value }));

  const handleSaveTaxpayer = async () => {
    if (!formData.gstin) return;
    try {
        if (linkedTaxpayer && linkedTaxpayer.id) {
            await db.taxpayers.update(linkedTaxpayer.id, taxpayerData);
            await db.auditLogs.add({
                entityType: 'Taxpayer',
                entityId: linkedTaxpayer.id,
                action: 'Update',
                timestamp: new Date().toISOString(),
                user: user?.username || 'System',
                details: `Updated details via Notice screen for ${taxpayerData.tradeName}`
            });
            alert('Taxpayer details updated');
        } else {
            // Create new
            const id = await db.taxpayers.add({
                ...taxpayerData,
                gstin: formData.gstin,
                tradeName: taxpayerData.tradeName || 'Unknown',
                legalName: taxpayerData.legalName || '',
                mobile: taxpayerData.mobile || '',
                email: taxpayerData.email || '',
                registeredAddress: taxpayerData.registeredAddress || '',
                stateCode: formData.gstin.substring(0,2)
            } as Taxpayer);
            await db.auditLogs.add({
                entityType: 'Taxpayer',
                entityId: id,
                action: 'Create',
                timestamp: new Date().toISOString(),
                user: user?.username || 'System',
                details: `Created taxpayer ${taxpayerData.tradeName} via Notice screen`
            });
             alert('Taxpayer created and linked');
        }
        // Refresh linked taxpayer
        const t = await db.taxpayers.where('gstin').equals(formData.gstin).first();
        setLinkedTaxpayer(t || null);
        setIsEditingTaxpayer(false);
    } catch (e) {
        console.error(e);
        alert('Error saving taxpayer details');
    }
  };

  const handleSaveNotice = async () => {
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
            // Calculate Diff
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

        await db.auditLogs.add({ 
            entityType: 'Notice', 
            entityId: savedId!, 
            action: logAction as any, 
            timestamp: new Date().toISOString(), 
            user: user?.username || 'System', 
            details: logDetails 
        });

        if(isNew) navigate(`/notices/${savedId}`); else alert('Saved successfully');

    } catch (e) { console.error(e); alert("Error saving notice"); }
  };

  const executeSync = async () => {
      if (!formData.arn) return;
      const linked = await db.notices.where('arn').equals(formData.arn).toArray();
      const targets = linked.filter(n => n.id !== noticeId);
      
      if (targets.length === 0) {
          alert("No other notices linked to this ARN.");
          setShowSyncModal(false);
          return;
      }

      const updates: Partial<Notice> = {};
      const updatedFields: string[] = [];

      if (syncOptions.gstin && formData.gstin) { updates.gstin = formData.gstin; updatedFields.push('GSTIN'); }
      if (syncOptions.riskLevel && formData.riskLevel) { updates.riskLevel = formData.riskLevel; updatedFields.push('Risk Level'); }
      if (syncOptions.assignedTo && formData.assignedTo) { updates.assignedTo = formData.assignedTo; updatedFields.push('Assigned To'); }
      if (syncOptions.status && formData.status) { updates.status = formData.status; updatedFields.push('Status'); }

      if (Object.keys(updates).length === 0) {
          alert("No fields selected for synchronization.");
          return;
      }

      for (const n of targets) {
          await db.notices.update(n.id!, updates);
          await db.auditLogs.add({
               entityType: 'Notice', 
               entityId: n.id!, 
               action: 'Update', 
               timestamp: new Date().toISOString(), 
               user: user?.username || 'System', 
               details: `Synced fields (${updatedFields.join(', ')}) from ARN Master` 
          });
      }
      
      alert(`Successfully updated ${targets.length} linked notices.`);
      setShowSyncModal(false);
  };

  const handleAddDefect = async (e: React.FormEvent) => {
      e.preventDefault();
      const sumField = (field: keyof TaxHeadValues) => (currentDefect.igst?.[field] || 0) + (currentDefect.cgst?.[field] || 0) + (currentDefect.sgst?.[field] || 0) + (currentDefect.cess?.[field] || 0);
      await db.defects.add({
          noticeId: noticeId!, defectType: currentDefect.defectType || 'General', section: currentDefect.section, description: currentDefect.description,
          igst: currentDefect.igst || initialTaxHead, cgst: currentDefect.cgst || initialTaxHead, sgst: currentDefect.sgst || initialTaxHead, cess: currentDefect.cess || initialTaxHead,
          taxDemand: sumField('tax'), interestDemand: sumField('interest'), penaltyDemand: sumField('penalty')
      });
      await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Added Defect: ${currentDefect.defectType}` });
      updateTotalDemand(noticeId!); setShowDefectModal(false); setShowCalculator(false);
      setCurrentDefect({ defectType: '', section: '', description: '', igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead } });
  };

  const handleDeleteDefect = async (id: number) => { 
      if(confirm('Delete?')) { 
          await db.defects.delete(id); 
          await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Deleted Defect #${id}` });
          updateTotalDemand(noticeId!); 
      } 
  };
  
  const updateTotalDemand = async (nId: number) => {
      const all = await db.defects.where('noticeId').equals(nId).toArray();
      const total = all.reduce((acc, d) => {
        const sub = (h: TaxHeadValues) => h.tax + h.interest + h.penalty + h.lateFee + h.others;
        return acc + sub(d.igst) + sub(d.cgst) + sub(d.sgst) + sub(d.cess);
      }, 0);
      await db.notices.update(nId, { demandAmount: total });
      setFormData(prev => ({ ...prev, demandAmount: total }));
  };

  const handleSavePaymentMatrix = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!paymentMatrix.challanNumber) { alert("Challan Number is required"); return; }
      const heads: MajorTaxHead[] = ['IGST', 'CGST', 'SGST', 'Cess'];
      const fields: (keyof TaxHeadValues)[] = ['tax', 'interest', 'penalty', 'lateFee', 'others'];
      const minorMap: Record<string, MinorTaxHead> = { tax: 'Tax', interest: 'Interest', penalty: 'Penalty', lateFee: 'Late Fee', others: 'Others' };

      let count = 0;
      for (const h of heads) {
          const headKey = h.toLowerCase() as 'igst' | 'cgst' | 'sgst' | 'cess';
          for (const f of fields) {
              const amount = paymentMatrix[headKey][f];
              if (amount > 0) {
                  await db.payments.add({
                      noticeId: noticeId!, defectId: selectedDefectId, majorHead: h, minorHead: minorMap[f], amount: amount,
                      challanNumber: paymentMatrix.challanNumber, paymentReferenceNumber: paymentMatrix.refNumber, paymentDate: paymentMatrix.paymentDate, bankName: paymentMatrix.bankName
                  });
                  count++;
              }
          }
      }
      if (count > 0) {
          await db.auditLogs.add({ entityType: 'Notice', entityId: noticeId!, action: 'Update', timestamp: new Date().toISOString(), user: user?.username || 'System', details: `Recorded ${count} payment entries (Challan: ${paymentMatrix.challanNumber})` });
          setShowPaymentModal(false);
          setPaymentMatrix({ igst: { ...initialTaxHead }, cgst: { ...initialTaxHead }, sgst: { ...initialTaxHead }, cess: { ...initialTaxHead }, challanNumber: '', paymentDate: new Date().toISOString().split('T')[0], bankName: '', refNumber: '' });
      } else alert("Enter at least one amount");
  };

  const handleUpdatePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPayment || !editingPayment.id) return;
    
    try {
        await db.payments.update(editingPayment.id, editingPayment);
        await db.auditLogs.add({
            entityType: 'Notice',
            entityId: noticeId!,
            action: 'Update',
            timestamp: new Date().toISOString(),
            user: user?.username || 'System',
            details: `Updated payment record #${editingPayment.id}: Amount ${editingPayment.amount}`
        });
        setShowEditPaymentModal(false);
        setEditingPayment(null);
    } catch (err) {
        console.error(err);
        alert('Error updating payment');
    }
  };

  const handleDeletePayment = async (payId: number) => {
      if(confirm('Are you sure you want to delete this payment record?')) {
          await db.payments.delete(payId);
          await db.auditLogs.add({
              entityType: 'Notice',
              entityId: noticeId!,
              action: 'Update',
              timestamp: new Date().toISOString(),
              user: user?.username || 'System',
              details: `Deleted payment record #${payId}`
          });
      }
  };

  const openEditPayment = (payment: PaymentLog) => {
      setEditingPayment({...payment});
      setShowEditPaymentModal(true);
  };

  const exportHistoryPDF = () => {
      const doc = new jsPDF();
      doc.setFontSize(18); doc.text(`Case Timeline - ID: ${formData.arn}`, 14, 20);
      doc.setFontSize(10); doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 28);
      
      // Filter based on current view
      const filtered = timelineEvents?.filter(e => timelineFilter === 'ALL' || e.type !== 'LOG') || [];

      const tableData = filtered.map(item => [
          item.date.toISOString().split('T')[0], 
          item.type, 
          item.title, 
          item.subtitle || '', 
          formatLogDetails(item.details || '')
      ]);
      autoTable(doc, { startY: 35, head: [['Date', 'Type', 'Event', 'User/Ref', 'Details']], body: tableData });
      doc.save(`CaseTimeline_${formData.arn}.pdf`);
  };

  const handleDefectMatrixChange = (head: 'igst' | 'cgst' | 'sgst' | 'cess', field: keyof TaxHeadValues, value: number) => {
      setCurrentDefect(prev => ({ ...prev, [head]: { ...prev[head], [field]: value } }));
  };
  const handlePaymentMatrixChange = (head: 'igst' | 'cgst' | 'sgst' | 'cess', field: keyof TaxHeadValues, value: number) => {
      setPaymentMatrix(prev => ({ ...prev, [head]: { ...prev[head], [field]: value } }));
  };
  const calculateInterest = () => {
      if (!calcFromDate) return;
      const days = Math.ceil(Math.abs((isTillDate ? new Date() : new Date(calcToDate)).getTime() - new Date(calcFromDate).getTime()) / (86400000)); 
      const calc = (tax: number) => Math.round((tax * calcRate * days) / (36500));
      setCurrentDefect(prev => ({ ...prev, igst: { ...prev.igst!, interest: calc(prev.igst?.tax || 0) }, cgst: { ...prev.cgst!, interest: calc(prev.cgst?.tax || 0) }, sgst: { ...prev.sgst!, interest: calc(prev.sgst?.tax || 0) }, cess: { ...prev.cess!, interest: calc(prev.cess?.tax || 0) } }));
  };
  const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

  if (loading) return <div className="p-8 text-center text-slate-500">Loading...</div>;

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-10">
      <div className="flex items-center justify-between">
        <button onClick={() => navigate('/notices')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800"><ArrowLeft size={18} /> Back</button>
        <button onClick={handleSaveNotice} className="flex items-center gap-2 bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 shadow-sm"><Save size={18} /> Save</button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200 bg-slate-50/50">
            {[
                {id: 'info', icon: FileText, label: 'Notice Info'},
                {id: 'defects', icon: Wallet, label: 'Defects & Payments'},
                {id: 'timeline', icon: History, label: 'Case Timeline'},
                {id: 'audit', icon: Activity, label: 'Audit Trail'}
            ].map(tab => (
                 <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} disabled={isNew && tab.id !== 'info'} className={`flex-1 py-4 text-sm font-medium border-b-2 transition-colors flex items-center justify-center gap-2 ${activeTab === tab.id ? 'border-blue-500 text-blue-600 bg-white' : 'border-transparent text-slate-500 hover:bg-slate-100'} ${(isNew && tab.id !== 'info') ? 'opacity-50' : ''}`}>
                     <tab.icon size={16}/> {tab.label}
                 </button>
            ))}
        </div>

        <div className="p-8">
            {activeTab === 'info' && (
                <div className="space-y-6 animate-in fade-in duration-300">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Select Taxpayer (GSTIN) <span className="text-red-500">*</span> <Tooltip text="Select the client entity for this notice. The GSTIN identifies the taxpayer." /></label>
                                <div className="flex gap-2">
                                    <select 
                                        value={formData.gstin || ''} 
                                        onChange={(e) => handleChange('gstin', e.target.value)} 
                                        className={`flex-1 p-2.5 border rounded-lg bg-white ${gstinError ? 'border-red-300' : 'border-slate-300'}`}
                                    >
                                        <option value="">-- Select Client --</option>
                                        {taxpayersList.map(t => (
                                            <option key={t.id} value={t.gstin}>{t.tradeName} - {t.gstin}</option>
                                        ))}
                                    </select>
                                    <Link to="/taxpayers/new" className="bg-slate-100 border border-slate-300 text-slate-600 p-2.5 rounded-lg hover:bg-slate-200" title="Add New Taxpayer">
                                        <Plus size={20}/>
                                    </Link>
                                </div>
                                {gstinError && <span className="text-xs text-red-500 mt-1 block">{gstinError}</span>}
                            </div>
                            
                            {/* Integrated Taxpayer Details Section */}
                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-2">
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="font-semibold text-slate-700 flex items-center gap-2 text-sm"><Building size={16}/> Taxpayer Details</h4>
                                    <button onClick={() => setIsEditingTaxpayer(!isEditingTaxpayer)} className="text-xs text-blue-600 hover:underline">{isEditingTaxpayer ? 'Cancel' : (linkedTaxpayer ? 'Edit' : 'Add Details')}</button>
                                </div>
                                
                                {isEditingTaxpayer ? (
                                    <div className="space-y-3 animate-in fade-in duration-200">
                                         <div>
                                            <label className="text-xs text-slate-500 font-medium block mb-1">Trade Name <Tooltip text="Registered Trade Name as per GST Portal"/></label>
                                            <input placeholder="Trade Name" value={taxpayerData.tradeName || ''} onChange={e => setTaxpayerData({...taxpayerData, tradeName: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
                                         </div>
                                         <div>
                                            <label className="text-xs text-slate-500 font-medium block mb-1">Legal Name <Tooltip text="Legal Name as per PAN Card"/></label>
                                            <input placeholder="Legal Name" value={taxpayerData.legalName || ''} onChange={e => setTaxpayerData({...taxpayerData, legalName: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
                                         </div>
                                         <div>
                                            <label className="text-xs text-slate-500 font-medium block mb-1">Address <Tooltip text="Principal Place of Business"/></label>
                                            <textarea placeholder="Registered Address" value={taxpayerData.registeredAddress || ''} onChange={e => setTaxpayerData({...taxpayerData, registeredAddress: e.target.value})} className="w-full p-2 border rounded text-sm h-16 resize-none bg-white" />
                                         </div>
                                         <div className="grid grid-cols-2 gap-2">
                                             <div>
                                                 <label className="text-xs text-slate-500 font-medium block mb-1">Mobile <Tooltip text="Authorized Signatory Mobile"/></label>
                                                 <input placeholder="Mobile" value={taxpayerData.mobile || ''} onChange={e => setTaxpayerData({...taxpayerData, mobile: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
                                             </div>
                                             <div>
                                                 <label className="text-xs text-slate-500 font-medium block mb-1">Email <Tooltip text="Official Email ID for alerts"/></label>
                                                 <input placeholder="Email" value={taxpayerData.email || ''} onChange={e => setTaxpayerData({...taxpayerData, email: e.target.value})} className="w-full p-2 border rounded text-sm bg-white" />
                                             </div>
                                         </div>
                                         <button onClick={handleSaveTaxpayer} className="w-full bg-blue-600 text-white py-1.5 rounded text-sm hover:bg-blue-700">Save Taxpayer Details</button>
                                    </div>
                                ) : (
                                    linkedTaxpayer ? (
                                        <div className="text-sm space-y-1">
                                            <p className="font-bold text-slate-800">{linkedTaxpayer.tradeName}</p>
                                            <p className="text-slate-500 text-xs">{linkedTaxpayer.legalName}</p>
                                            <div className="flex items-start gap-2 text-slate-600 mt-2">
                                                <MapPin size={14} className="mt-0.5 text-slate-400 shrink-0"/>
                                                <span className="text-xs">{linkedTaxpayer.registeredAddress || 'No Address'}</span>
                                            </div>
                                            <div className="flex items-center gap-4 mt-1">
                                                <span className="flex items-center gap-1 text-xs text-slate-600"><Phone size={12} className="text-slate-400"/> {linkedTaxpayer.mobile || 'N/A'}</span>
                                                <span className="flex items-center gap-1 text-xs text-slate-600"><Mail size={12} className="text-slate-400"/> {linkedTaxpayer.email || 'N/A'}</span>
                                            </div>
                                            <div className="mt-2 pt-2 border-t border-slate-200">
                                                 <Link to={`/taxpayers/${linkedTaxpayer.id}`} className="text-xs text-blue-600 hover:underline flex items-center gap-1">View Full Profile <ArrowLeft size={10} className="rotate-180"/></Link>
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic">No taxpayer linked. Select a client from the dropdown or click '+' to add.</p>
                                    )
                                )}
                            </div>

                            <div>
                                <div className="flex justify-between">
                                    <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
                                        Case ID (ARN) <Tooltip text="Application Reference Number used to group related notices (e.g., SCN, DRC-01, Orders)." />
                                    </label>
                                    {!isNew && formData.arn && <button onClick={() => setShowSyncModal(true)} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><RefreshCw size={12}/> Sync Linked</button>}
                                </div>
                                <input type="text" value={formData.arn || ''} onChange={(e) => handleChange('arn', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg" placeholder="ARN / Case Reference" />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Current Status <Tooltip text="Current stage of the notice in the workflow (e.g., Received, Hearing Scheduled)." /></label>
                                <select className="w-full p-2.5 border border-slate-300 rounded-lg bg-white" value={formData.status || ''} onChange={(e) => handleChange('status', e.target.value)}>{statusOptions.map((s: string) => <option key={s} value={s}>{s}</option>)}</select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Risk Level <Tooltip text="Assess potential financial or legal impact."/></label>
                                    <select className="w-full p-2.5 border border-slate-300 rounded-lg bg-white" value={formData.riskLevel || ''} onChange={(e) => handleChange('riskLevel', e.target.value)}>
                                        {Object.values(RiskLevel).map((r: string) => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">Assigned To <Tooltip text="Team member responsible for this notice."/></label>
                                    <select className="w-full p-2.5 border border-slate-300 rounded-lg bg-white" value={formData.assignedTo || ''} onChange={(e) => handleChange('assignedTo', e.target.value)}>
                                        <option value="">-- Unassigned --</option>
                                        {usersList.map((u: any) => <option key={u.id} value={u.username}>{u.fullName}</option>)}
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
                                    Notice Number <span className="text-red-500">*</span> <Tooltip text="Specific Document Identification Number (DIN) or Reference Number on the notice."/>
                                </label>
                                <input type="text" value={formData.noticeNumber || ''} onChange={(e) => handleChange('noticeNumber', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg" />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
                                    Notice Type <Tooltip text="Category of the notice (e.g., ASMT-10, DRC-01, SCN)."/>
                                </label>
                                <select className="w-full p-2.5 border border-slate-300 rounded-lg bg-white" value={formData.noticeType || ''} onChange={(e) => handleChange('noticeType', e.target.value)}><option value="">Select Type</option>{typeOptions.map((t: string) => <option key={t} value={t}>{t}</option>)}</select>
                            </div>
                             <div className="grid grid-cols-2 gap-4">
                                 <div>
                                     <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
                                         Section <Tooltip text="Relevant GST Act Section (e.g., Sec 61 for Scrutiny, Sec 73/74 for Demand)."/>
                                     </label>
                                     <input type="text" value={formData.section || ''} onChange={(e) => handleChange('section', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg" />
                                 </div>
                                 <div>
                                     <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
                                         Period <Tooltip text="Financial Year or Tax Period covered (e.g., FY 2017-18, July 2017)."/>
                                     </label>
                                     <input type="text" value={formData.period || ''} onChange={(e) => handleChange('period', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg" />
                                 </div>
                             </div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
                                Date of Issue <Tooltip text="Date printed on the notice."/>
                            </label>
                            <input type="date" value={formData.dateOfIssue || ''} onChange={(e) => handleChange('dateOfIssue', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
                                Due Date <Tooltip text="Deadline for reply or compliance."/>
                            </label>
                            <input type="date" value={formData.dueDate || ''} onChange={(e) => handleChange('dueDate', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-700 flex items-center gap-1">
                            Description <Tooltip text="Brief summary of the allegations or requirements."/>
                        </label>
                        <textarea value={formData.description || ''} onChange={(e) => handleChange('description', e.target.value)} className="w-full p-2.5 border border-slate-300 rounded-lg h-32 resize-none" />
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
                        <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-slate-800">Defect Breakdown</h3><button onClick={() => setShowDefectModal(true)} className="flex items-center gap-2 bg-slate-800 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-slate-700"><Plus size={16} /> Add Defect</button></div>
                        <div className="space-y-4">
                            {defects?.map(defect => {
                                const defectPayments = payments?.filter(p => p.defectId === defect.id);
                                const totalPaid = defectPayments?.reduce((sum, p) => sum + p.amount, 0) || 0;
                                const rowSum = (h: TaxHeadValues) => (h?.tax || 0) + (h?.interest || 0) + (h?.penalty || 0) + (h?.lateFee || 0) + (h?.others || 0);
                                const defectTotal = rowSum(defect.igst) + rowSum(defect.cgst) + rowSum(defect.sgst) + rowSum(defect.cess);
                                return (
                                    <div key={defect.id} className="border border-slate-200 rounded-xl overflow-hidden bg-white shadow-sm">
                                        <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex justify-between items-start"><div><div className="font-semibold text-slate-800 flex items-center gap-2">{defect.defectType} <span className="text-xs bg-slate-200 px-2 py-0.5 rounded text-slate-600">{defect.section}</span></div><p className="text-sm text-slate-500 mt-1">{defect.description}</p></div><button onClick={() => handleDeleteDefect(defect.id!)} className="text-slate-400 hover:text-red-500 p-1"><Trash2 size={16} /></button></div>
                                        <div className="p-4 overflow-x-auto"><table className="w-full text-sm text-right border-collapse"><thead className="text-xs text-slate-500 bg-slate-50/50 border-b"><tr><th className="py-2 px-2 text-left">Head</th><th className="px-2">Tax <Tooltip text="Principal Tax Amount"/></th><th className="px-2">Interest <Tooltip text="Sec 50 Interest"/></th><th className="px-2">Penalty <Tooltip text="Sec 122/73/74"/></th><th className="px-2">Late Fee <Tooltip text="Sec 47"/></th><th className="px-2">Total</th></tr></thead><tbody className="divide-y divide-slate-100 text-slate-700 text-xs">{['igst', 'cgst', 'sgst', 'cess'].map(h => { const r = (defect as any)[h]; const t = rowSum(r); return t > 0 ? <tr key={h}><td className="py-2 px-2 text-left uppercase">{h}</td><td>{r.tax}</td><td>{r.interest}</td><td>{r.penalty}</td><td>{r.lateFee}</td><td className="font-medium bg-slate-50">{t}</td></tr> : null; })}</tbody><tfoot className="border-t border-slate-200 bg-slate-50 text-slate-900 font-semibold"><tr><td className="py-2 px-2 text-left">Total Demand: {formatCurrency(defectTotal)}</td><td colSpan={5} className="py-2 px-2 text-right">Balance: {formatCurrency(defectTotal - totalPaid)}</td></tr></tfoot></table></div>
                                        <div className="p-4 bg-slate-50/50 border-t border-slate-200"><div className="flex justify-between items-center mb-2"><h4 className="text-xs font-semibold uppercase text-slate-500">Payments</h4><button onClick={() => { setSelectedDefectId(defect.id); setShowPaymentModal(true); }} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Plus size={12}/> Record Payment</button></div>{defectPayments?.length ? (<div className="space-y-1">{defectPayments.map(p => <div key={p.id} className="text-xs flex justify-between text-slate-600 border-b border-slate-100 pb-1 items-center"><span>{p.paymentDate} • {p.majorHead} {p.minorHead}</span><div className="flex items-center gap-3"><span className="font-medium">{formatCurrency(p.amount)}</span><div className="flex gap-1"><button onClick={() => openEditPayment(p)} className="text-slate-400 hover:text-blue-500 p-0.5"><Edit size={12}/></button><button onClick={() => handleDeletePayment(p.id!)} className="text-slate-400 hover:text-red-500 p-0.5"><Trash2 size={12}/></button></div></div></div>)}</div>) : <p className="text-xs text-slate-400 italic">No payments.</p>}</div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
            
            {activeTab === 'timeline' && (
                <div className="animate-in fade-in duration-300">
                    <div className="mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">Unified Case Timeline</h3>
                            <p className="text-sm text-slate-500">Events for Case ID: <span className="font-mono text-slate-800 font-semibold">{formData.arn || 'N/A'}</span></p>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={() => setTimelineFilter(timelineFilter === 'ALL' ? 'MAJOR' : 'ALL')} className={`text-xs px-3 py-1.5 rounded flex items-center gap-2 border ${timelineFilter === 'ALL' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                                <Filter size={14}/> {timelineFilter === 'ALL' ? 'Show Major Events' : 'Show All Logs'}
                            </button>
                            <button onClick={exportHistoryPDF} className="text-xs bg-white border border-slate-300 px-3 py-1.5 rounded flex items-center gap-2 hover:bg-slate-50">
                                <FileDown size={14}/> Export PDF
                            </button>
                        </div>
                    </div>

                    {!formData.arn ? (
                        <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 text-center text-amber-800">
                            <AlertCircle className="mx-auto mb-2" size={24}/>
                            <p className="font-medium">Case ID (ARN) Missing</p>
                            <p className="text-sm opacity-80 mt-1">Please enter a Case ID in the 'Notice Info' tab to enable timeline tracking.</p>
                        </div>
                    ) : (
                        <div className="relative border-l-2 border-slate-200 ml-4 space-y-0">
                            {timelineEvents
                                ?.filter(e => timelineFilter === 'ALL' || e.type !== 'LOG')
                                .map((item) => (
                                <div key={item.id} className="relative pl-8 pb-8 last:pb-0">
                                    <div className={`absolute -left-[11px] top-0 w-6 h-6 rounded-full border-4 border-white shadow-sm flex items-center justify-center
                                        ${item.type === 'NOTICE' ? (item.refId === noticeId ? 'bg-blue-600' : 'bg-slate-400') : 
                                          item.type === 'PAYMENT' ? 'bg-green-500' : 'bg-slate-300'}`}>
                                          {item.type === 'NOTICE' && <FileText size={12} className="text-white"/>}
                                          {item.type === 'PAYMENT' && <CreditCard size={12} className="text-white"/>}
                                          {item.type === 'LOG' && <Activity size={12} className="text-white"/>}
                                    </div>
                                    
                                    <div className={`rounded-xl border p-4 transition-all hover:shadow-md ${
                                        item.refId === noticeId && item.type === 'NOTICE' ? 'bg-blue-50/50 border-blue-200' : 'bg-white border-slate-200'
                                    }`}>
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="flex items-center gap-2">
                                                <span className={`text-xs font-bold px-2 py-0.5 rounded uppercase ${
                                                    item.type === 'NOTICE' ? 'bg-blue-100 text-blue-700' :
                                                    item.type === 'PAYMENT' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'
                                                }`}>{item.type}</span>
                                                <span className="text-xs text-slate-400 flex items-center gap-1"><Clock size={12}/> {item.date.toLocaleDateString()} {item.date.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                            </div>
                                            {item.type === 'NOTICE' && item.refId !== noticeId && (
                                                <button onClick={() => navigate(`/notices/${item.refId}`)} className="text-xs text-blue-600 hover:underline">View Notice</button>
                                            )}
                                        </div>
                                        
                                        <h4 className="font-bold text-slate-800 text-sm mt-1">{item.title}</h4>
                                        {item.subtitle && <p className="text-xs text-slate-600 font-mono mt-0.5">{item.subtitle}</p>}
                                        
                                        {item.amount && (
                                            <p className="text-sm font-bold text-green-700 mt-1">{formatCurrency(item.amount)}</p>
                                        )}
                                        
                                        {item.status && (
                                            <div className="mt-2">
                                                <span className="text-[10px] uppercase font-bold text-slate-500">Status: </span>
                                                <span className="text-xs font-medium text-slate-700">{item.status}</span>
                                            </div>
                                        )}

                                        {item.details && (
                                            <p className="text-xs text-slate-500 mt-2 bg-slate-50 p-2 rounded border border-slate-100 italic">
                                                {formatLogDetails(item.details)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            ))}
                            {timelineEvents?.length === 0 && <p className="text-slate-400 pl-8 italic">No events found for this Case ID.</p>}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'audit' && (
                <div className="animate-in fade-in duration-300">
                    <div className="flex items-center gap-2 mb-6"><ClipboardList className="text-slate-400"/><h3 className="text-lg font-bold text-slate-800">Detailed Audit Trail</h3></div>
                    <div className="overflow-hidden border border-slate-200 rounded-xl">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-slate-50 text-slate-500 uppercase text-xs border-b border-slate-200"><tr><th className="px-6 py-3">Timestamp</th><th className="px-6 py-3">User</th><th className="px-6 py-3">Action</th><th className="px-6 py-3">Details</th></tr></thead>
                            <tbody className="divide-y divide-slate-100">
                                {auditLogs?.map(log => (
                                    <tr key={log.id} className="hover:bg-slate-50">
                                        <td className="px-6 py-3 whitespace-nowrap text-slate-600"><div className="flex items-center gap-2"><Clock size={14} className="text-slate-400"/> {new Date(log.timestamp).toLocaleString()}</div></td>
                                        <td className="px-6 py-3 font-medium text-slate-800">{log.user}</td>
                                        <td className="px-6 py-3"><span className={`px-2 py-0.5 rounded text-xs font-semibold ${log.action === 'Create' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>{log.action}</span></td>
                                        <td className="px-6 py-3"><div className="truncate max-w-md text-slate-500" title={log.details}>{formatLogDetails(log.details)}</div></td>
                                    </tr>
                                ))}
                                {auditLogs?.length === 0 && <tr><td colSpan={4} className="px-6 py-8 text-center text-slate-400">No activity recorded yet.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
      </div>

      {/* Sync Modal */}
      {showSyncModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-4">
                      <h3 className="font-bold text-lg text-slate-800 flex items-center gap-2">
                          <RefreshCw size={20} className="text-blue-600"/> Sync Linked Notices
                      </h3>
                      <button onClick={() => setShowSyncModal(false)} className="text-slate-400 hover:text-slate-600">
                          <X size={20} />
                      </button>
                  </div>
                  
                  <div className="space-y-4">
                      <p className="text-sm text-slate-600">
                          Select fields to synchronize from this notice to all other notices linked to Case ID <span className="font-mono font-semibold text-slate-800">{formData.arn}</span>.
                      </p>
                      
                      <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-3">
                          <label className="flex items-center gap-3 cursor-pointer">
                              <input type="checkbox" checked={syncOptions.gstin} onChange={e => setSyncOptions({...syncOptions, gstin: e.target.checked})} className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                              <span className="text-sm font-medium text-slate-700">Taxpayer Details (GSTIN)</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                              <input type="checkbox" checked={syncOptions.riskLevel} onChange={e => setSyncOptions({...syncOptions, riskLevel: e.target.checked})} className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                              <span className="text-sm font-medium text-slate-700">Risk Level</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                              <input type="checkbox" checked={syncOptions.assignedTo} onChange={e => setSyncOptions({...syncOptions, assignedTo: e.target.checked})} className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                              <span className="text-sm font-medium text-slate-700">Assigned Team Member</span>
                          </label>
                          <label className="flex items-center gap-3 cursor-pointer">
                              <input type="checkbox" checked={syncOptions.status} onChange={e => setSyncOptions({...syncOptions, status: e.target.checked})} className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500" />
                              <span className="text-sm font-medium text-slate-700">Notice Status</span>
                          </label>
                      </div>

                      <div className="flex justify-end gap-3 pt-2">
                          <button onClick={() => setShowSyncModal(false)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
                          <button onClick={executeSync} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm">Sync Now</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      {/* Add Defect Modal */}
      {showDefectModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95">
                  <div className="p-5 border-b bg-slate-50 flex justify-between items-center sticky top-0 bg-slate-50 z-10"><h3 className="font-bold text-lg text-slate-800">Add New Defect</h3><button onClick={() => setShowDefectModal(false)} className="text-slate-400 hover:text-slate-600"><Plus size={24} className="rotate-45" /></button></div>
                  <form onSubmit={handleAddDefect} className="p-6 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="block text-xs font-medium text-slate-500 mb-1">Defect Type</label><select required className="w-full p-2 border border-slate-300 rounded text-sm bg-white" value={currentDefect.defectType} onChange={e => setCurrentDefect({...currentDefect, defectType: e.target.value})}><option value="">Select Defect Type</option>{defectTypeOptions.map((type: string) => <option key={type} value={type}>{type}</option>)}</select></div><div><label className="block text-xs font-medium text-slate-500 mb-1">Section</label><input type="text" className="w-full p-2 border border-slate-300 rounded text-sm" value={currentDefect.section} onChange={e => setCurrentDefect({...currentDefect, section: e.target.value})} /></div><div className="md:col-span-2"><label className="block text-xs font-medium text-slate-500 mb-1">Description</label><input type="text" className="w-full p-2 border border-slate-300 rounded text-sm" value={currentDefect.description} onChange={e => setCurrentDefect({...currentDefect, description: e.target.value})} /></div></div>
                      <div className="bg-blue-50 p-4 rounded-lg border border-blue-100"><button type="button" onClick={() => setShowCalculator(!showCalculator)} className="flex items-center gap-2 text-blue-700 font-medium text-sm"><Calculator size={16} /> Interest Calculator {showCalculator ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}</button>{showCalculator && <div className="mt-4 grid grid-cols-1 sm:grid-cols-4 gap-4 items-end animate-in fade-in slide-in-from-top-2"><div><label className="block text-xs font-medium text-slate-500 mb-1">From</label><input type="date" value={calcFromDate} onChange={(e) => setCalcFromDate(e.target.value)} className="w-full p-2 border border-blue-200 rounded text-sm" /></div><div><label className="block text-xs font-medium text-slate-500 mb-1">To</label><input type="date" disabled={isTillDate} value={isTillDate ? new Date().toISOString().split('T')[0] : calcToDate} onChange={(e) => setCalcToDate(e.target.value)} className="w-full p-2 border border-blue-200 rounded text-sm disabled:bg-slate-100" /></div><div className="flex items-center gap-2 pb-2"><input type="checkbox" checked={isTillDate} onChange={(e) => setIsTillDate(e.target.checked)} className="rounded border-blue-300" /><label className="text-xs text-slate-700">Till Today</label></div><div className="flex gap-2"><div className="w-20"><label className="block text-xs font-medium text-slate-500 mb-1">Rate %</label><input type="number" value={calcRate} onChange={(e) => setCalcRate(parseFloat(e.target.value))} className="w-full p-2 border border-blue-200 rounded text-sm" /></div><button type="button" onClick={calculateInterest} className="flex-1 bg-blue-600 text-white rounded text-sm font-medium">Apply</button></div></div>}</div>
                      <div>
                          <label className="block text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                              Demand Quantification 
                              <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded">Enter amounts for relevant tax heads</span>
                          </label>
                          <div className="overflow-x-auto border border-slate-200 rounded-lg">
                              <table className="w-full text-sm text-center">
                                  <thead className="bg-slate-100 text-slate-600 text-xs uppercase font-semibold">
                                      <tr>
                                          <th className="py-3 px-2 text-left w-24">Head</th>
                                          <th className="py-3 px-2">Tax <Tooltip text="Principal Tax Demand amount"/></th>
                                          <th className="py-3 px-2">Interest <Tooltip text="Applicable Interest u/s 50"/></th>
                                          <th className="py-3 px-2">Penalty <Tooltip text="Penalty u/s 122, 73, or 74"/></th>
                                          <th className="py-3 px-2">Late Fee <Tooltip text="Late fees u/s 47"/></th>
                                          <th className="py-3 px-2">Others <Tooltip text="Any other dues or cess"/></th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-slate-100">
                                      {(['igst', 'cgst', 'sgst', 'cess'] as const).map((head) => (
                                          <tr key={head} className="hover:bg-slate-50">
                                              <td className="py-2 px-3 text-left font-bold text-slate-700 uppercase">
                                                  {head}
                                                  <Tooltip text={
                                                      head === 'igst' ? 'Integrated Tax (Inter-state)' :
                                                      head === 'cgst' ? 'Central Tax (Intra-state)' :
                                                      head === 'sgst' ? 'State Tax (Intra-state)' :
                                                      'Compensation Cess'
                                                  } />
                                              </td>
                                              {(['tax', 'interest', 'penalty', 'lateFee', 'others'] as const).map((field) => (
                                                  <td key={field} className="p-1">
                                                      <input type="number" className="w-full p-2 border border-slate-200 rounded text-right text-sm focus:border-blue-500 outline-none" placeholder="0" value={(currentDefect as any)[head]?.[field] || ''} onChange={(e) => handleDefectMatrixChange(head as any, field, parseFloat(e.target.value) || 0)} />
                                                  </td>
                                              ))}
                                          </tr>
                                      ))}
                                  </tbody>
                              </table>
                          </div>
                      </div>
                      <div className="pt-4 flex justify-end gap-3 border-t border-slate-100"><button type="button" onClick={() => setShowDefectModal(false)} className="px-5 py-2.5 text-sm text-slate-600 hover:bg-slate-100 rounded-lg font-medium">Cancel</button><button type="submit" className="px-5 py-2.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm">Save Defect</button></div>
                  </form>
              </div>
          </div>
      )}

      {/* Add Payment Modal (Matrix) */}
      {showPaymentModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto animate-in zoom-in-95">
                  <div className="p-5 border-b bg-slate-50 flex justify-between items-center"><h3 className="font-bold text-lg">Record Payment (Matrix)</h3><button onClick={() => setShowPaymentModal(false)}><Plus size={24} className="rotate-45 text-slate-400" /></button></div>
                  <form onSubmit={handleSavePaymentMatrix} className="p-6 space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                          <div><label className="text-xs text-slate-500 font-bold">Challan / CPIN</label><input required className="w-full p-2 border rounded" value={paymentMatrix.challanNumber} onChange={e => setPaymentMatrix({...paymentMatrix, challanNumber: e.target.value})} /></div>
                          <div><label className="text-xs text-slate-500 font-bold">Date</label><input type="date" required className="w-full p-2 border rounded" value={paymentMatrix.paymentDate} onChange={e => setPaymentMatrix({...paymentMatrix, paymentDate: e.target.value})} /></div>
                          <div><label className="text-xs text-slate-500 font-bold">Bank</label><input className="w-full p-2 border rounded" value={paymentMatrix.bankName} onChange={e => setPaymentMatrix({...paymentMatrix, bankName: e.target.value})} /></div>
                          <div><label className="text-xs text-slate-500 font-bold">Ref No</label><input className="w-full p-2 border rounded" value={paymentMatrix.refNumber} onChange={e => setPaymentMatrix({...paymentMatrix, refNumber: e.target.value})} /></div>
                      </div>
                      <div className="overflow-x-auto border rounded-lg">
                          <table className="w-full text-sm text-center">
                              <thead className="bg-slate-100 text-xs uppercase font-semibold"><tr><th className="py-3 text-left pl-3">Head</th><th>Tax <Tooltip text="Principal" /></th><th>Interest <Tooltip text="Sec 50" /></th><th>Penalty <Tooltip text="Sec 122" /></th><th>Late Fee <Tooltip text="Sec 47" /></th><th>Others</th></tr></thead>
                              <tbody className="divide-y divide-slate-100">
                                  {['igst', 'cgst', 'sgst', 'cess'].map((h: any) => (
                                      <tr key={h} className="hover:bg-slate-50"><td className="text-left pl-3 font-bold uppercase">{h}</td>
                                      {['tax', 'interest', 'penalty', 'lateFee', 'others'].map((f: any) => (
                                          <td key={f} className="p-1"><input type="number" className="w-full p-1.5 border rounded text-right text-xs" placeholder="0" value={(paymentMatrix as any)[h][f]} onChange={e => handlePaymentMatrixChange(h, f, parseFloat(e.target.value) || 0)} /></td>
                                      ))}</tr>
                                  ))}
                              </tbody>
                          </table>
                      </div>
                      <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowPaymentModal(false)} className="px-4 py-2 text-sm bg-slate-100 rounded">Cancel</button><button type="submit" className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700">Save Payments</button></div>
                  </form>
              </div>
          </div>
      )}

      {/* Edit Single Payment Modal */}
      {showEditPaymentModal && editingPayment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="font-bold text-lg text-slate-800">Edit Payment Record</h3>
                      <button onClick={() => setShowEditPaymentModal(false)} className="text-slate-400 hover:text-slate-600"><Plus size={24} className="rotate-45" /></button>
                  </div>
                  <form onSubmit={handleUpdatePayment} className="space-y-4">
                      <div className="p-3 bg-slate-50 border border-slate-200 rounded mb-4">
                          <p className="text-xs font-bold text-slate-500 uppercase">Updating Record for</p>
                          <p className="font-medium text-slate-800">{editingPayment.majorHead} - {editingPayment.minorHead}</p>
                      </div>
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">Amount</label>
                          <input type="number" required className="w-full p-2 border rounded-lg" value={editingPayment.amount} onChange={e => setEditingPayment({...editingPayment, amount: parseFloat(e.target.value) || 0})} />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Challan / CPIN</label>
                              <input type="text" required className="w-full p-2 border rounded-lg" value={editingPayment.challanNumber} onChange={e => setEditingPayment({...editingPayment, challanNumber: e.target.value})} />
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Date</label>
                              <input type="date" required className="w-full p-2 border rounded-lg" value={editingPayment.paymentDate} onChange={e => setEditingPayment({...editingPayment, paymentDate: e.target.value})} />
                          </div>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Bank Name</label>
                              <input type="text" className="w-full p-2 border rounded-lg" value={editingPayment.bankName} onChange={e => setEditingPayment({...editingPayment, bankName: e.target.value})} />
                          </div>
                          <div>
                              <label className="block text-sm font-medium text-slate-700 mb-1">Ref Number</label>
                              <input type="text" className="w-full p-2 border rounded-lg" value={editingPayment.paymentReferenceNumber} onChange={e => setEditingPayment({...editingPayment, paymentReferenceNumber: e.target.value})} />
                          </div>
                      </div>
                      
                      <div className="pt-4 flex justify-end gap-3">
                          <button type="button" onClick={() => setShowEditPaymentModal(false)} className="px-4 py-2 text-sm bg-slate-100 rounded-lg hover:bg-slate-200 font-medium">Cancel</button>
                          <button type="submit" className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium shadow-sm">Update Payment</button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};

export default NoticeDetail;
