
import React, { useState, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { Plus, Search, Building, Phone, MapPin, Trash2, Edit, Upload, FileSpreadsheet, Download, X, FileText } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Taxpayer } from '../types';

const TaxpayerList: React.FC = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showImportModal, setShowImportModal] = useState(false);

  const taxpayers = useLiveQuery(async () => {
    let collection = db.taxpayers.toCollection();
    let result = await collection.toArray();
    
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      result = result.filter(t => 
        t.tradeName.toLowerCase().includes(lower) ||
        t.gstin.toLowerCase().includes(lower) ||
        t.legalName.toLowerCase().includes(lower)
      );
    }
    return result;
  }, [searchTerm]);

  const handleDelete = async (id: number) => {
      if(confirm('Are you sure? Linked notices will NOT be deleted but will lose taxpayer details.')) {
          await db.taxpayers.delete(id);
      }
  }

  // --- IMPORT LOGIC ---
  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([{
      gstin: "27ABCDE1234F1Z5",
      tradeName: "Acme Traders",
      legalName: "Acme Traders Pvt Ltd",
      stateCode: "27",
      mobile: "9876543210",
      email: "email@example.com",
      registeredAddress: "Shop 1, Market Road, Mumbai"
    }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Taxpayers");
    XLSX.writeFile(wb, "GSTNexus_Import_Taxpayers.xlsx");
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const bstr = evt.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const data = XLSX.utils.sheet_to_json<any>(ws);

        let count = 0;
        let errors = 0;

        for (const row of data) {
           if(row.gstin && row.tradeName) {
             // Check if exists
             const exists = await db.taxpayers.where('gstin').equals(row.gstin).first();
             if (!exists) {
                await db.taxpayers.add({
                    gstin: row.gstin.toString().toUpperCase(),
                    tradeName: row.tradeName,
                    legalName: row.legalName || '',
                    stateCode: row.stateCode?.toString() || '',
                    mobile: row.mobile?.toString() || '',
                    email: row.email || '',
                    registeredAddress: row.registeredAddress || ''
                });
                count++;
             } else {
                 errors++;
             }
           }
        }
        alert(`Imported: ${count}. Skipped (Duplicate GSTIN): ${errors}`);
        setShowImportModal(false);
      } catch (err) {
        console.error(err);
        alert('Error parsing Excel file.');
      }
    };
    reader.readAsBinaryString(file);
  };

  return (
    <div className="flex flex-col h-full space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Taxpayer Master</h2>
          <p className="text-slate-500 text-sm">Manage client GSTINs and details</p>
        </div>
        <div className="flex gap-2">
            <button onClick={() => setShowImportModal(true)} className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all">
                <Upload size={18} /> Import
            </button>
            <Link to="/taxpayers/new" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 shadow-sm transition-all">
                <Plus size={18} /> Add Taxpayer
            </Link>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="relative mb-4">
               <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
               <input 
                  type="text" 
                  placeholder="Search by Trade Name, Legal Name or GSTIN..." 
                  className="w-full pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-md focus:ring-1 focus:ring-blue-500 outline-none"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
               />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {taxpayers?.map(t => (
                  <div key={t.id} className="border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow bg-slate-50 relative group">
                      <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => navigate('/notices', { state: { gstin: t.gstin } })} className="p-1.5 bg-white border rounded text-blue-600 hover:bg-blue-50" title="View Notices"><FileText size={14}/></button>
                          <button onClick={() => navigate(`/taxpayers/${t.id}`)} className="p-1.5 bg-white border rounded text-slate-600 hover:bg-slate-50" title="Edit Details"><Edit size={14}/></button>
                          <button onClick={() => handleDelete(t.id!)} className="p-1.5 bg-white border rounded text-red-600 hover:bg-red-50" title="Delete"><Trash2 size={14}/></button>
                      </div>
                      <div className="flex items-start gap-3 mb-2">
                          <div className="p-2 bg-white rounded-lg shadow-sm text-blue-600">
                              <Building size={20}/>
                          </div>
                          <div>
                              <h3 className="font-bold text-slate-800">{t.tradeName}</h3>
                              <p className="text-xs text-slate-500">{t.legalName}</p>
                          </div>
                      </div>
                      <div className="space-y-1.5 mt-3">
                          <div className="bg-white px-2 py-1 rounded border border-slate-200 inline-block font-mono text-xs font-bold text-slate-700">
                              {t.gstin}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-slate-600">
                              <Phone size={12} className="text-slate-400"/> {t.mobile || 'N/A'}
                          </div>
                          <div className="flex items-start gap-2 text-xs text-slate-600">
                              <MapPin size={12} className="text-slate-400 mt-0.5"/> 
                              <span className="line-clamp-2">{t.registeredAddress}</span>
                          </div>
                      </div>
                  </div>
              ))}
              {taxpayers?.length === 0 && (
                  <div className="col-span-full text-center py-10 text-slate-400">
                      No taxpayers found.
                  </div>
              )}
          </div>
      </div>

      {/* Import Modal */}
      {showImportModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95">
                  <div className="flex justify-between items-center mb-6">
                      <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                          <FileSpreadsheet className="text-green-600"/> Import Taxpayers
                      </h3>
                      <button onClick={() => setShowImportModal(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                  </div>
                  
                  <div className="space-y-6">
                      <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                          <p className="text-sm text-blue-800 mb-3">1. Download the template.</p>
                          <button onClick={downloadTemplate} className="text-xs bg-white border border-blue-200 text-blue-700 px-3 py-2 rounded flex items-center gap-2 hover:bg-blue-50">
                              <Download size={14}/> Download Template (.xlsx)
                          </button>
                      </div>

                      <div className="border-2 border-dashed border-slate-300 rounded-lg p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => fileInputRef.current?.click()}>
                          <Upload size={32} className="mx-auto text-slate-400 mb-2"/>
                          <p className="text-sm font-medium text-slate-600">Click to upload Excel file</p>
                          <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls" onChange={handleFileUpload} />
                      </div>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default TaxpayerList;
