import React, { useState, useEffect, useRef } from 'react';
import * as Icons from 'lucide-react';
import * as XLSX from 'xlsx';
import api from '../services/api';
import { useThemeStore } from '../store/themeStore';
import { useToastStore } from '../store/toastStore';
import { formatDate } from '../utils/dateFormatter';

interface User {
  _id: string;
  firstName: string;
  lastName: string;
  email: string;
  roleId?: any;
}

interface LeadRecord {
  _id: string;
  createdAt: string;
  data: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    email?: string;
    company?: string;
    status?: string;
    source?: string;
    campaignName?: string;
    assignedTo?: string;
    budget?: string;
    loanType?: string;
    city?: string;
    state?: string;
    notes?: string;
    [key: string]: any;
  };
}

const CRM_FIELDS = [
  { key: 'firstName', label: 'First Name / Full Name', aliases: ['name', 'costomer', 'customer', 'customer_name', 'first name', 'fullname', 'full name', 'lead name'] },
  { key: 'lastName', label: 'Last Name', aliases: ['last name', 'surname', 'lastname'] },
  { key: 'phone', label: 'Phone / Mobile', aliases: ['mobile', 'phone', 'contact', 'contact_num', 'contact num', 'phone_number', 'phone number', 'mobile number'] },
  { key: 'email', label: 'Email Address', aliases: ['email', 'mail', 'email address', 'e-mail'] },
  { key: 'company', label: 'Company / Firm', aliases: ['company', 'firm', 'firm_name', 'firm name', 'company name', 'business'] },
  { key: 'budget', label: 'Budget / Amount', aliases: ['budget', 'amount', 'loan amount', 'value'] },
  { key: 'loanType', label: 'Category / Loan Type', aliases: ['loan type', 'loantype', 'category', 'lead category', 'product'] },
  { key: 'city', label: 'City / Location', aliases: ['city', 'location', 'town'] },
  { key: 'state', label: 'State', aliases: ['state', 'region', 'province'] },
  { key: 'status', label: 'Lead Status', aliases: ['status', 'lead status', 'stage'] },
  { key: 'source', label: 'Source / Campaign', aliases: ['source', 'campaign', 'campaign name', 'lead source'] },
  { key: 'notes', label: 'Notes / Remarks', aliases: ['notes', 'remarks', 'remark', 'comment', 'description'] },
];

