import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import api, { FILE_BASE_URL } from '../services/api';
import { useToastStore } from '../store/toastStore';
import { useAuthStore } from '../store/authStore';
import { queryClient } from '../services/queryClient';
import * as Icons from 'lucide-react';
import { exportCampaignCSV } from '../utils/exportCampaignCSV';
import { exportLeadReportXLSX } from '../utils/exportLeadReportXLSX';
import { formatDate } from '../utils/dateFormatter';
import { getStatusTokens } from '../utils/statusTokenMapper';

interface CampaignStats {
  campaignName: string;
  totalAssigned: number;
  dialed: number;
  yetToDial: number;
  createdAt: string;
  dailyTarget: number;
}

interface LeadRecord {
  _id: string;
  data: Record<string, any>;
  createdAt: string;
  updatedAt?: string;
  createdBy?: any;
  assignedTo?: any;
  [key: string]: any;
}

interface LeadState {
  status?: string;
  remarks?: string;
  caseDetails?: string;
  leadCategory?: string;
  dataCode?: string;
  leadName?: string;
  product?: string;
  location?: string;
  mobile?: string;
  amount?: string;
  bankPartner?: string;
  followupDate?: string;
  firmName?: string;
  psm?: string;
  wasDialed?: boolean;
  callAttempts?: number;
}

interface SaveSuccessModalData {
  isOpen: boolean;
  leadId: string;
  slNo: number;
  dataCode: string;
  nextLeadId?: string;
  nextSlNo?: number;
  hasNext: boolean;
}

const EXCLUDED_CAMPAIGN_STATUSES = new Set([
  'REJECTED',
  'DROPPED',
  'DISBUSED',
  'DISBURSED',
  'APPROVE BUT NOT DISBUSE',
  'APPROVED BUT NOT DISBUSE',
  'APPROVAL PENDING',
  'DOCUMENT PENDING',
  'CEBIL PENDING',
  'CIBIL PENDING',
  'CEDIL PENDING',
  'PENDING'
]);

const CAMPAIGN_STATUSES = [
  'Yet To Call',
  'Hot Leads',
  'Warm Leads',
  'Cool Lead',
  'Followup',
  'Not Interested',
  'Call Rejected',
  'Not Connected',
  'No Answer',
  'Number Busy',
  'Out of Service',
  'No Incoming Calls',
  'Switch Off',
  'Not Reachable',
  'Wrong Number',
  'Not Exists',
  'Repeated Number',
  'No Business'
];

const getCardStatusMeta = (statusStr: string) => {
  const upper = (statusStr || '').toUpperCase();
  if (upper.includes('HOT')) {
    return {
      icon: Icons.Flame,
      color: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-50 dark:bg-rose-950/40',
      border: 'border-rose-200 dark:border-rose-800'
    };
  }
  if (upper.includes('WARM')) {
    return {
      icon: Icons.Sun,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      border: 'border-amber-200 dark:border-amber-800'
    };
  }
  if (upper.includes('COOL')) {
    return {
      icon: Icons.Snowflake,
      color: 'text-cyan-600 dark:text-cyan-400',
      bg: 'bg-cyan-50 dark:bg-cyan-950/40',
      border: 'border-cyan-200 dark:border-cyan-800'
    };
  }
  if (upper.includes('FOLLOW')) {
    return {
      icon: Icons.PhoneCall,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-50 dark:bg-blue-950/40',
      border: 'border-blue-200 dark:border-blue-800'
    };
  }
  if (upper.includes('DISBUS') || upper.includes('APPROV')) {
    return {
      icon: Icons.CheckCircle,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      border: 'border-emerald-200 dark:border-emerald-800'
    };
  }
  return {
    icon: Icons.RotateCcw,
    color: 'text-teal-600 dark:text-teal-400',
    bg: 'bg-teal-50 dark:bg-teal-950/40',
    border: 'border-teal-200 dark:border-teal-800'
  };
};

