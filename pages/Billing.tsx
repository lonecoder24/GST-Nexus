
import React, { useState, useMemo, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Invoice, InvoiceStatus, InvoiceItem, UserRole } from '../types';
import { Plus, Printer, Trash2, X, Save, IndianRupee, Clock, CheckCircle, FileText, Download, Calendar, Calculator } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import StatsCard from '../components/StatsCard';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useLocation } from 'react-router-dom';

const Billing: React.FC = () => {
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const location = useLocation();

  // Data Fetching
  const invoices = useLiveQuery(() => db.invoices.reverse().toArray()) || [];
  const taxpayers = useLiveQuery(() => db.taxpayers.orderBy('tradeName').toArray()) || [];
  const activeNotices = useLiveQuery(() => db.notices.where('status').notEqual('Closed').toArray()) || [];

  // Form State
  const initialForm: Partial<Invoice> = {
      invoiceNumber: `INV-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0], // +15 days
      gstin: '',
      status: InvoiceStatus.DRAFT,
      items: [{ description: '', amount: 0 }],
      notes: 'Thank you for your business.'
  };
  const [formData, setFormData] = useState<Partial<Invoice>>(initialForm);

  // Fetch Time Logs for the selected client to show hours worked
  const clientTimeLogs = useLiveQuery(async () => {
      if (!formData.gstin) return [];
      
      // Get all notices for this client (including closed ones if possible, but here we query by GSTIN)
      // Note: timeSheets store noticeId. We need to map noticeId to client.
      // Optimization: Fetch all logs, filter in memory or fetch by notice IDs.
      // Since Dexie doesn't support complex joins easily, we'll iterate.
      
      const clientNotices = await db.notices.where('gstin').equals(formData.gstin).toArray();
      const noticeIds = clientNotices.map(n => n.id!);
      
      const logs = await db.timeSheets.where('noticeId').anyOf(noticeIds).toArray();
      
      // Aggregate hours per notice
      const hoursMap: Record<number, number> = {};
      logs.forEach(log => {
          hoursMap[log.noticeId] = (hoursMap[log.noticeId] || 0) + log.hoursSpent;
      });
      return hoursMap;
  }, [formData.gstin]);

  // Derived Values
  const itemsTotal = useMemo(() => formData.items?.reduce((sum, item) => sum + (item.amount || 0), 0) || 0, [formData.items]);
  const taxAmount = itemsTotal * 0.18; // 18% GST Assumption
  const totalAmount = itemsTotal + taxAmount;

  // Handle incoming invoice generation request from Notice Detail
  useEffect(() => {
      if (location.state?.createFromNotice) {
          const notice = location.state.createFromNotice;
          
          setFormData({
              ...initialForm,
              gstin: notice.gstin,
              items: [{
                  description: `Professional Fees for ${notice.noticeType} - Ref: ${notice.noticeNumber}`,
                  amount: 0,
                  noticeId: notice.id,
                  arn: notice.arn
              }]
          });
          setShowModal(true);
          
          // Clear state to prevent reopening on refresh
          window.history.replaceState({}, document.title);
      }
  }, [location]);

  // Extract unique ARNs / Notices for selected client for dropdown
  const availableNotices = useMemo(() => {
      if (!formData.gstin) return [];
      return activeNotices.filter(n => n.gstin === formData.gstin);
  }, [activeNotices, formData.gstin]);

  // Stats
  const stats = useMemo(() => {
      const totalBilled = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
      const received = invoices.filter(inv => inv.status === InvoiceStatus.PAID).reduce((sum, inv) => sum + inv.totalAmount, 0);
      const pending = invoices.filter(inv => inv.status !== InvoiceStatus.PAID && inv.status !== InvoiceStatus.CANCELLED).reduce((sum, inv) => sum + inv.totalAmount, 0);
      return { totalBilled, received, pending };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
      if (!search) return invoices;
      const lower = search.toLowerCase();
      return invoices.filter(inv => 
          inv.invoiceNumber.toLowerCase().includes(lower) ||
          inv.taxpayerName.toLowerCase().includes(lower) ||
          inv.gstin.toLowerCase().includes(lower)
      );
  }, [invoices, search]);

  // Handlers
  const handleItemChange = (index: number, field: keyof InvoiceItem, value: any) => {
      const newItems = [...(formData.items || [])];
      newItems[index] = { ...newItems[index], [field]: value };
      
      // If noticeId selected via dropdown, try to sync ARN if missing
      if (field === 'noticeId') {
          const notice = availableNotices.find(n => n.id === parseInt(value));
          if (notice) {
              newItems[index].arn = notice.arn;
              if (!newItems[index].description) {
                  newItems[index].description = `Professional Fees - ${notice.noticeType} (${notice.noticeNumber})`;
              }
          }
      }

      setFormData({ ...formData, items: newItems });
  };

  const addItem = () => setFormData({ ...formData, items: [...(formData.items || []), { description: '', amount: 0 }] });
  
  const removeItem = (index: number) => {
      const newItems = [...(formData.items || [])];
      newItems.splice(index, 1);
      setFormData({ ...formData, items: newItems });
  };

  const calculateFeeFromHours = (index: number, hours: number) => {
      const rateStr = prompt("Enter Hourly Rate (₹):", "2500");
      if (rateStr) {
          const rate = parseFloat(rateStr);
          if (!isNaN(rate)) {
              handleItemChange(index, 'amount', hours * rate);
          }
      }
  }

  const handleSave = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData.gstin || !formData.items?.length) {
          alert('Select a Client and add at least one item.');
          return;
      }

      const client = taxpayers.find(t => t.gstin === formData.gstin);
      
      const payload: any = {
          ...formData,
          taxpayerName: client?.tradeName || formData.gstin,
          subTotal: itemsTotal,
          taxAmount,
          totalAmount,
          createdBy: user?.username || 'System'
      };

      if (formData.id) {
          await db.invoices.update(formData.id, payload);
      } else {
          await db.invoices.add(payload);
          await db.auditLogs.add({
              entityType: 'Invoice', entityId: payload.invoiceNumber, action: 'Create', timestamp: new Date().toISOString(),
              user: user?.username || 'System', details: `Created Invoice ${payload.invoiceNumber} for ${payload.taxpayerName}`
          });
      }
      setShowModal(false);
      setFormData(initialForm);
  };

  const deleteInvoice = async (id: number) => {
      if (confirm('Delete this invoice?')) {
          await db.invoices.delete(id);
      }
  };

  const markPaid = async (id: number) => {
      const today = new Date().toISOString().split('T')[0];
      const paymentDate = prompt("Enter Payment Received Date (YYYY-MM-DD):", today);
      
      if (paymentDate) {
          await db.invoices.update(id, { 
              status: InvoiceStatus.PAID,
              paymentDate: paymentDate
          });
          
          await db.auditLogs.add({
              entityType: 'Invoice', entityId: id, action: 'Update', timestamp: new Date().toISOString(),
              user: user?.username || 'System', details: `Marked Invoice #${id} as Paid on ${paymentDate}`
          });
      }
  };

  const generatePDF = (invoice: Invoice) => {
      const doc = new jsPDF();
      const client = taxpayers.find(t => t.gstin === invoice.gstin);

      // Header
      doc.setFontSize(20);
      doc.text("INVOICE", 14, 22);
      doc.setFontSize(10);
      doc.text("GST Nexus Associates", 14, 30);
      doc.text("123, CA Street, Business Park", 14, 35);
      doc.text("Pune, MH - 411001", 14, 40);
      doc.text("GSTIN: 27AAAAA0000A1Z5", 14, 45);

      // Invoice Details (Right Aligned)
      doc.text(`Invoice No: ${invoice.invoiceNumber}`, 140, 30);
      doc.text(`Date: ${invoice.date}`, 140, 35);
      doc.text(`Due Date: ${invoice.dueDate}`, 140, 40);
      doc.text(`Status: ${invoice.status}`, 140, 45);
      if(invoice.paymentDate) doc.text(`Paid On: ${invoice.paymentDate}`, 140, 50);

      // Bill To
      doc.text("Bill To:", 14, 60);
      doc.setFont("helvetica", "bold");
      doc.text(invoice.taxpayerName, 14, 65);
      doc.setFont("helvetica", "normal");
      if (client) {
          doc.text(client.registeredAddress || '', 14, 70, { maxWidth: 80 });
          doc.text(`GSTIN: ${invoice.gstin}`, 14, 85);
      } else {
          doc.text(`GSTIN: ${invoice.gstin}`, 14, 70);
      }

      // Table
      const tableRows = invoice.items.map(item => {
          let desc = item.description;
          if (item.arn) desc += `\n(Case ID: ${item.arn})`;
          return [
              desc,
              new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(item.amount)
          ];
      });

      autoTable(doc, {
          startY: 95,
          head: [['Description', 'Amount']],
          body: tableRows,
          theme: 'grid',
          headStyles: { fillColor: [66, 66, 66] },
          columnStyles: { 1: { halign: 'right' } }
      });

      // Totals
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.text(`Sub Total:`, 140, finalY);
      doc.text(`${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(invoice.subTotal)}`, 190, finalY, { align: 'right' });
      
      doc.text(`GST (18%):`, 140, finalY + 7);
      doc.text(`${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(invoice.taxAmount)}`, 190, finalY + 7, { align: 'right' });
      
      doc.setFont("helvetica", "bold");
      doc.text(`Total Amount:`, 140, finalY + 16);
      doc.text(`${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(invoice.totalAmount)}`, 190, finalY + 16, { align: 'right' });

      // Footer
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.text("Notes:", 14, finalY + 30);
      doc.text(invoice.notes || '', 14, finalY + 35);
      doc.text("Bank Details: HDFC Bank, Acc: 1234567890, IFSC: HDFC0001234", 14, finalY + 45);

      doc.save(`Invoice_${invoice.invoiceNumber}.pdf`);
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(val);

  return (
    <div className="space-y-6 pb-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
                <h2 className="text-2xl font-bold text-slate-800">Billing & Invoices</h2>
                <p className="text-slate-500 text-sm">Manage client invoicing and track collections</p>
            </div>
            <button onClick={() => { setFormData(initialForm); setShowModal(true); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all">
                <Plus size={18} /> Create Invoice
            </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StatsCard title="Total Billed" value={formatCurrency(stats.totalBilled)} icon={FileText} color="blue"/>
            <StatsCard title="Pending / Sent" value={formatCurrency(stats.pending)} icon={Clock} color="amber"/>
            <StatsCard title="Collected" value={formatCurrency(stats.received)} icon={CheckCircle} color="green"/>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
                <input 
                    type="text" 
                    placeholder="Search Invoice..." 
                    className="pl-3 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none w-64"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                />
            </div>
            <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold border-b border-slate-200">
                    <tr>
                        <th className="px-6 py-4">Invoice #</th>
                        <th className="px-6 py-4">Date</th>
                        <th className="px-6 py-4">Client</th>
                        <th className="px-6 py-4 text-right">Amount</th>
                        <th className="px-6 py-4 text-center">Status</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {filteredInvoices.map(inv => (
                        <tr key={inv.id} className="hover:bg-slate-50">
                            <td className="px-6 py-4 font-medium text-slate-800">{inv.invoiceNumber}</td>
                            <td className="px-6 py-4 text-slate-600">
                                <div>{inv.date}</div>
                                <div className="text-[10px] text-slate-400">Due: {inv.dueDate}</div>
                            </td>
                            <td className="px-6 py-4">
                                <div className="font-medium text-slate-800">{inv.taxpayerName}</div>
                                <div className="text-xs text-slate-500 font-mono">{inv.gstin}</div>
                            </td>
                            <td className="px-6 py-4 text-right font-bold text-slate-800">{formatCurrency(inv.totalAmount)}</td>
                            <td className="px-6 py-4 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                                    inv.status === 'Paid' ? 'bg-green-100 text-green-700' :
                                    inv.status === 'Sent' ? 'bg-blue-100 text-blue-700' :
                                    inv.status === 'Cancelled' ? 'bg-red-100 text-red-700' :
                                    'bg-slate-100 text-slate-600'
                                }`}>{inv.status}</span>
                                {inv.paymentDate && <div className="text-[10px] text-green-600 mt-1 flex items-center justify-center gap-1"><Calendar size={10}/> {inv.paymentDate}</div>}
                            </td>
                            <td className="px-6 py-4 text-right flex justify-end gap-2">
                                <button onClick={() => generatePDF(inv)} className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded" title="Download PDF"><Printer size={16}/></button>
                                {inv.status !== 'Paid' && (
                                    <button onClick={() => markPaid(inv.id!)} className="p-1.5 text-slate-500 hover:text-green-600 hover:bg-green-50 rounded" title="Mark as Paid"><IndianRupee size={16}/></button>
                                )}
                                <button onClick={() => deleteInvoice(inv.id!)} className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded" title="Delete"><Trash2 size={16}/></button>
                            </td>
                        </tr>
                    ))}
                    {filteredInvoices.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-slate-400">No invoices found.</td></tr>}
                </tbody>
            </table>
        </div>

        {/* Invoice Modal */}
        {showModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2"><FileText className="text-blue-600"/> New Invoice</h3>
                        <button onClick={() => setShowModal(false)}><X size={20} className="text-slate-400 hover:text-slate-600"/></button>
                    </div>

                    <form onSubmit={handleSave} className="space-y-6">
                        {/* Header Info */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Invoice No</label>
                                <input required type="text" className="w-full p-2 border rounded" value={formData.invoiceNumber} onChange={e => setFormData({...formData, invoiceNumber: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Date</label>
                                <input required type="date" className="w-full p-2 border rounded" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} />
                            </div>
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Due Date</label>
                                <input required type="date" className="w-full p-2 border rounded" value={formData.dueDate} onChange={e => setFormData({...formData, dueDate: e.target.value})} />
                            </div>
                        </div>

                        {/* Client Select */}
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Client (Taxpayer)</label>
                            <select required className="w-full p-2 border rounded bg-white" value={formData.gstin} onChange={e => setFormData({...formData, gstin: e.target.value})}>
                                <option value="">-- Select Client --</option>
                                {taxpayers.map(t => <option key={t.id} value={t.gstin}>{t.tradeName} ({t.gstin})</option>)}
                            </select>
                        </div>

                        {/* Line Items */}
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Line Items</label>
                            <div className="space-y-2">
                                {formData.items?.map((item, idx) => {
                                    const workedHours = item.noticeId && clientTimeLogs ? (clientTimeLogs[item.noticeId] || 0) : 0;
                                    return (
                                        <div key={idx} className="flex gap-2 items-end flex-wrap">
                                            <div className="flex-1 min-w-[200px]">
                                                <input placeholder="Description" className="w-full p-2 border rounded text-sm" value={item.description} onChange={e => handleItemChange(idx, 'description', e.target.value)} required />
                                            </div>
                                            
                                            {/* Link Notice Selector */}
                                            <div className="w-48">
                                                <select className="w-full p-2 border rounded text-sm bg-white" value={item.noticeId || ''} onChange={e => handleItemChange(idx, 'noticeId', e.target.value || undefined)}>
                                                    <option value="">Link Notice...</option>
                                                    {availableNotices.map(n => (
                                                        <option key={n.id} value={n.id}>{n.noticeNumber}</option>
                                                    ))}
                                                </select>
                                                {item.noticeId && (
                                                    <div className="text-[10px] text-blue-600 mt-1 flex items-center gap-1 font-medium">
                                                        <Clock size={10}/> {workedHours} hrs worked
                                                    </div>
                                                )}
                                            </div>

                                            <div className="w-32 relative">
                                                <input type="number" placeholder="Amount" className="w-full p-2 border rounded text-sm text-right pr-8" value={item.amount} onChange={e => handleItemChange(idx, 'amount', parseFloat(e.target.value) || 0)} required />
                                                {item.noticeId && workedHours > 0 && (
                                                    <button 
                                                        type="button" 
                                                        onClick={() => calculateFeeFromHours(idx, workedHours)}
                                                        className="absolute right-1 top-1.5 p-1 text-slate-400 hover:text-green-600 rounded" 
                                                        title="Calculate Fee based on Hours"
                                                    >
                                                        <Calculator size={14}/>
                                                    </button>
                                                )}
                                            </div>

                                            <button type="button" onClick={() => removeItem(idx)} className="p-2 text-red-500 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
                                        </div>
                                    );
                                })}
                            </div>
                            <button type="button" onClick={addItem} className="mt-3 text-sm text-blue-600 font-medium hover:underline flex items-center gap-1"><Plus size={14}/> Add Item</button>
                        </div>

                        {/* Totals */}
                        <div className="flex justify-end">
                            <div className="w-64 space-y-2">
                                <div className="flex justify-between text-sm"><span>Sub Total:</span><span>{formatCurrency(itemsTotal)}</span></div>
                                <div className="flex justify-between text-sm"><span>GST (18%):</span><span>{formatCurrency(taxAmount)}</span></div>
                                <div className="flex justify-between font-bold text-lg border-t pt-2"><span>Total:</span><span>{formatCurrency(totalAmount)}</span></div>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Notes</label>
                            <textarea className="w-full p-2 border rounded h-20 resize-none text-sm" value={formData.notes} onChange={e => setFormData({...formData, notes: e.target.value})}></textarea>
                        </div>

                        <div className="flex justify-end gap-3 border-t pt-4">
                            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border rounded-lg text-slate-600 hover:bg-slate-50">Cancel</button>
                            <button type="submit" className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 shadow-sm flex items-center gap-2"><Save size={18}/> Save Invoice</button>
                        </div>
                    </form>
                </div>
            </div>
        )}
    </div>
  );
};

export default Billing;
