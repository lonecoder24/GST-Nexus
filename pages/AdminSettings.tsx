import React, { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { UserRole } from '../types';
import { Trash2, UserPlus, Save, Shield, Settings, Plus, X, AlertOctagon, Users, Wrench, Calculator, Calendar } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const AdminSettings: React.FC = () => {
  const users = useLiveQuery(() => db.users.toArray());
  const configItems = useLiveQuery(() => db.appConfig.toArray());
  
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [isCalculating, setIsCalculating] = useState(false);
  const [interestRate, setInterestRate] = useState(18);
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0]);
  
  // New User Form State
  const [newUser, setNewUser] = useState({
      username: '',
      password: '',
      fullName: '',
      email: '',
      role: UserRole.ASSOCIATE as string
  });

  // Config State (Input fields)
  const [newNoticeType, setNewNoticeType] = useState('');
  const [newNoticeStatus, setNewNoticeStatus] = useState('');
  const [newDefectType, setNewDefectType] = useState('');
  const [newUserRoleConfig, setNewUserRoleConfig] = useState('');

  const handleAddUser = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          const userId = await db.users.add({
              username: newUser.username,
              passwordHash: newUser.password, // Simple for demo
              fullName: newUser.fullName,
              email: newUser.email,
              role: newUser.role,
              isActive: true
          });

          // Log the action
          await db.auditLogs.add({
              entityType: 'Auth',
              entityId: userId,
              action: 'Create',
              timestamp: new Date().toISOString(),
              user: currentUser?.username || 'System',
              details: `Created user ${newUser.username} (${newUser.role})`
          });

          setNewUser({ username: '', password: '', fullName: '', email: '', role: UserRole.ASSOCIATE });
          alert('User created successfully');
      } catch (err) {
          alert('Error creating user. Username might exist.');
      }
  };

  const handleDeleteUser = async (id: number) => {
      if (confirm('Delete this user?')) {
          const userToDelete = await db.users.get(id);
          if (userToDelete) {
            await db.users.delete(id);
            await db.auditLogs.add({
                entityType: 'Auth',
                entityId: id,
                action: 'Delete',
                timestamp: new Date().toISOString(),
                user: currentUser?.username || 'System',
                details: `Deleted user ${userToDelete.username}`
            });
          }
      }
  };

  const handleBulkInterestUpdate = async () => {
    if (!confirm(`This will recalculate interest for ALL open notices based on their Due Date up to ${targetDate} at ${interestRate}%. Existing interest values will be overwritten. Continue?`)) return;

    setIsCalculating(true);
    try {
        const openNotices = await db.notices.where('status').notEqual('Closed').toArray();
        let updatedCount = 0;
        const timestamp = new Date().toISOString();

        for (const notice of openNotices) {
             const defects = await db.defects.where('noticeId').equals(notice.id!).toArray();
             let noticeUpdated = false;

             // Calculate days from Due Date to Target Date
             // If Due Date is missing or invalid, skip or use Issue Date? Using Due Date as per standard.
             if (!notice.dueDate) continue;
             
             const diffTime = new Date(targetDate).getTime() - new Date(notice.dueDate).getTime();
             const days = Math.ceil(diffTime / (1000 * 3600 * 24));
             
             if (days <= 0) continue; // No interest if paid before/on due date or target date is earlier

             for (const defect of defects) {
                 const calc = (tax: number) => Math.round((tax * interestRate * days) / 36500);

                 const newIgstInterest = calc(defect.igst.tax);
                 const newCgstInterest = calc(defect.cgst.tax);
                 const newSgstInterest = calc(defect.sgst.tax);
                 const newCessInterest = calc(defect.cess.tax);
                 const totalNewInterest = newIgstInterest + newCgstInterest + newSgstInterest + newCessInterest;

                 // Check if values actually changed to avoid unnecessary writes
                 const currentTotalInterest = defect.igst.interest + defect.cgst.interest + defect.sgst.interest + defect.cess.interest;
                 
                 if (totalNewInterest !== currentTotalInterest) {
                     await db.defects.update(defect.id!, {
                         igst: { ...defect.igst, interest: newIgstInterest },
                         cgst: { ...defect.cgst, interest: newCgstInterest },
                         sgst: { ...defect.sgst, interest: newSgstInterest },
                         cess: { ...defect.cess, interest: newCessInterest },
                         interestDemand: totalNewInterest
                     });
                     noticeUpdated = true;
                 }
             }

             if (noticeUpdated) {
                 // Recalculate notice total demand
                 const updatedDefects = await db.defects.where('noticeId').equals(notice.id!).toArray();
                 const newTotal = updatedDefects.reduce((acc, d) => {
                     const sumHead = (h: any) => (h.tax || 0) + (h.interest || 0) + (h.penalty || 0) + (h.lateFee || 0) + (h.others || 0);
                     return acc + sumHead(d.igst) + sumHead(d.cgst) + sumHead(d.sgst) + sumHead(d.cess);
                 }, 0);

                 await db.notices.update(notice.id!, { demandAmount: newTotal });
                 updatedCount++;
             }
        }

        if (updatedCount > 0) {
             await db.auditLogs.add({
                entityType: 'System',
                entityId: 'BULK_UPDATE',
                action: 'Update',
                timestamp,
                user: currentUser?.username || 'System',
                details: `Bulk Interest Update: ${updatedCount} notices updated (Rate: ${interestRate}%, Date: ${targetDate})`
            });
            alert(`Successfully updated interest for ${updatedCount} notices.`);
        } else {
            alert('No notices required updates based on the current criteria.');
        }

    } catch(e) {
        console.error(e);
        alert('Error during bulk update');
    } finally {
        setIsCalculating(false);
    }
  };

  // --- Config Functions ---

  const getConfig = (key: string) => {
      return configItems?.find(c => c.key === key)?.value || [];
  };

  const addItemToConfig = async (key: string, item: string, setInput: (v: string) => void) => {
      if (!item.trim()) return;
      const config = await db.appConfig.where('key').equals(key).first();
      let currentValues = config?.value || [];
      
      if (!currentValues.includes(item)) {
          const newValues = [...currentValues, item];
          if (config) {
              await db.appConfig.update(config.id!, { value: newValues });
          } else {
              await db.appConfig.add({ key, value: newValues });
          }
          setInput('');
      } else {
          alert('Item already exists');
      }
  };

  const removeItemFromConfig = async (key: string, item: string) => {
      const config = await db.appConfig.where('key').equals(key).first();
      if (config) {
          const newValues = config.value.filter((v: string) => v !== item);
          await db.appConfig.update(config.id!, { value: newValues });
      }
  };

  const userRoles = getConfig('user_roles');
  const roleOptions = userRoles.length > 0 ? userRoles : Object.values(UserRole);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-10">
      <div className="flex items-center gap-3 mb-6">
          <div className="p-3 bg-slate-800 text-white rounded-xl shadow-lg shadow-slate-200">
              <Shield size={24} />
          </div>
          <div>
              <h2 className="text-2xl font-bold text-slate-800">Administration</h2>
              <p className="text-slate-500 text-sm">System configuration and user management</p>
          </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
         <div className="flex border-b border-slate-200 overflow-x-auto">
            <button 
                onClick={() => setActiveTab('users')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'users' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
                User Management
            </button>
            <button 
                onClick={() => setActiveTab('config')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'config' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
                System Configuration
            </button>
            <button 
                onClick={() => setActiveTab('maintenance')}
                className={`px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeTab === 'maintenance' ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
            >
                Maintenance & Tools
            </button>
         </div>

         <div className="p-6">
             {activeTab === 'users' && (
                 <div className="space-y-8">
                     {/* Add User Form */}
                     <div className="bg-slate-50 p-6 rounded-xl border border-slate-200 shadow-sm">
                         <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                             <UserPlus size={18} className="text-blue-600" /> Add New User
                         </h3>
                         <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <input 
                                type="text" placeholder="Username" required
                                className="p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})}
                             />
                             <input 
                                type="text" placeholder="Full Name" required
                                className="p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                value={newUser.fullName} onChange={e => setNewUser({...newUser, fullName: e.target.value})}
                             />
                             <input 
                                type="email" placeholder="Email" required
                                className="p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})}
                             />
                             <select 
                                className="p-2.5 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}
                             >
                                 {roleOptions.map(r => <option key={r} value={r}>{r}</option>)}
                             </select>
                             <input 
                                type="password" placeholder="Password" required
                                className="p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})}
                             />
                             <button type="submit" className="bg-blue-600 text-white px-4 py-2.5 rounded-lg text-sm hover:bg-blue-700 font-medium transition-colors shadow-sm">
                                 Create User
                             </button>
                         </form>
                     </div>

                     {/* Users Table */}
                     <div>
                         <h3 className="font-semibold text-slate-800 mb-4">Existing Users</h3>
                         <div className="overflow-hidden border border-slate-200 rounded-xl shadow-sm">
                             <table className="w-full text-sm text-left">
                                 <thead className="bg-slate-50 border-b border-slate-200 uppercase text-xs text-slate-500">
                                     <tr>
                                         <th className="px-6 py-4">Username</th>
                                         <th className="px-6 py-4">Name</th>
                                         <th className="px-6 py-4">Role</th>
                                         <th className="px-6 py-4">Email</th>
                                         <th className="px-6 py-4 text-right">Action</th>
                                     </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-100 bg-white">
                                     {users?.map(u => (
                                         <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                                             <td className="px-6 py-4 font-medium text-slate-900">{u.username}</td>
                                             <td className="px-6 py-4 text-slate-600">{u.fullName}</td>
                                             <td className="px-6 py-4">
                                                 <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${
                                                     u.role === UserRole.ADMIN ? 'bg-purple-50 text-purple-700 border-purple-200' :
                                                     u.role === UserRole.SENIOR_ASSOCIATE ? 'bg-indigo-50 text-indigo-700 border-indigo-200' :
                                                     'bg-slate-100 text-slate-600 border-slate-200'
                                                 }`}>
                                                     {u.role}
                                                 </span>
                                             </td>
                                             <td className="px-6 py-4 text-slate-500">{u.email}</td>
                                             <td className="px-6 py-4 text-right">
                                                 {u.username !== 'admin' && (
                                                     <button onClick={() => handleDeleteUser(u.id!)} className="text-red-500 hover:text-red-700 p-1.5 hover:bg-red-50 rounded transition-colors">
                                                         <Trash2 size={16} />
                                                     </button>
                                                 )}
                                             </td>
                                         </tr>
                                     ))}
                                 </tbody>
                             </table>
                         </div>
                     </div>
                 </div>
             )}

             {activeTab === 'config' && (
                 <div className="space-y-8">
                     
                     {/* Notice Types Config */}
                     <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                         <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                             <Settings size={18} className="text-blue-600" /> Notice Types
                         </h3>
                         <div className="flex gap-2 mb-4">
                             <input 
                                type="text" 
                                placeholder="Add new notice type (e.g. Form GST DRC-01)" 
                                className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                value={newNoticeType}
                                onChange={(e) => setNewNoticeType(e.target.value)}
                             />
                             <button 
                                onClick={() => addItemToConfig('notice_types', newNoticeType, setNewNoticeType)}
                                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
                             >
                                 <Plus size={18} />
                             </button>
                         </div>
                         <div className="flex flex-wrap gap-2">
                             {getConfig('notice_types').map((type: string) => (
                                 <div key={type} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-slate-200 text-sm text-slate-700 shadow-sm">
                                     <span>{type}</span>
                                     <button onClick={() => removeItemFromConfig('notice_types', type)} className="text-slate-400 hover:text-red-500">
                                         <X size={14} />
                                     </button>
                                 </div>
                             ))}
                             {getConfig('notice_types').length === 0 && <span className="text-xs text-slate-400 italic">No types defined.</span>}
                         </div>
                     </div>

                     {/* Notice Status Config */}
                     <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                         <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                             <Settings size={18} className="text-purple-600" /> Notice Status Workflow
                         </h3>
                         <div className="flex gap-2 mb-4">
                             <input 
                                type="text" 
                                placeholder="Add new status (e.g. Awaiting Order)" 
                                className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                                value={newNoticeStatus}
                                onChange={(e) => setNewNoticeStatus(e.target.value)}
                             />
                             <button 
                                onClick={() => addItemToConfig('notice_statuses', newNoticeStatus, setNewNoticeStatus)}
                                className="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700"
                             >
                                 <Plus size={18} />
                             </button>
                         </div>
                         <div className="flex flex-wrap gap-2">
                             {getConfig('notice_statuses').map((status: string) => (
                                 <div key={status} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-slate-200 text-sm text-slate-700 shadow-sm">
                                     <span>{status}</span>
                                     <button onClick={() => removeItemFromConfig('notice_statuses', status)} className="text-slate-400 hover:text-red-500">
                                         <X size={14} />
                                     </button>
                                 </div>
                             ))}
                             {getConfig('notice_statuses').length === 0 && <span className="text-xs text-slate-400 italic">No statuses defined.</span>}
                         </div>
                     </div>

                     {/* User Roles Config */}
                     <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                         <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                             <Users size={18} className="text-indigo-600" /> User Roles (User Types)
                         </h3>
                         <div className="flex gap-2 mb-4">
                             <input 
                                type="text" 
                                placeholder="Add new user type (e.g. Partner, Intern)" 
                                className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                value={newUserRoleConfig}
                                onChange={(e) => setNewUserRoleConfig(e.target.value)}
                             />
                             <button 
                                onClick={() => addItemToConfig('user_roles', newUserRoleConfig, setNewUserRoleConfig)}
                                className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700"
                             >
                                 <Plus size={18} />
                             </button>
                         </div>
                         <div className="flex flex-wrap gap-2">
                             {getConfig('user_roles').map((role: string) => (
                                 <div key={role} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-slate-200 text-sm text-slate-700 shadow-sm">
                                     <span>{role}</span>
                                     <button onClick={() => removeItemFromConfig('user_roles', role)} className="text-slate-400 hover:text-red-500">
                                         <X size={14} />
                                     </button>
                                 </div>
                             ))}
                             {getConfig('user_roles').length === 0 && <span className="text-xs text-slate-400 italic">No roles defined.</span>}
                         </div>
                     </div>

                     {/* Defect Types Config */}
                     <div className="bg-slate-50 p-6 rounded-xl border border-slate-200">
                         <h3 className="font-semibold text-slate-800 mb-4 flex items-center gap-2">
                             <AlertOctagon size={18} className="text-amber-600" /> Defect Types
                         </h3>
                         <div className="flex gap-2 mb-4">
                             <input 
                                type="text" 
                                placeholder="Add new defect type (e.g. Excess ITC Claim)" 
                                className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                                value={newDefectType}
                                onChange={(e) => setNewDefectType(e.target.value)}
                             />
                             <button 
                                onClick={() => addItemToConfig('defect_types', newDefectType, setNewDefectType)}
                                className="bg-amber-600 text-white px-4 py-2 rounded-lg hover:bg-amber-700"
                             >
                                 <Plus size={18} />
                             </button>
                         </div>
                         <div className="flex flex-wrap gap-2">
                             {getConfig('defect_types').map((type: string) => (
                                 <div key={type} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-slate-200 text-sm text-slate-700 shadow-sm">
                                     <span>{type}</span>
                                     <button onClick={() => removeItemFromConfig('defect_types', type)} className="text-slate-400 hover:text-red-500">
                                         <X size={14} />
                                     </button>
                                 </div>
                             ))}
                             {getConfig('defect_types').length === 0 && <span className="text-xs text-slate-400 italic">No defect types defined.</span>}
                         </div>
                     </div>

                 </div>
             )}

             {activeTab === 'maintenance' && (
                 <div className="space-y-8 animate-in fade-in">
                     <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
                         <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                             <Calculator size={20} className="text-blue-600"/> Bulk Interest Update
                         </h3>
                         <p className="text-sm text-slate-500 mb-6">
                             Recalculate interest for all defects in open notices (Status ≠ Closed). 
                             Calculation is based on the period from the <strong>Notice Due Date</strong> to the <strong>Target Date</strong> below.
                         </p>

                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                             <div>
                                 <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                                     <Calendar size={14}/> Target Date (Calculation Till)
                                 </label>
                                 <input 
                                    type="date" 
                                    value={targetDate} 
                                    onChange={(e) => setTargetDate(e.target.value)}
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm"
                                 />
                             </div>
                             <div>
                                 <label className="block text-sm font-medium text-slate-700 mb-1">Interest Rate (% per annum)</label>
                                 <input 
                                    type="number" 
                                    value={interestRate} 
                                    onChange={(e) => setInterestRate(parseFloat(e.target.value))}
                                    className="w-full p-2.5 border border-slate-300 rounded-lg text-sm"
                                 />
                             </div>
                         </div>
                         
                         <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                             <div className="flex items-start gap-3">
                                 <AlertOctagon size={20} className="text-amber-600 shrink-0 mt-0.5"/>
                                 <div>
                                     <p className="text-sm font-bold text-amber-800">Warning</p>
                                     <p className="text-xs text-amber-700 mt-1">
                                         This action will overwrite existing 'Interest' values for all defects in active notices. 
                                         Only notices with a valid 'Due Date' will be processed.
                                     </p>
                                 </div>
                             </div>
                         </div>

                         <button 
                             onClick={handleBulkInterestUpdate} 
                             disabled={isCalculating}
                             className={`flex items-center gap-2 bg-blue-600 text-white px-6 py-2.5 rounded-lg font-medium shadow-sm hover:bg-blue-700 transition-colors ${isCalculating ? 'opacity-70 cursor-wait' : ''}`}
                         >
                             {isCalculating ? 'Processing...' : 'Update All Open Notices'}
                         </button>
                     </div>
                 </div>
             )}
         </div>
      </div>
    </div>
  );
};

export default AdminSettings;