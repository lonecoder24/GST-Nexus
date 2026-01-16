
import React, { useState, useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { UserRole, ALL_PERMISSIONS, PermissionType, User } from '../types';
import { Trash2, UserPlus, Save, Shield, Settings, Plus, X, AlertOctagon, Users, Calculator, Calendar, ToggleLeft, ToggleRight, Info, CheckCircle, Lock, Edit2, Database, Download, Upload, Globe, Key, Wifi, MapPin, List } from 'lucide-react';
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
  
  // Config State
  const [newConfigInput, setNewConfigInput] = useState<Record<string, string>>({});

  // Password Reset State
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [selectedUserForReset, setSelectedUserForReset] = useState<User | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');

  // New User Form State
  const [newUser, setNewUser] = useState({
      username: '',
      password: '',
      fullName: '',
      email: '',
      role: UserRole.ASSOCIATE as string
  });

  // API Config State
  const [apiConfig, setApiConfig] = useState({
      baseUrl: 'https://api.gst.gov.in/v1',
      clientId: '',
      clientSecret: ''
  });

  // Sync target date with today if toggle is on
  useEffect(() => {
      if (isTillToday) {
          setTargetDate(new Date().toISOString().split('T')[0]);
      }
  }, [isTillToday]);

  useEffect(() => {
      // Load API Config
      db.appConfig.get({ key: 'api_config' }).then(config => {
          if (config && config.value) {
              setApiConfig({
                  baseUrl: config.value.baseUrl || 'https://api.gst.gov.in/v1',
                  clientId: config.value.clientId || '',
                  clientSecret: config.value.clientSecret || ''
              });
          }
      });
  }, []);

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

  const openPasswordModal = (user: User) => {
      setSelectedUserForReset(user);
      setNewPasswordInput('');
      setShowPasswordModal(true);
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedUserForReset || !newPasswordInput) return;

      try {
          await db.users.update(selectedUserForReset.id!, { passwordHash: newPasswordInput });
          await db.auditLogs.add({
              entityType: 'Auth', entityId: selectedUserForReset.id!, action: 'Update', timestamp: new Date().toISOString(),
              user: currentUser?.username || 'System', details: `Password changed for user ${selectedUserForReset.username}`
          });
          alert('Password updated successfully');
          setShowPasswordModal(false);
          setNewPasswordInput('');
          setSelectedUserForReset(null);
      } catch (err) {
          console.error(err);
          alert('Failed to update password');
      }
  };

  // --- SYSTEM CONFIG HANDLERS ---
  const handleAddConfigItem = async (key: string) => {
      const val = newConfigInput[key]?.trim();
      if (!val) return;

      const currentConfig = configItems?.find(c => c.key === key);
      const currentValues = currentConfig?.value || [];
      
      if (currentValues.includes(val)) {
          alert('Value already exists');
          return;
      }

      const newValues = [...currentValues, val];

      if (currentConfig) {
          await db.appConfig.update(currentConfig.id!, { value: newValues });
      } else {
          await db.appConfig.add({ key, value: newValues });
      }

      await db.auditLogs.add({
          entityType: 'System', entityId: 'CONFIG', action: 'Update', timestamp: new Date().toISOString(),
          user: currentUser?.username || 'System', details: `Added '${val}' to ${key}`
      });

      setNewConfigInput({ ...newConfigInput, [key]: '' });
  };

  const handleRemoveConfigItem = async (key: string, valueToRemove: string) => {
      if (!confirm(`Remove '${valueToRemove}'?`)) return;
      
      const currentConfig = configItems?.find(c => c.key === key);
      if (!currentConfig) return;

      const newValues = currentConfig.value.filter((v: string) => v !== valueToRemove);
      await db.appConfig.update(currentConfig.id!, { value: newValues });

      await db.auditLogs.add({
          entityType: 'System', entityId: 'CONFIG', action: 'Update', timestamp: new Date().toISOString(),
          user: currentUser?.username || 'System', details: `Removed '${valueToRemove}' from ${key}`
      });
  };

  const handleBulkInterestUpdate = async () => {
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
                  for (const table of db.tables) {
                      await table.clear();
                  }
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

  const handleSaveApiConfig = async (e: React.FormEvent) => {
      e.preventDefault();
      try {
          const existing = await db.appConfig.get({ key: 'api_config' });
          if (existing) {
              await db.appConfig.update(existing.id!, { value: apiConfig });
          } else {
              await db.appConfig.add({ key: 'api_config', value: apiConfig });
          }
          await db.auditLogs.add({
              entityType: 'System', entityId: 'API_CONFIG', action: 'Update', timestamp: new Date().toISOString(),
              user: currentUser?.username || 'System', details: 'Updated API Configuration'
          });
          alert('API Configuration Saved.');
      } catch (e) {
          alert('Error saving configuration');
      }
  };

  const getConfig = (key: string) => configItems?.find(c => c.key === key)?.value || [];
  const getRolePermissions = (role: string): string[] => {
      return configItems?.find(c => c.key === `perm:${role}`)?.value || [];
  };

  const togglePermission = async (role: string, permission: string) => {
      const key = `perm:${role}`;
      const config = await db.appConfig.where('key').equals(key).first();
      
      let currentPerms = config?.value || [];
      if (currentPerms.includes(permission)) {
          currentPerms = currentPerms.filter((p: string) => p !== permission);
      } else {
          currentPerms = [...currentPerms, permission];
      }

      if (config) {
          await db.appConfig.update(config.id!, { value: currentPerms });
      } else {
          await db.appConfig.add({ key, value: currentPerms });
      }
  };

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
            {['users', 'config', 'api', 'maintenance', 'data'].map(tab => (
                <button 
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-8 py-5 text-sm font-semibold border-b-2 transition-all capitalize ${activeTab === tab ? 'border-blue-600 text-blue-600 bg-blue-50/30' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                >
                    {tab === 'config' ? 'System Configuration' : tab === 'api' ? 'API Integration' : tab === 'maintenance' ? 'Maintenance & Tools' : tab === 'data' ? 'Data Management' : 'User Management'}
                </button>
            ))}
         </div>

         <div className="p-8">
             {/* CONFIGURATION TAB */}
             {activeTab === 'config' && (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-in fade-in">
                     <div className="md:col-span-2 bg-blue-50 p-4 rounded-xl border border-blue-100 flex items-start gap-3">
                         <Info className="text-blue-600 shrink-0 mt-0.5" size={18}/>
                         <div>
                             <p className="text-sm font-bold text-blue-800">System Parameters</p>
                             <p className="text-xs text-blue-700 mt-1">
                                 Values configured here populate dropdowns across the application (e.g. creating new notices, assigning defects, filtering reports).
                             </p>
                         </div>
                     </div>

                     {[
                         { key: 'notice_types', label: 'Notice Types', icon: List, placeholder: 'e.g. SCN, ASMT-10, DRC-01' },
                         { key: 'notice_periods', label: 'Financial Periods', icon: Calendar, placeholder: 'e.g. FY 2023-24' },
                         { key: 'notice_statuses', label: 'Workflow Statuses', icon: CheckCircle, placeholder: 'e.g. Pending Review, Order Passed' },
                         { key: 'defect_types', label: 'Defect Types', icon: AlertOctagon, placeholder: 'e.g. ITC Mismatch, E-Way Bill' },
                         { key: 'user_roles', label: 'User Roles', icon: Users, placeholder: 'e.g. Manager, Partner' }
                     ].map(section => (
                         <div key={section.key} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                             <h4 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
                                 <section.icon size={18} className="text-slate-400"/> {section.label}
                             </h4>
                             <div className="flex gap-2 mb-4">
                                 <input 
                                     type="text" 
                                     className="flex-1 p-2 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                     placeholder={section.placeholder}
                                     value={newConfigInput[section.key] || ''}
                                     onChange={e => setNewConfigInput({...newConfigInput, [section.key]: e.target.value})}
                                     onKeyDown={e => e.key === 'Enter' && handleAddConfigItem(section.key)}
                                 />
                                 <button 
                                     onClick={() => handleAddConfigItem(section.key)}
                                     className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                                 >
                                     Add
                                 </button>
                             </div>
                             <div className="flex flex-wrap gap-2 min-h-[60px] content-start">
                                 {getConfig(section.key).map((item: string) => (
                                     <span key={item} className="bg-slate-100 text-slate-700 text-xs px-2.5 py-1.5 rounded-full border border-slate-200 flex items-center gap-1 group transition-colors hover:bg-slate-200">
                                         {item}
                                         <button 
                                            onClick={() => handleRemoveConfigItem(section.key, item)} 
                                            className="text-slate-400 hover:text-red-500 rounded-full p-0.5 hover:bg-red-50"
                                         >
                                             <X size={12}/>
                                         </button>
                                     </span>
                                 ))}
                                 {getConfig(section.key).length === 0 && <span className="text-xs text-slate-400 italic">No items configured</span>}
                             </div>
                         </div>
                     ))}
                 </div>
             )}

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
                                                    <div className="flex justify-end gap-2">
                                                        <button 
                                                            onClick={() => openPasswordModal(u)}
                                                            className="text-slate-400 hover:text-blue-600 p-2 hover:bg-blue-50 rounded-lg transition-colors"
                                                            title="Change Password"
                                                        >
                                                            <Lock size={18} />
                                                        </button>
                                                        {u.username !== 'admin' && (
                                                            <button 
                                                                onClick={() => handleDeleteUser(u.id!)} 
                                                                className="text-slate-400 hover:text-red-600 p-2 hover:bg-red-50 rounded-lg transition-colors"
                                                                title="Delete User"
                                                            >
                                                                <Trash2 size={18} />
                                                            </button>
                                                        )}
                                                    </div>
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

             {activeTab === 'api' && (
                 <div className="max-w-2xl mx-auto animate-in fade-in zoom-in-95">
                     <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                         <div className="flex items-start gap-4 mb-6">
                             <div className="p-3 bg-indigo-100 text-indigo-600 rounded-xl"><Globe size={28}/></div>
                             <div>
                                 <h3 className="text-xl font-bold text-slate-800">API Integration</h3>
                                 <p className="text-slate-500 text-sm mt-1">Configure credentials for future fetching of GSTR data.</p>
                             </div>
                         </div>
                         
                         <form onSubmit={handleSaveApiConfig} className="space-y-6">
                             <div>
                                 <label className="block text-sm font-bold text-slate-700 mb-2">GSTN API Base URL</label>
                                 <input type="url" value={apiConfig.baseUrl} onChange={e => setApiConfig({...apiConfig, baseUrl: e.target.value})} className="w-full p-3 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 outline-none" required />
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                 <div>
                                     <label className="block text-sm font-bold text-slate-700 mb-2">Client ID</label>
                                     <div className="relative">
                                         <Key size={16} className="absolute left-3 top-3 text-slate-400"/>
                                         <input type="text" value={apiConfig.clientId} onChange={e => setApiConfig({...apiConfig, clientId: e.target.value})} className="w-full pl-9 pr-3 py-3 border border-slate-300 rounded-xl text-sm" placeholder="Enter Client ID"/>
                                     </div>
                                 </div>
                                 <div>
                                     <label className="block text-sm font-bold text-slate-700 mb-2">Client Secret</label>
                                     <div className="relative">
                                         <Lock size={16} className="absolute left-3 top-3 text-slate-400"/>
                                         <input type="password" value={apiConfig.clientSecret} onChange={e => setApiConfig({...apiConfig, clientSecret: e.target.value})} className="w-full pl-9 pr-3 py-3 border border-slate-300 rounded-xl text-sm" placeholder="Enter Secret"/>
                                     </div>
                                 </div>
                             </div>
                             
                             <div className="pt-4">
                                 <button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl transition-colors shadow-md">
                                     Save Configuration
                                 </button>
                             </div>
                         </form>
                     </div>
                 </div>
             )}

             {/* Maintenance and Data tabs... (Same as before) */}
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

      {/* Password Reset Modal */}
      {showPasswordModal && selectedUserForReset && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                          <Lock className="text-blue-600"/> Change Password
                      </h3>
                      <button onClick={() => setShowPasswordModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                  </div>
                  
                  <div className="mb-4">
                      <p className="text-sm text-slate-600">Setting new password for user: <span className="font-bold text-slate-800">{selectedUserForReset.username}</span></p>
                  </div>

                  <form onSubmit={handlePasswordUpdate} className="space-y-4">
                      <div>
                          <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                          <input 
                              type="text" 
                              required 
                              placeholder="Enter new password"
                              value={newPasswordInput} 
                              onChange={e => setNewPasswordInput(e.target.value)} 
                              className="w-full p-2.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                          />
                      </div>
                      <div className="flex justify-end pt-2">
                          <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium hover:bg-blue-700 shadow-sm w-full">
                              Update Password
                          </button>
                      </div>
                  </form>
              </div>
          </div>
      )}
    </div>
  );
};

export default AdminSettings;
