
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Taxpayer } from '../types';
import { Save, ArrowLeft, Building, FileText, ExternalLink, Map, ShieldCheck, Activity } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const TaxpayerDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = id === 'new';

  const [formData, setFormData] = useState<Partial<Taxpayer>>({
      gstin: '', tradeName: '', legalName: '', mobile: '', email: '', registeredAddress: '', stateCode: '',
      stateCircle: '', centralRange: '', status: 'Active'
  });

  const statusConfig = useLiveQuery(() => db.appConfig.get({ key: 'taxpayer_statuses' }));
  const statusOptions = statusConfig?.value || ['Active', 'Dormant', 'Suspended', 'Litigation Only', 'Closed'];

  useEffect(() => {
    if (!isNew && id) {
      db.taxpayers.get(parseInt(id)).then(t => { if (t) setFormData(t); });
    }
  }, [id, isNew]);

  const notices = useLiveQuery(async () => {
    if (formData.gstin) {
        return await db.notices.where('gstin').equals(formData.gstin).toArray();
    }
    return [];
  }, [formData.gstin]);

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!formData.gstin || !formData.tradeName) { alert("GSTIN and Trade Name are required"); return; }
      
      try {
          if (isNew) {
              const newId = await db.taxpayers.add(formData as Taxpayer);
              await db.auditLogs.add({
                  entityType: 'Taxpayer', entityId: newId, action: 'Create', timestamp: new Date().toISOString(), 
                  user: user?.username || 'System', details: `Created Taxpayer: ${formData.tradeName} (${formData.gstin})`
              });
          } else {
              await db.taxpayers.update(parseInt(id!), formData);
              await db.auditLogs.add({
                entityType: 'Taxpayer', entityId: id!, action: 'Update', timestamp: new Date().toISOString(), 
                user: user?.username || 'System', details: `Updated details for ${formData.tradeName}`
            });
          }
          navigate('/taxpayers');
      } catch (err) {
          console.error(err);
          alert('Error saving. GSTIN must be unique.');
      }
  };

  const handleGstinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value.toUpperCase();
      let updatedFormData = { ...formData, gstin: val };
      
      // Auto-fill state code if GSTIN starts with 2 digits
      if (val.length >= 2) {
          const potentialStateCode = val.substring(0, 2);
          if (/^\d+$/.test(potentialStateCode)) {
              updatedFormData.stateCode = potentialStateCode;
          }
      }
      setFormData(updatedFormData);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 pb-10">
       <div className="flex items-center justify-between">
            <button onClick={() => navigate('/taxpayers')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800"><ArrowLeft size={18} /> Back</button>
            <h2 className="text-xl font-bold text-slate-800">{isNew ? 'New Taxpayer' : 'Edit Taxpayer'}</h2>
       </div>

       <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
           <form onSubmit={handleSubmit} className="space-y-6">
               <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
                    <div className="p-3 bg-blue-50 rounded-full text-blue-600"><Building size={24}/></div>
                    <div>
                        <h3 className="font-semibold text-slate-800">Basic Information</h3>
                        <p className="text-xs text-slate-500">Registration details from GST Portal</p>
                    </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">GSTIN <span className="text-red-500">*</span></label>
                       <input type="text" value={formData.gstin} onChange={handleGstinChange} maxLength={15} 
                        className="w-full p-2 border border-slate-300 rounded uppercase font-mono" required placeholder="27ABCDE1234F1Z5"/>
                   </div>
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">State Code</label>
                       <input type="text" value={formData.stateCode} onChange={e => setFormData({...formData, stateCode: e.target.value})} maxLength={2} 
                        className="w-full p-2 border border-slate-300 rounded" placeholder="27"/>
                   </div>
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Trade Name <span className="text-red-500">*</span></label>
                       <input type="text" value={formData.tradeName} onChange={e => setFormData({...formData, tradeName: e.target.value})} 
                        className="w-full p-2 border border-slate-300 rounded" required/>
                   </div>
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Legal Name</label>
                       <input type="text" value={formData.legalName} onChange={e => setFormData({...formData, legalName: e.target.value})} 
                        className="w-full p-2 border border-slate-300 rounded" />
                   </div>
                   <div className="md:col-span-2">
                       <label className="block text-sm font-medium text-slate-700 mb-1">Client Status</label>
                       <div className="relative">
                           <Activity size={16} className="absolute left-3 top-3 text-slate-400"/>
                           <input 
                                list="statusOptionsList"
                                type="text"
                                value={formData.status || 'Active'} 
                                onChange={e => setFormData({...formData, status: e.target.value})}
                                className="w-full pl-9 p-2.5 border border-slate-300 rounded bg-white outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="Select or Type Status"
                           />
                           <datalist id="statusOptionsList">
                               {statusOptions.map((s: string) => <option key={s} value={s} />)}
                           </datalist>
                       </div>
                   </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Mobile</label>
                       <input type="text" value={formData.mobile} onChange={e => setFormData({...formData, mobile: e.target.value})} 
                        className="w-full p-2 border border-slate-300 rounded" />
                   </div>
                   <div>
                       <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                       <input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} 
                        className="w-full p-2 border border-slate-300 rounded" />
                   </div>
                   <div className="md:col-span-2">
                       <label className="block text-sm font-medium text-slate-700 mb-1">Registered Address</label>
                       <textarea value={formData.registeredAddress} onChange={e => setFormData({...formData, registeredAddress: e.target.value})} 
                        className="w-full p-2 border border-slate-300 rounded h-20 resize-none" />
                   </div>
               </div>

               <div className="flex items-center gap-3 mt-8 mb-6 pb-4 border-b border-slate-100">
                    <div className="p-3 bg-purple-50 rounded-full text-purple-600"><Map size={24}/></div>
                    <div>
                        <h3 className="font-semibold text-slate-800">Jurisdictional Details</h3>
                        <p className="text-xs text-slate-500">Mapping to Authority and Wards (Static)</p>
                    </div>
               </div>

               <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
                   <div>
                       <label className="block text-xs font-bold text-slate-600 uppercase mb-1">State Circle / Ward</label>
                       <input 
                            type="text" 
                            placeholder="e.g. Pune Zone II"
                            value={formData.stateCircle || ''} 
                            onChange={e => setFormData({...formData, stateCircle: e.target.value})} 
                            className="w-full p-2 border border-slate-300 rounded text-sm" 
                       />
                   </div>
                   <div>
                       <label className="block text-xs font-bold text-slate-600 uppercase mb-1">Central Range / Div</label>
                       <input 
                            type="text" 
                            placeholder="e.g. Range I Div III"
                            value={formData.centralRange || ''} 
                            onChange={e => setFormData({...formData, centralRange: e.target.value})} 
                            className="w-full p-2 border border-slate-300 rounded text-sm" 
                       />
                   </div>
               </div>

               <div className="pt-4 flex justify-end">
                   <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2 shadow-sm">
                       <Save size={18}/> Save Taxpayer
                   </button>
               </div>
           </form>
       </div>

       {/* Linked Notices Section */}
       {!isNew && (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
           <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold text-slate-800 flex items-center gap-2">
                    <FileText size={20} className="text-blue-600"/> Linked Notices ({notices?.length || 0})
                </h3>
                {notices && notices.length > 0 && (
                    <button onClick={() => navigate('/notices', { state: { gstin: formData.gstin } })} className="text-xs flex items-center gap-1 text-blue-600 hover:underline">
                        View in Registry <ExternalLink size={12}/>
                    </button>
                )}
           </div>
           
           <div className="overflow-x-auto border rounded-lg">
               <table className="w-full text-sm text-left">
                   <thead className="bg-slate-50 text-slate-500 uppercase text-xs font-bold">
                       <tr>
                           <th className="px-4 py-3">Notice Number</th>
                           <th className="px-4 py-3">Type</th>
                           <th className="px-4 py-3">Date</th>
                           <th className="px-4 py-3">Status</th>
                           <th className="px-4 py-3 text-right">Demand</th>
                           <th className="px-4 py-3">Action</th>
                       </tr>
                   </thead>
                   <tbody className="divide-y divide-slate-100">
                       {notices?.map(n => (
                           <tr key={n.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/notices/${n.id}`)}>
                               <td className="px-4 py-3 font-medium text-slate-800">{n.noticeNumber}</td>
                               <td className="px-4 py-3 text-slate-600">{n.noticeType}</td>
                               <td className="px-4 py-3 text-slate-600">{n.dateOfIssue}</td>
                               <td className="px-4 py-3">
                                   <span className={`px-2 py-0.5 rounded-full text-xs border ${
                                       n.status === 'Closed' ? 'bg-slate-100 text-slate-500' : 'bg-blue-50 text-blue-600 border-blue-100'
                                   }`}>{n.status}</span>
                               </td>
                               <td className="px-4 py-3 text-right font-mono">{n.demandAmount}</td>
                               <td className="px-4 py-3">
                                   <span className="text-blue-600 text-xs">View</span>
                               </td>
                           </tr>
                       ))}
                       {!notices?.length && <tr><td colSpan={6} className="text-center py-4 text-slate-400">No linked notices found.</td></tr>}
                   </tbody>
               </table>
           </div>
        </div>
       )}
    </div>
  );
};

export default TaxpayerDetail;