export default function MyCampaign() {
  const navigate = useNavigate();
  const { showToast } = useToastStore();
  const { user } = useAuthStore();
  // React Query for campaigns with 60s cache and instantaneous cache hydration
  const {
    data: rawCampaignsData,
    isLoading: loading,
    error: queryError,
    refetch: refetchCampaigns
  } = useQuery({
    queryKey: ['my-campaigns-list'],
    queryFn: async () => {
      const res = await api.get('/records/campaigns/my-campaigns');
      const data = res.data?.campaigns || res.data;
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60000,
    gcTime: 15 * 60 * 1000,
    placeholderData: keepPreviousData
  });

  const campaigns: CampaignStats[] = useMemo(() => {
    if (Array.isArray(rawCampaignsData)) return rawCampaignsData;
    if (rawCampaignsData && Array.isArray((rawCampaignsData as any).campaigns)) return (rawCampaignsData as any).campaigns;
    return [];
  }, [rawCampaignsData]);

  const campaignError = queryError ? (queryError as any).message || 'Failed to load campaigns.' : null;

  // React Query for status options
  const { data: statuses = [] } = useQuery<string[]>({
    queryKey: ['master-statuses-list'],
    queryFn: async () => {
      const res = await api.get('/statuses').catch(() => ({ data: [] }));
      return Array.isArray(res.data) ? res.data.map((s: any) => s.name) : [];
    },
    staleTime: 10 * 60 * 1000,
    placeholderData: keepPreviousData
  });

  // Dynamic campaign status configuration (Custom statuses + Create Lead triggers + Dashboard visibility)
  const {
    data: campaignStatusConfig,
    refetch: refetchCampaignStatuses
  } = useQuery({
    queryKey: ['campaign-status-config'],
    queryFn: async () => {
      const res = await api.get('/records/campaigns/statuses').catch(() => ({
        data: {
          statuses: CAMPAIGN_STATUSES,
          triggerStatuses: ['HOT LEADS', 'WARM LEADS'],
          dashboardStatuses: ['HOT LEADS', 'WARM LEADS', 'COOL LEAD', 'FOLLOWUP']
        }
      }));
      return res.data || { 
        statuses: CAMPAIGN_STATUSES, 
        triggerStatuses: ['HOT LEADS', 'WARM LEADS'],
        dashboardStatuses: ['HOT LEADS', 'WARM LEADS', 'COOL LEAD', 'FOLLOWUP']
      };
    },
    staleTime: 60000,
    placeholderData: keepPreviousData
  });

  const configuredStatuses: string[] = useMemo(() => {
    if (Array.isArray(campaignStatusConfig?.statuses) && campaignStatusConfig.statuses.length > 0) {
      return campaignStatusConfig.statuses;
    }
    return CAMPAIGN_STATUSES;
  }, [campaignStatusConfig]);

  const triggerStatuses: string[] = useMemo(() => {
    if (Array.isArray(campaignStatusConfig?.triggerStatuses) && campaignStatusConfig.triggerStatuses.length > 0) {
      return campaignStatusConfig.triggerStatuses.map((s: string) => s.trim().toUpperCase());
    }
    return ['HOT LEADS', 'WARM LEADS', 'COOL LEAD'];
  }, [campaignStatusConfig]);

  const dashboardStatuses: string[] = useMemo(() => {
    if (Array.isArray(campaignStatusConfig?.dashboardStatuses) && campaignStatusConfig.dashboardStatuses.length > 0) {
      return campaignStatusConfig.dashboardStatuses.map((s: string) => s.trim().toUpperCase());
    }
    return ['HOT LEADS', 'WARM LEADS', 'COOL LEAD', 'FOLLOWUP'];
  }, [campaignStatusConfig]);

  // Merge built-in campaign statuses with custom statuses with strict deduplication (single Hot Leads, single Warm Leads)
  const availableStatuses = useMemo(() => {
    const list: string[] = [];
    const seen = new Set<string>();

    const normalizeKey = (name: string) => {
      let s = name.trim().toUpperCase();
      if (s === 'HOT LEAD' || s === 'HOT LEADS') return 'HOT LEADS';
      if (s === 'WARM LEAD' || s === 'WARM LEADS') return 'WARM LEADS';
      if (s === 'COOL LEAD' || s === 'COOL LEADS') return 'COOL LEAD';
      if (s === 'NOT INTESTED' || s === 'NOT INTERESTED') return 'NOT INTERESTED';
      return s;
    };

    const addStatus = (raw: string) => {
      if (!raw) return;
      const key = normalizeKey(raw);
      if (EXCLUDED_CAMPAIGN_STATUSES.has(key)) return;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(key);
      }
    };

    configuredStatuses.forEach(addStatus);
    statuses.forEach(addStatus);

    return list;
  }, [configuredStatuses, statuses]);

  // Campaign Status Settings Modal State (Super Admin / Admin dynamic management)
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [modalStatuses, setModalStatuses] = useState<string[]>([]);
  const [modalTriggerStatuses, setModalTriggerStatuses] = useState<string[]>([]);
  const [modalDashboardStatuses, setModalDashboardStatuses] = useState<string[]>([]);
  const [newStatusInput, setNewStatusInput] = useState('');
  const [newStatusDashboard, setNewStatusDashboard] = useState(true);
  const [newStatusTrigger, setNewStatusTrigger] = useState(false);
  const [searchStatusModal, setSearchStatusModal] = useState('');
  const [savingStatusConfig, setSavingStatusConfig] = useState(false);

  useEffect(() => {
    if (showStatusModal) {
      setModalStatuses([...configuredStatuses]);
      setModalTriggerStatuses([...triggerStatuses]);
      setModalDashboardStatuses([...dashboardStatuses]);
      setNewStatusInput('');
      setNewStatusDashboard(true);
      setNewStatusTrigger(false);
      setSearchStatusModal('');
    }
  }, [showStatusModal, configuredStatuses, triggerStatuses, dashboardStatuses]);

  const handleToggleTriggerStatus = (statusName: string) => {
    const norm = statusName.trim().toUpperCase();
    setModalTriggerStatuses(prev => {
      const exists = prev.some(s => s.trim().toUpperCase() === norm);
      if (exists) {
        return prev.filter(s => s.trim().toUpperCase() !== norm);
      } else {
        return [...prev, norm];
      }
    });
  };

  const handleToggleDashboardStatus = (statusName: string) => {
    const norm = statusName.trim().toUpperCase();
    setModalDashboardStatuses(prev => {
      const exists = prev.some(s => s.trim().toUpperCase() === norm);
      if (exists) {
        return prev.filter(s => s.trim().toUpperCase() !== norm);
      } else {
        return [...prev, norm];
      }
    });
  };

  const handleAddNewStatus = () => {
    const trimmed = newStatusInput.trim();
    if (!trimmed) {
      showToast('Please enter a status name.', 'warning');
      return;
    }
    const norm = trimmed.toUpperCase();
    const alreadyExists = modalStatuses.some(s => s.trim().toUpperCase() === norm);
    if (alreadyExists) {
      showToast('This status already exists in the list.', 'warning');
      return;
    }
    setModalStatuses(prev => [...prev, trimmed]);
    if (newStatusDashboard) {
      setModalDashboardStatuses(prev => [...prev, norm]);
    }
    if (newStatusTrigger) {
      setModalTriggerStatuses(prev => [...prev, norm]);
    }
    setNewStatusInput('');
    setNewStatusDashboard(true);
    setNewStatusTrigger(false);
    showToast(`Added status "${trimmed}"`, 'success');
  };

  const handleDeleteStatus = (statusName: string) => {
    const norm = statusName.trim().toUpperCase();
    setModalStatuses(prev => prev.filter(s => s.trim().toUpperCase() !== norm));
    setModalTriggerStatuses(prev => prev.filter(s => s.trim().toUpperCase() !== norm));
    setModalDashboardStatuses(prev => prev.filter(s => s.trim().toUpperCase() !== norm));
  };

  const handleSaveStatusSettings = async () => {
    try {
      setSavingStatusConfig(true);
      await api.put('/records/campaigns/statuses', {
        statuses: modalStatuses,
        triggerStatuses: modalTriggerStatuses,
        dashboardStatuses: modalDashboardStatuses
      });
      await refetchCampaignStatuses();
      
      // Invalidate queries so Dashboard and Settings update instantly
      queryClient.invalidateQueries({ queryKey: ['campaign-status-config'] });
      queryClient.invalidateQueries({ queryKey: ['statuses-list'] });
      queryClient.invalidateQueries({ queryKey: ['master-statuses-list'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-configured-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['layout-configured-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });

      showToast('Campaign statuses, Dashboard links, and lead triggers saved successfully!', 'success');
      setShowStatusModal(false);
    } catch (err: any) {
      console.error('Failed to save campaign statuses', err);
      showToast(err.response?.data?.error || 'Failed to save campaign statuses', 'error');
    } finally {
      setSavingStatusConfig(false);
    }
  };

  const handleResetStatusDefaults = () => {
    setModalStatuses([...CAMPAIGN_STATUSES]);
    setModalTriggerStatuses(['HOT LEADS', 'WARM LEADS']);
    setModalDashboardStatuses(['HOT LEADS', 'WARM LEADS', 'COOL LEAD', 'FOLLOWUP']);
    showToast('Reset to default campaign statuses.', 'info');
  };

  const [activeCampaign, setActiveCampaign] = useState<CampaignStats | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [filterTab, setFilterTab] = useState<'yetToDial' | 'dialed' | 'all'>('yetToDial');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Track inputs for each lead ID
  const [leadStates, setLeadStates] = useState<Record<string, LeadState>>({});
  const [editingLeadIds, setEditingLeadIds] = useState<Record<string, boolean>>({});
  const toggleLeadEdit = (id: string) => {
    setEditingLeadIds(prev => ({ ...prev, [id]: !prev[id] }));
  };

  // Pagination states - defaults to 10 for instant loading & snappy telecalling
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(10);
  const [serverTotalLeads, setServerTotalLeads] = useState<number>(0);
  const [serverTotalPages, setServerTotalPages] = useState<number>(1);
  const [campaignStats, setCampaignStats] = useState<{ totalAllocated: number; dialed: number; yetToDial: number }>({
    totalAllocated: 0,
    dialed: 0,
    yetToDial: 0
  });

  // Campaign list pagination (10 campaigns per page)
  const [campaignPage, setCampaignPage] = useState<number>(1);
  const CAMPAIGNS_PER_PAGE = 10;

  // In-memory cache for instant page flipping & background prefetching
  const pageCacheRef = React.useRef<Record<string, {
    leads: LeadRecord[];
    total: number;
    totalPages: number;
    stats: { totalAllocated: number; dialed: number; yetToDial: number };
  }>>({});

  // Modal & Navigation States for Lead Save Confirmation
  const [saveSuccessModal, setSaveSuccessModal] = useState<SaveSuccessModalData | null>(null);
  const [highlightedLeadId, setHighlightedLeadId] = useState<string | null>(null);

  // File upload and Audit History states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingRecordId, setUploadingRecordId] = useState<string | null>(null);
  const [activeHistoryRecord, setActiveHistoryRecord] = useState<any | null>(null);
  const [historyActivities, setHistoryActivities] = useState<any[]>([]);
  const [historyDocuments, setHistoryDocuments] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Users dropdown query for resolving agent and manager names
  const { data: usersDropdown } = useQuery({
    queryKey: ['campaign-users-dropdown'],
    queryFn: async () => {
      const res = await api.get('/auth/users?purpose=dropdown').catch(() => ({ data: [] }));
      return res.data || [];
    },
    staleTime: 5 * 60 * 1000,
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
    return str;
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
    try {
      await api.post(`/records/leads/${uploadingRecordId}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      showToast('File uploaded successfully', 'success');
    } catch (err: any) {
      console.error('Upload error:', err);
      showToast(err.response?.data?.message || 'Failed to upload document', 'error');
    } finally {
      setUploadingRecordId(null);
    }
  };

  const openHistory = async (rec: any) => {
    setActiveHistoryRecord(rec);
    setLoadingHistory(true);
    try {
      const [activitiesRes, docsRes] = await Promise.all([
        api.get(`/records/leads/${rec._id}/activities`).catch(() => ({ data: [] })),
        api.get(`/records/leads/${rec._id}/documents`).catch(() => ({ data: [] }))
      ]);
      setHistoryActivities(activitiesRes.data || []);
      setHistoryDocuments(docsRes.data || []);
    } catch (err) {
      console.error('Failed to load history:', err);
      setHistoryActivities([]);
      setHistoryDocuments([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  // Phone masking
  const [revealedPhones, setRevealedPhones] = useState<Record<string, boolean>>({});
  const togglePhoneReveal = (id: string) => {
    setRevealedPhones(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const extractLeadPhone = (obj: any): string => {
    if (!obj || typeof obj !== 'object') return '';
    const direct = obj.phone || obj.mobile || obj.contactNumber || obj.mobileNo || obj.name_contact_num || obj.contact_num || obj.contactNum || obj.contact || obj.phoneNumber || obj.phone_number || obj.mobile_no || obj.contact_number;
    if (direct && String(direct).trim() !== '' && !['N/A', 'UNDEFINED', 'NULL'].includes(String(direct).trim().toUpperCase())) {
      return String(direct).trim().replace(/\.0+$/, '');
    }
    for (const key of Object.keys(obj)) {
      const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanKey.includes('psm') || cleanKey.includes('datacode') || cleanKey.includes('leadno') || cleanKey.includes('slno')) continue;
      if (
        cleanKey.includes('phone') ||
        cleanKey.includes('mobile') ||
        cleanKey.includes('contact') ||
        cleanKey.includes('cell') ||
        cleanKey.includes('mob') ||
        cleanKey.includes('tel') ||
        cleanKey.includes('calling') ||
        cleanKey.includes('dial') ||
        cleanKey === 'number' ||
        cleanKey === 'no'
      ) {
        const val = obj[key];
        if (val !== undefined && val !== null && String(val).trim() !== '' && !['N/A', 'UNDEFINED', 'NULL'].includes(String(val).trim().toUpperCase())) {
          return String(val).trim().replace(/\.0+$/, '');
        }
      }
    }
    // Fallback: search for any key containing a genuine 10-12 digit phone number
    for (const key of Object.keys(obj)) {
      const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (cleanKey.includes('sl') || cleanKey.includes('id') || cleanKey.includes('amount') || cleanKey.includes('budget') || cleanKey.includes('code')) continue;
      const val = obj[key];
      if (val !== undefined && val !== null) {
        const numStr = String(val).trim().replace(/[^0-9]/g, '');
        if (numStr.length === 10 || (numStr.length === 12 && numStr.startsWith('91'))) {
          return String(val).trim().replace(/\.0+$/, '');
        }
      }
    }
    return '';
  };

  const maskPhoneNumber = (phone?: string, isRevealed: boolean = false) => {
    if (!phone || phone === 'N/A' || phone === 'XXXXXXXXXX') return 'N/A';
    const clean = String(phone).trim();
    if (isRevealed) return clean;
    if (clean.length <= 4) return '******';
    if (clean.length === 10) {
      return `${clean.slice(0, 5)}*****`;
    }
    const prefixLen = Math.min(4, Math.floor(clean.length / 2));
    return `${clean.slice(0, prefixLen)}${'*'.repeat(Math.max(4, clean.length - prefixLen))}`;
  };

  // Fetch lead details for active campaign with instant pagination & background prefetching
  const fetchLeadDetails = async (
    campaignName: string,
    targetPage: number = 1,
    targetLimit: number = pageSize,
    targetTab: 'yetToDial' | 'dialed' | 'all' = filterTab,
    targetSearch: string = searchQuery,
    isSilent: boolean = false
  ) => {
    const cacheKey = `${campaignName}:${targetTab}:${targetSearch.trim()}:${targetLimit}:${targetPage}`;
    if (pageCacheRef.current[cacheKey]) {
      const cached = pageCacheRef.current[cacheKey];
      setLeads(cached.leads);
      setServerTotalLeads(cached.total);
      setServerTotalPages(cached.totalPages);
      setCampaignStats(cached.stats);
      setCurrentPage(targetPage);
      if (!isSilent) setLoadingLeads(false);
      return;
    }

    if (!isSilent) setLoadingLeads(true);

    try {
      const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}`, {
        params: {
          page: targetPage,
          limit: targetLimit,
          tab: targetTab,
          search: targetSearch.trim() || undefined
        }
      });

      const fetchedLeads = res.data.leads || [];
      const total = typeof res.data.total === 'number' ? res.data.total : fetchedLeads.length;
      const totalPages = typeof res.data.totalPages === 'number' ? res.data.totalPages : Math.max(1, Math.ceil(total / targetLimit));
      const stats = {
        totalAllocated: res.data.totalAllocated ?? activeCampaign?.totalAssigned ?? total,
        dialed: res.data.dialed ?? activeCampaign?.dialed ?? 0,
        yetToDial: res.data.yetToDial ?? activeCampaign?.yetToDial ?? Math.max(0, total - (res.data.dialed || 0))
      };

      setLeads(fetchedLeads);
      setServerTotalLeads(total);
      setServerTotalPages(totalPages);
      setCampaignStats(stats);
      setCurrentPage(targetPage);

      // Save to fast in-memory cache
      pageCacheRef.current[cacheKey] = {
        leads: fetchedLeads,
        total,
        totalPages,
        stats
      };

      // Trigger background prefetching for the next page so clicking 'Next' is instant
      if (targetPage < totalPages) {
        const nextKey = `${campaignName}:${targetTab}:${targetSearch.trim()}:${targetLimit}:${targetPage + 1}`;
        if (!pageCacheRef.current[nextKey]) {
          setTimeout(async () => {
            try {
              const bgRes = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}`, {
                params: {
                  page: targetPage + 1,
                  limit: targetLimit,
                  tab: targetTab,
                  search: targetSearch.trim() || undefined
                }
              });
              if (bgRes.data?.leads) {
                pageCacheRef.current[nextKey] = {
                  leads: bgRes.data.leads,
                  total: bgRes.data.total ?? bgRes.data.leads.length,
                  totalPages: bgRes.data.totalPages ?? totalPages,
                  stats
                };
              }
            } catch (e) {
              // Ignore background prefetch errors
            }
          }, 300);
        }
      }
    } catch (err: any) {
      console.error(err);
      showToast('Failed to load campaign leads.', 'error');
    } finally {
      if (!isSilent) setLoadingLeads(false);
    }
  };

  const handleViewDetails = (campaign: CampaignStats) => {
    setActiveCampaign(campaign);
    setCampaignStats({
      totalAllocated: campaign.totalAssigned,
      dialed: campaign.dialed,
      yetToDial: campaign.yetToDial
    });
    setServerTotalLeads(campaign.yetToDial);
    setServerTotalPages(Math.max(1, Math.ceil(campaign.yetToDial / 10)));
    setCurrentPage(1);
    setPageSize(10);
    setFilterTab('yetToDial');
    setSearchQuery('');
    setLeadStates({});
    fetchLeadDetails(campaign.campaignName, 1, 10, 'yetToDial', '');
  };

  const handleBack = () => {
    setActiveCampaign(null);
    setLeads([]);
    setLeadStates({});
    setCurrentPage(1);
    pageCacheRef.current = {};
    refetchCampaigns();
  };

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > serverTotalPages || newPage === currentPage) return;
    setCurrentPage(newPage);
    if (activeCampaign) {
      fetchLeadDetails(activeCampaign.campaignName, newPage, pageSize, filterTab, searchQuery);
    }
  };

  const handlePageSizeChange = (newSize: number) => {
    setPageSize(newSize);
    setCurrentPage(1);
    if (activeCampaign) {
      fetchLeadDetails(activeCampaign.campaignName, 1, newSize, filterTab, searchQuery);
    }
  };

  const handleTabChange = (newTab: 'yetToDial' | 'dialed' | 'all') => {
    if (filterTab === newTab) return;
    setFilterTab(newTab);
    setCurrentPage(1);
    if (activeCampaign) {
      fetchLeadDetails(activeCampaign.campaignName, 1, pageSize, newTab, searchQuery);
    }
  };

  const handleSearchChange = (query: string) => {
    setSearchQuery(query);
    setCurrentPage(1);
    if (activeCampaign) {
      fetchLeadDetails(activeCampaign.campaignName, 1, pageSize, filterTab, query);
    }
  };

  const handleDownloadCampaign = async (campaignName: string) => {
    try {
      showToast(`Exporting report for "${campaignName}"...`, 'info');
      const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}?all=true`);
      const targetLeads: LeadRecord[] = res.data.leads || [];

      if (!targetLeads || targetLeads.length === 0) {
        showToast('No leads available to export.', 'warning');
        return;
      }

      exportLeadReportXLSX(targetLeads, campaignName);
      showToast(`Exported all ${targetLeads.length.toLocaleString()} leads successfully!`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to export campaign report.', 'error');
    }
  };

  const handleFieldChange = (leadId: string, field: keyof LeadState, value: string) => {
    setLeadStates(prev => ({
      ...prev,
      [leadId]: {
        ...prev[leadId],
        [field]: value
      }
    }));
  };

  const handleStatusSelect = (lead: LeadRecord, newStatus: string) => {
    // 1. Update state locally so user sees the selected status immediately in dropdown & badge
    handleFieldChange(lead._id, 'status', newStatus);
    showToast(`Status changed to "${newStatus}". Complete fields and click Save.`, 'info');
  };

  const handleWhatsAppChat = (lead: LeadRecord) => {
    const rawPhone = leadStates[lead._id]?.mobile || extractLeadPhone(lead.data) || extractLeadPhone(lead) || '';
    let cleanPhone = String(rawPhone).replace(/\D/g, '').trim();
    if (!cleanPhone) {
      showToast('No phone number available for this lead.', 'warning');
      return;
    }
    if (cleanPhone.length === 10) {
      cleanPhone = `91${cleanPhone}`;
    }
    window.open(`https://wa.me/${cleanPhone}`, '_blank');
  };

  const handleInitiateCall = (lead: LeadRecord) => {
    const rawPhone = leadStates[lead._id]?.mobile || extractLeadPhone(lead.data) || extractLeadPhone(lead) || '';
    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '').trim();
    if (!cleanPhone) {
      showToast('No phone number available for this lead.', 'warning');
      return;
    }
    const leadName = `${lead.data?.firstName || ''} ${lead.data?.lastName || ''}`.trim() || lead.data?.fullName || lead.data?.customerName || lead.data?.name || 'Lead';
    showToast(`Calling ${leadName} (${cleanPhone})...`, 'info');

    // DO NOT save to backend here or mark as dialed!
    // The user has just dialed and hasn't spoken, updated status, or saved yet.
    // Record the dial attempt in local state only so it persists when they click Save.
    setLeadStates(prev => ({
      ...prev,
      [lead._id]: {
        ...prev[lead._id],
        wasDialed: true,
        callAttempts: ((lead.data?.callAttempts as number) || 0) + 1
      }
    }));

    // Trigger phone dialer cleanly using a temporary anchor element so the current page does not reload or navigate away
    const telAnchor = document.createElement('a');
    telAnchor.href = `tel:${cleanPhone}`;
    telAnchor.rel = 'noopener noreferrer';
    document.body.appendChild(telAnchor);
    telAnchor.click();
    document.body.removeChild(telAnchor);
  };

  const isLeadDialed = (lead: LeadRecord) => {
    const savedStatus = (lead.data?.status || lead.data?.dialStatus || '').toString().trim().toLowerCase();
    const isDialedStatus = savedStatus && !['yet to call', 'not called', 'new', 'yet to dial'].includes(savedStatus);
    return Boolean(isDialedStatus);
  };

  const totalAllocatedCount = campaignStats.totalAllocated || (activeCampaign?.totalAssigned || 0);
  const dialedCount = campaignStats.dialed || (activeCampaign?.dialed || 0);
  const yetToDialCount = campaignStats.yetToDial || Math.max(0, totalAllocatedCount - dialedCount);

  // Since backend filters and paginates, filteredLeads and paginatedLeads are the current page's leads
  const filteredLeads = leads;
  const paginatedLeads = leads;
  const totalPages = serverTotalPages || Math.max(1, Math.ceil(serverTotalLeads / pageSize));
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;

  const handleGoToNextLead = (targetNextId?: string) => {
    const nextId = targetNextId || saveSuccessModal?.nextLeadId;
    setSaveSuccessModal(null);

    if (!nextId) {
      if (currentPage < totalPages && activeCampaign) {
        showToast('Advancing to next page...', 'info');
        handlePageChange(currentPage + 1);
        return;
      }
      showToast('You have reached the last lead in this list!', 'info');
      return;
    }

    // Set highlight ring
    setHighlightedLeadId(nextId);

    // Smooth scroll to next lead card or table row
    setTimeout(() => {
      const el = document.getElementById(`lead-card-${nextId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);

    // Auto clear highlight after 2.5s
    setTimeout(() => {
      setHighlightedLeadId(prev => (prev === nextId ? null : prev));
    }, 2500);
  };

  // Keyboard shortcut support for save confirmation popup
  useEffect(() => {
    if (!saveSuccessModal?.isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSaveSuccessModal(null);
      } else if (e.key === 'Enter') {
        if (saveSuccessModal.hasNext) {
          handleGoToNextLead();
        } else {
          setSaveSuccessModal(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveSuccessModal, filteredLeads, pageSize, currentPage, totalPages]);

  const handleSaveLead = async (leadId: string) => {
    try {
      const lead = leads.find(l => l._id === leadId);
      if (!lead) return;

      const state = leadStates[leadId];
      const rawStatus = state?.status || lead.data?.status || lead.data?.dialStatus || 'Yet To Call';
      const cleanRawStatus = (rawStatus && rawStatus.toString().trim().toUpperCase() !== 'NEW') ? rawStatus : 'Yet To Call';
      const matchedStatus = statuses.find(s => s.trim().toUpperCase() === cleanRawStatus.trim().toUpperCase());
      const finalStatusToSave = matchedStatus || cleanRawStatus;

      const currentRemarks = state?.remarks ?? (lead.data?.notes || lead.data?.remarks || '');
      const currentCaseDetails = state?.caseDetails ?? (lead.data?.caseDetails || '');
      const currentLeadCategory = state?.leadCategory ?? (lead.data?.leadCategory || lead.data?.lead_category || '');
      const currentDataCode = state?.dataCode ?? (lead.data?.dataCode || lead.data?.data_code || lead.data?.code || '');

      const currentIndex = leads.findIndex(l => l._id === leadId);
      const slNo = startIndex + (currentIndex >= 0 ? currentIndex + 1 : 1);
      const nextLead = currentIndex >= 0 && currentIndex + 1 < leads.length ? leads[currentIndex + 1] : null;
      const nextLeadId = nextLead?._id;
      const nextSlNo = nextLead ? slNo + 1 : (currentPage < totalPages ? slNo + 1 : undefined);
      const hasNext = Boolean(nextLead) || currentPage < totalPages;

      const dataCode = currentDataCode || lead.data?.dataCode || lead.data?.data_code || lead.data?.code || '';
      const loggedInSaverName = user 
        ? ([user.firstName, user.lastName].filter(Boolean).join(' ') || (user as any).name || (user as any).fullName || user.email?.split('@')[0])
        : 'Super Admin';

      const payload: Record<string, any> = {
        status: finalStatusToSave,
        dialStatus: finalStatusToSave,
        dialedAt: new Date(),
        dialedBy: loggedInSaverName,
        callerName: loggedInSaverName,
        source: loggedInSaverName,
        callAttempts: Math.max(1, (state?.callAttempts as number) || ((lead.data?.callAttempts as number) || 0) + 1),
        notes: currentRemarks,
        remarks: currentRemarks,
        caseDetails: currentCaseDetails,
        leadCategory: currentLeadCategory,
        lead_category: currentLeadCategory,
        dataCode: currentDataCode,
        data_code: currentDataCode
      };

      if (state?.leadName !== undefined && state.leadName.trim() !== '') {
        const parts = state.leadName.trim().split(' ');
        payload.customerName = state.leadName.trim();
        payload.firstName = parts[0] || state.leadName.trim();
        payload.lastName = parts.slice(1).join(' ') || '';
        payload.customer = state.leadName.trim();
        payload.name = state.leadName.trim();
      }
      if (state?.product !== undefined) {
        payload.loanType = state.product;
        payload.product = state.product;
      }
      if (state?.location !== undefined) {
        payload.city = state.location;
        payload.location = state.location;
      }
      if (state?.mobile !== undefined && state.mobile.trim() !== '') {
        payload.phone = state.mobile.trim();
        payload.mobile = state.mobile.trim();
        payload.contactNumber = state.mobile.trim();
      }
      if (state?.amount !== undefined) {
        payload.loanAmount = state.amount;
        payload.amount = state.amount;
      }
      if (state?.bankPartner !== undefined) {
        payload.businessPartner = state.bankPartner;
        payload.bankPartner = state.bankPartner;
        payload.bank = state.bankPartner;
      }
      if (state?.followupDate !== undefined) {
        payload.followUpDate = state.followupDate;
      }
      if (state?.firmName !== undefined) {
        payload.company = state.firmName;
        payload.firmName = state.firmName;
      }
      if (state?.psm !== undefined) {
        payload.psm = state.psm;
      }

      await api.put(`/records/leads/${leadId}`, payload);

      // Invalidate queries so Dashboard, leads, and Reports counts sync immediately
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-configured-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['layout-configured-statuses'] });
      queryClient.invalidateQueries({ queryKey: ['campaign-matrix-report'] });

      const isNowDialed = finalStatusToSave && !['yet to call', 'not called', 'new', 'yet to dial'].includes(finalStatusToSave.trim().toLowerCase());

      // If dialing in 'yetToDial' tab, immediately remove dialed lead from the list so it moves to dialed tab
      if (filterTab === 'yetToDial' && isNowDialed) {
        setLeads(prev => prev.filter(l => l._id !== leadId));
        setServerTotalLeads(prev => Math.max(0, prev - 1));
      } else {
        // Update lead in memory so counts & UI update immediately
        setLeads(prev => prev.map(l => l._id === leadId ? { ...l, data: { ...l.data, ...payload } } : l));
      }

      // Update in-memory counts if lead was marked dialed
      if (isNowDialed && !isLeadDialed(lead)) {
        setCampaignStats(prev => ({
          ...prev,
          dialed: prev.dialed + 1,
          yetToDial: Math.max(0, prev.yetToDial - 1)
        }));
      }

      // Open proper popup matching user's exact design
      setSaveSuccessModal({
        isOpen: true,
        leadId,
        slNo,
        dataCode,
        nextLeadId,
        nextSlNo,
        hasNext
      });

      // Clear cache so future tab visits reflect saved status
      pageCacheRef.current = {};

      // Refresh campaigns listing in background
      refetchCampaigns().then(res => {
        const rawData = res.data;
        const updatedCampaigns: CampaignStats[] = Array.isArray(rawData) ? rawData : (Array.isArray((rawData as any)?.campaigns) ? (rawData as any).campaigns : []);
        if (activeCampaign) {
          const found = updatedCampaigns.find(c => c && c.campaignName === activeCampaign.campaignName);
          if (found) setActiveCampaign(found);
        }
      }).catch(err => console.error(err));
    } catch (err: any) {
      console.error(err);
      showToast('Failed to save lead updates.', 'error');
    }
  };

  if (loading && campaigns.length === 0) {
    return (
      <div className="space-y-6 max-w-[1400px] mx-auto text-left p-4 sm:p-6 animate-pulse">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="space-y-2">
            <div className="h-4 w-32 bg-slate-200 dark:bg-slate-800 rounded"></div>
            <div className="h-7 w-48 bg-slate-300 dark:bg-slate-700 rounded-lg"></div>
          </div>
          <div className="h-10 w-36 bg-slate-200 dark:bg-slate-800 rounded-lg"></div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-2xl p-6 space-y-4 shadow-xs">
              <div className="flex items-center justify-between">
                <div className="h-6 w-36 bg-slate-200 dark:bg-slate-800 rounded"></div>
                <div className="h-6 w-16 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="h-16 bg-slate-100 dark:bg-slate-800/60 rounded-xl"></div>
                <div className="h-16 bg-slate-100 dark:bg-slate-800/60 rounded-xl"></div>
              </div>
              <div className="h-10 bg-slate-200 dark:bg-slate-800 rounded-xl mt-4"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (campaignError && campaigns.length === 0) {
    return (
      <div className="max-w-[1400px] mx-auto text-left p-6">
        <div className="py-12 text-center bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/50 rounded-xl p-6 max-w-md mx-auto space-y-3">
          <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-950/50 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <Icons.AlertCircle className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-slate-800 dark:text-white">Failed to load campaigns</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{campaignError}</p>
          <button
            onClick={() => refetchCampaigns()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Icons.RefreshCw className="w-3 h-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 max-w-[1400px] mx-auto text-left px-1 py-0.5 sm:px-2">
      
      {!activeCampaign ? (
        // CAMPAIGNS CARDS VIEW
        (() => {
          const safeCampaigns = (Array.isArray(campaigns) ? campaigns : []).filter(c => (c.totalAssigned || 0) > 0);
          const filteredCampaigns = safeCampaigns.filter(c => 
            c && c.campaignName && typeof c.campaignName === 'string'
              ? c.campaignName.toLowerCase().includes(searchQuery.trim().toLowerCase())
              : false
          );
          const totalCampaignPages = Math.ceil(filteredCampaigns.length / CAMPAIGNS_PER_PAGE) || 1;
          const safeCampaignPage = Math.min(Math.max(1, campaignPage), totalCampaignPages);
          const paginatedCampaigns = filteredCampaigns.slice((safeCampaignPage - 1) * CAMPAIGNS_PER_PAGE, safeCampaignPage * CAMPAIGNS_PER_PAGE);

          return (
            <div className="space-y-2.5">
              {/* Streamlined Header Summary Bar with Defined Border */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-xl shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 flex-shrink-0 shadow-3xs">
                      <Icons.Megaphone className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm sm:text-base font-bold text-slate-800 dark:text-slate-100">
                          My Call Campaigns
                        </h2>
                        <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
                          ({safeCampaigns.length} {safeCampaigns.length === 1 ? 'Active' : 'Active'})
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Select a campaign to initiate telecalling, record call remarks, and update lead status.
                      </p>
                    </div>
                  </div>

                  {/* Compact Stats Indicators with Border */}
                  {safeCampaigns.length > 0 && (
                    <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-800 pt-2.5 sm:pt-0 sm:pl-5 flex-shrink-0">
                      <div className="text-left">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Campaigns</span>
                        <span className="text-base font-bold text-slate-800 dark:text-slate-100 font-mono leading-tight">{safeCampaigns.length}</span>
                      </div>
                      <div className="w-px h-7 bg-slate-200 dark:bg-slate-700" />
                      <div className="text-left">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Total Leads</span>
                        <span className="text-base font-bold text-emerald-700 dark:text-emerald-400 font-mono leading-tight">
                          {safeCampaigns.reduce((sum, c) => sum + (c?.totalAssigned || 0), 0)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Search & Filter Toolbar with Crisp Border */}
              {safeCampaigns.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-xl shadow-xs">
                  <div className="relative flex-1 max-w-sm">
                    <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search campaigns by name..."
                      className="w-full h-8.5 pl-9 pr-8 text-xs bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs p-0.5 rounded cursor-pointer"
                        title="Clear search"
                      >
                        <Icons.X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-[11.5px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <span>Showing</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{filteredCampaigns.length}</span>
                      <span>of</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{safeCampaigns.length}</span>
                      <span>campaigns</span>
                    </div>
                  </div>
                </div>
              )}

              {safeCampaigns.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-10 text-center text-slate-500 dark:text-slate-400 shadow-xs">
                  <div className="w-12 h-12 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center mx-auto mb-3 text-slate-400 shadow-3xs">
                    <Icons.Megaphone className="w-5 h-5" />
                  </div>
                  <p className="font-bold text-sm text-slate-800 dark:text-slate-200">No campaigns assigned to you yet.</p>
                  <p className="text-xs text-slate-400 mt-0.5">When leads are allocated to your account, they will appear here.</p>
                </div>
              ) : filteredCampaigns.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-slate-500 dark:text-slate-400 shadow-xs">
                  <Icons.Search className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                  <p className="font-bold text-sm text-slate-800 dark:text-slate-200">No campaigns matching &quot;{searchQuery}&quot;</p>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="mt-3 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:hover:bg-indigo-900/40 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                  >
                    Clear Search Filter
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {paginatedCampaigns.map((campaign) => {
                    const pct = campaign.totalAssigned > 0 
                      ? Math.round((campaign.dialed / campaign.totalAssigned) * 100)
                      : 0;

                    return (
                      <div 
                        key={campaign.campaignName}
                        className="group relative bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/90 dark:border-slate-800 p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:shadow-lg hover:border-indigo-300 dark:hover:border-indigo-800/80 transition-all duration-200 flex flex-col justify-between overflow-hidden"
                      >
                        {/* Top Accent bar */}
                        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-indigo-500 via-indigo-600 to-indigo-700" />

                        <div className="space-y-4">
                          {/* Header: Title & Total Badge */}
                          <div className="flex items-start justify-between gap-3 pt-1">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/80 dark:border-indigo-900/50 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                  <Icons.PhoneCall className="w-2.5 h-2.5" />
                                  Campaign
                                </span>
                                <span className="text-[11px] text-slate-400 dark:text-slate-500 font-medium">
                                  {new Date(campaign.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                              </div>
                              <h3 className="text-base font-bold text-slate-900 dark:text-white capitalize truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                {campaign.campaignName}
                              </h3>
                            </div>

                            <div className="text-right flex-shrink-0">
                              <div className="inline-flex flex-col items-end bg-slate-50 dark:bg-slate-800/80 border border-slate-200/80 dark:border-slate-700 px-2.5 py-1 rounded-xl">
                                <span className="text-sm font-black text-slate-800 dark:text-slate-100 leading-tight font-mono">{campaign.totalAssigned}</span>
                                <span className="text-[9px] font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider">Total Leads</span>
                              </div>
                            </div>
                          </div>

                          {/* Metric Cards - Sleek 2-col cards with micro icons and subtle colored indicators */}
                          <div className="grid grid-cols-2 gap-2.5">
                            <div className="bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 rounded-xl p-3 flex items-center justify-between">
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Dialed</span>
                                <span className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono leading-none mt-1 block">
                                  {campaign.dialed}
                                </span>
                              </div>
                              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/60 dark:border-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                                <Icons.PhoneCall className="w-3.5 h-3.5" />
                              </div>
                            </div>

                            <div className="bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 rounded-xl p-3 flex items-center justify-between">
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Yet to Dial</span>
                                <span className="text-lg font-bold text-amber-600 dark:text-amber-400 font-mono leading-none mt-1 block">
                                  {campaign.yetToDial}
                                </span>
                              </div>
                              <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200/60 dark:border-amber-900/40 flex items-center justify-center text-amber-600 dark:text-amber-400">
                                <Icons.Clock className="w-3.5 h-3.5" />
                              </div>
                            </div>
                          </div>

                          {/* Progress Bar in Sub-panel */}
                          <div className="bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/50 rounded-xl p-2.5 space-y-1.5">
                            <div className="flex justify-between items-center text-[11px]">
                              <span className="font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-[10px]">Calling Progress</span>
                              <span className="font-bold text-indigo-600 dark:text-indigo-400 font-mono">{pct}% completed</span>
                            </div>
                            <div className="w-full h-2 bg-slate-200/80 dark:bg-slate-700/80 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-300"
                                style={{ width: `${Math.max(pct, pct > 0 ? 5 : 0)}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Actions Bar */}
                        <div className="flex items-center gap-2 pt-4 border-t border-slate-100 dark:border-slate-800 mt-4">
                          <button 
                            onClick={() => handleViewDetails(campaign)}
                            className="flex-1 h-9 px-3.5 bg-slate-900 hover:bg-slate-800 active:bg-black text-white text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                          >
                            <Icons.Eye className="w-4 h-4" />
                            <span>View Details</span>
                          </button>
                          <button 
                            onClick={() => handleDownloadCampaign(campaign.campaignName)}
                            className="h-9 px-3.5 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-3xs"
                            title="Download Campaign Excel/CSV"
                          >
                            <Icons.Download className="w-3.5 h-3.5 text-slate-500" />
                            <span>Export</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Campaigns List Pagination (10 per page) */}
              {filteredCampaigns.length > CAMPAIGNS_PER_PAGE && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-5 py-3.5 rounded-xl shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3 mt-4">
                  <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                    Showing <span className="font-bold text-slate-800 dark:text-slate-200">{(safeCampaignPage - 1) * CAMPAIGNS_PER_PAGE + 1}</span> to{' '}
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {Math.min(safeCampaignPage * CAMPAIGNS_PER_PAGE, filteredCampaigns.length)}
                    </span>{' '}
                    of <span className="font-bold text-indigo-600 dark:text-indigo-400">{filteredCampaigns.length}</span> campaigns
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCampaignPage(prev => Math.max(1, prev - 1))}
                      disabled={safeCampaignPage === 1}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Icons.ChevronLeft className="w-4 h-4" />
                      <span>Prev</span>
                    </button>
                    <span className="px-3 text-xs font-bold text-slate-700 dark:text-slate-200">
                      Page <strong className="text-indigo-600 dark:text-indigo-400 font-black">{safeCampaignPage}</strong> of{' '}
                      <strong>{totalCampaignPages}</strong>
                    </span>
                    <button
                      onClick={() => setCampaignPage(prev => Math.min(totalCampaignPages, prev + 1))}
                      disabled={safeCampaignPage === totalCampaignPages}
                      className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <span>Next</span>
                      <Icons.ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })()
      ) : (
        // DETAILS VIEW
        <div className="space-y-2.5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-white dark:bg-[#111827] px-3.5 py-2 rounded-xl border border-slate-200/90 dark:border-slate-800 shadow-2xs">
            <div className="flex items-center gap-2.5">
              <button 
                onClick={handleBack} 
                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all cursor-pointer"
                title="Back to Campaigns"
              >
                <Icons.ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 dark:text-indigo-400 px-2 py-0.5 rounded-md uppercase tracking-wider">
                    Call Campaign
                  </span>
                  <span className="text-[11px] font-medium text-slate-400">
                    Created {new Date(activeCampaign.createdAt).toLocaleDateString('en-GB')}
                  </span>
                </div>
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white uppercase tracking-tight">
                  {activeCampaign.campaignName}
                </h2>
              </div>
            </div>

            {/* Campaign Controls & Progress */}
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
              {/* View Switcher */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setViewMode('table')}
                  className={`py-1 px-2.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Icons.Table className="w-3.5 h-3.5" />
                  Table
                </button>
                <button
                  onClick={() => setViewMode('cards')}
                  className={`py-1 px-2.5 rounded-md text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'cards'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Icons.LayoutGrid className="w-3.5 h-3.5" />
                  Cards
                </button>
              </div>

              <button
                onClick={() => handleDownloadCampaign(activeCampaign.campaignName)}
                className="h-7.5 px-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg shadow-3xs transition-all flex items-center gap-1.5 cursor-pointer uppercase tracking-wider active:scale-95"
              >
                <Icons.Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              {(() => {
                const pct = activeCampaign.totalAssigned > 0 
                  ? Math.round((activeCampaign.dialed / activeCampaign.totalAssigned) * 100)
                  : 0;
                return (
                  <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 py-1 rounded-lg min-w-[120px]">
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] font-bold mb-0.5">
                        <span className="text-slate-500 uppercase tracking-wider">Progress</span>
                        <span className="text-indigo-600 dark:text-indigo-400">{pct}%</span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ACTIVE CAMPAIGN COMPACT METRICS GRID */}
          <div className="space-y-2.5">
                {/* 3 TOP COMPACT METRIC CARDS */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  {/* 1. TOTAL YET TO DIAL */}
                  <div 
                    onClick={() => handleTabChange('yetToDial')}
                    className={`px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center justify-between border ${
                      filterTab === 'yetToDial'
                        ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-400 dark:border-amber-500 shadow-xs ring-1 ring-amber-400/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/60 border border-amber-200/60 dark:border-amber-900/50 flex items-center justify-center text-amber-500 flex-shrink-0">
                        <Icons.Clock className="w-4 h-4 stroke-[2.2]" />
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                          TOTAL YET TO DIAL
                        </span>
                        <span className="text-lg sm:text-xl font-black text-amber-500 leading-none">
                          {yetToDialCount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {filterTab === 'yetToDial' && (
                      <span className="bg-amber-500 text-white font-bold text-[9px] px-2 py-0.5 rounded-md uppercase tracking-wider shadow-3xs">
                        ACTIVE FILTER
                      </span>
                    )}
                  </div>

                  {/* 2. TOTAL DIALED */}
                  <div 
                    onClick={() => handleTabChange('dialed')}
                    className={`px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center justify-between border ${
                      filterTab === 'dialed'
                        ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-500 dark:border-emerald-500 shadow-xs ring-1 ring-emerald-500/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-700/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/60 dark:border-emerald-900/50 flex items-center justify-center text-emerald-500 flex-shrink-0">
                        <Icons.PhoneCall className="w-4 h-4 stroke-[2.2]" />
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                          TOTAL DIALED
                        </span>
                        <span className="text-lg sm:text-xl font-black text-emerald-600 dark:text-emerald-400 leading-none">
                          {dialedCount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {filterTab === 'dialed' && (
                      <span className="bg-emerald-600 text-white font-bold text-[9px] px-2 py-0.5 rounded-md uppercase tracking-wider shadow-3xs">
                        ACTIVE FILTER
                      </span>
                    )}
                  </div>

                  {/* 3. TOTAL ALLOCATED */}
                  <div 
                    onClick={() => handleTabChange('all')}
                    className={`px-3.5 py-2 rounded-xl transition-all cursor-pointer flex items-center justify-between border ${
                      filterTab === 'all'
                        ? 'bg-indigo-50/60 dark:bg-indigo-950/20 border-indigo-500 dark:border-indigo-500 shadow-xs ring-1 ring-indigo-500/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700/60'
                    }`}
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-900/50 flex items-center justify-center text-indigo-500 flex-shrink-0">
                        <Icons.Layers className="w-4 h-4 stroke-[2.2]" />
                      </div>
                      <div>
                        <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                          TOTAL ALLOCATED
                        </span>
                        <span className="text-lg sm:text-xl font-black text-slate-900 dark:text-white leading-none">
                          {totalAllocatedCount.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {filterTab === 'all' && (
                      <span className="bg-indigo-600 text-white font-bold text-[9px] px-2 py-0.5 rounded-md uppercase tracking-wider shadow-3xs">
                        ACTIVE FILTER
                      </span>
                    )}
                  </div>
                </div>

                {/* SEARCH & FILTER BAR - CLASSIC & SPACE SAVING */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 px-3 py-1.5 rounded-xl shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2">
                  {/* Search input */}
                  <div className="relative flex-1">
                    <Icons.Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleSearchChange(e.target.value)}
                      placeholder="Search leads by customer, firm, data code, mobile..."
                      className="w-full h-8 pl-8 pr-8 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => handleSearchChange('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                        title="Clear search"
                      >
                        <Icons.X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap flex-shrink-0">
                    <button
                      onClick={() => handleTabChange('yetToDial')}
                      className={`h-8 px-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        filterTab === 'yetToDial'
                          ? 'bg-amber-500 text-white shadow-3xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <Icons.Clock className="w-3.5 h-3.5" />
                      <span>Yet To Dial</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[11px] font-black ${
                        filterTab === 'yetToDial' ? 'bg-amber-600/60 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {yetToDialCount.toLocaleString()}
                      </span>
                    </button>

                    <button
                      onClick={() => handleTabChange('dialed')}
                      className={`h-8 px-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        filterTab === 'dialed'
                          ? 'bg-emerald-600 text-white shadow-3xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <Icons.PhoneCall className="w-3.5 h-3.5" />
                      <span>Dialed</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[11px] font-black ${
                        filterTab === 'dialed' ? 'bg-emerald-700/60 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {dialedCount.toLocaleString()}
                      </span>
                    </button>

                    <button
                      onClick={() => handleTabChange('all')}
                      className={`h-8 px-2.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        filterTab === 'all'
                          ? 'bg-indigo-600 text-white shadow-3xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <Icons.Layers className="w-3.5 h-3.5" />
                      <span>All Leads</span>
                      <span className={`px-1.5 py-0.2 rounded-full text-[11px] font-black ${
                        filterTab === 'all' ? 'bg-indigo-700/60 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {totalAllocatedCount.toLocaleString()}
                      </span>
                    </button>
                  </div>
                </div>

                {/* LEADS LIST / CARDS */}
                {loadingLeads ? (
                  <div className="flex items-center justify-center h-[40vh]">
                    <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
                  </div>
                ) : filteredLeads.length === 0 ? (
                  <div className="bg-white dark:bg-[#1a1f2c] rounded-2xl border border-slate-200 dark:border-slate-800 p-12 text-center text-slate-500 dark:text-slate-400">
                    <Icons.Search className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
                    <p className="font-bold text-sm text-slate-800 dark:text-slate-200">No leads found matching your criteria.</p>
                    <p className="text-xs text-slate-400 mt-0.5">Try switching filter tabs or clearing your search query.</p>
                  </div>
                ) : viewMode === 'table' ? (
                  /* TABLE VIEW */
                  <div className="bg-white dark:bg-[#111827] rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-sm overflow-hidden">
                    <div className="overflow-x-auto max-h-[75vh]">
                      <table className="w-full text-left text-xs border-collapse min-w-[1300px]">
                        <thead className="sticky top-0 z-10">
                          <tr className="bg-[#17223B] text-white font-extrabold uppercase text-[10px] tracking-wider border-b border-slate-800 shadow-xs">
                            <th className="py-3.5 px-3 text-center w-14 border-r border-slate-700/50">Sl No.</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">Data Code</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">Location</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">Customer</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">firm_name</th>
                            <th className="py-3.5 px-3 min-w-[150px] border-r border-slate-700/50">contact num</th>
                            <th className="py-3.5 px-3 min-w-[160px] border-r border-slate-700/50">Case Details</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">lead_category</th>
                            <th className="py-3.5 px-3 min-w-[160px] border-r border-slate-700/50">Remarks</th>
                            <th className="py-3.5 px-3 border-r border-slate-700/50">Agent Assigned To</th>
                            <th className="py-3.5 px-3 min-w-[150px] border-r border-slate-700/50">Dial Status</th>
                            <th className="py-3.5 px-3 min-w-[130px] border-r border-slate-700/50">Dailed Datetime</th>
                            <th className="py-3.5 px-3 text-center min-w-[100px]">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium text-slate-700 dark:text-slate-200">
                          {paginatedLeads.map((lead, localIdx) => {
                            const idx = startIndex + localIdx;
                            const campPrefix = (activeCampaign?.campaignName || lead.data?.campaignName || lead.data?.source || 'CAMPAIGN')
                              .trim().toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-');
                            const dataCode = lead.data?.dataCode || lead.data?.data_code || lead.data?.code || `${campPrefix}-DATA-${idx + 1}`;
                            const location = lead.data?.city || lead.data?.location || 'N/A';
                            const customer = `${lead.data?.firstName || ''} ${lead.data?.lastName || ''}`.trim() || lead.data?.customerName || lead.data?.customer || 'N/A';
                            const firmName = lead.data?.company || lead.data?.firmName || lead.data?.firm_name || 'N/A';
                            const phoneVal = extractLeadPhone(lead.data) || 'N/A';
                            const leadCategory = leadStates[lead._id]?.leadCategory || lead.data?.leadCategory || lead.data?.lead_category || 'N/A';
                            const agentAssigned = lead.data?.assignedTo || (lead as any).assignedToName || 'Unassigned';
                            
                            const dialStatus = leadStates[lead._id]?.status || lead.data?.status || 'Not Called';
                            const isDialed = isLeadDialed(lead);

                            let dialedDatetime = 'Not Called';
                            if (isDialed || lead.data?.dialedAt || lead.data?.lastCallDate) {
                              const dateVal = lead.data?.dialedAt || lead.data?.lastCallDate || (lead as any).updatedAt || lead.createdAt;
                              if (dateVal) {
                                const d = new Date(dateVal);
                                if (!isNaN(d.getTime())) {
                                  dialedDatetime = d.toLocaleString('en-US', {
                                    month: 'short',
                                    day: '2-digit',
                                    year: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                    hour12: true
                                  }).replace(',', '');
                                }
                              }
                            }

                            return (
                              <tr
                                key={lead._id}
                                id={`lead-card-${lead._id}`}
                                className={`transition-all duration-300 ${
                                  highlightedLeadId === lead._id
                                    ? 'bg-indigo-50/90 dark:bg-indigo-950/70 ring-2 ring-indigo-500'
                                    : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                                }`}
                              >
                                <td className="py-3 px-3 text-center font-bold text-slate-400 border-r border-slate-100 dark:border-slate-800">{idx + 1}</td>
                                <td className="py-3 px-3 font-semibold text-slate-900 dark:text-white border-r border-slate-100 dark:border-slate-800">{dataCode}</td>
                                <td className="py-3 px-3 border-r border-slate-100 dark:border-slate-800 font-semibold">{location}</td>
                                <td className="py-3 px-3 font-extrabold text-slate-900 dark:text-white border-r border-slate-100 dark:border-slate-800">{customer}</td>
                                <td className="py-3 px-3 font-medium text-slate-800 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800">{firmName}</td>
                                <td className="py-3 px-3 border-r border-slate-100 dark:border-slate-800">
                                  <div className="space-y-1">
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-bold text-slate-900 dark:text-white font-mono">{maskPhoneNumber(phoneVal, !!revealedPhones[lead._id])}</span>
                                      {phoneVal && phoneVal !== 'N/A' && (
                                        <button
                                          type="button"
                                          onClick={() => togglePhoneReveal(lead._id)}
                                          className="p-0.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                          title={revealedPhones[lead._id] ? "Hide number" : "Show number"}
                                        >
                                          {revealedPhones[lead._id] ? <Icons.EyeOff className="w-3 h-3" /> : <Icons.Eye className="w-3 h-3" />}
                                        </button>
                                      )}
                                    </div>
                                    <div className="flex gap-1">
                                      <button
                                        onClick={() => handleWhatsAppChat(lead)}
                                        className="px-2 py-0.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 text-[10px] font-bold rounded flex items-center gap-1 transition-all"
                                        title="WhatsApp Chat"
                                      >
                                        <Icons.MessageSquare className="w-3 h-3 text-emerald-600" />
                                        WA
                                      </button>
                                      <button
                                        onClick={() => handleInitiateCall(lead)}
                                        className="px-2 py-0.5 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 text-[10px] font-bold rounded flex items-center gap-1 transition-all"
                                        title="Initiate Call"
                                      >
                                        <Icons.PhoneCall className="w-3 h-3 text-blue-600" />
                                        Call
                                      </button>
                                    </div>
                                  </div>
                                </td>
                                <td className="py-2 px-2 border-r border-slate-100 dark:border-slate-800">
                                  <input
                                    type="text"
                                    placeholder="Case Details"
                                    value={leadStates[lead._id]?.caseDetails ?? ''}
                                    onChange={(e) => handleFieldChange(lead._id, 'caseDetails', e.target.value)}
                                    className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-600"
                                  />
                                </td>
                                <td className="py-2 px-2 border-r border-slate-100 dark:border-slate-800">
                                  <input
                                    type="text"
                                    placeholder="Lead Category"
                                    value={leadStates[lead._id]?.leadCategory ?? ''}
                                    onChange={(e) => handleFieldChange(lead._id, 'leadCategory', e.target.value)}
                                    className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-600"
                                  />
                                </td>
                                <td className="py-2 px-2 border-r border-slate-100 dark:border-slate-800">
                                  <input
                                    type="text"
                                    placeholder="Remarks / Notes"
                                    value={(leadStates[lead._id]?.remarks ?? '').replace(/<[^>]*>/g, '')}
                                    onChange={(e) => handleFieldChange(lead._id, 'remarks', e.target.value)}
                                    className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:border-indigo-600"
                                  />
                                </td>
                                <td className="py-3 px-3 border-r border-slate-100 dark:border-slate-800 font-semibold text-slate-800 dark:text-slate-300">{agentAssigned}</td>
                                <td className="py-2 px-2 border-r border-slate-100 dark:border-slate-800">
                                  <select
                                    value={leadStates[lead._id]?.status || 'Yet To Call'}
                                    onChange={(e) => handleStatusSelect(lead, e.target.value)}
                                    className="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 text-slate-800 dark:text-white cursor-pointer"
                                  >
                                    {availableStatuses.map(statusOpt => (
                                      <option key={statusOpt} value={statusOpt}>{statusOpt}</option>
                                    ))}
                                  </select>
                                </td>
                                <td className="py-3 px-3 font-semibold text-slate-600 dark:text-slate-400 border-r border-slate-100 dark:border-slate-800">{dialedDatetime}</td>
                                <td className="py-2 px-2 text-center">
                                  <button
                                    onClick={() => handleSaveLead(lead._id)}
                                    className="h-8 px-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] uppercase tracking-wider rounded-lg inline-flex items-center gap-1.5 cursor-pointer transition-all shadow-xs active:scale-95"
                                    title="Save lead details"
                                  >
                                    <Icons.Save className="w-3.5 h-3.5" />
                                    <span>SAVE</span>
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  /* CARD VIEW MATCHING EXACT USER DESIGN (4-Column Structured Full Details - Image 3) */
                  <div className="space-y-2.5">
                    {paginatedLeads.map((lead, localIdx) => {
                      const idx = startIndex + localIdx;
                      const isDialed = isLeadDialed(lead);
                      
                      // Sequential Lead No ending in 01, 02, 03... completely decoupled from year
                      const serialNum = String(idx + 1).padStart(4, '0'); // e.g. 0001, 0002, 0003...
                      const rawLeadNo = lead.data?.leadNo || lead.data?.lead_no;
                      const leadNo = (rawLeadNo && !String(rawLeadNo).startsWith('C99') && !String(rawLeadNo).includes('2020') && String(rawLeadNo) !== 'N/A')
                        ? String(rawLeadNo)
                        : `B2B-G5-${serialNum}`;

                      // Lead Name: never display literal "UNNAMED" or "N/A"
                      const rawLeadName = `${lead.data?.firstName || ''} ${lead.data?.lastName || ''}`.trim() || lead.data?.customerName || lead.data?.name || lead.data?.customer || '';
                      let cleanLeadName = (rawLeadName && !['UNNAMED', 'N/A', 'UNDEFINED', 'NULL'].includes(rawLeadName.toUpperCase())) ? rawLeadName : '';
                      if (!cleanLeadName && lead.data) {
                        for (const [k, v] of Object.entries(lead.data)) {
                          const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                          if (cleanK.includes('company') || cleanK.includes('firm') || cleanK.includes('bank') || cleanK.includes('psm') || cleanK.includes('campaign') || cleanK.includes('source') || cleanK.includes('assignedto') || cleanK.includes('agent')) continue;
                          if (
                            cleanK.includes('customer') || cleanK.includes('client') || cleanK.includes('leadname') ||
                            cleanK.includes('applicant') || cleanK.includes('borrower') || cleanK.includes('party') ||
                            cleanK.includes('contactperson') || cleanK.includes('custname') || cleanK === 'name' || cleanK === 'fullname' || cleanK === 'firstname' || cleanK === 'lead'
                          ) {
                            if (v && !['UNNAMED', 'N/A', 'UNDEFINED', 'NULL'].includes(String(v).toUpperCase()) && String(v).trim()) {
                              cleanLeadName = String(v).trim();
                              break;
                            }
                          }
                        }
                      }
                      const currentLeadName = leadStates[lead._id]?.leadName !== undefined 
                        ? leadStates[lead._id].leadName 
                        : cleanLeadName;

                      // Location: blank if missing or N/A
                      const rawLocation = lead.data?.city || lead.data?.location || lead.data?.Location || lead.data?.LOCATION || lead.data?.place || lead.data?.area || lead.data?.state || '';
                      let cleanLocation = (rawLocation && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(rawLocation).toUpperCase())) ? String(rawLocation).trim() : '';
                      if (!cleanLocation && lead.data) {
                        for (const [k, v] of Object.entries(lead.data)) {
                          const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                          if (
                            cleanK.includes('location') || cleanK.includes('city') || cleanK.includes('place') ||
                            cleanK.includes('district') || cleanK.includes('area') || cleanK.includes('address') ||
                            cleanK.includes('branch') || cleanK.includes('state') || cleanK.includes('town') ||
                            cleanK.includes('zone') || cleanK.includes('region')
                          ) {
                            if (v && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(v).toUpperCase()) && String(v).trim()) {
                              cleanLocation = String(v).trim();
                              break;
                            }
                          }
                        }
                      }
                      const currentLocation = leadStates[lead._id]?.location !== undefined
                        ? leadStates[lead._id].location
                        : cleanLocation;

                      // Data Code: blank if missing or N/A
                      const rawDataCode = lead.data?.dataCode || lead.data?.data_code || lead.data?.code || lead.data?.datacode || '';
                      let cleanDataCode = (rawDataCode && !['N/A', 'UNDEFINED', 'NULL'].includes(String(rawDataCode).toUpperCase())) ? String(rawDataCode).trim() : '';
                      if (!cleanDataCode && lead.data) {
                        for (const [k, v] of Object.entries(lead.data)) {
                          const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                          if (cleanK.includes('datacode') || cleanK.includes('leadcode') || cleanK.includes('customercode') || cleanK.includes('datano') || cleanK === 'code' || cleanK === 'dcode') {
                            if (v && !['N/A', 'UNDEFINED', 'NULL'].includes(String(v).toUpperCase()) && String(v).trim()) {
                              cleanDataCode = String(v).trim();
                              break;
                            }
                          }
                        }
                      }
                      const currentDataCode = leadStates[lead._id]?.dataCode !== undefined
                        ? leadStates[lead._id].dataCode
                        : cleanDataCode;

                      // Lead Category: blank if missing or N/A
                      const rawCategory = lead.data?.leadCategory || lead.data?.lead_category || lead.data?.category || '';
                      let cleanCategory = (rawCategory && !['N/A', 'UNDEFINED', 'NULL', 'PERSONAL LOAN'].includes(String(rawCategory).toUpperCase())) ? String(rawCategory).trim() : '';
                      if (!cleanCategory && lead.data) {
                        for (const [k, v] of Object.entries(lead.data)) {
                          const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                          if (cleanK.includes('category') || cleanK.includes('leadcat') || cleanK.includes('cattype') || cleanK.includes('leadtype')) {
                            if (v && !['N/A', 'UNDEFINED', 'NULL', 'PERSONAL LOAN'].includes(String(v).toUpperCase()) && String(v).trim()) {
                              cleanCategory = String(v).trim();
                              break;
                            }
                          }
                        }
                      }
                      const currentLeadCategory = leadStates[lead._id]?.leadCategory !== undefined
                        ? leadStates[lead._id].leadCategory
                        : cleanCategory;

                      // Firm/Company: blank if missing or N/A
                      const rawFirm = lead.data?.company || lead.data?.firm || lead.data?.firmName || lead.data?.firm_name || lead.data?.companyName || '';
                      let cleanFirm = (rawFirm && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(rawFirm).toUpperCase())) ? String(rawFirm).trim() : '';
                      if (!cleanFirm && lead.data) {
                        for (const [k, v] of Object.entries(lead.data)) {
                          const cleanK = k.toLowerCase().replace(/[^a-z0-9]/g, '');
                          if (cleanK.includes('company') || cleanK.includes('firm') || cleanK.includes('employer') || cleanK.includes('organization') || cleanK.includes('business')) {
                            if (v && !['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(String(v).toUpperCase()) && String(v).trim()) {
                              cleanFirm = String(v).trim();
                              break;
                            }
                          }
                        }
                      }
                      const currentFirmCompany = leadStates[lead._id]?.firmName !== undefined
                        ? leadStates[lead._id].firmName
                        : cleanFirm;

                      const rawPhone = extractLeadPhone(lead.data) || extractLeadPhone(lead) || '';
                      const cleanPhone = (rawPhone && !['N/A', 'UNDEFINED', 'NULL', 'XXXXXXXXXX'].includes(rawPhone.toUpperCase())) ? rawPhone : '';
                      const currentMobile = leadStates[lead._id]?.mobile !== undefined 
                        ? leadStates[lead._id].mobile 
                        : cleanPhone;
                      const isRevealed = !!revealedPhones[lead._id];
                      const displayedPhone = maskPhoneNumber(currentMobile || rawPhone, isRevealed);

                      // Amount: blank if missing or N/A
                      const rawAmount = lead.data?.loanAmount || lead.data?.amount || lead.data?.loan_amount || lead.data?.budget;
                      const cleanAmount = (rawAmount != null && !['N/A', 'UNDEFINED', 'NULL', ''].includes(String(rawAmount).toUpperCase())) ? String(rawAmount).trim() : '';
                      const currentAmount = leadStates[lead._id]?.amount !== undefined
                        ? leadStates[lead._id].amount
                        : cleanAmount;

                      // Bank Partner: blank if missing or N/A
                      const rawBankPartner = lead.data?.businessPartner || lead.data?.bankPartner || lead.data?.bank_partner || lead.data?.bank || lead.data?.businessPartners || '';
                      const cleanBankPartner = (rawBankPartner && !['N/A', 'UNDEFINED', 'NULL'].includes(String(rawBankPartner).toUpperCase())) ? String(rawBankPartner).trim() : '';
                      const currentBankPartner = leadStates[lead._id]?.bankPartner !== undefined
                        ? leadStates[lead._id].bankPartner
                        : cleanBankPartner;

                      // Case Details: blank if missing or N/A
                      const rawCaseDetails = lead.data?.caseDetails || lead.data?.case_details || lead.data?.case_status || '';
                      const cleanCaseDetails = (rawCaseDetails && !['N/A', 'UNDEFINED', 'NULL'].includes(String(rawCaseDetails).toUpperCase())) ? String(rawCaseDetails).trim() : '';
                      const currentCaseDetails = leadStates[lead._id]?.caseDetails !== undefined
                        ? leadStates[lead._id].caseDetails
                        : cleanCaseDetails;

                      // Remarks: blank if missing or N/A
                      const rawRemarks = (lead.data?.remarks || lead.data?.notes || lead.data?.remark || '').replace(/<[^>]*>/g, '');
                      const cleanRemarks = (rawRemarks && !['N/A', 'UNDEFINED', 'NULL'].includes(String(rawRemarks).toUpperCase())) ? String(rawRemarks).trim() : '';
                      const currentRemarks = leadStates[lead._id]?.remarks !== undefined
                        ? leadStates[lead._id].remarks
                        : cleanRemarks;

                      // Product / Loan Type: strictly blank input unless genuinely provided in uploaded campaign file (NEVER auto-default to PERSONAL LOAN or PERSONAL DETAILS)
                      const rawProduct = lead.data?.loanType || lead.data?.product || lead.data?.loan_type || '';
                      const cleanProduct = (rawProduct && !['N/A', 'UNDEFINED', 'NULL', 'PERSONAL LOAN', 'PERSONAL DETAILS', 'PERSONAL DETAIL'].includes(String(rawProduct).toUpperCase())) 
                        ? String(rawProduct).trim() 
                        : '';
                      const currentProduct = leadStates[lead._id]?.product !== undefined
                        ? leadStates[lead._id].product
                        : cleanProduct;

                      // Created On: strictly on which date dialing (today's date or dialedAt date)
                      const dialingDate = lead.data?.dialedAt || lead.data?.lastCallDate || new Date().toISOString();
                      const createdOnDisplay = formatDate(dialingDate) || new Date().toLocaleDateString('en-GB');

                      // Created By: who is dialing or creating (e.g. Super Admin if super admin is dialing, or dialed caller name)
                      const currentCallerName = user?.firstName 
                        ? `${user.firstName} ${user.lastName || ''}`.trim() 
                        : ((user as any)?.name || (user as any)?.fullName || 'Super Admin');
                      const dialedAgentName = lead.data?.dialedBy || lead.data?.callerName;
                      const createdByDisplay = dialedAgentName || currentCallerName;

                      // Modified On: strictly N/A before dialing / editing; update date once modified
                      const hasMeaningfulUpdate = isDialed || (lead.updatedAt && lead.createdAt && Math.abs(new Date(lead.updatedAt).getTime() - new Date(lead.createdAt).getTime()) > 5000);
                      const modifiedOnDisplay = hasMeaningfulUpdate
                        ? (formatDate(lead.data?.dialedAt || lead.updatedAt) || 'N/A')
                        : 'N/A';

                      // Lead pipeline status check: only display pendingAt / assignedTo if lead was actually created via Create Lead
                      const isLeadCreated = Boolean(
                        lead.data?.isLeadCreated || 
                        lead.data?.leadCreated || 
                        lead.data?.pipelineLeadId ||
                        (lead.data?.pipelineAssignedTo && String(lead.data?.pipelineAssignedTo).trim() !== '')
                      );
                      const pendingAtVal = isLeadCreated
                        ? (lead.data?.assignToTeam || lead.data?.pendingAt || lead.data?.pending_at || '—')
                        : '—';
                      const assignedToName = isLeadCreated
                        ? (lead.data?.pipelineAssignedTo || lead.data?.assignedToName || resolveUserDisplayName(lead.data?.assignedTo) || '—')
                        : '—';

                      // Assigned By: manager or Super Admin who distributed campaign (NEVER campaign name like 11-03-26-DEMO)
                      const isCampaignLabel = (val: any) => {
                        if (!val) return true;
                        const s = String(val).trim().toUpperCase();
                        return s.includes('DEMO') || s.includes('CAMPAIGN') || s.includes('TEST') || s === 'SYSTEM' || s === 'N/A' || /^[0-9\-_]+$/.test(s);
                      };
                      const rawAssBy = lead.data?.assignedByName || lead.data?.assignedBy;
                      const assignedByName = (!isCampaignLabel(rawAssBy) ? resolveUserDisplayName(rawAssBy) : '') ||
                        (lead.createdBy?.firstName ? `${lead.createdBy.firstName} ${lead.createdBy.lastName || ''}`.trim() : '') ||
                        'Super Admin';

                      // PSM: strictly blank input unless genuinely provided in uploaded campaign file (never auto-fill telecaller or campaign name)
                      const rawPsm = lead.data?.psmName || lead.data?.psm;
                      const isArtificialPsm = !rawPsm ||
                        String(rawPsm).trim() === '' ||
                        ['N/A', 'UNASSIGNED', 'UNDEFINED', 'NULL'].includes(String(rawPsm).toUpperCase()) ||
                        String(rawPsm).trim().toLowerCase() === String(lead.data?.assignedTo || '').trim().toLowerCase() ||
                        isCampaignLabel(rawPsm);

                      const cleanPsm = isArtificialPsm ? '' : resolveUserDisplayName(rawPsm);
                      const currentPsm = leadStates[lead._id]?.psm !== undefined ? leadStates[lead._id].psm : cleanPsm;

                      const followupDateVal = lead.data?.followUpDate || lead.data?.followupDate || lead.data?.followup_date;
                      const cleanFollowup = (followupDateVal && !['N/A', 'UNDEFINED', 'NULL'].includes(String(followupDateVal).toUpperCase())) ? String(followupDateVal).slice(0, 10) : '';
                      const currentFollowupDate = leadStates[lead._id]?.followupDate !== undefined
                        ? leadStates[lead._id].followupDate
                        : cleanFollowup;

                      const currentStatus = leadStates[lead._id]?.status || lead.data?.status || 'Yet To Call';
                      const campaignNameDisplay = activeCampaign?.campaignName || lead.data?.campaignName || lead.data?.campaign || '—';
                      // Source name is strictly same as Created By (who is dialing / creating)
                      const sourceNameDisplay = createdByDisplay;

                      const isEditing = !!editingLeadIds[lead._id];
                      const statusMeta = getCardStatusMeta(currentStatus);
                      const StatusIcon = statusMeta.icon;

                      return (
                        <div
                          key={lead._id}
                          id={`lead-card-${lead._id}`}
                          className={`relative rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 shadow-[0_2px_8px_-2px_rgba(30,41,59,0.05),0_1px_2px_-1px_rgba(30,41,59,0.03)] hover:shadow-[0_6px_20px_-3px_rgba(79,70,229,0.08)] transition-all duration-200 p-2.5 sm:p-3 text-[11px] sm:text-xs overflow-hidden ${
                            highlightedLeadId === lead._id
                              ? 'ring-2 ring-indigo-500 shadow-md border-indigo-500'
                              : ''
                          }`}
                        >
                          {/* Top Red Accent Ribbon */}
                          <div className="absolute top-0 left-0 right-0 h-[2.5px] bg-red-500" />

                          <div className="space-y-1.5">
                            {/* Compressed 6-Row x 4-Column Structured Grid */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-4 lg:gap-x-5 gap-y-1 sm:gap-y-1.5 text-[11px] sm:text-xs">
                              {/* ===== ROW 1 ===== */}
                              {/* Col 1: Sl No. */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Sl No.:&nbsp;</span>
                                <span className="text-slate-700 dark:text-slate-300 font-medium">{idx + 1}</span>
                              </div>

                              {/* Col 2: Lead Name (Text if matched from Excel; blank input if not matched or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Lead Name:&nbsp;</span>
                                {isEditing || !cleanLeadName ? (
                                  <input
                                    type="text"
                                    placeholder="Enter Lead Name"
                                    value={currentLeadName}
                                    onChange={(e) => handleFieldChange(lead._id, 'leadName', e.target.value)}
                                    className="h-[22px] text-[11px] font-bold text-sky-600 dark:text-sky-400 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 focus:outline-none focus:ring-1 focus:ring-sky-500 w-full max-w-[165px] uppercase truncate"
                                  />
                                ) : (
                                  <div className="flex items-center gap-1 flex-1 min-w-0">
                                    <span className="font-extrabold text-sky-600 dark:text-sky-400 uppercase truncate max-w-[165px]" title={currentLeadName || 'ENTER LEAD NAME'}>
                                      {currentLeadName || 'ENTER LEAD NAME'}
                                    </span>
                                    <Link
                                      to={`/modules/leads/${lead._id}`}
                                      title="Open lead profile"
                                      className="p-0.5 text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 flex-shrink-0"
                                    >
                                      <Icons.ExternalLink className="w-3 h-3" />
                                    </Link>
                                  </div>
                                )}
                              </div>

                              {/* Col 3: Created On */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Created On:&nbsp;</span>
                                <span className="text-slate-700 dark:text-slate-300 font-medium">{createdOnDisplay}</span>
                              </div>

                              {/* Col 4: Firm/Company (Text if matched from Excel; blank input if not matched or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Firm/Company:&nbsp;</span>
                                {isEditing || !cleanFirm ? (
                                  <input
                                    type="text"
                                    placeholder="Firm / Company"
                                    value={currentFirmCompany}
                                    onChange={(e) => handleFieldChange(lead._id, 'firmName', e.target.value)}
                                    className="h-[22px] text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[170px]"
                                  />
                                ) : (
                                  <span className="text-slate-800 dark:text-slate-200 font-semibold uppercase truncate inline-block max-w-[180px]" title={currentFirmCompany || '—'}>
                                    {currentFirmCompany || '—'}
                                  </span>
                                )}
                              </div>

                              {/* ===== ROW 2 ===== */}
                              {/* Col 1: Lead No. */}
                              <div className="leading-tight min-h-[22px] flex items-center gap-1.5">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Lead No.:&nbsp;</span>
                                <span className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px] font-bold border border-slate-200/80 dark:border-slate-700">
                                  {leadNo}
                                </span>
                              </div>

                              {/* Col 2: Location (Text if matched from Excel; blank input if not matched or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Location:&nbsp;</span>
                                {isEditing || !cleanLocation ? (
                                  <input
                                    type="text"
                                    placeholder="Location"
                                    value={currentLocation}
                                    onChange={(e) => handleFieldChange(lead._id, 'location', e.target.value)}
                                    className="h-[22px] text-[11px] uppercase font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[165px]"
                                  />
                                ) : (
                                  <span className="text-slate-700 dark:text-slate-300 font-medium uppercase truncate inline-block max-w-[165px]" title={currentLocation || '—'}>
                                    {currentLocation || '—'}
                                  </span>
                                )}
                              </div>

                              {/* Col 3: By */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">By:&nbsp;</span>
                                <span className="text-slate-700 dark:text-slate-300 font-medium truncate inline-block max-w-[170px]" title={createdByDisplay}>
                                  {createdByDisplay}
                                </span>
                              </div>

                              {/* Col 4: Modified On */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Modified On:&nbsp;</span>
                                <span className="text-slate-700 dark:text-slate-300 font-medium">{modifiedOnDisplay}</span>
                              </div>

                              {/* ===== ROW 3 ===== */}
                              {/* Col 1: Data Code (Lavender badge if matched from Excel; blank input if not matched or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Data Code:&nbsp;</span>
                                {isEditing || !cleanDataCode ? (
                                  <input
                                    type="text"
                                    placeholder="Data Code"
                                    value={currentDataCode}
                                    onChange={(e) => handleFieldChange(lead._id, 'dataCode', e.target.value)}
                                    className="h-[22px] text-[11px] font-mono font-bold bg-white dark:bg-slate-800 border border-indigo-300 dark:border-indigo-700 rounded px-1.5 py-0 text-indigo-700 dark:text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[150px]"
                                  />
                                ) : (
                                  <span className="inline-block px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono text-[10px] font-bold border border-indigo-200/80 dark:border-indigo-800">
                                    {currentDataCode}
                                  </span>
                                )}
                              </div>

                              {/* Col 2: Mobile No. (Text with reveal if matched from Excel; blank input if not matched or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Mobile No.:&nbsp;</span>
                                {isEditing || !cleanPhone ? (
                                  <input
                                    type="tel"
                                    placeholder="Mobile Number"
                                    value={currentMobile}
                                    onChange={(e) => handleFieldChange(lead._id, 'mobile', e.target.value)}
                                    className="h-[22px] text-[11px] font-mono font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[155px]"
                                  />
                                ) : (
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-mono font-bold text-slate-800 dark:text-slate-100">
                                      {displayedPhone || currentMobile}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => togglePhoneReveal(lead._id)}
                                      title={isRevealed ? "Hide number" : "Show number"}
                                      className="p-0.5 rounded text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                                    >
                                      {isRevealed ? <Icons.EyeOff className="w-3 h-3" /> : <Icons.Eye className="w-3 h-3" />}
                                    </button>
                                  </div>
                                )}
                              </div>

                              {/* Col 3: Followup Date (Badge if set/saved; date input if empty or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Followup Date:&nbsp;</span>
                                {isEditing || !cleanFollowup ? (
                                  <input
                                    type="date"
                                    value={currentFollowupDate}
                                    onChange={(e) => handleFieldChange(lead._id, 'followupDate', e.target.value)}
                                    className="h-[22px] text-[11px] bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[140px] cursor-pointer"
                                  />
                                ) : (
                                  <span className="inline-block px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-mono text-[10px] font-medium border border-indigo-200/80 dark:border-indigo-800">
                                    {formatDate(currentFollowupDate) || currentFollowupDate}
                                  </span>
                                )}
                              </div>

                              {/* Col 4: Assigned By */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Assigned By:&nbsp;</span>
                                <span className="text-slate-700 dark:text-slate-300 truncate inline-block max-w-[170px]" title={assignedByName}>
                                  {assignedByName}
                                </span>
                              </div>

                              {/* ===== ROW 4 ===== */}
                              {/* Col 1: Lead Category (Text if matched from Excel; blank input if not matched or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Lead Category:&nbsp;</span>
                                {isEditing || !cleanCategory ? (
                                  <input
                                    type="text"
                                    placeholder="Lead Category"
                                    value={currentLeadCategory}
                                    onChange={(e) => handleFieldChange(lead._id, 'leadCategory', e.target.value)}
                                    className="h-[22px] text-[11px] uppercase font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[155px]"
                                  />
                                ) : (
                                  <span className="text-slate-800 dark:text-slate-200 font-semibold uppercase truncate inline-block max-w-[155px]" title={currentLeadCategory || '—'}>
                                    {currentLeadCategory || '—'}
                                  </span>
                                )}
                              </div>

                              {/* Col 2: Amount (Emerald bold text if matched/entered; blank input if empty or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Amount:&nbsp;</span>
                                {isEditing || !cleanAmount ? (
                                  <input
                                    type="text"
                                    placeholder="Loan Amount"
                                    value={currentAmount}
                                    onChange={(e) => handleFieldChange(lead._id, 'amount', e.target.value)}
                                    className="h-[22px] text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 focus:outline-none focus:ring-1 focus:ring-emerald-500 w-full max-w-[150px]"
                                  />
                                ) : (
                                  <span className="font-bold text-emerald-600 dark:text-emerald-400 truncate inline-block max-w-[150px]">
                                    {String(currentAmount || '').startsWith('₹') ? currentAmount : `₹${currentAmount}`}
                                  </span>
                                )}
                              </div>

                              {/* Col 3: Pending at (strictly '—' until lead is actually created via Create Lead) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Pending at:&nbsp;</span>
                                <span className={`font-semibold uppercase truncate inline-block max-w-[170px] ${isLeadCreated && pendingAtVal !== '—' ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500 font-semibold'}`} title={isLeadCreated ? pendingAtVal : '—'}>
                                  {isLeadCreated ? pendingAtVal : '—'}
                                </span>
                              </div>

                              {/* Col 4: Assigned To (strictly '—' until lead is actually created via Create Lead) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Assigned To:&nbsp;</span>
                                <span className={`font-semibold truncate inline-block max-w-[170px] ${isLeadCreated && assignedToName !== '—' ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 font-semibold'}`} title={isLeadCreated ? assignedToName : '—'}>
                                  {isLeadCreated ? assignedToName : '—'}
                                </span>
                              </div>

                              {/* ===== ROW 5 ===== */}
                              {/* Col 1: Product (Text if matched/entered; blank input if empty or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Product:&nbsp;</span>
                                {isEditing || !cleanProduct ? (
                                  <input
                                    type="text"
                                    placeholder="PRODUCT / LOAN TYPE"
                                    value={currentProduct}
                                    onChange={(e) => handleFieldChange(lead._id, 'product', e.target.value)}
                                    className="h-[22px] text-[11px] uppercase font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[165px]"
                                  />
                                ) : (
                                  <span className="text-slate-800 dark:text-slate-200 font-semibold uppercase truncate inline-block max-w-[165px]" title={currentProduct || '—'}>
                                    {currentProduct || '—'}
                                  </span>
                                )}
                              </div>

                              {/* Col 2: Bank Partner (Text if matched/entered; blank input if empty or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Bank Partner:&nbsp;</span>
                                {isEditing || !cleanBankPartner ? (
                                  <input
                                    type="text"
                                    placeholder="BANK PARTNER"
                                    value={currentBankPartner}
                                    onChange={(e) => handleFieldChange(lead._id, 'bankPartner', e.target.value)}
                                    className="h-[22px] text-[11px] uppercase font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[165px]"
                                  />
                                ) : (
                                  <span className="text-slate-800 dark:text-slate-200 font-semibold uppercase truncate inline-block max-w-[165px]" title={currentBankPartner || '—'}>
                                    {currentBankPartner || '—'}
                                  </span>
                                )}
                              </div>

                              {/* Col 3: PSM (Text if matched/entered; blank input if empty or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">PSM:&nbsp;</span>
                                {isEditing || !cleanPsm ? (
                                  <input
                                    type="text"
                                    placeholder="PSM Name"
                                    value={currentPsm}
                                    onChange={(e) => handleFieldChange(lead._id, 'psm', e.target.value)}
                                    className="h-[22px] text-[11px] font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[165px]"
                                  />
                                ) : (
                                  <span className="text-slate-800 dark:text-slate-200 font-semibold uppercase truncate inline-block max-w-[165px]" title={currentPsm || '—'}>
                                    {currentPsm || '—'}
                                  </span>
                                )}
                              </div>

                              {/* Col 4: Case Details (Text if matched/entered; blank input if empty or editing) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Case Details:&nbsp;</span>
                                {isEditing || !cleanCaseDetails ? (
                                  <input
                                    type="text"
                                    placeholder="Case Details"
                                    value={currentCaseDetails}
                                    onChange={(e) => handleFieldChange(lead._id, 'caseDetails', e.target.value)}
                                    className="h-[22px] text-[11px] bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[150px]"
                                  />
                                ) : (
                                  <span className="text-slate-700 dark:text-slate-300 font-medium truncate inline-block max-w-[150px]" title={currentCaseDetails || 'N/A'}>
                                    {currentCaseDetails || 'N/A'}
                                  </span>
                                )}
                              </div>

                              {/* ===== ROW 6 (Compressed, without redundant Campaign display) ===== */}
                              {/* Col 1: Status (Dropdown select matching target design) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Status:&nbsp;</span>
                                <select
                                  value={currentStatus}
                                  onChange={(e) => handleStatusSelect(lead, e.target.value)}
                                  className="h-[22px] text-[11px] font-bold uppercase bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 cursor-pointer focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[165px]"
                                >
                                  {availableStatuses.map(st => (
                                    <option key={st} value={st}>{st.toUpperCase()}</option>
                                  ))}
                                </select>
                              </div>

                              {/* Col 2: Source (Same as Created By: who is dialing / creating) */}
                              <div className="leading-tight min-h-[22px] flex items-center">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Source:&nbsp;</span>
                                <span className="text-slate-700 dark:text-slate-300 font-medium truncate inline-block max-w-[165px]" title={sourceNameDisplay}>
                                  {sourceNameDisplay}
                                </span>
                              </div>

                              {/* Col 3 & 4: Remarks (Spanning remaining columns for wide comfortable notes input) */}
                              <div className="leading-tight min-h-[22px] flex items-center sm:col-span-2">
                                <span className="font-bold text-slate-800 dark:text-slate-100 whitespace-nowrap">Remarks:&nbsp;</span>
                                {isEditing || !cleanRemarks ? (
                                  <input
                                    type="text"
                                    placeholder="Remarks / Notes"
                                    value={currentRemarks}
                                    onChange={(e) => handleFieldChange(lead._id, 'remarks', e.target.value)}
                                    className="h-[22px] text-[11px] italic bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded px-1.5 py-0 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full max-w-[340px]"
                                  />
                                ) : (
                                  <span className="text-slate-600 dark:text-slate-400 italic truncate inline-block max-w-[340px]" title={currentRemarks || '—'}>
                                    {currentRemarks || '—'}
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Card Footer: Action Toolbar matching Image 4 */}
                            <div className="mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-1.5">
                              {/* Left: Dynamic Status Pill Badge Button matching Image 4 */}
                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleStatusSelect(lead, currentStatus)}
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors shadow-3xs cursor-pointer ${statusMeta.color} ${statusMeta.bg} border ${statusMeta.border}`}
                                  title="Current Lead Status (Click to trigger / update)"
                                >
                                  <StatusIcon className="w-3 h-3" />
                                  <span>{currentStatus}</span>
                                </button>
                              </div>

                              {/* Right: Actions matching target UI */}
                              <div className="flex flex-wrap items-center gap-1.5">
                                {/* WA Chat (Green) */}
                                <button 
                                  type="button"
                                  onClick={() => handleWhatsAppChat(lead)}
                                  className="inline-flex items-center gap-1 bg-[#10b981] hover:bg-[#059669] active:bg-[#047857] text-white text-[11px] font-bold px-2.5 py-0.5 rounded-lg transition-colors shadow-3xs cursor-pointer"
                                >
                                  <Icons.MessageSquare className="w-3 h-3" />
                                  <span>WA Chat</span>
                                </button>
                                
                                {/* Call (Purple/Indigo) */}
                                <button 
                                  type="button"
                                  onClick={() => handleInitiateCall(lead)}
                                  className="inline-flex items-center gap-1 bg-[#4f46e5] hover:bg-[#4338ca] active:bg-[#3730a3] text-white text-[11px] font-bold px-2.5 py-0.5 rounded-lg transition-colors shadow-3xs cursor-pointer"
                                >
                                  <Icons.PhoneCall className="w-3 h-3" />
                                  <span>Call</span>
                                </button>

                                {/* Save Button (Cyan/Blue with Save Disk Icon) */}
                                <button 
                                  type="button"
                                  onClick={() => handleSaveLead(lead._id)}
                                  className="inline-flex items-center gap-1 bg-[#0284c7] hover:bg-[#0369a1] active:bg-[#075985] text-white text-[11px] font-bold px-2.5 py-0.5 rounded-lg transition-all shadow-3xs cursor-pointer"
                                  title="Save entered details"
                                >
                                  <Icons.Save className="w-3 h-3" />
                                  <span>Save</span>
                                </button>

                                {/* Edit Button (White/Outline with Pencil Icon) */}
                                <button 
                                  type="button"
                                  onClick={() => toggleLeadEdit(lead._id)}
                                  className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-lg transition-all shadow-3xs cursor-pointer ${
                                    isEditing
                                      ? 'bg-amber-600 hover:bg-amber-700 text-white'
                                      : 'bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700'
                                  }`}
                                  title={isEditing ? "Exit Edit Mode" : "Edit All Fields"}
                                >
                                  <Icons.Edit3 className="w-3 h-3" />
                                  <span>{isEditing ? 'Done' : 'Edit'}</span>
                                </button>

                                {/* Upload File (Outline) */}
                                <button
                                  type="button"
                                  onClick={() => handleUploadClick(lead._id)}
                                  className="inline-flex items-center gap-1 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-[11px] font-bold px-2.5 py-0.5 rounded-lg transition-colors shadow-3xs cursor-pointer"
                                  title="Upload document for this lead"
                                >
                                  <Icons.Upload className="w-3 h-3" />
                                  <span>Upload File</span>
                                </button>

                                {/* History (Outline) */}
                                <button
                                  type="button"
                                  onClick={() => openHistory(lead)}
                                  className="inline-flex items-center gap-1.5 bg-white hover:bg-slate-50 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-xs font-bold px-3 py-1 rounded-lg transition-colors shadow-3xs cursor-pointer"
                                  title="View audit & call history"
                                >
                                  <Icons.History className="w-3.5 h-3.5" />
                                  <span>History</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* BOTTOM PAGINATION CONTROLS BAR */}
                {(filteredLeads.length > 0 || serverTotalLeads > 0) && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 px-5 py-3.5 rounded-2xl shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
                    {/* Left: Summary text */}
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      Showing <span className="font-bold text-slate-800 dark:text-slate-200">{leads.length > 0 ? startIndex + 1 : 0}</span> to{' '}
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {Math.min(startIndex + leads.length, serverTotalLeads || leads.length)}
                      </span>{' '}
                      of <span className="font-bold text-indigo-600 dark:text-indigo-400">{serverTotalLeads || leads.length}</span> leads
                    </div>

                    {/* Center: Per Page selector */}
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <span>Rows per page:</span>
                      <select
                        value={pageSize}
                        onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                        className="h-8 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                      </select>
                    </div>

                    {/* Right: Page navigation buttons */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handlePageChange(1)}
                        disabled={currentPage === 1}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1 cursor-pointer"
                        title="First Page"
                      >
                        <Icons.ChevronsLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handlePageChange(currentPage - 1)}
                        disabled={currentPage === 1}
                        className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Icons.ChevronLeft className="w-4 h-4" />
                        <span>Prev</span>
                      </button>

                      <span className="px-3 text-xs font-bold text-slate-700 dark:text-slate-200">
                        Page <strong className="text-indigo-600 dark:text-indigo-400 font-black">{currentPage}</strong> of{' '}
                        <strong>{totalPages}</strong>
                      </span>

                      <button
                        onClick={() => handlePageChange(currentPage + 1)}
                        disabled={currentPage >= totalPages}
                        className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <span>Next</span>
                        <Icons.ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handlePageChange(totalPages)}
                        disabled={currentPage >= totalPages}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1 cursor-pointer"
                        title="Last Page"
                      >
                        <Icons.ChevronsRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

      {/* PROPER SAVE CONFIRMATION POPUP MODAL */}
      {saveSuccessModal && saveSuccessModal.isOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm transition-all duration-200"
          onClick={() => setSaveSuccessModal(null)}
        >
          <div 
            className="relative w-full max-w-md bg-white dark:bg-slate-900 rounded-[28px] border border-slate-100 dark:border-slate-800 shadow-2xl p-6 sm:p-7 text-center transform transition-all animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close 'X' button top-right */}
            <button
              onClick={() => setSaveSuccessModal(null)}
              className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close"
            >
              <Icons.X className="w-4 h-4" />
            </button>

            {/* Top rounded pill with centered checkmark circle matching Image 2 */}
            <div className="w-full h-8 bg-[#e6f8f0] dark:bg-emerald-950/40 rounded-full flex items-center justify-center relative mb-5 mt-1">
              <div className="w-7 h-7 rounded-full bg-white dark:bg-slate-900 border-2 border-[#10b981] text-[#10b981] flex items-center justify-center shadow-xs">
                <Icons.Check className="w-4 h-4 stroke-[3]" />
              </div>
            </div>

            {/* Title: LEAD SAVED SUCCESSFULLY */}
            <h3 className="text-base sm:text-lg font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider text-center mb-4">
              LEAD SAVED SUCCESSFULLY
            </h3>

            {/* LEAD NUMBER Box */}
            <div className="bg-[#e8f8f2] dark:bg-emerald-950/40 border border-[#bbf0db] dark:border-emerald-800/60 rounded-2xl py-3.5 px-4 text-center mb-3">
              <span className="block text-[11px] font-extrabold text-[#059669] dark:text-emerald-400 uppercase tracking-widest mb-1">
                LEAD NUMBER
              </span>
              <span className="text-xl sm:text-2xl font-black text-[#047857] dark:text-emerald-300 font-mono tracking-tight">
                {saveSuccessModal.dataCode}
              </span>
            </div>

            {/* Subtitle */}
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 text-center font-medium mb-6">
              Lead updated successfully and moved to next lead.
            </p>

            {/* Action Buttons: "DONE AND NEXT" */}
            <div className="space-y-2.5">
              {saveSuccessModal.hasNext ? (
                <button
                  onClick={() => handleGoToNextLead()}
                  className="w-full h-12 bg-[#008f5d] hover:bg-[#007a4f] text-white font-extrabold text-sm uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-700/20 cursor-pointer active:scale-98 transition-all"
                  title="Move to next lead (Press Enter)"
                >
                  <span>CONTINUE CALLING</span>
                </button>
              ) : (
                <button
                  onClick={() => setSaveSuccessModal(null)}
                  className="w-full h-12 bg-[#008f5d] hover:bg-[#007a4f] text-white font-extrabold text-sm uppercase tracking-wider rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-700/20 cursor-pointer active:scale-98 transition-all"
                >
                  <span>ALL LEADS COMPLETED</span>
                </button>
              )}

              <button
                onClick={() => setSaveSuccessModal(null)}
                className="w-full h-10 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                title="Stay on this lead (Press Esc)"
              >
                <span>DONE</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden File Input for Upload */}
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={handleFileChange} 
        className="hidden" 
      />

      {/* History Audit Modal */}
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
                  Lead Name: <span className="text-slate-800 dark:text-white font-bold">{activeHistoryRecord.data?.firstName} {activeHistoryRecord.data?.lastName || activeHistoryRecord.data?.customerName || 'Customer'}</span> • Lead No: <span className="font-mono font-bold text-indigo-600">LND-{activeHistoryRecord._id.slice(-6).toUpperCase()}</span>
                </p>
              </div>
              <button 
                onClick={() => setActiveHistoryRecord(null)}
                className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
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
                          <div key={doc._id} className="flex justify-between items-center p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-100 dark:border-slate-800">
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
                className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-xs rounded-xl uppercase transition-colors cursor-pointer"
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
