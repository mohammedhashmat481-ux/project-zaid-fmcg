import React, { useEffect, useState, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { useParams, Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useDelayedLoading } from '../hooks/useDelayedLoading';
import { useDebounce } from '../hooks/useDebounce';
import * as Icons from 'lucide-react';
import { useModuleStore, ModuleDefinition } from '../store/moduleStore';
import { useAuthStore } from '../store/authStore';
import api, { FILE_BASE_URL } from '../services/api';
import { DynamicIcon } from '../components/Layout';
import { useToastStore } from '../store/toastStore';
import { useThemeStore } from '../store/themeStore';
import { formatDate } from '../utils/dateFormatter';
import { exportCampaignCSV } from '../utils/exportCampaignCSV';
import { exportLeadReportXLSX } from '../utils/exportLeadReportXLSX';
import { getStatusTokens } from '../utils/statusTokenMapper';

type ViewMode = 'table' | 'kanban' | 'calendar' | 'timeline';

export default function ModuleView() {
  const { apiPath } = useParams<{ apiPath: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  const { activeModule, setActiveModuleByPath, modules, loadingModules } = useModuleStore();
  const { canAccessMenu } = useAuthStore();
  const { branding } = useThemeStore();
  const { showConfirm, showToast, showAlertModal } = useToastStore();

  useEffect(() => {
    if (apiPath && !canAccessMenu(apiPath.toLowerCase())) {
      navigate('/', { replace: true });
    }
  }, [apiPath, canAccessMenu, navigate]);

  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [searchVal, setSearchVal] = useState('');
  const debouncedSearchVal = useDebounce(searchVal, 300);
  const [filterField, setFilterField] = useState('');
  const [filterVal, setFilterVal] = useState('');
  const [page, setPage] = useState(1);

  // File upload and History timeline states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRecordId, setUploadingRecordId] = useState<string | null>(null);
  const [activeHistoryRecord, setActiveHistoryRecord] = useState<any | null>(null);
  const [historyActivities, setHistoryActivities] = useState<any[]>([]);
  const [historyDocuments, setHistoryDocuments] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Phone number masking state and toggle
  const [revealedPhones, setRevealedPhones] = useState<Record<string, boolean>>({});
  const togglePhoneReveal = (id: string) => {
    setRevealedPhones(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const maskPhoneNumber = (phone?: string, isRevealed: boolean = false) => {
    if (!phone || phone === 'N/A') return 'N/A';
    const clean = String(phone).trim();
    if (isRevealed) return clean;
    if (clean.length <= 4) return '******';
    if (clean.length === 10) {
      return `${clean.slice(0, 5)}*****`;
    }
    const prefixLen = Math.min(4, Math.floor(clean.length / 2));
    return `${clean.slice(0, prefixLen)}${'*'.repeat(Math.max(4, clean.length - prefixLen))}`;
  };

  const getStatusTheme = (status?: string) => {
    const s = String(status || '').toUpperCase();
    if (s.includes('HOT')) {
      return {
        gradient: 'from-rose-500 via-pink-500 to-red-500',
        badge: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/40',
        dot: 'bg-rose-500'
      };
    }
    if (s.includes('DISBUS') || s.includes('APPROVED')) {
      return {
        gradient: 'from-emerald-500 via-teal-500 to-green-600',
        badge: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/40',
        dot: 'bg-emerald-500'
      };
    }
    if (s.includes('WARM') || s.includes('APPROVAL PENDING') || s.includes('DOCUMENT')) {
      return {
        gradient: 'from-amber-400 via-orange-400 to-amber-500',
        badge: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/40',
        dot: 'bg-amber-500'
      };
    }
    if (s.includes('REJECT') || s.includes('DROP')) {
      return {
        gradient: 'from-slate-400 to-slate-600',
        badge: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
        dot: 'bg-slate-500'
      };
    }
    return {
      gradient: 'from-indigo-500 via-sky-500 to-blue-600',
      badge: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/40',
      dot: 'bg-indigo-500'
    };
  };

  const getCustomerInitials = (name?: string) => {
    if (!name || name === 'N/A') return 'LD';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  // Campaign expansion state for 12-column detailed view
  const [expandedCampaign, setExpandedCampaign] = useState<string | null>(null);
  const [campaignLeadsMap, setCampaignLeadsMap] = useState<Record<string, any[]>>({});
  const [loadingCampaignLeads, setLoadingCampaignLeads] = useState<Record<string, boolean>>({});

  const toggleExpandCampaign = async (campaignName: string) => {
    if (expandedCampaign === campaignName) {
      setExpandedCampaign(null);
      return;
    }
    setExpandedCampaign(campaignName);
    if (!campaignLeadsMap[campaignName]) {
      try {
        setLoadingCampaignLeads(prev => ({ ...prev, [campaignName]: true }));
        const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}`);
        setCampaignLeadsMap(prev => ({ ...prev, [campaignName]: res.data.leads || [] }));
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingCampaignLeads(prev => ({ ...prev, [campaignName]: false }));
      }
    }
  };

  const handleUploadClick = (recordId: string) => {
    setUploadingRecordId(recordId);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !uploadingRecordId) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('recordId', uploadingRecordId);

    try {
      await api.post('/documents/upload', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      showToast('File uploaded successfully!', 'success');
    } catch (err) {
      showToast('Failed to upload file.', 'error');
    } finally {
      setUploadingRecordId(null);
    }
  };

  const openHistory = async (rec: any) => {
    setActiveHistoryRecord(rec);
    setLoadingHistory(true);
    try {
      const [activitiesRes, docsRes] = await Promise.all([
        api.get(`/records/leads/${rec._id}/activities`),
        api.get(`/documents`, { params: { recordId: rec._id } })
      ]);
      setHistoryActivities(activitiesRes.data);
      setHistoryDocuments(docsRes.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingHistory(false);
    }
  };

  // --- Campaign Assignment custom screen states ---
  const [caCampaigns, setCaCampaigns] = useState<any[]>([]);
  const [caSelectedCampaign, setCaSelectedCampaign] = useState('');
  const [caRoles, setCaRoles] = useState<any[]>([]);
  const [caSelectedRole, setCaSelectedRole] = useState('');
  const [caAgents, setCaAgents] = useState<any[]>([]);
  const [caSelectedAgents, setCaSelectedAgents] = useState<string[]>([]);
  const [caFile, setCaFile] = useState<File | null>(null);
  const [caParsedLeads, setCaParsedLeads] = useState<any[]>([]);
  const [campaignFilterTab, setCampaignFilterTab] = useState<'all' | 'in_progress' | 'completed'>('all');
  const [caAllocatedStats, setCaAllocatedStats] = useState<Record<string, number>>({});
  const [caDialedStats, setCaDialedStats] = useState<Record<string, number>>({});
  const [caLoadingStats, setCaLoadingStats] = useState(false);
  const [caAssigning, setCaAssigning] = useState(false);
  const [caLoadingAgents, setCaLoadingAgents] = useState(false);

  useEffect(() => {
    if (apiPath === 'campaignassignments') {
      loadCampaignAssignmentsData();
    }
  }, [apiPath]);

  const loadCampaignAssignmentsData = async () => {
    try {
      setCaLoadingStats(true);
      const [campaignsRes, rolesRes, statsRes, usersRes] = await Promise.allSettled([
        api.get('/records/campaigns?limit=100'),
        api.get('/auth/roles'),
        api.get('/records/campaigns/allocation-stats'),
        api.get('/auth/users?purpose=dropdown')
      ]);

      if (campaignsRes.status === 'fulfilled') {
        const records = campaignsRes.value.data?.records || [];
        setCaCampaigns(records);
        if (records.length > 0) {
          const firstCamp = records[0].data?.campaignName || records[0].data?.name || records[0].name || '';
          setCaSelectedCampaign((prev: string) => prev || firstCamp);
        }
      }

      if (rolesRes.status === 'fulfilled') {
        setCaRoles(rolesRes.value.data || []);
      }

      if (statsRes.status === 'fulfilled') {
        setCaAllocatedStats(statsRes.value.data?.stats || {});
        setCaDialedStats(statsRes.value.data?.dialedStats || {});
      }

      if (usersRes.status === 'fulfilled') {
        const allUsers = usersRes.value.data || [];
        const activeUsers = allUsers.filter((u: any) => u.isActive !== false);
        setCaAgents(activeUsers);
        setCaSelectedAgents(activeUsers.map((u: any) => u._id));
      }
    } catch (err) {
      console.error('Failed to load campaign assignments metadata:', err);
    } finally {
      setCaLoadingStats(false);
    }
  };

  const handleLoadAgents = async () => {
    setCaLoadingAgents(true);
    try {
      const res = await api.get('/auth/users?purpose=dropdown');
      const allUsers = res.data || [];
      const activeUsers = allUsers.filter((u: any) => u.isActive !== false);
      let filtered = activeUsers;
      if (caSelectedRole && caSelectedRole !== 'ALL') {
        filtered = activeUsers.filter((u: any) => {
          const rId = typeof u.roleId === 'object' ? (u.roleId?._id || u.roleId?.id) : u.roleId;
          return rId === caSelectedRole;
        });
      }
      setCaAgents(filtered);
      setCaSelectedAgents(filtered.map((u: any) => u._id));
      showToast(`Loaded ${filtered.length} agent(s).`, 'info');
    } catch (err) {
      console.error('Failed to load agents:', err);
      showToast('Failed to load agents.', 'error');
    } finally {
      setCaLoadingAgents(false);
    }
  };

  const parseCSV = (text: string): any[] => {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
    const results: any[] = [];
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values: string[] = [];
      let currentVal = '';
      let insideQuotes = false;
      
      for (let j = 0; j < line.length; j++) {
        const char = line[j];
        if (char === '"') {
          insideQuotes = !insideQuotes;
        } else if (char === ',' && !insideQuotes) {
          values.push(currentVal.trim().replace(/^["']|["']$/g, ''));
          currentVal = '';
        } else {
          currentVal += char;
        }
      }
      values.push(currentVal.trim().replace(/^["']|["']$/g, ''));
      
      // Skip rows where all meaningful values are empty (ignore Slno/index columns)
      const hasContent = values.some((val, idx) => {
        const header = (headers[idx] || '').toLowerCase();
        if (header === 'slno' || header === 'sl no' || header === 'sno' || header === 'id') return false;
        return val.trim() !== '';
      });
      if (!hasContent) continue;

      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      results.push(row);
    }
    return results;
  };

  // Parse Excel (XLSX/XLS) files using SheetJS
  const parseExcelFile = (buffer: ArrayBuffer): any[] => {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    
    // Use sheet_to_json in object mode — SheetJS automatically skips truly empty rows
    const rawRows: any[] = XLSX.utils.sheet_to_json(firstSheet, { raw: false, defval: '' });

    if (rawRows.length === 0) return [];

    const results: any[] = [];
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i];
      
      // Check if this row has at least one non-empty value in a meaningful column
      const keys = Object.keys(row);
      const hasContent = keys.some((key) => {
        const k = key.toLowerCase().trim();
        // Skip index/serial number columns
        if (k === 'slno' || k === 'sl no' || k === 'sno' || k === 'id' || k === 's.no' || k === 'sr no' || k === 'srno') return false;
        return String(row[key]).trim() !== '';
      });
      if (!hasContent) continue;

      // Normalize keys: trim whitespace
      const cleanRow: Record<string, string> = {};
      keys.forEach((key) => {
        cleanRow[key.trim()] = String(row[key]).trim();
      });
      results.push(cleanRow);
    }

    console.log(`[parseExcelFile] Parsed ${results.length} valid rows from Excel file`);
    return results;
  };

  const handleFileSelection = (file: File | null) => {
    setCaFile(file);
    if (!file) {
      setCaParsedLeads([]);
      return;
    }
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        let parsed: any[] = [];
        if (isExcel) {
          const buffer = e.target?.result as ArrayBuffer;
          parsed = parseExcelFile(buffer);
        } else {
          const text = e.target?.result as string;
          parsed = parseCSV(text);
        }
        setCaParsedLeads(parsed);
        if (parsed.length > 0) {
          showToast(`File verified: ${parsed.length} leads loaded. Ready for equal distribution.`, 'info');
        } else {
          showToast('The uploaded file is empty or has no valid rows.', 'warning');
        }
      } catch (err) {
        console.error('File parsing error:', err);
        showToast('Failed to parse the selected file.', 'error');
        setCaParsedLeads([]);
      }
    };

    if (isExcel) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  };

  const handleAssignData = async () => {
    if (!caSelectedCampaign) {
      showToast('Please select a Campaign.', 'warning');
      return;
    }
    if (caSelectedAgents.length === 0) {
      showToast('Please check at least one employee in the table.', 'warning');
      return;
    }
    if (!caFile) {
      showToast('Please upload an Excel or CSV file.', 'warning');
      return;
    }

    setCaAssigning(true);
    try {
      let leadsToSend = caParsedLeads;
      if (!leadsToSend || leadsToSend.length === 0) {
        const fileName = caFile.name.toLowerCase();
        const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
        const bufferOrText = await caFile.arrayBuffer();
        if (isExcel) {
          leadsToSend = parseExcelFile(bufferOrText);
        } else {
          const text = new TextDecoder().decode(bufferOrText);
          leadsToSend = parseCSV(text);
        }
      }

      if (!leadsToSend || leadsToSend.length === 0) {
        showToast('The uploaded file is empty or invalid.', 'warning');
        setCaAssigning(false);
        return;
      }

      const agentNames = caAgents
        .filter((a: any) => caSelectedAgents.includes(a._id))
        .map((a: any) => `${a.firstName || ''} ${a.lastName || ''}`.trim() || a.name || 'Agent');

      const res = await api.post('/records/campaigns/bulk-assign', {
        campaignName: caSelectedCampaign,
        agentNames,
        leads: leadsToSend
      });

      showAlertModal({
        title: 'Leads Allocated Successfully',
        message: res.data?.message || `Successfully assigned ${leadsToSend.length} leads equally among ${agentNames.length} agents.`,
        type: 'success'
      });
      
      setCaFile(null);
      setCaParsedLeads([]);
      
      queryClient.invalidateQueries({ queryKey: ['records', 'leads'] });
      loadCampaignAssignmentsData();
    } catch (err: any) {
      console.error(err);
      showToast(err.response?.data?.error || 'Failed to process bulk assignment.', 'error');
    } finally {
      setCaAssigning(false);
    }
  };
  const renderCampaignAssignments = () => {
    const totalAgentAllocated = caAgents.reduce((sum: number, agent: any) => {
      const fullName = `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || agent.name || 'Agent';
      return sum + (caAllocatedStats[fullName] || caAllocatedStats[agent.firstName] || 0);
    }, 0);

    const equalPerAgent = (caSelectedAgents.length > 0 && caParsedLeads.length > 0)
      ? Math.floor(caParsedLeads.length / caSelectedAgents.length)
      : 0;
    const equalRemainder = (caSelectedAgents.length > 0 && caParsedLeads.length > 0)
      ? caParsedLeads.length % caSelectedAgents.length
      : 0;

    return (
      <div className="space-y-6 text-left">


        {/* 4 Vibrant Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Available Campaigns */}
          <div className="bg-white dark:bg-slate-900 border border-violet-100/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-600 to-indigo-600" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Available Campaigns
              </span>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-xs">
                <Icons.Layers className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {caCampaigns.length}
              </span>
              <span className="text-[11px] font-bold text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50 px-2.5 py-0.5 rounded-md">
                Active Sources
              </span>
            </div>
          </div>

          {/* Card 2: Team Roles */}
          <div className="bg-white dark:bg-slate-900 border border-blue-100/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-600" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Team Roles
              </span>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xs">
                <Icons.Users2 className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {caRoles.length}
              </span>
              <span className="text-[11px] font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2.5 py-0.5 rounded-md">
                Role Groups
              </span>
            </div>
          </div>

          {/* Card 3: Loaded Agents */}
          <div className="bg-white dark:bg-slate-900 border border-teal-100/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 to-emerald-500" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Loaded Agents
              </span>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-teal-600 to-emerald-600 flex items-center justify-center text-white shadow-xs">
                <Icons.UserCheck className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {caAgents.length}
              </span>
              <span className="text-[11px] font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 px-2.5 py-0.5 rounded-md">
                {caSelectedAgents.length} Selected
              </span>
            </div>
          </div>

          {/* Card 4: Total Assigned */}
          <div className="bg-white dark:bg-slate-900 border border-amber-100/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Total Assigned
              </span>
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
                <Icons.Zap className="w-4.5 h-4.5" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
                {totalAgentAllocated.toLocaleString()}
              </span>
              <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2.5 py-0.5 rounded-md">
                Allocated Leads
              </span>
            </div>
          </div>
        </div>

        {/* Top Control Card (Campaign Distribution Studio) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden text-left">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-600 via-indigo-600 via-teal-500 to-emerald-500" />
          
          <div className="flex items-center justify-between mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                <Icons.Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Campaign Distribution Studio
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <div className="text-left">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Icons.Layers className="w-3.5 h-3.5 text-violet-500" />
                Select Campaign
              </label>
              <select 
                value={caSelectedCampaign} 
                onChange={e => setCaSelectedCampaign(e.target.value)} 
                className="w-full h-11 px-4 text-xs font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15 transition-all cursor-pointer shadow-inner-sm"
              >
                <option value="">Select Campaign</option>
                {caCampaigns.map((c: any) => {
                  const name = c.data?.campaignName || c.data?.name || c.name;
                  return <option key={c._id} value={name}>{name}</option>;
                })}
              </select>
            </div>

            <div className="text-left">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Icons.Users2 className="w-3.5 h-3.5 text-blue-500" />
                Agent Type (Role)
              </label>
              <select 
                value={caSelectedRole} 
                onChange={e => setCaSelectedRole(e.target.value)} 
                className="w-full h-11 px-4 text-xs font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15 transition-all cursor-pointer shadow-inner-sm"
              >
                <option value="ALL">All Roles (All Team Members)</option>
                {caRoles.map((r: any) => (
                  <option key={r._id} value={r._id}>{r.name}</option>
                ))}
              </select>
            </div>

            <div className="flex gap-2.5">
              <button 
                type="button" 
                onClick={handleLoadAgents}
                className="flex-1 h-11 bg-gradient-to-r from-violet-600 via-indigo-600 to-indigo-700 hover:from-violet-700 hover:to-indigo-800 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-violet-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                disabled={caLoadingAgents}
              >
                {caLoadingAgents ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Icons.Search className="w-4 h-4" /> Load Now
                  </>
                )}
              </button>
              
              <Link 
                to="/modules/campaigns"
                className="h-11 px-4 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center justify-center"
              >
                View Details
              </Link>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 my-6"></div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
            <div className="md:col-span-2 text-left">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Icons.FileSpreadsheet className="w-3.5 h-3.5 text-teal-600" />
                Upload Excel / CSV File
              </label>
              
              <div 
                onClick={() => document.getElementById('ca-file-input')?.click()}
                className={`border-2 border-dashed rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition-all ${
                  caFile 
                    ? 'border-emerald-400 bg-emerald-50/30 dark:bg-emerald-950/30' 
                    : 'border-slate-200/90 dark:border-slate-700 hover:border-violet-500 bg-slate-50/50 dark:bg-slate-900/40'
                }`}
              >
                <input 
                  id="ca-file-input"
                  type="file" 
                  accept=".csv,.xlsx,.xls"
                  onChange={e => handleFileSelection(e.target.files?.[0] || null)}
                  className="hidden"
                />
                {caFile ? (
                  <div className="flex items-center gap-3 w-full">
                    <div className="p-2.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 rounded-xl shadow-3xs">
                      <Icons.FileSpreadsheet className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{caFile.name}</p>
                      <p className="text-xs text-slate-500 font-medium">
                        {(caFile.size / 1024).toFixed(1)} KB • {caParsedLeads.length > 0 ? (
                          <strong className="text-emerald-600 dark:text-emerald-400 font-mono">
                            {caParsedLeads.length} leads loaded {caSelectedAgents.length > 0 ? `(${Math.floor(caParsedLeads.length / caSelectedAgents.length)} leads each)` : ''}
                          </strong>
                        ) : 'Ready to assign'}
                      </p>
                    </div>
                    <button 
                      type="button" 
                      onClick={(e) => {
                        e.stopPropagation();
                        handleFileSelection(null);
                      }}
                      className="p-2 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-colors cursor-pointer"
                    >
                      <Icons.X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 py-1">
                    <div className="p-2.5 bg-violet-50 dark:bg-slate-800 text-violet-600 dark:text-violet-400 rounded-xl border border-violet-100 dark:border-slate-700 shadow-3xs">
                      <Icons.UploadCloud className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <p className="text-xs font-bold text-slate-800 dark:text-white">Click to select file (.csv, .xlsx, .xls)</p>
                      <p className="text-[10px] text-slate-500 font-medium">File data will be allocated to selected employees</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div>
              <button 
                type="button" 
                onClick={handleAssignData}
                className="w-full h-12 bg-gradient-to-r from-emerald-600 via-teal-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 active:scale-[0.98] text-white rounded-xl font-extrabold text-xs uppercase tracking-wider shadow-md shadow-emerald-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                disabled={caAssigning || !caFile}
              >
                {caAssigning ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <>
                    <Icons.CheckCircle2 className="w-4.5 h-4.5" /> Assign Data
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Employee Allocation Table Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-600 via-indigo-600 via-teal-500 to-emerald-500" />
          
          <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900 dark:text-white text-left uppercase tracking-tight">
                Assign Campaigns for Below Employees
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Check employees who should receive batch leads from the uploaded dataset.
              </p>
            </div>
            {caAgents.length > 0 && (
              <span className="text-xs font-bold text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-950/60 px-3.5 py-1 rounded-full border border-violet-200/80 dark:border-violet-800/60 uppercase tracking-wider font-mono">
                Selected: {caSelectedAgents.length} of {caAgents.length} Agents
              </span>
            )}
          </div>

          {caParsedLeads.length > 0 && caSelectedAgents.length > 0 && (
            <div className="mx-6 mt-4 p-3 rounded-xl bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/40 dark:to-teal-950/40 border border-emerald-200/80 dark:border-emerald-800/60 flex items-center justify-between gap-3 text-xs text-emerald-900 dark:text-emerald-200">
              <div className="flex items-center gap-2">
                <Icons.CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="font-bold">
                  Equal Distribution: {caParsedLeads.length} leads ÷ {caSelectedAgents.length} selected agents = {equalPerAgent} leads each {equalRemainder > 0 ? `(+${equalRemainder} distributed)` : ''}
                </span>
              </div>
              <span className="px-2.5 py-1 rounded-lg bg-emerald-200/70 dark:bg-emerald-900/60 font-mono font-bold text-[11px] text-emerald-900 dark:text-emerald-100">
                {equalPerAgent} Leads / Member
              </span>
            </div>
          )}
          
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider h-11 bg-slate-50/90 dark:bg-slate-800/80">
                  <th className="py-2 px-4 w-12 text-center">
                    <input 
                      type="checkbox"
                      checked={caAgents.length > 0 && caSelectedAgents.length === caAgents.length}
                      onChange={e => {
                        if (e.target.checked) {
                          setCaSelectedAgents(caAgents.map(a => a._id));
                        } else {
                          setCaSelectedAgents([]);
                        }
                      }}
                      className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer w-4 h-4"
                    />
                  </th>
                  <th className="py-3 px-4">Full Name</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Reporting Manager</th>
                  <th className="py-3 px-4 text-center">Total Allocated #</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60">
                {caAgents.map((agent: any) => {
                  const fullName = `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || agent.name || 'Agent';
                  const allocated = caAllocatedStats[fullName] || caAllocatedStats[agent.firstName] || 0;
                  const isChecked = caSelectedAgents.includes(agent._id);
                  const selectedIdx = isChecked ? caSelectedAgents.indexOf(agent._id) : -1;
                  const willReceive = (isChecked && caParsedLeads.length > 0 && caSelectedAgents.length > 0)
                    ? equalPerAgent + (selectedIdx < equalRemainder ? 1 : 0)
                    : 0;
                  
                  return (
                    <tr 
                      key={agent._id} 
                      className={`transition-colors h-14 ${
                        isChecked 
                          ? 'bg-violet-50/40 dark:bg-slate-800/50 hover:bg-violet-50/60' 
                          : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                      }`}
                    >
                      <td className="px-4 py-2 text-center">
                        <input 
                          type="checkbox"
                          checked={isChecked}
                          onChange={e => {
                            if (e.target.checked) {
                              setCaSelectedAgents([...caSelectedAgents, agent._id]);
                            } else {
                              setCaSelectedAgents(caSelectedAgents.filter(id => id !== agent._id));
                            }
                          }}
                          className="rounded border-slate-300 text-violet-600 focus:ring-violet-500 cursor-pointer w-4 h-4"
                        />
                      </td>
                      <td className="px-4 py-2 text-left">
                        <div className="flex items-center gap-3">
                          <div className="w-8.5 h-8.5 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center font-bold text-xs uppercase shadow-3xs">
                            {agent.firstName ? agent.firstName[0] : 'U'}
                          </div>
                          <div>
                            <span className="font-bold text-slate-900 dark:text-slate-100 block">
                              {fullName}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                              {agent.email || agent.userCode || 'Agent'}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-left">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 border border-violet-200/80 dark:border-violet-800/50">
                          {agent.roleId?.name || 'No Role'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-left">
                        {agent.reportingManager ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
                            {agent.reportingManager.firstName} {agent.reportingManager.lastName}
                          </span>
                        ) : (
                          <span className="text-slate-400 dark:text-slate-500 font-medium italic">Unassigned</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-center">
                        <div className="inline-flex items-center justify-center gap-1.5">
                          <span className="inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold font-mono bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60 min-w-[3rem] shadow-3xs">
                            {allocated}
                          </span>
                          {willReceive > 0 && (
                            <span className="inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-extrabold font-mono bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 border border-emerald-300/80 shadow-3xs animate-pulse">
                              +{willReceive} New
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {caAgents.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-14 text-center">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-violet-500/20">
                        <Icons.Users className="w-6 h-6" />
                      </div>
                      <p className="font-extrabold text-sm text-slate-800 dark:text-slate-200">No employees loaded</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Select an agent role type above and click "Load Now" to display team members.
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  // Campaigns local state for inline form
  const [campaignNameInput, setCampaignNameInput] = useState('');
  const [editCampaignId, setEditCampaignId] = useState<string | null>(null);
  const [isSubmittingCampaign, setIsSubmittingCampaign] = useState(false);

  const handleSaveCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campaignNameInput.trim()) {
      showToast('Campaign Name is required', 'warning');
      return;
    }

    setIsSubmittingCampaign(true);
    try {
      if (editCampaignId) {
        // Update Campaign
        await api.put(`/records/campaigns/${editCampaignId}`, {
          data: { campaignName: campaignNameInput.trim() }
        });
      } else {
        // Create Campaign with required default fields
        await api.post(`/records/campaigns`, {
          data: {
            campaignName: campaignNameInput.trim(),
            status: 'Planned',
            type: 'Email'
          }
        });
      }
      showAlertModal({
        title: editCampaignId ? 'Saved Successfully' : 'Created Successfully',
        message: editCampaignId ? 'The campaign has been updated successfully.' : 'The new campaign has been created successfully.',
        type: 'success'
      });
      setCampaignNameInput('');
      setEditCampaignId(null);
      refetch();
      queryClient.invalidateQueries({ queryKey: ['records', 'campaigns'] });
    } catch (err: any) {
      const serverData = err.response?.data;
      let msg = serverData?.error || 'Failed to save campaign';
      if (serverData?.details && Array.isArray(serverData.details) && serverData.details.length > 0) {
        msg = `${msg}: ${serverData.details.join(' ')}`;
      }
      showToast(msg, 'error');
    } finally {
      setIsSubmittingCampaign(false);
    }
  };

  const handleEditClick = (rec: any) => {
    setEditCampaignId(rec._id);
    setCampaignNameInput(rec.data?.campaignName || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  
  // Fetch dynamic campaign allocation & dialed stats
  const { data: campaignStatsData } = useQuery({
    queryKey: ['campaign-allocation-stats'],
    queryFn: async () => {
      const res = await api.get('/records/campaigns/allocation-stats');
      return res.data || {};
    },
    enabled: apiPath === 'campaigns' || apiPath === 'campaignassignments'
  });

  const campAllocStats = campaignStatsData?.campaignAllocatedStats || {};
  const campDialedStats = campaignStatsData?.campaignDialedStats || {};

  const getAllocatedNumbers = (name: string) => {
    const key = (name || '').toLowerCase().trim();
    if (campAllocStats[key] !== undefined) return campAllocStats[key];
    return 0;
  };

  const getDialedNumbers = (name: string) => {
    const key = (name || '').toLowerCase().trim();
    if (campDialedStats[key] !== undefined) return campDialedStats[key];
    return 0;
  };

  const handleDownloadCampaign = async (rec: any) => {
    const campaignName = (
      rec.data?.campaignName ||
      rec.data?.source ||
      rec.data?.campaign ||
      rec.data?.name ||
      rec.name
    )?.toString().trim();

    if (!campaignName) {
      showToast('Campaign name not found.', 'error');
      return;
    }

    try {
      showToast(`Exporting 12-column report for "${campaignName}"...`, 'info');
      const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}`);
      const leads = res.data?.leads || [];

      if (leads.length === 0) {
        showToast(`No lead records found under campaign "${campaignName}".`, 'warning');
        return;
      }

      exportCampaignCSV(campaignName, leads);
      showToast(`Exported ${leads.length} leads for campaign "${campaignName}"!`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to export campaign data.', 'error');
    }
  };

  const handleDeleteCampaign = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to delete campaign "${name}"? This action cannot be undone.`)) {
      return;
    }
    try {
      await api.delete(`/records/campaigns/${id}`);
      showAlertModal({
        title: 'Campaign Deleted',
        message: `Campaign "${name}" was deleted successfully.`,
        type: 'success'
      });
      refetch();
      queryClient.invalidateQueries({ queryKey: ['records', 'campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaign-allocation-stats'] });
    } catch (err: any) {
      showToast(err.response?.data?.error || 'Failed to delete campaign', 'error');
    }
  };

  // Read ?status= and ?followup= from URL and apply as filter
  const urlStatus = searchParams.get('status');
  const urlFollowup = searchParams.get('followup');

  // Set Active Module in store on path mount/change
  useEffect(() => {
    if (apiPath) {
      setActiveModuleByPath(apiPath);
      setPage(1);
      setSearchVal('');
      if (urlStatus) {
        setFilterField('status');
        setFilterVal(urlStatus);
      } else if (urlFollowup === 'today') {
        setFilterField('followup');
        setFilterVal('today');
      } else {
        setFilterField('');
        setFilterVal('');
      }
    }
  }, [apiPath, urlStatus, urlFollowup, modules.length]);

  // Query records with 10 records per page for lightning fast performance
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['records', apiPath, debouncedSearchVal, filterField, filterVal, page],
    queryFn: async () => {
      const params: Record<string, any> = {
        page,
        limit: 10,
        search: debouncedSearchVal
      };
      if (filterField && filterVal) {
        if (filterField === 'followup') {
          params.followup = filterVal;
        } else {
          params[`data.${filterField}`] = filterVal;
        }
      }
      const res = await api.get(`/records/${apiPath}`, { params });
      return res.data;
    },
    enabled: !!apiPath,
    placeholderData: keepPreviousData,
    staleTime: 60000,
    refetchInterval: (query) => (query.state.error ? false : 60000),
    refetchOnWindowFocus: false
  });

  const { showLoading: showDelayedSkeleton, isTakingLonger } = useDelayedLoading(isLoading && !data, 400);

  const campaignSummaryStats = useMemo(() => {
    const records = data?.records || [];
    let totalAllocated = 0;
    let totalDialed = 0;
    let inProgressCount = 0;
    let completedCount = 0;

    records.forEach((rec: any) => {
      const name = rec.data?.campaignName || rec.data?.source || rec.data?.campaign || rec.data?.name || rec.name || '';
      const allocated = getAllocatedNumbers(name);
      const dialed = getDialedNumbers(name);
      totalAllocated += allocated;
      totalDialed += dialed;
      if (allocated > 0 && dialed >= allocated) {
        completedCount++;
      } else {
        inProgressCount++;
      }
    });

    const overallRate = totalAllocated > 0 ? Math.round((totalDialed / totalAllocated) * 100) : 0;
    return {
      totalCampaigns: data?.pagination?.total ?? records.length,
      inProgressCount,
      completedCount,
      totalAllocated,
      totalDialed,
      yetToDial: Math.max(0, totalAllocated - totalDialed),
      overallRate
    };
  }, [data?.records, data?.pagination?.total, campaignStatsData]);

  const filteredCampaignRecords = useMemo(() => {
    const records = data?.records || [];
    if (campaignFilterTab === 'all') return records;
    return records.filter((rec: any) => {
      const name = rec.data?.campaignName || rec.data?.source || rec.data?.campaign || rec.data?.name || rec.name || '';
      const allocated = getAllocatedNumbers(name);
      const dialed = getDialedNumbers(name);
      const isCompleted = allocated > 0 && dialed >= allocated;
      if (campaignFilterTab === 'completed') return isCompleted;
      if (campaignFilterTab === 'in_progress') return !isCompleted;
      return true;
    });
  }, [data?.records, campaignFilterTab, campaignStatsData]);

  const { data: usersDropdown } = useQuery({
    queryKey: ['moduleview-users-dropdown'],
    queryFn: async () => {
      const res = await api.get('/auth/users?purpose=dropdown');
      return res.data || [];
    },
    staleTime: 60000
  });

  const resolveUserDisplayName = (val: any) => {
    if (!val) return 'Unassigned';
    if (typeof val === 'object') {
      if (val.firstName || val.lastName) return `${val.firstName || ''} ${val.lastName || ''}`.trim();
      if (val.name) return val.name;
      if (val.email) return val.email.split('@')[0];
    }
    const str = String(val).trim();
    if (!str || str === 'undefined' || str === 'null') return 'Unassigned';
    if (Array.isArray(usersDropdown)) {
      const found = usersDropdown.find((u: any) => 
        u._id === str || u.id === str || u.email?.toLowerCase() === str.toLowerCase() || u.userCode === str
      );
      if (found) {
        return `${found.firstName || ''} ${found.lastName || ''}`.trim() || found.name || found.email || str;
      }
    }
    if (/^[0-9a-fA-F]{24}$/.test(str)) {
      return 'Assigned Agent';
    }
    return str;
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    refetch();
  };

  const handleLoadAll = () => {
    setSearchVal('');
    setFilterVal('');
    setFilterField('');
    setPage(1);
    if (urlStatus || urlFollowup) {
      navigate('/modules/leads');
    } else {
      refetch();
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/records/${apiPath}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['records', apiPath] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-leads'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
    }
  });

  const handleDelete = (id: string) => {
    showConfirm({
      title: 'Delete Record',
      message: `Are you sure you want to delete this ${activeModule?.singularLabel || 'record'}?`,
      onConfirm: () => {
        deleteMutation.mutate(id, {
          onSuccess: () => {
            showAlertModal({
              title: 'Deleted Successfully',
              message: `The ${activeModule?.singularLabel || 'record'} has been permanently deleted.`,
              type: 'success'
            });
          },
          onError: () => {
            showToast('Failed to delete record.', 'error');
          }
        });
      }
    });
  };

  // CSV / XLSX Export Utility
  const handleExportCSV = () => {
    if (!data?.records || !activeModule) return;
    
    if (activeModule.apiPath === 'leads') {
      exportLeadReportXLSX(data.records, 'Leads_Report');
      showToast(`Exported ${data.records.length} lead records to Excel!`, 'success');
      return;
    }

    // Header
    const fields = activeModule.fields.map((f) => f.name);
    const headers = activeModule.fields.map((f) => f.label).join(',');
    
    // Rows
    const rows = data.records.map((rec: any) =>
      fields.map((f) => `"${String(rec.data[f] || '').replace(/"/g, '""')}"`).join(',')
    );

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `${activeModule.apiPath}_export.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Kanban view card layout assembler
  const renderKanban = (moduleDef: ModuleDefinition, records: any[]) => {
    // Find first dropdown field (e.g. status) to group by
    const statusField = moduleDef.fields.find((f) => f.type === 'dropdown');
    if (!statusField) {
      return (
        <div className="py-12 text-center text-slate-500 border rounded-xl border-dashed">
          Kanban view requires at least one dropdown status field in the module definition.
        </div>
      );
    }

    const columns = statusField.options || ['New', 'In Progress', 'Completed'];

    return (
      <div className="flex gap-6 overflow-x-auto pb-4 snap-x snap-mandatory scroll-smooth touch-pan-x overscroll-x-contain hide-scrollbar">
        {columns.map((col) => {
          const colRecords = records.filter(
            (r) => String(r.data[statusField.name] || '').toLowerCase() === col.toLowerCase()
          );

          return (
            <div key={col} className="bg-slate-100/60 dark:bg-slate-800/40 border border-slate-200/50 dark:border-slate-700/50 rounded-xl p-4 flex flex-col min-w-[280px] sm:min-w-[320px] w-[280px] sm:w-[320px] max-w-[320px] flex-shrink-0 snap-center max-h-[600px]">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                <span className="font-semibold text-sm text-slate-700 dark:text-slate-300">{col}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-full">
                  {colRecords.length}
                </span>
              </div>
              <div className="space-y-3 flex-1 overflow-y-auto pr-1">
                {colRecords.map((rec) => (
                  <div
                    key={rec._id}
                    onClick={() => navigate(`/modules/${moduleDef.apiPath}/${rec._id}`)}
                    className="p-4 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-primary dark:hover:border-primary/50 rounded-lg shadow-sm cursor-pointer transition-all hover:scale-[1.01]"
                  >
                    <p className="font-semibold text-sm text-slate-800 dark:text-white truncate">
                      {rec.data.firstName || rec.data.lastName
                        ? `${rec.data.firstName || ''} ${rec.data.lastName || ''}`.trim()
                        : rec.data.fullName || rec.data.companyName || rec.data.dealName || rec.data.title || rec._id}
                    </p>
                    <div className="mt-2 space-y-1">
                      {moduleDef.fields.slice(0, 3).map((f) => (
                        <p key={f.name} className="text-[11px] text-slate-400 truncate">
                          <span className="font-medium text-slate-500">{f.label}:</span> {String(rec.data[f.name] || '')}
                        </p>
                      ))}
                    </div>
                  </div>
                ))}
                {colRecords.length === 0 && (
                  <div className="py-6 text-center text-xs text-slate-400 border border-dashed rounded-lg border-slate-300 dark:border-slate-700">Drop cards here</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // Calendar cell layout builder
  const renderCalendar = (moduleDef: ModuleDefinition, records: any[]) => {
    const dateField = moduleDef.fields.find((f) => f.type === 'date');
    if (!dateField) {
      return (
        <div className="py-12 text-center text-slate-500 border rounded-xl border-dashed">
          Calendar view requires at least one date field in the module definition.
        </div>
      );
    }

    // Dynamic month assembly (e.g. June 2026)
    const today = new Date();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const startDayIndex = new Date(today.getFullYear(), today.getMonth(), 1).getDay(); // sun=0

    const calendarGrid = [];
    // empty blocks
    for (let i = 0; i < startDayIndex; i++) {
      calendarGrid.push(null);
    }
    // day blocks
    for (let i = 1; i <= daysInMonth; i++) {
      calendarGrid.push(i);
    }

    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <h3 className="font-semibold text-lg text-slate-800 dark:text-white">
            {today.toLocaleString('default', { month: 'long' })} {today.getFullYear()}
          </h3>
          <span className="text-xs text-slate-400 flex items-center gap-1.5">
            <Icons.Calendar className="w-4 h-4 text-primary" /> Mapping: <span className="font-semibold text-slate-500">{dateField.label}</span>
          </span>
        </div>
        <div className="overflow-x-auto pb-2">
          <div className="min-w-[650px] pr-1">
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              <div>Sun</div><div>Mon</div><div>Tue</div><div>Wed</div><div>Thu</div><div>Fri</div><div>Sat</div>
            </div>

            <div className="grid grid-cols-7 gap-2">
              {calendarGrid.map((day, idx) => {
                if (!day) return <div key={`empty-${idx}`} className="h-24 bg-slate-50 dark:bg-slate-900/30 rounded-lg"></div>;

                // Match records falling on this day
                const dayRecords = records.filter((r) => {
                  if (!r.data[dateField.name]) return false;
                  const recDate = new Date(r.data[dateField.name]);
                  return recDate.getDate() === day && recDate.getMonth() === today.getMonth();
                });

                return (
                  <div key={day} className="h-28 border border-slate-100 dark:border-slate-700 rounded-lg p-2 flex flex-col text-left hover:bg-slate-50/50 dark:hover:bg-slate-700/20 transition-all">
                    <span className="text-xs font-bold text-slate-500">{day}</span>
                    <div className="mt-1 space-y-1 flex-1 overflow-y-auto scrollbar-none">
                      {dayRecords.map((r) => (
                        <Link
                          key={r._id}
                          to={`/modules/${moduleDef.apiPath}/${r._id}`}
                          className="block text-[9px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded truncate"
                        >
                          {r.data.fullName || r.data.companyName || r.data.dealName || r.data.title || r._id.substring(18)}
                        </Link>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Timeline view builder
  const renderTimeline = (records: any[]) => {
    return (
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-6 shadow-sm">
        <h3 className="font-semibold text-lg text-slate-800 dark:text-white mb-6">Module Audit Trail</h3>
        <div className="relative pl-6 border-l border-slate-200 dark:border-slate-700 space-y-6">
          {records.map((rec) => (
            <div key={rec._id} className="relative">
              {/* Dot marker */}
              <div className="absolute -left-[30px] top-1.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-slate-800 bg-primary shadow-sm"></div>
              
              <div className="text-xs text-left">
                <p className="text-[10px] font-bold text-slate-400 uppercase">{formatDate(rec.createdAt)} {new Date(rec.createdAt).toLocaleTimeString()}</p>
                <p className="text-slate-700 dark:text-slate-300 mt-1">
                  Record Created: <Link to={`/modules/${apiPath}/${rec._id}`} className="font-semibold text-primary hover:underline">
                    {rec.data.fullName || rec.data.companyName || rec.data.dealName || rec.data.title || rec._id}
                  </Link>
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {Object.keys(rec.data).slice(0, 3).map((k) => (
                    <span key={k} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-[10px] text-slate-500">
                      {k}: {String(rec.data[k])}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!activeModule && apiPath !== 'campaigns' && apiPath !== 'campaignassignments') {
    if (loadingModules) {
      return (
        <div className="space-y-4 p-4 animate-pulse">
          <div className="h-10 bg-slate-200/80 dark:bg-slate-800 rounded-xl w-48" />
          <div className="h-96 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-2xl" />
        </div>
      );
    }
    return (
      <div className="py-16 text-center text-slate-500 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800">
        <Icons.FolderClosed className="w-10 h-10 mx-auto mb-2 text-slate-400" />
        <p className="font-bold text-sm">Module not found</p>
      </div>
    );
  }

  const renderCampaignsList = () => {
    return (
      <div className="space-y-6 text-left">


        {/* 6 Vibrant Metric Cards matching Image 1 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          {/* Card 1: Total Campaigns */}
          <div className="bg-white dark:bg-slate-900 border border-violet-100/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-600 to-indigo-600" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Total Campaigns
              </span>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-600 to-indigo-600 flex items-center justify-center text-white shadow-xs">
                <Icons.Megaphone className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5 flex-wrap">
              <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {campaignSummaryStats.totalCampaigns}
              </span>
              <span className="text-[10px] font-bold text-violet-700 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/50 px-2 py-0.5 rounded-md">
                Active Drives
              </span>
            </div>
          </div>

          {/* Card 2: In Progress */}
          <div className="bg-white dark:bg-slate-900 border border-blue-100/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 to-indigo-600" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                In Progress
              </span>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-xs">
                <Icons.PhoneCall className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5 flex-wrap">
              <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {campaignSummaryStats.inProgressCount}
              </span>
              <span className="text-[10px] font-bold text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded-md">
                Active Calling
              </span>
            </div>
          </div>

          {/* Card 3: Completed */}
          <div className="bg-white dark:bg-slate-900 border border-emerald-100/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-600 to-teal-600" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Completed
              </span>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-600 flex items-center justify-center text-white shadow-xs">
                <Icons.CheckCircle className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5 flex-wrap">
              <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {campaignSummaryStats.completedCount}
              </span>
              <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md">
                100% Dialed
              </span>
            </div>
          </div>

          {/* Card 4: Allocated Leads */}
          <div className="bg-white dark:bg-slate-900 border border-cyan-100/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 to-blue-600" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Allocated Leads
              </span>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white shadow-xs">
                <Icons.Users className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5 flex-wrap">
              <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {campaignSummaryStats.totalAllocated.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-cyan-700 dark:text-cyan-400 bg-cyan-50 dark:bg-cyan-950/50 px-2 py-0.5 rounded-md">
                Pipeline Leads
              </span>
            </div>
          </div>

          {/* Card 5: Total Dialed */}
          <div className="bg-white dark:bg-slate-900 border border-teal-100/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-teal-500 to-emerald-600" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Total Dialed
              </span>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-teal-500 to-emerald-600 flex items-center justify-center text-white shadow-xs">
                <Icons.PhoneOutgoing className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-baseline gap-1.5 flex-wrap">
              <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {campaignSummaryStats.totalDialed.toLocaleString()}
              </span>
              <span className="text-[10px] font-bold text-teal-700 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/50 px-2 py-0.5 rounded-md">
                Contacted
              </span>
            </div>
          </div>

          {/* Card 6: Dialing Rate */}
          <div className="bg-white dark:bg-slate-900 border border-amber-100/90 dark:border-slate-800 rounded-2xl p-4 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all group">
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                Dialing Rate
              </span>
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
                <Icons.Zap className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-1.5">
              <span className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {campaignSummaryStats.overallRate}%
              </span>
              <div className="w-14 h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200/60 dark:border-slate-700/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-500 to-emerald-500 transition-all"
                  style={{ width: `${Math.max(campaignSummaryStats.overallRate, 4)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Quick Create Marketing Campaign Studio Card */}
        <form
          onSubmit={handleSaveCampaign}
          className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden text-left"
        >
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-600 via-indigo-600 to-teal-500" />

          <div className="flex items-center justify-between mb-4 pb-2.5 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-violet-50 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400 flex items-center justify-center">
                <Icons.Sparkles className="w-3.5 h-3.5" />
              </div>
              <span className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                {editCampaignId ? 'Edit Campaign Details' : 'Quick Create Marketing Campaign'}
              </span>
            </div>
          </div>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex-1 max-w-2xl">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                Campaign Name <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Icons.Tag className="w-4 h-4 text-violet-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={campaignNameInput}
                  onChange={(e) => setCampaignNameInput(e.target.value)}
                  placeholder="e.g. Q3 Telecalling Drive, HNI Real Estate, Loan Festival..."
                  className="w-full h-11 pl-10 pr-4 text-xs sm:text-sm font-semibold bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-500/15 transition-all shadow-inner-sm"
                />
              </div>
            </div>
            <div className="flex items-center gap-2.5 self-end md:self-auto mt-2 md:mt-0">
              {editCampaignId && (
                <button
                  type="button"
                  onClick={() => {
                    setCampaignNameInput('');
                    setEditCampaignId(null);
                  }}
                  className="h-11 px-5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all cursor-pointer"
                >
                  Cancel
                </button>
              )}
              <button
                type="submit"
                disabled={isSubmittingCampaign || !campaignNameInput.trim()}
                className="h-11 px-6 bg-gradient-to-r from-violet-600 via-indigo-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 active:scale-[0.98] disabled:opacity-50 text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-violet-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmittingCampaign ? (
                  <Icons.Loader className="w-4 h-4 animate-spin" />
                ) : (
                  <Icons.Plus className="w-4 h-4 stroke-[2.5]" />
                )}
                <span>{editCampaignId ? 'Update Campaign' : '+ Create Campaign'}</span>
              </button>
            </div>
          </div>
        </form>

        {/* Filter Tabs Bar matching Image 1 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-2.5 px-4 shadow-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setCampaignFilterTab('all')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                campaignFilterTab === 'all'
                  ? 'bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 border border-violet-200 dark:border-violet-800 shadow-3xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icons.Layers className="w-3.5 h-3.5" />
              <span>All Campaigns</span>
              <span className="px-1.5 py-0.2 rounded-full bg-violet-100 dark:bg-violet-900/60 text-violet-800 dark:text-violet-200 text-[10px] font-mono">
                {campaignSummaryStats.totalCampaigns}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCampaignFilterTab('in_progress')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                campaignFilterTab === 'in_progress'
                  ? 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shadow-3xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icons.PhoneCall className="w-3.5 h-3.5" />
              <span>In Progress</span>
              <span className="px-1.5 py-0.2 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 text-[10px] font-mono">
                {campaignSummaryStats.inProgressCount}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setCampaignFilterTab('completed')}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                campaignFilterTab === 'completed'
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shadow-3xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icons.CheckCircle className="w-3.5 h-3.5" />
              <span>Completed</span>
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 text-[10px] font-mono">
                {campaignSummaryStats.completedCount}
              </span>
            </button>
          </div>
          <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Showing <span className="font-bold text-slate-900 dark:text-white font-mono">{filteredCampaignRecords.length}</span> of <span className="font-bold text-slate-900 dark:text-white font-mono">{campaignSummaryStats.totalCampaigns}</span> campaigns
          </div>
        </div>

        {/* Campaign Table matching Image 1 */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-600 via-indigo-600 via-teal-500 to-emerald-500" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-left text-xs text-slate-800 dark:text-slate-200">
              <thead>
                <tr className="bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700/80">
                  <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Campaign
                  </th>
                  <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Created Date
                  </th>
                  <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider text-center">
                    Allocated Leads
                  </th>
                  <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider text-center">
                    Dialed
                  </th>
                  <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                    Calling Progress
                  </th>
                  <th className="px-6 py-4 text-[11px] font-black text-slate-600 dark:text-slate-300 uppercase tracking-wider text-right">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {filteredCampaignRecords.map((rec: any) => {
                  const name = rec.data?.campaignName || rec.data?.source || rec.data?.campaign || rec.data?.name || rec.name || 'Unnamed Campaign';
                  const allocated = getAllocatedNumbers(name);
                  const dialed = getDialedNumbers(name);
                  const progress = allocated > 0 ? Math.round((dialed / allocated) * 100) : 0;
                  const createdDate = rec.createdAt ? new Date(rec.createdAt) : new Date();
                  const createdDateStr = createdDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + createdDate.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                  });

                  return (
                    <tr key={rec._id} className="hover:bg-violet-50/30 dark:hover:bg-slate-800/60 transition-colors">
                      <td className="px-6 py-4 font-bold text-slate-900 dark:text-white">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-xs flex-shrink-0">
                            <Icons.Megaphone className="w-5 h-5 stroke-[2.2]" />
                          </div>
                          <div>
                            <span className="capitalize block text-sm font-extrabold text-slate-900 dark:text-white tracking-tight">
                              {name}
                            </span>
                            <span className="inline-flex items-center px-2 py-0.5 mt-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60">
                              Active Campaign
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-slate-500 dark:text-slate-400 font-medium">
                        <span className="inline-flex items-center gap-1.5 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1 rounded-lg border border-slate-200/60 dark:border-slate-700/60 text-xs font-semibold text-slate-700 dark:text-slate-300">
                          <Icons.Calendar className="w-3.5 h-3.5 text-violet-500" />
                          {createdDateStr}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center font-bold px-3 py-1 rounded-full bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/60 font-mono text-xs shadow-3xs">
                          {allocated.toLocaleString()} Leads
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center justify-center font-bold px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60 font-mono text-xs shadow-3xs">
                          {dialed.toLocaleString()} Dialed
                        </span>
                      </td>
                      <td className="px-6 py-4 min-w-[150px]">
                        <div className="space-y-1.5">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-extrabold text-slate-800 dark:text-slate-100 font-mono">{progress}%</span>
                            <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md ${
                              progress >= 100
                                ? 'text-emerald-700 bg-emerald-100/80 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : progress > 0
                                ? 'text-violet-700 bg-violet-100/80 dark:bg-violet-950/60 dark:text-violet-300'
                                : 'text-slate-500 bg-slate-100 dark:bg-slate-800'
                            }`}>
                              {progress >= 100 ? 'Completed' : progress > 0 ? 'In Progress' : 'Pending'}
                            </span>
                          </div>
                          <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden border border-slate-200/60 dark:border-slate-700/60 p-0.5">
                            <div
                              className="h-full rounded-full transition-all bg-gradient-to-r from-violet-600 via-indigo-600 to-emerald-500"
                              style={{ width: `${Math.max(progress, 3)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="inline-flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleDownloadCampaign(rec)}
                            className="h-8.5 px-3 bg-violet-50 hover:bg-violet-100 active:bg-violet-150 text-violet-700 dark:bg-violet-950/50 dark:hover:bg-violet-900/60 dark:text-violet-300 border border-violet-200 dark:border-violet-800/80 rounded-xl text-xs font-bold shadow-3xs transition-all inline-flex items-center gap-1.5 cursor-pointer"
                            title="Download 12-Column CSV"
                          >
                            <Icons.Download className="w-3.5 h-3.5" />
                            <span>Export</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEditClick(rec)}
                            className="w-8.5 h-8.5 rounded-xl bg-amber-50 hover:bg-amber-100 active:bg-amber-150 text-amber-700 dark:bg-amber-950/50 dark:hover:bg-amber-900/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center transition-all shadow-3xs cursor-pointer"
                            title="Edit Campaign"
                          >
                            <Icons.Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteCampaign(rec._id, name)}
                            className="w-8.5 h-8.5 rounded-xl bg-rose-50 hover:bg-rose-100 active:bg-rose-150 text-rose-600 dark:bg-rose-950/50 dark:hover:bg-rose-900/60 dark:text-rose-400 border border-rose-200 dark:border-rose-800/80 flex items-center justify-center transition-all shadow-3xs cursor-pointer"
                            title="Delete Campaign"
                          >
                            <Icons.Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {filteredCampaignRecords.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-16 text-center">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-600 to-indigo-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-violet-500/20">
                        <Icons.Megaphone className="w-7 h-7" />
                      </div>
                      <p className="font-extrabold text-base text-slate-800 dark:text-slate-100">No campaigns found</p>
                      <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                        {campaignFilterTab !== 'all'
                          ? `No campaigns in "${campaignFilterTab.replace('_', ' ')}" status.`
                          : 'Enter a campaign name above to launch your first targeted marketing drive.'}
                      </p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  if (apiPath === 'campaignassignments') {
    return (
      <div className="space-y-6">
        {renderCampaignAssignments()}
      </div>
    );
  }

  if (apiPath === 'campaigns') {
    return (
      <div className="space-y-6">
        {renderCampaignsList()}
      </div>
    );
  }

  if (!activeModule) {
    return (
      <div className="py-16 text-center text-slate-500 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/60 dark:border-slate-800">
        <Icons.FolderClosed className="w-10 h-10 mx-auto mb-2 text-slate-400" />
        <p className="font-bold text-sm">Module not found</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {apiPath === 'leads' ? (
        <div className="space-y-5">
          {/* Header Title Bar with Icon & Live Count */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pt-1">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shadow-3xs flex-shrink-0">
                <Icons.Users className="w-5 h-5" />
              </div>
              <div className="text-left">
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white uppercase tracking-tight">
                    {urlFollowup === 'today'
                      ? "TODAY'S FOLLOWUPS"
                      : urlStatus 
                        ? (urlStatus.toUpperCase().endsWith('LEADS') ? urlStatus.toUpperCase() : `${urlStatus.toUpperCase()} LEADS`) 
                        : 'ALL LEADS'}
                  </h1>
                  <span className="text-xs font-bold px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-3xs font-mono">
                    {data?.pagination?.total ?? data?.pagination?.totalRecords ?? (data?.records?.length || 0)} Total
                  </span>
                </div>
                <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {urlFollowup === 'today'
                    ? "Showing all leads scheduled for follow-up today."
                    : urlStatus 
                      ? `Filtering leads with status: ${urlStatus}` 
                      : 'Search, manage, and track leads across all campaigns.'}
                </p>
              </div>
            </div>

            {(urlStatus || urlFollowup) && (
              <Link
                to="/modules/leads"
                className="px-3.5 py-2 text-xs font-bold bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl transition-all flex items-center gap-1.5 shadow-3xs cursor-pointer"
              >
                <Icons.X className="w-3.5 h-3.5" />
                <span>Clear Filter</span>
              </Link>
            )}
          </div>

          {/* Premium Control Bar with Generous Padding */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            {/* Create Lead Button */}
            <Link
              to="/modules/leads/new"
              className="inline-flex items-center justify-center gap-2 h-10 px-5 bg-[#17223B] hover:bg-[#223050] active:bg-[#0F172A] text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-xs transition-all self-start lg:self-auto cursor-pointer"
            >
              <Icons.Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Create Lead</span>
            </Link>

            {/* Search Input & Action Buttons Form */}
            <form 
              onSubmit={handleSearchSubmit}
              className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 w-full"
            >
              <div className="relative flex-1 max-w-md">
                <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={searchVal}
                  onChange={(e) => setSearchVal(e.target.value)}
                  placeholder="Search by name, lead number, created by, mobile..."
                  className="w-full h-10 pl-10 pr-9 text-xs sm:text-sm bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
                />
                {searchVal && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchVal('');
                      setPage(1);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-1 rounded cursor-pointer"
                    title="Clear search"
                  >
                    <Icons.X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="submit"
                  className="h-10 px-5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold uppercase tracking-wider rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Icons.Search className="w-3.5 h-3.5 stroke-[2.2]" />
                  <span>Search</span>
                </button>
                <button
                  type="button"
                  onClick={handleLoadAll}
                  className="h-10 px-4.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  title="Reset filters and load all leads"
                >
                  <Icons.RotateCcw className="w-3.5 h-3.5 stroke-[2]" />
                  <span>Load All</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        <>
          {/* Title & Add new header bar */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary/10 text-primary rounded-xl">
                <DynamicIcon name={activeModule.icon} className="w-6 h-6" />
              </div>
              <div>
                <h1 className="text-2xl uppercase font-bold tracking-tight text-slate-800 dark:text-white">
                  {urlStatus ? `${urlStatus} Leads` : activeModule.pluralLabel}
                </h1>
                <p className="text-sm text-slate-500 mt-1">
                  {urlStatus ? `Showing leads with status: ${urlStatus}` : 'Manage database records'}
                </p>
              </div>
              {urlStatus && (
                <Link
                  to={`/modules/${activeModule.apiPath}`}
                  className="ml-2 px-3 py-1.5 text-xs font-semibold bg-rose-100 text-rose-600 rounded-lg hover:bg-rose-200 transition-all flex items-center gap-1"
                >
                  <Icons.X className="w-3 h-3" /> Clear Filter
                </Link>
              )}
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={handleExportCSV}
                className="flex-1 sm:flex-none justify-center px-4 py-2 border border-[#EAE4DA] bg-white hover:bg-[#F8F5F1] rounded-xl text-xs font-bold uppercase tracking-wider transition-all text-[#1F2937] flex items-center gap-1.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
              >
                <Icons.Download className="w-4 h-4" /> Export CSV
              </button>
              <Link
                to={`/modules/${activeModule.apiPath}/new`}
                className="flex-1 sm:flex-none justify-center px-5 py-2 bg-[#17223B] hover:bg-[#24324A] text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-1.5 shadow-[0_2px_6px_rgba(23,34,59,0.12)] hover:shadow-[0_4px_12px_rgba(23,34,59,0.2)]"
              >
                <Icons.Plus className="w-4 h-4" /> Add {activeModule.singularLabel}
              </Link>
            </div>
          </div>

          {/* Filtering Controls */}
          <div className="flex flex-col md:flex-row md:items-center justify-end gap-4 border-b border-slate-200 dark:border-slate-700/50 pb-4">

            {/* Inline Search / Filters */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="relative">
                <Icons.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  value={searchVal}
                  onChange={(e) => setSearchVal(e.target.value)}
                  placeholder="Search rows..."
                  className="pl-9 pr-4 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary text-slate-700 dark:text-slate-300"
                />
              </div>

              {/* Quick status dropdown filter */}
              {activeModule.fields.find((f) => f.type === 'dropdown') && (
                <div className="flex items-center gap-1 text-xs">
                  <span className="text-slate-400">Filter:</span>
                  <select
                    value={filterVal}
                    onChange={(e) => {
                      const dropField = activeModule.fields.find((f) => f.type === 'dropdown');
                      setFilterField(dropField?.name || '');
                      setFilterVal(e.target.value);
                    }}
                    className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 focus:outline-none text-slate-700 dark:text-slate-300"
                  >
                    <option value="">All Stages</option>
                    {activeModule.fields
                      .find((f) => f.type === 'dropdown')
                      ?.options?.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Render selected Mode Layout */}
      {showDelayedSkeleton && !data ? (
        <div className="space-y-4 py-8">
          <div className="h-10 bg-slate-200 dark:bg-slate-700 rounded animate-shimmer"></div>
          <div className="h-32 bg-slate-100 dark:bg-slate-800 rounded animate-shimmer"></div>
          {isTakingLonger && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl text-center space-y-2">
              <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Taking longer than usual...</p>
              <button
                onClick={() => refetch()}
                className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
              >
                Retry Connection
              </button>
            </div>
          )}
        </div>
      ) : isError && !data ? (
        <div className="py-12 text-center bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/50 rounded-xl p-6 max-w-md mx-auto space-y-3">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <Icons.AlertCircle className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-white">Failed to load records</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {(error as any)?.message || "The request could not reach the server."}
          </p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Icons.RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      ) : (
        <>
          {viewMode === 'table' && (
            apiPath === 'leads' ? (
              <div className="space-y-6">
                {data?.records.map((rec: any, idx: number) => {
                  const leadNo = rec._id.slice(-6).toUpperCase();
                  const leadName = `${rec.data?.firstName || ''} ${rec.data?.lastName || ''}`.trim() || rec.data?.fullName || rec.data?.customerName || rec.data?.name || rec.data?.leadName || 'N/A';
                  const leadLocation = rec.data?.location || [rec.data?.city, rec.data?.state].filter(Boolean).join(', ') || rec.data?.city || rec.data?.presentAddress || rec.data?.address || 'N/A';
                  const amountVal = rec.data?.budget ?? rec.data?.loanAmount ?? rec.data?.amount;
                  const currencySymbol = '₹';
                  const formattedAmount = amountVal != null && amountVal !== '' ? `${currencySymbol}${Number(amountVal).toLocaleString('en-IN')}` : 'N/A';
                  const createdByName = rec.createdBy?.firstName 
                    ? `${rec.createdBy.firstName} ${rec.createdBy.lastName || ''}`.trim()
                    : (rec.createdBy?.name || rec.createdBy?.email?.split('@')[0] || (typeof rec.createdBy === 'string' && rec.createdBy.length < 25 && !rec.createdBy.match(/^[0-9a-fA-F]{24}$/) ? rec.createdBy : '') || rec.data?.source || rec.data?.createdBy || 'Ink CRM');

                  const assignedToName = rec.data?.assignedToName || resolveUserDisplayName(rec.data?.assignedTo || rec.data?.assignTo || rec.assignedTo);
                  const assignedByName = rec.data?.assignedByName 
                    ? resolveUserDisplayName(rec.data.assignedByName) 
                    : (rec.data?.assignedBy 
                        ? resolveUserDisplayName(rec.data.assignedBy) 
                        : (createdByName && createdByName !== 'System' && createdByName !== 'N/A' ? createdByName : 'System Router'));
                  const psmName = rec.data?.psmName || resolveUserDisplayName(rec.data?.psm || rec.data?.assignedTo || 'Unassigned');

                  const rawPhone = rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contactNum || rec.data?.mobileNo || rec.data?.contact_num || '';
                  const isRevealed = !!revealedPhones[rec._id];
                  const displayedPhone = maskPhoneNumber(rawPhone, isRevealed);
                  const statusTokens = getStatusTokens(rec.data?.status || 'HOT');
                  const rawStatus = (rec.data?.status || 'NEW').toUpperCase();
                  const statusBadgeText = rawStatus.endsWith('LEAD') || rawStatus.endsWith('LEADS') 
                    ? rawStatus 
                    : `${rawStatus} LEAD`;

                  let statusBadgeStyle = 'border border-slate-300 bg-slate-50 text-slate-700 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-300';
                  let StatusBadgeIcon: any = Icons.Sparkles;

                  if (rawStatus.includes('HOT')) {
                    statusBadgeStyle = 'border border-rose-200 bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:border-rose-900/60 dark:text-rose-400';
                    StatusBadgeIcon = Icons.Flame;
                  } else if (rawStatus.includes('CALL NOT CONNECT') || rawStatus.includes('NOT CONNECT')) {
                    statusBadgeStyle = 'border border-sky-200 bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:border-sky-900/60 dark:text-sky-400';
                    StatusBadgeIcon = Icons.PhoneOff;
                  } else if (rawStatus.includes('WARM') || rawStatus.includes('DEMO')) {
                    statusBadgeStyle = 'border border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:border-amber-900/60 dark:text-amber-400';
                    StatusBadgeIcon = Icons.Zap;
                  } else if (rawStatus.includes('DISBURS') || rawStatus.includes('APPROV') || rawStatus.includes('WON')) {
                    statusBadgeStyle = 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:border-emerald-900/60 dark:text-emerald-400';
                    StatusBadgeIcon = Icons.CheckCircle2;
                  } else if (rawStatus.includes('REJECT') || rawStatus.includes('DROP') || rawStatus.includes('DEAD')) {
                    statusBadgeStyle = 'border border-slate-300 bg-slate-100 text-slate-600 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400';
                    StatusBadgeIcon = Icons.XCircle;
                  } else {
                    statusBadgeStyle = 'border border-indigo-200 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:border-indigo-900/60 dark:text-indigo-400';
                    StatusBadgeIcon = Icons.PhoneCall;
                  }

                  const remarksText = rec.data?.notes 
                    ? rec.data.notes.replace(/<[^>]*>/g, '') 
                    : (rec.data?.remarks || (rec.data?.dataCode ? `Data Code: ${rec.data.dataCode}` : 'N/A'));

                  return (
                    <div 
                      key={rec._id} 
                      className="border border-slate-200 dark:border-slate-700/80 rounded-2xl bg-white dark:bg-slate-800 relative mb-4 last:mb-0 text-left shadow-xs hover:shadow-md transition-all duration-150 overflow-hidden"
                    >
                      {/* Status-colored Top Accent Bar */}
                      <div 
                        className="absolute top-0 left-0 right-0 h-[3px]" 
                        style={{ backgroundColor: statusTokens.accentHex }} 
                      />
                      
                      <div className="p-5 sm:p-6 space-y-4">
                        {/* 4-Column CSS Grid matching Image 1 exactly */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3.5 text-xs">
                          {/* --- Column 1 --- */}
                          <div className="space-y-3.5">
                            {/* Row 1: Sl No. */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Sl No.: </span>
                              <span className="text-slate-700 dark:text-slate-300 font-normal">{(page - 1) * 10 + idx + 1}</span>
                            </div>

                            {/* Row 2: Lead No. */}
                            <div className="leading-snug flex items-center gap-1.5">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Lead No.: </span>
                              <span className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700/70 text-slate-700 dark:text-slate-300 font-mono text-[11px] font-semibold border border-slate-200/60 dark:border-slate-600/60">
                                LND-{leadNo}
                              </span>
                            </div>

                            {/* Row 3: Product */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Product: </span>
                              <span className="text-slate-700 dark:text-slate-300 uppercase truncate inline-block max-w-[190px] align-bottom" title={rec.data?.loanType || 'N/A'}>
                                {rec.data?.loanType || 'N/A'}
                              </span>
                            </div>

                            {/* Row 4: Status */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Status: </span>
                              <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase">
                                {rec.data?.status || 'NEW'}
                              </span>
                            </div>

                            {/* Row 5: Bank Partner */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Bank Partner: </span>
                              <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase truncate inline-block max-w-[170px] align-bottom" title={rec.data?.businessPartner || rec.data?.bankPartner || 'BAJAJ FINANCE'}>
                                {rec.data?.businessPartner || rec.data?.bankPartner || 'BAJAJ FINANCE'}
                              </span>
                            </div>
                          </div>

                          {/* --- Column 2 --- */}
                          <div className="space-y-3.5">
                            {/* Row 1: Lead Name */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Lead Name: </span>
                              <Link 
                                to={`/modules/leads/${rec._id}`}
                                className="text-sky-600 dark:text-sky-400 font-bold hover:underline cursor-pointer uppercase truncate inline-block max-w-[190px] align-bottom" 
                                title={leadName}
                              >
                                {leadName}
                              </Link>
                            </div>

                            {/* Row 2: Location */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Location: </span>
                              <span className="text-slate-700 dark:text-slate-300 uppercase truncate inline-block max-w-[190px] align-bottom" title={leadLocation}>
                                {leadLocation}
                              </span>
                            </div>

                            {/* Row 3: Mobile No. */}
                            <div className="leading-snug flex items-center gap-1.5">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Mobile No.: </span>
                              <span className="text-slate-700 dark:text-slate-300 font-mono font-medium inline-flex items-center gap-1.5">
                                {displayedPhone}
                                {rawPhone && rawPhone !== 'N/A' && (
                                  <button
                                    type="button"
                                    onClick={() => togglePhoneReveal(rec._id)}
                                    title={isRevealed ? "Hide number" : "Show number"}
                                    className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                  >
                                    {isRevealed ? <Icons.EyeOff className="w-3.5 h-3.5" /> : <Icons.Eye className="w-3.5 h-3.5" />}
                                  </button>
                                )}
                              </span>
                            </div>

                            {/* Row 4: Amount */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Amount: </span>
                              <span className={formattedAmount !== 'N/A' ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-slate-700 dark:text-slate-300"}>
                                {formattedAmount}
                              </span>
                            </div>

                            {/* Row 5: Case Details */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Case Details: </span>
                              <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={rec.data?.caseDetails || 'N/A'}>
                                {rec.data?.caseDetails || 'N/A'}
                              </span>
                            </div>
                          </div>

                          {/* --- Column 3 --- */}
                          <div className="space-y-3.5">
                            {/* Row 1: Created On */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Created On: </span>
                              <span className="text-slate-700 dark:text-slate-300">{formatDate(rec.createdAt)}</span>
                            </div>

                            {/* Row 2: By (Created By) */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">By: </span>
                              <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={createdByName}>
                                {createdByName}
                              </span>
                            </div>

                            {/* Row 3: Followup Date */}
                            <div className="leading-snug flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Followup Date: </span>
                              <span className="inline-block px-2.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 font-semibold text-[11px] border border-indigo-100 dark:border-indigo-900/40">
                                {rec.data?.followUpDate ? formatDate(rec.data.followUpDate) : 'N/A'}
                              </span>
                            </div>

                            {/* Row 4: Pending at */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Pending at: </span>
                              <span className="text-slate-700 dark:text-slate-300 font-semibold uppercase truncate inline-block max-w-[180px] align-bottom" title={rec.data?.assignToTeam || rec.data?.pendingAt || 'SALES MANAGER'}>
                                {rec.data?.assignToTeam || rec.data?.pendingAt || 'SALES MANAGER'}
                              </span>
                            </div>

                            {/* Row 5: PSM */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">PSM: </span>
                              <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={psmName}>
                                {psmName}
                              </span>
                            </div>
                          </div>

                          {/* --- Column 4 --- */}
                          <div className="space-y-3.5">
                            {/* Row 1: Firm/Company */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Firm/Company: </span>
                              <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={rec.data?.company || rec.data?.firm || 'N/A'}>
                                {rec.data?.company || rec.data?.firm || 'N/A'}
                              </span>
                            </div>

                            {/* Row 2: Modified On */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Modified On: </span>
                              <span className="text-slate-700 dark:text-slate-300">{formatDate(rec.updatedAt)}</span>
                            </div>

                            {/* Row 3: Assigned By */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Assigned By: </span>
                              <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[180px] align-bottom" title={assignedByName}>
                                {assignedByName}
                              </span>
                            </div>

                            {/* Row 4: Assigned To */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Assigned To: </span>
                              <span className="text-indigo-600 dark:text-indigo-400 font-semibold truncate inline-block max-w-[180px] align-bottom" title={assignedToName}>
                                {assignedToName}
                              </span>
                            </div>

                            {/* Row 5: Remarks */}
                            <div className="leading-snug">
                              <span className="font-bold text-slate-800 dark:text-slate-100">Remarks: </span>
                              <span className="italic text-slate-500 dark:text-slate-400 truncate inline-block max-w-[180px] align-bottom" title={remarksText}>
                                {remarksText}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Card Footer: Action Toolbar */}
                        <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider ${statusBadgeStyle}`}>
                              <StatusBadgeIcon className="w-3.5 h-3.5" />
                              <span>{statusBadgeText}</span>
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            {/* WA Chat (Green) */}
                            <button 
                              type="button"
                              onClick={() => {
                                const phoneNum = rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contactNum || rec.data?.mobileNo || rec.data?.contact_num || '';
                                let cleanPhone = String(phoneNum).replace(/\D/g, '').trim();
                                if (cleanPhone) {
                                  if (cleanPhone.length === 10) {
                                    cleanPhone = `91${cleanPhone}`;
                                  }
                                  window.open(`https://wa.me/${cleanPhone}`, '_blank');
                                } else {
                                  showToast('No phone number available for this lead.', 'warning');
                                }
                              }}
                              className="inline-flex items-center gap-1.5 bg-[#10b981] hover:bg-[#059669] active:bg-[#047857] text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
                            >
                              <Icons.MessageSquare className="w-3.5 h-3.5" />
                              <span>WA Chat</span>
                            </button>
                            
                            {/* Call (Purple/Indigo) */}
                            <button 
                              type="button"
                              onClick={() => {
                                const phoneNum = rec.data?.phone || rec.data?.mobile || rec.data?.contactNumber || rec.data?.contactNum || rec.data?.mobileNo || rec.data?.contact_num || '';
                                const cleanPhone = String(phoneNum).replace(/[^\d+]/g, '').trim();
                                if (cleanPhone) {
                                  const name = `${rec.data?.firstName || ''} ${rec.data?.lastName || ''}`.trim() || rec.data?.fullName || rec.data?.customerName || rec.data?.name || 'Lead';
                                  showToast(`Calling ${name} (${cleanPhone})...`, 'info');
                                  window.location.href = `tel:${cleanPhone}`;
                                } else {
                                  showToast('No phone number available for this lead.', 'warning');
                                }
                              }}
                              className="inline-flex items-center gap-1.5 bg-[#4f46e5] hover:bg-[#4338ca] active:bg-[#3730a3] text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
                            >
                              <Icons.PhoneCall className="w-3.5 h-3.5" />
                              <span>Call</span>
                            </button>
                            
                            {/* Upload File (White with border) */}
                            <button 
                              type="button"
                              onClick={() => handleUploadClick(rec._id)}
                              className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
                            >
                              <Icons.Upload className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                              <span>Upload File</span>
                            </button>
                            
                            {/* Edit (Blue) */}
                            <Link 
                              to={`/modules/leads/${rec._id}`} 
                              className="inline-flex items-center gap-1.5 bg-[#0284c7] hover:bg-[#0369a1] active:bg-[#075985] text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs"
                            >
                              <Icons.Edit3 className="w-3.5 h-3.5" />
                              <span>Edit</span>
                            </Link>
                            
                            {/* History (White with border) */}
                            <button 
                              type="button"
                              onClick={() => openHistory(rec)}
                              className="inline-flex items-center gap-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/60 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors shadow-2xs cursor-pointer"
                            >
                              <Icons.History className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                              <span>History</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {data?.records.length === 0 && (
                  <div className="p-12 text-center text-slate-400 border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
                    No leads records found.
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/50 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto pb-2 -mx-2 px-2 sm:mx-0 sm:px-0">
                  <table className="w-full min-w-[800px] text-left text-sm text-slate-600 dark:text-slate-300">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-xs font-semibold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-700">
                      <tr>
                        <th className="px-6 py-4">Name / ID</th>
                        {activeModule.fields.slice(1, 5).map((field) => (
                          <th key={field.name} className="px-6 py-4">
                            {field.label}
                          </th>
                        ))}
                        <th className="px-6 py-4">Created At</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                      {data?.records.map((rec: any) => {
                        const leadName = rec.data.firstName || rec.data.lastName
                          ? `${rec.data.firstName || ''} ${rec.data.lastName || ''}`.trim()
                          : null;
                        const mainVal =
                          leadName ||
                          rec.data.fullName ||
                          rec.data.companyName ||
                          rec.data.dealName ||
                          rec.data.title ||
                          rec._id;

                        return (
                          <tr key={rec._id} className="hover:bg-slate-50 dark:hover:bg-slate-700/20 transition-colors">
                            <td className="px-6 py-4 font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">
                              <Link to={`/modules/${activeModule.apiPath}/${rec._id}`} className="hover:underline text-primary">
                                {mainVal}
                              </Link>
                            </td>
                            {activeModule.fields.slice(1, 5).map((field) => (
                              <td key={field.name} className="px-6 py-4 truncate max-w-[150px]">
                                {field.type === 'currency' 
                                  ? `₹${Number(rec.data[field.name] || 0).toLocaleString('en-IN')}` 
                                  : field.type === 'date'
                                    ? formatDate(rec.data[field.name])
                                    : String(rec.data[field.name] || '-')}
                              </td>
                            ))}
                            <td className="px-6 py-4 text-xs text-slate-400">
                              {formatDate(rec.createdAt)}
                            </td>
                            <td className="px-6 py-4 text-right space-x-3">
                              <Link
                                to={`/modules/${activeModule.apiPath}/${rec._id}`}
                                className="text-primary hover:text-indigo-400 font-medium text-xs"
                              >
                                Edit
                              </Link>
                              <button
                                onClick={() => handleDelete(rec._id)}
                                className="text-rose-500 hover:text-rose-400 font-medium text-xs"
                              >
                                Delete
                              </button>
                            </td>
                          </tr>
                        );
                      })}

                      {data?.records.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-slate-400">
                            No records loaded matching queries.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {/* Pagination bar - 10 leads per page */}
          {(() => {
            const totalRecords = data?.pagination?.total ?? data?.pagination?.totalRecords ?? (data?.records?.length || 0);
            const totalPages = Math.max(1, data?.pagination?.totalPages || Math.ceil(totalRecords / 10));
            const startIdx = totalRecords === 0 ? 0 : (page - 1) * 10 + 1;
            const endIdx = Math.min(page * 10, totalRecords);

            // Compute array of page numbers to show (e.g., 1, 2, 3, 4, 5...)
            const getPageNumbers = () => {
              const pages: (number | string)[] = [];
              if (totalPages <= 7) {
                for (let i = 1; i <= totalPages; i++) pages.push(i);
              } else {
                if (page <= 4) {
                  pages.push(1, 2, 3, 4, 5, '...', totalPages);
                } else if (page >= totalPages - 3) {
                  pages.push(1, '...', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages);
                } else {
                  pages.push(1, '...', page - 1, page, page + 1, '...', totalPages);
                }
              }
              return pages;
            };

            const handlePageChange = (newPage: number) => {
              if (newPage >= 1 && newPage <= totalPages && newPage !== page) {
                setPage(newPage);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }
            };

            return (
              <div className="px-6 py-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col md:flex-row justify-between items-center gap-4 text-xs shadow-xs mt-6">
                <div className="text-slate-500 dark:text-slate-400 font-medium">
                  {totalRecords > 0 ? (
                    <>
                      Showing <span className="font-bold text-slate-900 dark:text-white font-mono">{startIdx}</span> to{' '}
                      <span className="font-bold text-slate-900 dark:text-white font-mono">{endIdx}</span> of{' '}
                      <span className="font-bold text-slate-900 dark:text-white font-mono">{totalRecords}</span> {apiPath === 'leads' ? 'leads' : 'records'}
                      <span className="ml-2 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                        (Page {page} of {totalPages})
                      </span>
                    </>
                  ) : (
                    <span>No {apiPath === 'leads' ? 'leads' : 'records'} found</span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 flex-wrap justify-center">
                  {/* First Page */}
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(1)}
                    className="h-8.5 px-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    title="First Page"
                  >
                    «
                  </button>

                  {/* Previous Page */}
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(page - 1)}
                    className="h-8.5 px-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Icons.ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>

                  {/* Numbered Page Buttons */}
                  <div className="hidden sm:flex items-center gap-1">
                    {getPageNumbers().map((pNum, pIdx) => {
                      if (pNum === '...') {
                        return (
                          <span key={`dots-${pIdx}`} className="px-2 py-1 text-slate-400 select-none">
                            ...
                          </span>
                        );
                      }
                      const isCurrent = pNum === page;
                      return (
                        <button
                          key={`page-${pNum}`}
                          type="button"
                          onClick={() => handlePageChange(Number(pNum))}
                          className={`h-8.5 min-w-[34px] px-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                            isCurrent
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {pNum}
                        </button>
                      );
                    })}
                  </div>

                  {/* Next Page */}
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(page + 1)}
                    className="h-8.5 px-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <span>Next</span>
                    <Icons.ChevronRight className="w-3.5 h-3.5" />
                  </button>

                  {/* Last Page */}
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(totalPages)}
                    className="h-8.5 px-2.5 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs disabled:opacity-30 disabled:cursor-not-allowed transition-all cursor-pointer"
                    title="Last Page"
                  >
                    »
                  </button>
                </div>
              </div>
            );
          })()}

          {viewMode === 'kanban' && renderKanban(activeModule, data?.records || [])}

          {viewMode === 'calendar' && renderCalendar(activeModule, data?.records || [])}

          {viewMode === 'timeline' && renderTimeline(data?.records || [])}
        </>
      )}
      {/* Hidden file uploader */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />

      {/* Record History & Timeline Modal */}
      {activeHistoryRecord && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-900/50">
              <div>
                <h3 className="font-bold text-slate-800 dark:text-white text-lg uppercase tracking-tight">
                  Lead Audit History
                </h3>
                <p className="text-xs text-slate-400 font-medium mt-0.5">
                  Lead Name: <span className="text-slate-800 dark:text-white font-bold">{activeHistoryRecord.data?.firstName} {activeHistoryRecord.data?.lastName}</span> • Lead No: <span className="font-mono font-bold text-indigo-600">LND-{activeHistoryRecord._id.slice(-6).toUpperCase()}</span>
                </p>
              </div>
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-500 dark:text-slate-400 transition-colors"
              >
                <Icons.X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              {loadingHistory ? (
                <div className="flex justify-center items-center py-12">
                  <Icons.Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
                </div>
              ) : (
                <>
                  {/* Documents Section */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                      <Icons.File className="w-3.5 h-3.5 text-amber-500" /> Attached Documents ({historyDocuments.length})
                    </h4>
                    {historyDocuments.length > 0 ? (
                      <div className="space-y-2">
                        {historyDocuments.map((doc: any) => (
                          <div key={doc._id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-805">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Icons.FileText className="w-4 h-4 text-indigo-500 flex-shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-700 dark:text-slate-200 truncate">{doc.name}</p>
                                <p className="text-[10px] text-slate-400">{(doc.size / 1024).toFixed(1)} KB</p>
                              </div>
                            </div>
                            <a 
                              href={`${FILE_BASE_URL}${doc.filePath}`} 
                              target="_blank" 
                              rel="noreferrer"
                              className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                            >
                              <Icons.Download className="w-3.5 h-3.5" /> Download
                            </a>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic">No files attached to this record.</p>
                    )}
                  </div>

                  {/* Comprehensive Audit & Modification History */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-1.5 border-b border-slate-100 dark:border-slate-800 pb-2">
                      <Icons.History className="w-4 h-4 text-indigo-600" /> Full Audit & Modification History ({historyActivities.length})
                    </h4>

                    {historyActivities.length > 0 ? (
                      <div className="relative border-l-2 border-slate-200 dark:border-slate-800 ml-3 pl-6 space-y-6">
                        {historyActivities.map((act: any) => {
                          const dateObj = new Date(act.createdAt);
                          const dateStr = formatDate(act.createdAt);
                          const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                          const performerName = act.userId ? `${act.userId.firstName || ''} ${act.userId.lastName || ''}`.trim() : (act.performedBy ? `${act.performedBy.firstName || ''} ${act.performedBy.lastName || ''}`.trim() : 'System Router');
                          
                          const d = act.details || {};
                          const fieldName = d.fieldName || '';
                          const isStatusChange = act.type === 'status_change' || fieldName === 'status';
                          const isAssignment = act.type === 'assignment' || fieldName === 'assignedTo';
                          const isCreation = act.type === 'create';

                          return (
                            <div key={act._id} className="relative bg-slate-50/80 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 p-3.5 rounded-2xl space-y-2">
                              {/* Dot Icon */}
                              <span className={`absolute -left-[31px] top-4 w-4 h-4 rounded-full border-2 border-white dark:border-slate-900 ${
                                isStatusChange ? 'bg-indigo-600' : isAssignment ? 'bg-emerald-600' : isCreation ? 'bg-blue-600' : 'bg-amber-500'
                              }`} />

                              {/* Header & Event Badge */}
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-md border ${
                                  isStatusChange ? 'bg-indigo-50 border-indigo-200 text-indigo-700' :
                                  isAssignment ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                                  isCreation ? 'bg-blue-50 border-blue-200 text-blue-700' :
                                  'bg-amber-50 border-amber-200 text-amber-700'
                                }`}>
                                  {isStatusChange ? 'STATUS UPDATED' : isAssignment ? 'LEAD TRANSFERRED / ASSIGNED' : isCreation ? 'LEAD CREATED' : `EDITED (${fieldName.toUpperCase()})`}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">
                                  {dateStr} • {timeStr}
                                </span>
                              </div>

                              {/* Activity Details: Old vs New Values */}
                              <div className="text-xs space-y-1">
                                {isStatusChange && (
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Status Changed: <span className="line-through text-rose-500 font-bold">{d.oldValue || 'N/A'}</span> ➔ <span className="text-emerald-600 font-bold uppercase">{d.newValue || 'Updated'}</span>
                                  </div>
                                )}

                                {isAssignment && (
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    Lead Transferred To: <span className="line-through text-slate-400">{d.oldValue || 'Unassigned'}</span> ➔ <span className="text-indigo-600 font-bold">{d.newValue || 'Agent'}</span>
                                  </div>
                                )}

                                {!isStatusChange && !isAssignment && !isCreation && (
                                  <div className="font-semibold text-slate-800 dark:text-slate-200">
                                    {fieldName ? `Field '${fieldName}': ` : ''}
                                    <span className="line-through text-slate-400">{String(d.oldValue || 'N/A')}</span> ➔ <span className="text-slate-900 dark:text-white font-bold">{String(d.newValue || 'N/A')}</span>
                                  </div>
                                )}

                                {isCreation && (
                                  <div className="font-semibold text-slate-700 dark:text-slate-300">
                                    Lead initially registered in system with status: <span className="font-bold text-indigo-600 uppercase">{activeHistoryRecord.data?.status || 'New'}</span>
                                  </div>
                                )}

                                {d.commentText && (
                                  <p className="text-[11px] text-slate-500 italic mt-1 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800">
                                    "{d.commentText}"
                                  </p>
                                )}
                              </div>

                              {/* Performed By footer */}
                              <div className="text-[10px] text-slate-400 font-semibold pt-1 border-t border-slate-200/50 dark:border-slate-700/50 flex items-center justify-between">
                                <span>Action by: <span className="text-slate-700 dark:text-slate-300 font-bold">{performerName}</span></span>
                                <span>Record ID: LND-{activeHistoryRecord._id.slice(-6).toUpperCase()}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic text-center py-6">No modification history logged for this record yet.</p>
                    )}
                  </div>
                </>
              )}
            </div>
            
            {/* Modal Footer */}
            <div className="p-4 bg-slate-50/50 dark:bg-slate-900/50 border-t border-slate-100 dark:border-slate-800 flex justify-end">
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl uppercase transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
