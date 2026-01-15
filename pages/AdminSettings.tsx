
import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { UserRole, ALL_PERMISSIONS, PermissionType } from '../types';
import { Trash2, UserPlus, Save, Shield, Settings, Plus, X, AlertOctagon, Users, Calculator, Calendar, ToggleLeft, ToggleRight, Info, CheckCircle, Lock, Edit2, Database, Download, Upload } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const AdminSettings: React.FC = () => {
  const users = useLiveQuery(() => db.users.toArray());
  const configItems = useLiveQuery(() => db.appConfig.toArray());
  
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [isCalculating, setIsCalculating] = useState(false);
  const [interestRate, setInterestRate] = useState(18);
  const [targetDate, setTargetDate] = useState(new Date().toISOString().split('T')[0]);
  const [isTillToday, setIsTillToday] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // New User Form State
  const [newUser, setNewUser] = useState({
      username: '',
      password: '',
      fullName: '',
      email: '',
      role: UserRole.ASSOCIATE as string
  });

  // Config State
  const [newNoticeType, setNewNoticeType] = useState('');
  const [newNoticeStatus, setNewNoticeStatus] = useState('');
  const [newDefectType, setNewDefectType] = useState('');
  const [newUserRoleConfig, setNewUserRoleConfig] = useState('');

  // Sync target date with today if toggle is on
  useEffect(() => {
      if (isTillToday) {
          setTargetDate(new Date().toISOString().split('T')[0]);
      }
  }, [isTillToday]);

  const handleAddUser = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          const userId = await db.users.add({
              username: newUser.username,
              passwordHash: newUser.password, 
              fullName: newUser.fullName,
              email: newUser.email,
              role: newUser.role,
              isActive: true
          });

          await db.auditLogs.add({
              entityType: 'Auth', entityId: userId, action: 'Create', timestamp: new Date().toISOString(),
              user: currentUser?.username || 'System', details: `Created user ${newUser.username} (${newUser.role})`
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
                entityType: 'Auth', entityId: id, action: 'Delete', timestamp: new Date().toISOString(),
                user: currentUser?.username || 'System', details: `Deleted user ${userToDelete.username}`
            });
          }
      }
  };

  const handleBulkInterestUpdate = async () => {
    // Only proceed if logic is sound.
    // Requirement: "The bulk interest update option is only for notices for which interest is calculated till today is selected"
    
    const confirmation = confirm(`This will recalculate interest for ALL open notices (Status ≠ Closed).
    \nParameters:
    - Interest Rate: ${interestRate}%
    - Calculation Period: Due Date -> ${isTillToday ? 'TODAY' : targetDate}
    \nExisting interest values will be overwritten. Continue?`);

    if (!confirmation) return;

    setIsCalculating(true);
    try {
        const openNotices = await db.notices.where('status').notEqual('Closed').toArray();
        let updatedCount = 0;
        const timestamp = new Date().toISOString();
        const effectiveTargetDate = isTillToday ? new Date().toISOString().split('T')[0] : targetDate;

        for (const notice of openNotices) {
             const defects = await db.defects.where('noticeId').equals(notice.id!).toArray();
             let noticeUpdated = false;

             if (!notice.dueDate) continue;
             
             const diffTime = new Date(effectiveTargetDate).getTime() - new Date(notice.dueDate).getTime();
             const days = Math.ceil(diffTime / (1000 * 3600 * 24));
             
             if (days <= 0) continue; 

             for (const defect of defects) {
                 const calc = (tax: number) => Math.round((tax * interestRate * days) / 36500);

                 const newIgstInterest = calc(defect.igst.tax);
                 const newCgstInterest = calc(defect.cgst.tax);
                 const newSgstInterest = calc(defect.sgst.tax);
                 const newCessInterest = calc(defect.cess.tax);
                 const totalNewInterest = newIgstInterest + newCgstInterest + newSgstInterest + newCessInterest;

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
                entityType: 'System', entityId: 'BULK_UPDATE', action: 'Update', timestamp,
                user: currentUser?.username || 'System',
                details: `Bulk Interest Update: ${updatedCount} notices. Rate: ${interestRate}%, Target: ${effectiveTargetDate}`
            });
            alert(`Success! Updated interest for ${updatedCount} notices.`);
        } else {
            alert('No notices required updates.');
        }

    } catch(e) {
        console.error(e);
        alert('Error during bulk update');
    } finally {
        setIsCalculating(false);
    }
  };

  const handleBackup = async () => {
      try {
          const exportData: Record<string, any[]> = {};
          for (const table of db.tables) {
              exportData[table.name] = await table.toArray();
          }
          const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `GSTNexus_Backup_${new Date().toISOString().split('T')[0]}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
      } catch (err) {
          console.error(err);
          alert("Backup failed.");
      }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!confirm("WARNING: This will CLEAR all current data and replace it with the backup file. This action cannot be undone. Are you sure?")) {
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
      }

      const reader = new FileReader();
      reader.onload = async (ev) => {
          try {
              const importedData = JSON.parse(ev.target?.result as string);
              await db.transaction('rw', db.tables, async () => {
                  // Clear all tables
                  for (const table of db.tables) {
                      await table.clear();
                  }
                  // Populate tables
                  for (const tableName of Object.keys(importedData)) {
                      const table = db.table(tableName);
                      if (table) {
                          await table.bulkAdd(importedData[tableName]);
                      }
                  }
              });
              alert("Data restored successfully. The page will reload.");
              window.location.reload();
          } catch (err) {
              console.error(err);
              alert("Restore failed. Invalid backup file format.");
          }
      };
      reader.readAsText(file);
  };

  const getConfig = (key: string) => configItems?.find(c => c.key === key)?.value || [];
  
  const addItemToConfig = async (key: string, item: string, setInput: (v: string) => void) => {
      if (!item.trim()) return;
      const config = await db.appConfig.where('key').equals(key).first();
      let currentValues = config?.value || [];
      if (!currentValues.includes(item)) {
          const newValues = [...currentValues, item];
          config ? await db.appConfig.update(config.id!, { value: newValues }) : await db.appConfig.add({ key, value: newValues });
          setInput('');
      } else alert('Item already exists');
  };
  
  const removeItemFromConfig = async (key: string, item: string) => {
      const config = await db.appConfig.where('key').equals(key).first();
      if (config) await db.appConfig.update(config.id!, { value: config.value.filter((v: string) => v !== item) });
  };

  const togglePermission = async (role: string, permission: string) => {
      const key = `perm:${role}`;
      const config = await db.appConfig.where('key').equals(key).first();
      
      let currentPerms = config?.value || [];
      if (currentPerms.includes(permission)) {
          currentPerms = currentPerms.filter(p => p !== permission);
      } else {
          currentPerms = [...currentPerms, permission];
      }

      if (config) {
          await db.appConfig.update(config.id!, { value: currentPerms });
      } else {
          await db.appConfig.add({ key, value: currentPerms });
      }
  };

  const getRolePermissions = (role: string): string[] => {
      return configItems?.find(c => c.key === `perm:${role}`)?.value || [];
  };

  // Get dynamic roles from config or fallback to defaults
  const availableRoles = getConfig('user_roles').length > 0 ? getConfig('user_roles') : Object.values(UserRole);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-10">
      <div className="flex items-center gap-4 mb-8">
          <div className="p-4 bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-2xl shadow-lg">
              <Shield size={28} />
          </div>
          <div>
              <h2 className="text-3xl font-bold text-slate-800 tracking-tight">System Administration</h2>
              <p className="text-slate-500">Configure global settings, manage users, and run maintenance tasks</p>
          </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px]">
         <div className="flex border-b border-slate-200 overflow-x-auto">
            {['users', 'config', 'maintenance', 'data'].map(tab => (
                <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-8 py-5 text-sm font-semibold border-b-2 transition-all capitalize ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                >
                    {tab === 'config' ? 'System Configuration' : tab === 'maintenance' ? 'Maintenance & Tools' : tab === 'data' ? 'Data Management' : 'User Management'}
                </button>
            ))}
         </div>

         <div className="p-8">
             {activeTab === 'users' && (
                 <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-left-4">
                     {/* Add User */}
                     <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 h-fit">
                         <h3 className="font-bold text-slate-800 mb-6 flex items-center gap-2">
                             <UserPlus size={20} className="text-blue-600" /> Create New User
                         </h3>
                         <form onSubmit={handleAddUser} className="space-y-4">
                             <input type="text" placeholder="Username" required className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={newUser.username} onChange={e => setNewUser({...newUser, username: e.target.value})} />
                             <input type="text" placeholder="Full Name" required className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={newUser.fullName} onChange={e => setNewUser({...newUser, fullName: e.target.value})} />
                             <input type="email" placeholder="Email Address" required className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={newUser.email} onChange={e => setNewUser({...newUser, email: e.target.value})} />
                             <select className="w-full p-3 border border-slate-300 rounded-xl text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none" value={newUser.role} onChange={e => setNewUser({...newUser, role: e.target.value})}>{availableRoles.map((r: string) => <option key={r} value={r}>{r}</option>)}</select>
                             <input type="password" placeholder="Password" required className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={newUser.password} onChange={e => setNewUser({...newUser, password: e.target.value})} />
                             <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 mt-2">Create User Account</button>
                         </form>
                     </div>

                     {/* User List */}
                     <div className="lg:col-span-2 space-y-6">
                         <div>
                            <h3 className="font-bold text-slate-800 mb-4 px-2">Active Users</h3>
                            <div className="border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-slate-50 border-b border-slate-200 uppercase text-xs text-slate-500 font-semibold">
                                        <tr><th className="px-6 py-4">User Details</th><th className="px-6 py-4">Role</th><th className="px-6 py-4 text-right">Action</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 bg-white">
                                        {users?.map(u => (
                                            <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                                                <td className="px-6 py-4">
                                                    <p className="font-semibold text-slate-800">{u.fullName}</p>
                                                    <p className="text-xs text-slate-500">@{u.username} • {u.email}</p>
                                                </td>
                                                <td className="px-6 py-4"><span className="px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">{u.role}</span></td>
                                                <td className="px-6 py-4 text-right">
                                                    {u.username !== 'admin' && <button onClick={() => handleDeleteUser(u.id!)} className="text-slate-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"><Trash2 size={18} /></button>}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                         </div>
                         
                         {/* Permissions Matrix Visual */}
                         <div className="bg-slate-50 rounded-2xl border border-slate-200 p-6">
                             <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Lock size={18}/> Role Permissions Matrix <span className="text-xs font-normal text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-full ml-2 flex items-center gap-1"><Edit2 size={10}/> Editable</span></h3>
                             <div className="overflow-x-auto">
                                 <table className="w-full text-sm border-collapse">
                                     <thead>
                                         <tr className="border-b border-slate-200 bg-white/50">
                                             <th className="text-left py-3 px-4 font-semibold text-slate-600">Permission</th>
                                             {availableRoles.map(role => (
                                                 <th key={role} className="text-center py-3 px-2 font-semibold text-slate-600">{role}</th>
                                             ))}
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-slate-200 bg-white">
                                         {ALL_PERMISSIONS.map(p => (
                                             <tr key={p}>
                                                 <td className="py-2.5 px-4 text-slate-700 font-medium capitalize">{p.replace('_', ' ')}</td>
                                                 {availableRoles.map(role => {
                                                     const hasPerm = getRolePermissions(role).includes(p);
                                                     return (
                                                         <td key={`${role}-${p}`} className="text-center py-2.5 px-2">
                                                             <input 
                                                                type="checkbox" 
                                                                checked={hasPerm}
                                                                onChange={() => togglePermission(role, p)}
                                                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                                                             />
                                                         </td>
                                                     );
                                                 })}
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             </div>
                             <p className="text-xs text-slate-400 mt-4 italic">* Changes are saved automatically and applied immediately.</p>
                         </div>
                     </div>
                 </div>
             )}

             {activeTab === 'config' && (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in fade-in slide-in-from-right-4">
                     {[
                         { title: 'Notice Types', icon: Settings, color: 'blue', items: getConfig('notice_types'), newItem: newNoticeType, setNewItem: setNewNoticeType, key: 'notice_types' },
                         { title: 'Notice Statuses', icon: Settings, color: 'purple', items: getConfig('notice_statuses'), newItem: newNoticeStatus, setNewItem: setNewNoticeStatus, key: 'notice_statuses' },
                         { title: 'User Roles', icon: Users, color: 'indigo', items: getConfig('user_roles'), newItem: newUserRoleConfig, setNewItem: setNewUserRoleConfig, key: 'user_roles' },
                         { title: 'Defect Types', icon: AlertOctagon, color: 'amber', items: getConfig('defect_types'), newItem: newDefectType, setNewItem: setNewDefectType, key: 'defect_types' }
                     ].map((section) => (
                         <div key={section.key} className="bg-slate-50 p-6 rounded-2xl border border-slate-200 flex flex-col">
                             <h3 className={`font-bold text-slate-800 mb-4 flex items-center gap-2`}>
                                 <section.icon size={20} className={`text-${section.color}-600`} /> {section.title}
                             </h3>
                             <div className="flex gap-2 mb-4">
                                 <input type="text" placeholder="Add new..." className="flex-1 p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none" value={section.newItem} onChange={(e) => section.setNewItem(e.target.value)} />
                                 <button onClick={() => addItemToConfig(section.key, section.newItem, section.setNewItem)} className={`bg-${section.color}-600 text-white px-4 py-2 rounded-lg hover:bg-${section.color}-700 transition-colors`}><Plus size={20} /></button>
                             </div>
                             <div className="flex flex-wrap gap-2 content-start">
                                 {section.items.map((item: string) => (
                                     <div key={item} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-700 shadow-sm group">
                                         <span>{item}</span>
                                         <button onClick={() => removeItemFromConfig(section.key, item)} className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><X size={14} /></button>
                                     </div>
                                 ))}
                                 {!section.items.length && <span className="text-xs text-slate-400 italic">No items defined.</span>}
                             </div>
                         </div>
                     ))}
                 </div>
             )}

             {activeTab === 'maintenance' && (
                 <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in zoom-in-95">
                     <div className="bg-gradient-to-br from-white to-slate-50 border border-slate-200 rounded-2xl p-8 shadow-sm">
                         <div className="flex items-start gap-4 mb-6">
                             <div className="p-3 bg-blue-100 text-blue-600 rounded-xl"><Calculator size={28}/></div>
                             <div>
                                 <h3 className="text-xl font-bold text-slate-800">Bulk Interest Updater</h3>
                                 <p className="text-slate-500 text-sm mt-1">Recalculate interest for all open notices in one click.</p>
                             </div>
                         </div>

                         <div className="space-y-6">
                             <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
                                 <div className="flex justify-between items-center mb-4">
                                     <label className="text-sm font-bold text-slate-700 flex items-center gap-2"><Calendar size={16}/> Calculation Target Date</label>
                                     <button 
                                        onClick={() => setIsTillToday(!isTillToday)} 
                                        className={`flex items-center gap-2 text-sm font-medium px-3 py-1.5 rounded-lg transition-colors ${isTillToday ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600'}`}
                                     >
                                         {isTillToday ? <ToggleRight size={20}/> : <ToggleLeft size={20}/>}
                                         {isTillToday ? 'Calculate till TODAY' : 'Custom Date'}
                                     </button>
                                 </div>
                                 <input 
                                    type="date" 
                                    value={targetDate} 
                                    disabled={isTillToday}
                                    onChange={(e) => setTargetDate(e.target.value)}
                                    className={`w-full p-3 border rounded-xl text-sm transition-all ${isTillToday ? 'bg-slate-50 text-slate-400 border-slate-200' : 'bg-white border-blue-300 ring-2 ring-blue-50'}`}
                                 />
                                 {isTillToday && <p className="text-xs text-green-600 mt-2 flex items-center gap-1"><Info size={12}/> Interest will be calculated up to {new Date().toLocaleDateString()}</p>}
                             </div>

                             <div>
                                 <label className="block text-sm font-bold text-slate-700 mb-2">Annual Interest Rate (%)</label>
                                 <input 
                                    type="number" 
                                    value={interestRate} 
                                    onChange={(e) => setInterestRate(parseFloat(e.target.value))}
                                    className="w-full p-3 border border-slate-300 rounded-xl text-sm font-mono text-lg"
                                 />
                             </div>

                             <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                                 <AlertOctagon size={24} className="text-amber-600 shrink-0"/>
                                 <div>
                                     <p className="font-bold text-amber-800 text-sm">Action Warning</p>
                                     <p className="text-xs text-amber-700 mt-1">This will overwrite existing 'Interest' amounts for all defects in notices where Status is not 'Closed'.</p>
                                 </div>
                             </div>

                             <button 
                                 onClick={handleBulkInterestUpdate} 
                                 disabled={isCalculating}
                                 className={`w-full py-4 rounded-xl font-bold text-white shadow-lg transition-all flex justify-center items-center gap-2 ${isCalculating ? 'bg-slate-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'}`}
                             >
                                 {isCalculating ? 'Processing...' : 'Run Bulk Update'}
                             </button>
                         </div>
                     </div>
                 </div>
             )}

             {activeTab === 'data' && (
                 <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in slide-in-from-right-4">
                     <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
                         <div className="flex items-center gap-4 mb-6">
                             <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl"><Database size={28}/></div>
                             <div>
                                 <h3 className="text-xl font-bold text-slate-800">Backup & Restore</h3>
                                 <p className="text-slate-500 text-sm">Manage your offline data securely.</p>
                             </div>
                         </div>

                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                             <div className="border border-slate-200 rounded-xl p-6 bg-slate-50 hover:bg-slate-100 transition-colors">
                                 <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Download size={18}/> Export Data</h4>
                                 <p className="text-sm text-slate-500 mb-4">Download a complete JSON backup of all your data (Notices, Taxpayers, Payments, etc.).</p>
                                 <button onClick={handleBackup} className="w-full bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center justify-center gap-2">
                                     <Download size={16}/> Download Backup
                                 </button>
                             </div>

                             <div className="border border-slate-200 rounded-xl p-6 bg-slate-50 hover:bg-slate-100 transition-colors">
                                 <h4 className="font-bold text-slate-800 mb-2 flex items-center gap-2"><Upload size={18}/> Restore Data</h4>
                                 <p className="text-sm text-slate-500 mb-4">Import a backup file. <span className="text-red-500 font-bold">Warning: This will replace all current data!</span></p>
                                 <button onClick={() => fileInputRef.current?.click()} className="w-full bg-white border border-slate-300 text-slate-700 py-2 rounded-lg text-sm font-medium hover:bg-slate-50 flex items-center justify-center gap-2">
                                     <Upload size={16}/> Select Backup File
                                 </button>
                                 <input type="file" ref={fileInputRef} onChange={handleRestore} className="hidden" accept=".json" />
                             </div>
                         </div>
                     </div>
                 </div>
             )}
         </div>
      </div>
    </div>
  );
};

export default AdminSettings;