export default function LeadImportDelete() {
  const { branding } = useThemeStore();
  const { showToast, showAlertModal } = useToastStore();

  const [activeTab, setActiveTab] = useState<'import' | 'delete'>('import');

  // Common data
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  // ── Tab 1: Import State ──────────────────────────────────────────────
  const [file, setFile] = useState<File | null>(null);
  const [rawRows, setRawRows] = useState<any[]>([]);
  const [fileHeaders, setFileHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [campaignName, setCampaignName] = useState('');
  const [defaultStatus, setDefaultStatus] = useState('New');
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [distributeRoundRobin, setDistributeRoundRobin] = useState(true);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Tab 2: Delete State ──────────────────────────────────────────────
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [campaignOptions, setCampaignOptions] = useState<string[]>([]);
  const [statusOptions, setStatusOptions] = useState<string[]>([]);
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [totalLeadsCount, setTotalLeadsCount] = useState(0);

  // Delete Filters
  const [filterCampaign, setFilterCampaign] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterAgent, setFilterAgent] = useState('');
  const [filterStartDate, setFilterStartDate] = useState('');
  const [filterEndDate, setFilterEndDate] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  // Table selection
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [deleteMode, setDeleteMode] = useState<'selected' | 'all_filtered'>('selected');
  const [confirmInputText, setConfirmInputText] = useState('');

  // Quick Restore Specific Leads state
  interface QuickRestoreLeadRow {
    name: string;
    phone: string;
    status: string;
    loanType: string;
    amount: string;
    city: string;
    notes: string;
  }

  const [showQuickRestoreModal, setShowQuickRestoreModal] = useState(false);
  const [quickRestoreCampaign, setQuickRestoreCampaign] = useState('');
  const [quickRestoreRows, setQuickRestoreRows] = useState<QuickRestoreLeadRow[]>([
    { name: '', phone: '', status: 'HOT LEADS', loanType: '', amount: '', city: '', notes: '' },
    { name: '', phone: '', status: 'WARM LEADS', loanType: '', amount: '', city: '', notes: '' }
  ]);
  const [quickPasteText, setQuickPasteText] = useState('');
  const [showPasteBox, setShowPasteBox] = useState(false);
  const [savingQuickLeads, setSavingQuickLeads] = useState(false);

  const handleAddQuickRow = () => {
    setQuickRestoreRows(prev => [
      ...prev,
      { name: '', phone: '', status: 'HOT LEADS', loanType: '', amount: '', city: '', notes: '' }
    ]);
  };

  const handleRemoveQuickRow = (idx: number) => {
    setQuickRestoreRows(prev => prev.filter((_, i) => i !== idx));
  };

  const handleQuickRowChange = (idx: number, field: keyof QuickRestoreLeadRow, val: string) => {
    setQuickRestoreRows(prev => prev.map((row, i) => i === idx ? { ...row, [field]: val } : row));
  };

  const handleParsePasteText = () => {
    if (!quickPasteText.trim()) return;
    const lines = quickPasteText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const newRows: QuickRestoreLeadRow[] = [];

    for (const line of lines) {
      const parts = line.split(/[,\t|]+/).map(p => p.trim());
      if (parts.length === 1) {
        const val = parts[0];
        if (/\d{7,15}/.test(val)) {
          newRows.push({ name: '', phone: val, status: 'HOT LEADS', loanType: '', amount: '', city: '', notes: '' });
        } else {
          newRows.push({ name: val, phone: '', status: 'HOT LEADS', loanType: '', amount: '', city: '', notes: '' });
        }
      } else {
        const p1 = parts[0] || '';
        const p2 = parts[1] || '';
        let name = '';
        let phone = '';
        if (/\d{7,15}/.test(p1) && !/\d{7,15}/.test(p2)) {
          phone = p1;
          name = p2;
        } else {
          name = p1;
          phone = p2;
        }
        const status = parts[2] || 'HOT LEADS';
        const amount = parts[3] || '';
        const city = parts[4] || '';
        const notes = parts.slice(5).join(' ') || '';
        newRows.push({ name, phone, status, loanType: '', amount, city, notes });
      }
    }

    if (newRows.length > 0) {
      setQuickRestoreRows(newRows);
      setShowPasteBox(false);
      showToast(`Parsed ${newRows.length} lead(s) successfully!`, 'success');
    }
  };

  const handleSaveQuickLeads = async () => {
    const validRows = quickRestoreRows.filter(r => r.phone.trim() || r.name.trim());
    if (validRows.length === 0) {
      showToast('Please enter at least one lead with a phone number or customer name.', 'warning');
      return;
    }
    const camp = quickRestoreCampaign.trim() || 'Restored Campaign Leads';

    setSavingQuickLeads(true);
    try {
      const res = await api.post('/records/leads/bulk-import', {
        campaignName: camp,
        leads: validRows.map(r => ({
          name: r.name.trim(),
          firstName: r.name.trim().split(' ')[0] || r.name.trim(),
          lastName: r.name.trim().split(' ').slice(1).join(' ') || '',
          phone: r.phone.trim(),
          mobile: r.phone.trim(),
          status: r.status || 'HOT LEADS',
          dialStatus: r.status || 'HOT LEADS',
          loanType: r.loanType.trim(),
          amount: r.amount.trim(),
          city: r.city.trim(),
          location: r.city.trim(),
          notes: r.notes.trim(),
          remarks: r.notes.trim()
        }))
      });

      showAlertModal({
        title: 'Leads Successfully Restored!',
        message: `Successfully created and restored ${res.data?.count || validRows.length} lead(s) into campaign "${camp}"! You can now manage and dial them directly in My Campaign.`,
        type: 'success'
      });

      setShowQuickRestoreModal(false);
      setQuickRestoreRows([
        { name: '', phone: '', status: 'HOT LEADS', loanType: '', amount: '', city: '', notes: '' },
        { name: '', phone: '', status: 'WARM LEADS', loanType: '', amount: '', city: '', notes: '' }
      ]);
      setQuickPasteText('');
      fetchFilterMeta();
    } catch (err: any) {
      showToast(err.response?.data?.error || err.message || 'Failed to restore leads.', 'error');
    } finally {
      setSavingQuickLeads(false);
    }
  };

  const handleRecoverDeletedLeads = async () => {
    setRecovering(true);
    try {
      const res = await api.post('/records/leads/recover-deleted');
      if (res.data.recoveredCount > 0) {
        showAlertModal({
          title: 'Leads Successfully Recovered!',
          message: `Successfully restored ${res.data.recoveredCount} deleted lead(s) into your CRM database!`,
          type: 'success'
        });
        fetchFilterMeta();
      } else {
        showAlertModal({
          title: 'No Automated Snapshots in Audit Trail',
          message: 'Bulk Excel uploads log summary counts rather than individual rows in audit logs. To restore specific leads now, you can click "Restore Specific Leads" to enter or paste them directly, or re-upload your source Excel sheet.',
          type: 'info'
        });
      }
    } catch (err: any) {
      showToast(err.response?.data?.error || err.message || 'Failed to recover deleted leads.', 'error');
    } finally {
      setRecovering(false);
    }
  };

  // Load Users & Metadata
  useEffect(() => {
    fetchUsers();
    fetchFilterMeta();
  }, []);

  const fetchUsers = async () => {
    try {
      setLoadingUsers(true);
      const res = await api.get('/auth/users?purpose=dropdown');
      setUsers(res.data || []);
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setLoadingUsers(false);
    }
  };

  const fetchFilterMeta = async () => {
    try {
      const res = await api.get('/records/leads/filters-meta');
      setCampaignOptions(res.data.campaigns || []);
      setStatusOptions(res.data.statuses || []);
      setSourceOptions(res.data.sources || []);
      setTotalLeadsCount(res.data.totalLeads || 0);
    } catch (err) {
      console.error('Failed to fetch filter metadata:', err);
    }
  };

  const fetchLeadsForDelete = async () => {
    try {
      setLoadingLeads(true);
      let url = '/records/leads?limit=1000';
      const res = await api.get(url);
      const fetched: LeadRecord[] = res.data.records || res.data || [];
      setLeads(fetched);
    } catch (err) {
      console.error('Failed to fetch leads:', err);
      showToast('Failed to load leads list.', 'error');
    } finally {
      setLoadingLeads(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'delete') {
      fetchLeadsForDelete();
      fetchFilterMeta();
    }
  }, [activeTab]);

  // ── Import Handlers ────────────────────────────────────────────────
  const autoMapHeaders = (headers: string[]) => {
    const mapping: Record<string, string> = {};
    headers.forEach((hdr) => {
      const cleanHdr = hdr.toLowerCase().trim();
      let matchedKey = 'ignore';

      for (const field of CRM_FIELDS) {
        if (field.aliases.some((alias) => cleanHdr === alias || cleanHdr.includes(alias))) {
          matchedKey = field.key;
          break;
        }
      }
      mapping[hdr] = matchedKey;
    });
    setColumnMapping(mapping);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    const fileName = uploadedFile.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        let parsed: any[] = [];
        let headers: string[] = [];

        if (isExcel) {
          const buffer = event.target?.result as ArrayBuffer;
          const workbook = XLSX.read(buffer, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[firstSheetName];
          parsed = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: '' });
          if (parsed.length > 0) {
            headers = Object.keys(parsed[0]);
          }
        } else {
          const csvText = event.target?.result as string;
          const lines = csvText.split(/\r\n|\n/).filter((l) => l.trim() !== '');
          if (lines.length > 0) {
            headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
            for (let i = 1; i < lines.length; i++) {
              const values = lines[i].split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
              const rowObj: Record<string, any> = {};
              headers.forEach((h, idx) => {
                rowObj[h] = values[idx] || '';
              });
              parsed.push(rowObj);
            }
          }
        }

        if (parsed.length === 0) {
          showToast('The uploaded file contains no data rows.', 'warning');
          return;
        }

        setRawRows(parsed);
        setFileHeaders(headers);
        autoMapHeaders(headers);
        showToast(`Parsed ${parsed.length} rows successfully. Please verify column mapping.`, 'success');
      } catch (err) {
        console.error(err);
        showToast('Failed to parse uploaded file. Please check file format.', 'error');
      }
    };

    if (isExcel) {
      reader.readAsArrayBuffer(uploadedFile);
    } else {
      reader.readAsText(uploadedFile);
    }
  };

  const handleDownloadSample = () => {
    const sampleData = [
      {
        'First Name': 'Zaid',
        'Last Name': 'Ahmed',
        'Mobile': '9876543210',
        'Email Address': 'zaid@example.com',
        'Company': 'FMCG Enterprises',
        'Budget': '500000',
        'Category': 'Business Loan',
        'City': 'Mumbai',
        'State': 'Maharashtra',
        'Lead Status': 'New',
        'Lead Source': 'Summer Campaign',
        'Notes': 'High priority lead for expansion'
      },
      {
        'First Name': 'Mohammed',
        'Last Name': 'Hashmat',
        'Mobile': '9123456789',
        'Email Address': 'hashmat@example.com',
        'Company': 'Global Traders',
        'Budget': '1000000',
        'Category': 'Commercial Finance',
        'City': 'Bengaluru',
        'State': 'Karnataka',
        'Lead Status': 'New',
        'Lead Source': 'Digital Ads',
        'Notes': 'Interested in quarterly financing'
      }
    ];

    const worksheet = XLSX.utils.json_to_sheet(sampleData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sample Leads');
    XLSX.writeFile(workbook, 'Sample_Leads_Import_Template.xlsx');
    showToast('Sample Excel template downloaded!', 'success');
  };

  const handleExecuteImport = async () => {
    if (rawRows.length === 0) {
      showToast('Please upload a valid Excel or CSV file first.', 'warning');
      return;
    }

    try {
      setImporting(true);

      const assignedAgentNames = selectedAgentIds.map((id) => {
        const u = users.find((usr) => usr._id === id);
        return u ? `${u.firstName} ${u.lastName}`.trim() : id;
      });

      const payload = {
        leads: rawRows,
        columnMapping,
        campaignName: campaignName.trim(),
        defaultStatus,
        assignedTo: assignedAgentNames
      };

      const res = await api.post('/records/leads/bulk-import', payload);
      showToast(res.data.message || `Successfully imported ${res.data.count} leads!`, 'success');

      // Reset import form
      setFile(null);
      setRawRows([]);
      setFileHeaders([]);
      setColumnMapping({});
      setCampaignName('');
      if (fileInputRef.current) fileInputRef.current.value = '';

      fetchFilterMeta();
    } catch (err: any) {
      console.error('Import error:', err);
      showToast(err.response?.data?.error || 'Failed to import leads.', 'error');
    } finally {
      setImporting(false);
    }
  };

  // ── Delete Handlers ────────────────────────────────────────────────
  const filteredLeads = leads.filter((lead) => {
    const d = lead.data || {};
    const src = (d.source || d.campaignName || '').toString().toLowerCase();
    const st = (d.status || '').toString().toLowerCase();
    const ass = (d.assignedTo || '').toString().toLowerCase();

    if (filterCampaign && !src.includes(filterCampaign.toLowerCase())) return false;
    if (filterStatus && st !== filterStatus.toLowerCase()) return false;
    if (filterAgent && !ass.includes(filterAgent.toLowerCase())) return false;

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const fn = (d.firstName || '').toLowerCase();
      const ln = (d.lastName || '').toLowerCase();
      const ph = (d.phone || '').toLowerCase();
      const em = (d.email || '').toLowerCase();
      const comp = (d.company || '').toLowerCase();
      if (!fn.includes(q) && !ln.includes(q) && !ph.includes(q) && !em.includes(q) && !comp.includes(q)) {
        return false;
      }
    }

    if (filterStartDate || filterEndDate) {
      const created = new Date(lead.createdAt).getTime();
      if (filterStartDate && created < new Date(filterStartDate).getTime()) return false;
      if (filterEndDate) {
        const end = new Date(filterEndDate);
        end.setHours(23, 59, 59, 999);
        if (created > end.getTime()) return false;
      }
    }

    return true;
  });

  const handleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked) {
      setSelectedLeadIds(filteredLeads.map((l) => l._id));
    } else {
      setSelectedLeadIds([]);
    }
  };

  const handleSelectOne = (id: string) => {
    setSelectedLeadIds((prev) => (prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]));
  };

  const openDeleteModal = (mode: 'selected' | 'all_filtered') => {
    const count = mode === 'selected' ? selectedLeadIds.length : filteredLeads.length;
    if (count === 0) {
      showToast(mode === 'selected' ? 'No leads selected to delete.' : 'No matching leads found to purge.', 'warning');
      return;
    }
    setDeleteMode(mode);
    setConfirmInputText('');
    setShowConfirmModal(true);
  };

  const handleConfirmDelete = async () => {
    if (confirmInputText.toUpperCase() !== 'DELETE') {
      showToast('Please type "DELETE" to confirm deletion.', 'warning');
      return;
    }

    try {
      setDeleting(true);
      let payload: any = {};

      if (deleteMode === 'selected') {
        payload = { leadIds: selectedLeadIds };
      } else {
        payload = {
          deleteAllMatching: true,
          filters: {
            campaignName: filterCampaign,
            status: filterStatus,
            assignedTo: filterAgent,
            startDate: filterStartDate,
            endDate: filterEndDate,
            searchQuery: searchQuery
          }
        };
      }

      const res = await api.post('/records/leads/bulk-delete', payload);
      showToast(res.data.message || `Successfully deleted ${res.data.count} lead(s).`, 'success');

      setShowConfirmModal(false);
      setSelectedLeadIds([]);
      fetchLeadsForDelete();
      fetchFilterMeta();
    } catch (err: any) {
      console.error('Delete error:', err);
      showToast(err.response?.data?.error || 'Failed to delete leads.', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1600px] mx-auto min-h-screen pb-20">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400">
              <Icons.ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                Lead Import & Deletion Management
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                Bulk import new leads via Excel/CSV or safely purge lead batches from the database.
              </p>
            </div>
          </div>
        </div>

        {/* Tab Navigation Switches */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <button
              onClick={() => setActiveTab('import')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer ${
                activeTab === 'import'
                  ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icons.FileSpreadsheet className="w-4 h-4" />
              <span>Lead Import</span>
            </button>
            <button
              onClick={() => setActiveTab('delete')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs sm:text-sm font-semibold transition-all duration-150 cursor-pointer ${
                activeTab === 'delete'
                  ? 'bg-white dark:bg-slate-900 text-red-600 dark:text-red-400 shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <Icons.Trash2 className="w-4 h-4" />
              <span>Lead Bulk Delete</span>
            </button>
          </div>

          <button
            onClick={handleRecoverDeletedLeads}
            disabled={recovering}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-xl text-xs sm:text-sm font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
            title="Scan system audit logs to recover deleted leads"
          >
            <Icons.RotateCcw className={`w-4 h-4 ${recovering ? 'animate-spin' : ''}`} />
            <span>{recovering ? 'Recovering Leads...' : 'Recover Deleted Leads'}</span>
          </button>

          <button
            onClick={() => setShowQuickRestoreModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs sm:text-sm font-bold transition-all shadow-sm cursor-pointer"
            title="Restore or add specific leads by typing or pasting"
          >
            <Icons.PlusCircle className="w-4 h-4" />
            <span>Restore Specific Leads</span>
          </button>
        </div>
      </div>

      {/* ────────────────── TAB 1: LEAD IMPORT ────────────────── */}
      {activeTab === 'import' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Top Info & Sample Download */}
          <div className="bg-gradient-to-r from-red-500/10 via-amber-500/5 to-transparent p-5 rounded-2xl border border-red-200/50 dark:border-red-900/30 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Icons.Sparkles className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Excel & CSV Bulk Lead Import Studio
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 max-w-3xl">
                  Upload spreadsheets containing lead details. The system automatically maps standard headers like First Name, Phone, Email, Company, Loan Type, and Source. You can also assign leads round-robin to telecallers.
                </p>
              </div>
            </div>
            <button
              onClick={handleDownloadSample}
              className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-xl text-xs font-semibold shadow-sm transition-all flex-shrink-0 cursor-pointer"
            >
              <Icons.Download className="w-4 h-4 text-red-600 dark:text-red-400" />
              <span>Download Sample Template</span>
            </button>
          </div>

          {/* Grid Layout: Upload Controls + Mapping */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: File Upload & Settings */}
            <div className="lg:col-span-5 space-y-6">
              {/* Dropzone Card */}
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Icons.UploadCloud className="w-4 h-4 text-red-600 dark:text-red-400" />
                  Step 1: Upload File
                </h3>

                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-red-500 dark:hover:border-red-500 rounded-2xl p-8 text-center bg-slate-50/50 dark:bg-slate-800/30 transition-all cursor-pointer group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx, .xls, .csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-950/50 text-red-600 dark:text-red-400 mx-auto flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Icons.FileSpreadsheet className="w-6 h-6" />
                  </div>
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200 mt-3">
                    {file ? file.name : 'Click to select or drag & drop file'}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-1">Supports XLSX, XLS, and CSV files</p>
                </div>

                {file && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                    <div className="flex items-center gap-2 truncate">
                      <Icons.CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{file.name}</span>
                    </div>
                    <span className="text-slate-500 font-mono text-[11px] flex-shrink-0">
                      {rawRows.length} rows parsed
                    </span>
                  </div>
                )}
              </div>

              {/* Import Options Card */}
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Icons.SlidersHorizontal className="w-4 h-4 text-red-600 dark:text-red-400" />
                  Step 2: Campaign & Assignment Config
                </h3>

                {/* Campaign Name */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Campaign / Lead Source Name
                  </label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g. FMCG Diwali Promo 2026"
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-red-500 text-slate-900 dark:text-white"
                  />
                </div>

                {/* Default Status */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-700 dark:text-slate-300">
                    Default Lead Status
                  </label>
                  <select
                    value={defaultStatus}
                    onChange={(e) => setDefaultStatus(e.target.value)}
                    className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-red-500 text-slate-900 dark:text-white"
                  >
                    <option value="New">New</option>
                    <option value="Yet To Call">Yet To Call</option>
                    <option value="Contacted">Contacted</option>
                    <option value="Interested">Interested</option>
                    <option value="In Progress">In Progress</option>
                  </select>
                </div>

                {/* Assign to Employees / Round Robin */}
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                    <span>Assign Imported Leads To Telecallers</span>
                    <span className="text-[10px] text-slate-400 font-normal">Optional</span>
                  </label>

                  <div className="max-h-40 overflow-y-auto space-y-1 pr-1 border border-slate-200 dark:border-slate-700 rounded-xl p-2 bg-slate-50/50 dark:bg-slate-800/30">
                    {users.map((usr) => {
                      const isChecked = selectedAgentIds.includes(usr._id);
                      return (
                        <label
                          key={usr._id}
                          className={`flex items-center justify-between p-2 rounded-lg text-xs transition-colors cursor-pointer ${
                            isChecked
                              ? 'bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 font-medium'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <span>
                            {usr.firstName} {usr.lastName} <span className="text-[10px] text-slate-400">({usr.email})</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedAgentIds((prev) => [...prev, usr._id]);
                              } else {
                                setSelectedAgentIds((prev) => prev.filter((id) => id !== usr._id));
                              }
                            }}
                            className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300"
                          />
                        </label>
                      );
                    })}
                  </div>

                  {selectedAgentIds.length > 1 && (
                    <p className="text-[11px] text-red-600 dark:text-red-400 flex items-center gap-1.5 mt-1 font-medium">
                      <Icons.RefreshCw className="w-3 h-3" />
                      Leads will be evenly distributed round-robin across {selectedAgentIds.length} agents.
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Right Column: Column Mapping & Data Preview */}
            <div className="lg:col-span-7 space-y-6">
              {/* Column Mapping Card */}
              <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Icons.ArrowRightLeft className="w-4 h-4 text-red-600 dark:text-red-400" />
                    Step 3: Field Mapping
                  </h3>
                  {fileHeaders.length > 0 && (
                    <span className="text-xs text-slate-500">
                      {fileHeaders.length} columns detected
                    </span>
                  )}
                </div>

                {fileHeaders.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 text-xs border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                    Upload an Excel/CSV file to preview and configure column mapping.
                  </div>
                ) : (
                  <div className="max-h-72 overflow-y-auto space-y-2 pr-1 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
                    {fileHeaders.map((hdr) => (
                      <div
                        key={hdr}
                        className="flex items-center justify-between gap-3 p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-xs"
                      >
                        <div className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[200px]">
                          {hdr}
                        </div>
                        <Icons.ArrowRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                        <select
                          value={columnMapping[hdr] || 'ignore'}
                          onChange={(e) =>
                            setColumnMapping((prev) => ({
                              ...prev,
                              [hdr]: e.target.value
                            }))
                          }
                          className="px-3 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium text-slate-900 dark:text-white"
                        >
                          <option value="ignore">-- Do Not Map --</option>
                          {CRM_FIELDS.map((f) => (
                            <option key={f.key} value={f.key}>
                              {f.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Data Preview Table */}
              {rawRows.length > 0 && (
                <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <Icons.Eye className="w-4 h-4 text-red-600 dark:text-red-400" />
                      Preview Mapped Data (First 5 Rows)
                    </h3>
                  </div>

                  <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                    <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                      <thead className="bg-slate-100 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white">
                        <tr>
                          {CRM_FIELDS.filter((f) => Object.values(columnMapping).includes(f.key)).map((f) => (
                            <th key={f.key} className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 whitespace-nowrap">
                              {f.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rawRows.slice(0, 5).map((row, idx) => (
                          <tr key={idx} className="border-b border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800/30">
                            {CRM_FIELDS.filter((f) => Object.values(columnMapping).includes(f.key)).map((f) => {
                              const rawHeader = Object.keys(columnMapping).find((k) => columnMapping[k] === f.key);
                              const cellVal = rawHeader ? row[rawHeader] : '';
                              return (
                                <td key={f.key} className="px-3 py-2 whitespace-nowrap truncate max-w-[150px]">
                                  {cellVal || '-'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Import Button */}
                  <div className="pt-2 flex justify-end">
                    <button
                      onClick={handleExecuteImport}
                      disabled={importing || rawRows.length === 0}
                      className="flex items-center gap-2 px-6 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-red-600/20 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {importing ? (
                        <>
                          <Icons.Loader2 className="w-4 h-4 animate-spin" />
                          <span>Importing {rawRows.length} Leads...</span>
                        </>
                      ) : (
                        <>
                          <Icons.CheckCircle2 className="w-4 h-4" />
                          <span>Confirm & Import {rawRows.length} Leads</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ────────────────── TAB 2: LEAD BULK DELETE ────────────────── */}
      {activeTab === 'delete' && (
        <div className="space-y-6 animate-fadeIn">
          {/* Top Warning Banner */}
          <div className="bg-red-500/10 p-5 rounded-2xl border border-red-500/20 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <Icons.AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-bold text-red-900 dark:text-red-200">
                  Lead Bulk Purge & Deletion Controls
                </h3>
                <p className="text-xs text-red-700 dark:text-red-300 mt-1 max-w-3xl">
                  Filter and delete unwanted lead batches or obsolete records. Deletions are permanent and will update reports and assigned lead statistics immediately.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => openDeleteModal('selected')}
                disabled={selectedLeadIds.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-red-600/20 disabled:opacity-40 transition-all cursor-pointer"
              >
                <Icons.Trash2 className="w-4 h-4" />
                <span>Delete Selected ({selectedLeadIds.length})</span>
              </button>
              <button
                onClick={() => openDeleteModal('all_filtered')}
                disabled={filteredLeads.length === 0}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 dark:bg-slate-100 dark:text-slate-900 text-white hover:bg-black rounded-xl text-xs font-bold shadow-md disabled:opacity-40 transition-all cursor-pointer"
              >
                <Icons.Zap className="w-4 h-4 text-amber-400 dark:text-amber-600" />
                <span>Purge All Filtered ({filteredLeads.length})</span>
              </button>
            </div>
          </div>

          {/* Filters Bar */}
          <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider flex items-center gap-2">
                <Icons.Filter className="w-4 h-4 text-red-600 dark:text-red-400" />
                Lead Filters & Search
              </h3>
              <div className="text-xs text-slate-500 font-medium">
                Showing <span className="font-bold text-slate-900 dark:text-white">{filteredLeads.length}</span> of {totalLeadsCount} total leads
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              {/* Campaign Filter */}
              <div>
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                  Campaign / Source
                </label>
                <select
                  value={filterCampaign}
                  onChange={(e) => setFilterCampaign(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="">All Campaigns</option>
                  {campaignOptions.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status Filter */}
              <div>
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                  Status
                </label>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="">All Statuses</option>
                  {statusOptions.map((st) => (
                    <option key={st} value={st}>
                      {st}
                    </option>
                  ))}
                </select>
              </div>

              {/* Assigned Agent Filter */}
              <div>
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                  Assigned Agent
                </label>
                <select
                  value={filterAgent}
                  onChange={(e) => setFilterAgent(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="">All Agents</option>
                  {users.map((u) => {
                    const name = `${u.firstName} ${u.lastName}`.trim();
                    return (
                      <option key={u._id} value={name}>
                        {name}
                      </option>
                    );
                  })}
                </select>
              </div>

              {/* Start Date */}
              <div>
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                  From Date
                </label>
                <input
                  type="date"
                  value={filterStartDate}
                  onChange={(e) => setFilterStartDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                  To Date
                </label>
                <input
                  type="date"
                  value={filterEndDate}
                  onChange={(e) => setFilterEndDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>

              {/* Search Query */}
              <div>
                <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                  Search Keyword
                </label>
                <div className="relative">
                  <Icons.Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Name, Phone, Email..."
                    className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Leads Table */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={filteredLeads.length > 0 && selectedLeadIds.length === filteredLeads.length}
                  onChange={handleSelectAll}
                  className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300 cursor-pointer"
                />
                <span>Select All ({filteredLeads.length} leads)</span>
              </div>
              <span className="text-xs text-slate-500">
                {selectedLeadIds.length} leads selected
              </span>
            </div>

            {loadingLeads ? (
              <div className="py-20 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
                <Icons.Loader2 className="w-6 h-6 animate-spin text-red-600" />
                <span>Loading leads from database...</span>
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs">
                No leads match the specified filter criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 font-semibold text-slate-900 dark:text-white">
                    <tr>
                      <th className="p-3.5 w-10">#</th>
                      <th className="p-3.5">Lead Name</th>
                      <th className="p-3.5">Phone</th>
                      <th className="p-3.5">Email</th>
                      <th className="p-3.5">Company / Firm</th>
                      <th className="p-3.5">Campaign / Source</th>
                      <th className="p-3.5">Status</th>
                      <th className="p-3.5">Assigned To</th>
                      <th className="p-3.5">Created Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredLeads.map((lead) => {
                      const d = lead.data || {};
                      const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unnamed Lead';
                      const isSelected = selectedLeadIds.includes(lead._id);

                      return (
                        <tr
                          key={lead._id}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${
                            isSelected ? 'bg-red-50/50 dark:bg-red-950/20' : ''
                          }`}
                        >
                          <td className="p-3.5">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleSelectOne(lead._id)}
                              className="w-4 h-4 rounded text-red-600 focus:ring-red-500 border-slate-300 cursor-pointer"
                            />
                          </td>
                          <td className="p-3.5 font-bold text-slate-900 dark:text-white">
                            {fullName}
                          </td>
                          <td className="p-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                            {d.phone || '-'}
                          </td>
                          <td className="p-3.5 text-slate-600 dark:text-slate-400">
                            {d.email || '-'}
                          </td>
                          <td className="p-3.5 text-slate-700 dark:text-slate-300">
                            {d.company || '-'}
                          </td>
                          <td className="p-3.5">
                            <span className="px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                              {d.source || d.campaignName || 'Direct'}
                            </span>
                          </td>
                          <td className="p-3.5">
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                              {d.status || 'New'}
                            </span>
                          </td>
                          <td className="p-3.5 text-slate-700 dark:text-slate-300 font-medium">
                            {d.assignedTo || 'Unassigned'}
                          </td>
                          <td className="p-3.5 text-[11px] text-slate-500">
                            {formatDate(lead.createdAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Safeguard Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-md w-full p-6 shadow-2xl border border-red-500/30 space-y-4">
            <div className="flex items-center gap-3 text-red-600 dark:text-red-400">
              <div className="p-3 rounded-full bg-red-100 dark:bg-red-950">
                <Icons.AlertOctagon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Confirm Lead Deletion
                </h3>
                <p className="text-xs text-slate-500">Permanent Action</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              You are about to delete{' '}
              <span className="font-bold text-red-600 dark:text-red-400">
                {deleteMode === 'selected' ? selectedLeadIds.length : filteredLeads.length} lead record(s)
              </span>{' '}
              permanently from the database. This action cannot be undone.
            </p>

            <div className="space-y-1.5 pt-2">
              <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Type <span className="font-mono text-red-600 dark:text-red-400 font-bold">DELETE</span> to confirm:
              </label>
              <input
                type="text"
                value={confirmInputText}
                onChange={(e) => setConfirmInputText(e.target.value)}
                placeholder="DELETE"
                className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-red-300 dark:border-red-900/60 font-mono tracking-widest text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-4">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                disabled={deleting || confirmInputText.toUpperCase() !== 'DELETE'}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold shadow-md shadow-red-600/20 disabled:opacity-40 transition-all cursor-pointer"
              >
                {deleting ? (
                  <Icons.Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Icons.Trash2 className="w-4 h-4" />
                )}
                <span>Confirm Permanent Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* QUICK RESTORE SPECIFIC LEADS MODAL */}
      {showQuickRestoreModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-4xl w-full p-6 shadow-2xl border border-blue-500/30 space-y-4 my-8">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                  <Icons.PlusCircle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                    Restore Specific Leads
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Quickly restore the few leads you need back into your CRM and campaign.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowQuickRestoreModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <Icons.X className="w-5 h-5" />
              </button>
            </div>

            {/* Campaign Name selector */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Assign to Campaign Name:
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={quickRestoreCampaign}
                  onChange={(e) => setQuickRestoreCampaign(e.target.value)}
                  placeholder="e.g. HAVERI-VC-12-11-26 or Restored Leads"
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPasteBox(!showPasteBox)}
                  className="px-3 py-2 text-xs font-semibold bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl whitespace-nowrap transition-colors"
                >
                  {showPasteBox ? 'Hide Paste Box' : '📋 Quick Paste List'}
                </button>
              </div>
            </div>

            {/* Quick Paste Area */}
            {showPasteBox && (
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Paste Multiple Leads (comma or tab separated, one per line):
                </label>
                <textarea
                  rows={4}
                  value={quickPasteText}
                  onChange={(e) => setQuickPasteText(e.target.value)}
                  placeholder="Format: Name, Phone, Status, Amount, Location, Remarks&#10;e.g.: Kiran Viranna, 9164287654, HOT LEADS, 500000, Haveri, Followup next week&#10;Munna Kotipura, 9945898765, WARM LEADS, 300000, Haveri"
                  className="w-full p-2.5 text-xs font-mono rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleParsePasteText}
                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                  >
                    Parse into Table Below
                  </button>
                </div>
              </div>
            )}

            {/* Rows Table */}
            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              <div className="grid grid-cols-12 gap-2 text-[11px] font-bold text-slate-500 uppercase px-1">
                <div className="col-span-3">Customer Name</div>
                <div className="col-span-2">Mobile Number</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Loan Amount</div>
                <div className="col-span-2">City / Location</div>
                <div className="col-span-1 text-center">Action</div>
              </div>

              {quickRestoreRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center bg-slate-50/70 dark:bg-slate-800/40 p-1.5 rounded-xl border border-slate-200/60 dark:border-slate-800">
                  <div className="col-span-3">
                    <input
                      type="text"
                      placeholder="Customer Name"
                      value={row.name}
                      onChange={(e) => handleQuickRowChange(idx, 'name', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="tel"
                      placeholder="Mobile No."
                      value={row.phone}
                      onChange={(e) => handleQuickRowChange(idx, 'phone', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-semibold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <select
                      value={row.status}
                      onChange={(e) => handleQuickRowChange(idx, 'status', e.target.value)}
                      className="w-full px-2 py-1.5 text-xs font-bold uppercase rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="HOT LEADS">HOT LEADS</option>
                      <option value="WARM LEADS">WARM LEADS</option>
                      <option value="YET TO CALL">YET TO CALL</option>
                      <option value="CEBIL PENDING">CEBIL PENDING</option>
                      <option value="DOCUMENT PENDING">DOCUMENT PENDING</option>
                      <option value="NOT CONNECTED">NOT CONNECTED</option>
                      <option value="CALL REJECTED">CALL REJECTED</option>
                      <option value="INTERESTED">INTERESTED</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="text"
                      placeholder="Amount"
                      value={row.amount}
                      onChange={(e) => handleQuickRowChange(idx, 'amount', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <input
                      type="text"
                      placeholder="Location"
                      value={row.city}
                      onChange={(e) => handleQuickRowChange(idx, 'city', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div className="col-span-1 text-center">
                    {quickRestoreRows.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveQuickRow(idx)}
                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-colors"
                        title="Remove row"
                      >
                        <Icons.Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={handleAddQuickRow}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-lg transition-colors cursor-pointer"
              >
                <Icons.Plus className="w-4 h-4" />
                <span>+ Add Another Lead</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowQuickRestoreModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveQuickLeads}
                  disabled={savingQuickLeads}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-600/20 disabled:opacity-50 transition-all cursor-pointer"
                >
                  {savingQuickLeads ? (
                    <Icons.Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Icons.Check className="w-4 h-4 stroke-[3]" />
                  )}
                  <span>Restore Leads into CRM</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
