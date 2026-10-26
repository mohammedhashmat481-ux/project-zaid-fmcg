import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import { useAuthStore } from '../store/authStore';
import * as Icons from 'lucide-react';
import { exportCampaignCSV } from '../utils/exportCampaignCSV';

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
}

interface LeadState {
  status?: string;
  remarks?: string;
  caseDetails?: string;
  leadCategory?: string;
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

const CAMPAIGN_STATUSES = [
  'Yet To Call',
  'Hot Lead',
  'Warm Lead',
  'Not Intested',
  'Call Rejected',
  'Not Connected',
  'Cool Lead',
  'No Answer',
  'Wrong Number',
  'Not Exists',
  'Repeated Number',
  'No Business',
  'Not Reachable'
];

export default function MyCampaign() {
  const navigate = useNavigate();
  const { showToast } = useToastStore();
  const { user } = useAuthStore();
  const [campaigns, setCampaigns] = useState<CampaignStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [activeCampaign, setActiveCampaign] = useState<CampaignStats | null>(null);
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');
  const [filterTab, setFilterTab] = useState<'yetToDial' | 'dialed' | 'all'>('yetToDial');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Track inputs for each lead ID
  const [leadStates, setLeadStates] = useState<Record<string, LeadState>>({});

  // Pagination states for instant rendering without DOM freezing
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(25);

  // Modal & Navigation States for Lead Save Confirmation
  const [saveSuccessModal, setSaveSuccessModal] = useState<SaveSuccessModalData | null>(null);
  const [highlightedLeadId, setHighlightedLeadId] = useState<string | null>(null);

  // Fetch campaigns
  const fetchCampaigns = async () => {
    try {
      setLoading(true);
      setCampaignError(null);
      const res = await api.get('/records/campaigns/my-campaigns');
      setCampaigns(res.data.campaigns || []);
    } catch (err: any) {
      console.error(err);
      setCampaignError(err?.message || 'Failed to load campaigns.');
      showToast('Failed to load campaigns.', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Fetch lead details for active campaign (optimized for instant load)
  const fetchLeadDetails = async (campaignName: string) => {
    try {
      setLoadingLeads(true);
      setCurrentPage(1);
      setLeadStates({}); // Reset modified states
      const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}`);
      setLeads(res.data.leads || []);
    } catch (err: any) {
      console.error(err);
      showToast('Failed to load campaign leads.', 'error');
    } finally {
      setLoadingLeads(false);
    }
  };

  // Fetch status dropdown options
  useEffect(() => {
    fetchCampaigns();
    api.get('/statuses')
      .then(res => setStatuses(res.data.map((s: any) => s.name)))
      .catch(err => console.error('Failed to load statuses', err));
  }, []);

  const handleViewDetails = (campaign: CampaignStats) => {
    setActiveCampaign(campaign);
    setCurrentPage(1);
    fetchLeadDetails(campaign.campaignName);
  };

  const handleBack = () => {
    setActiveCampaign(null);
    setLeads([]);
    setLeadStates({});
    setCurrentPage(1);
    fetchCampaigns();
  };

  const handleDownloadCampaign = async (campaignName: string, campaignLeads?: LeadRecord[]) => {
    try {
      showToast('Exporting campaign CSV report...', 'info');
      let targetLeads = campaignLeads && campaignLeads.length > 0 ? campaignLeads : undefined;
      
      if (!targetLeads) {
        const res = await api.get(`/records/campaigns/my-campaigns/details/${encodeURIComponent(campaignName)}`);
        targetLeads = res.data.leads || [];
      }

      if (!targetLeads || targetLeads.length === 0) {
        showToast('No leads available to export.', 'warning');
        return;
      }

      // Generate CSV rows
      const headers = ['Sl No', 'Data Code', 'Location', 'Customer', 'Firm Name', 'Contact Number', 'Case Details', 'Lead Category', 'Remarks', 'Agent Assigned To', 'Dial Status', 'Created At'];
      const rows = targetLeads.map((lead, idx) => [
        idx + 1,
        lead.data?.dataCode || lead.data?.data_code || `LND-${lead._id.slice(-6).toUpperCase()}`,
        lead.data?.city || lead.data?.location || 'N/A',
        `${lead.data?.firstName || ''} ${lead.data?.lastName || ''}`.trim() || lead.data?.customerName || lead.data?.customer || 'N/A',
        lead.data?.company || lead.data?.firmName || lead.data?.firm_name || 'N/A',
        lead.data?.phone || lead.data?.mobile || lead.data?.name_contact_num || 'N/A',
        leadStates[lead._id]?.caseDetails ?? lead.data?.caseDetails ?? 'N/A',
        lead.data?.leadCategory || lead.data?.lead_category || lead.data?.loanType || 'N/A',
        (leadStates[lead._id]?.remarks ?? lead.data?.notes ?? '').toString().replace(/<[^>]*>/g, ''),
        lead.data?.assignedTo || (lead as any).assignedToName || 'Unassigned',
        leadStates[lead._id]?.status || lead.data?.status || 'Yet To Call',
        new Date(lead.createdAt).toLocaleDateString()
      ]);

      const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
      const encodedUri = encodeURI(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', encodedUri);
      link.setAttribute('download', `${campaignName.replace(/\s+/g, '_')}_Leads_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Campaign exported successfully!', 'success');
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

  const handleStatusSelect = async (lead: LeadRecord, newStatus: string) => {
    // 1. Always update state locally so user sees the selected status immediately
    handleFieldChange(lead._id, 'status', newStatus);

    const isHotOrWarm = newStatus === 'Hot Lead' || newStatus === 'Warm Lead';

    // 2. ONLY for Hot Lead or Warm Lead: Auto-save status and immediately open Create Lead
    if (isHotOrWarm) {
      const currentRemarks = leadStates[lead._id]?.remarks ?? (lead.data?.notes || lead.data?.remarks || '');
      const currentCaseDetails = leadStates[lead._id]?.caseDetails ?? (lead.data?.caseDetails || '');
      const currentLeadCategory = leadStates[lead._id]?.leadCategory ?? (lead.data?.leadCategory || lead.data?.loanType || '');

      try {
        const payload = {
          status: newStatus,
          dialStatus: newStatus,
          dialedAt: new Date(),
          callAttempts: ((lead.data?.callAttempts as number) || 0) + 1,
          notes: currentRemarks,
          caseDetails: currentCaseDetails,
          leadCategory: currentLeadCategory
        };

        // Persist to database
        await api.put(`/records/leads/${lead._id}`, payload);

        // Update in-memory state so counters reflect immediately
        setLeads(prev => prev.map(l => l._id === lead._id ? { ...l, data: { ...l.data, ...payload } } : l));

        showToast(`${newStatus} selected! Opening Create Lead...`, 'success');

        // Lead Creator name: MUST be the currently logged-in user who clicked it
        const loggedInCreatorName = user 
          ? ([user.firstName, user.lastName].filter(Boolean).join(' ') || (user as any).name || (user as any).fullName || user.email?.split('@')[0])
          : 'Super Admin';

        const phoneVal = lead.data?.phone || lead.data?.mobile || lead.data?.name_contact_num || '';
        
        navigate('/modules/leads/new', {
          state: {
            ...lead.data,
            firstName: lead.data?.firstName || lead.data?.customer || lead.data?.customerName || '',
            lastName: lead.data?.lastName || '',
            phone: phoneVal,
            company: lead.data?.company || lead.data?.firm_name || lead.data?.firmName || '',
            city: lead.data?.city || lead.data?.location || '',
            dataCode: lead.data?.dataCode || lead.data?.data_code || '',
            status: newStatus.toUpperCase().includes('HOT') ? 'HOT LEAD' : 'WARM LEAD',
            notes: currentRemarks,
            caseDetails: currentCaseDetails,
            leadCategory: currentLeadCategory,
            loanType: currentLeadCategory,
            source: loggedInCreatorName, // FIXED: CREATOR'S NAME ONLY!
            fromCampaignLeadId: lead._id
          }
        });
      } catch (err: any) {
        console.error(err);
        showToast(err.response?.data?.error || 'Failed to update status.', 'error');
      }
    } else {
      // 3. For ALL other statuses (Yet To Call, Call Rejected, Not Connected, etc.):
      // DO NOT navigate away, DO NOT auto-save to DB yet!
      // The status will only be saved when user clicks the "SAVE" button!
      showToast(`Status changed to ${newStatus}. Click SAVE to persist.`, 'info');
    }
  };

  const handleWhatsAppChat = (lead: LeadRecord) => {
    const rawPhone = lead.data?.phone || lead.data?.mobile || lead.data?.contactNumber || lead.data?.contactNum || lead.data?.mobileNo || lead.data?.contact_num || '';
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

  const handleInitiateCall = async (lead: LeadRecord) => {
    const rawPhone = lead.data?.phone || lead.data?.mobile || lead.data?.contactNumber || lead.data?.contactNum || lead.data?.mobileNo || lead.data?.contact_num || '';
    const cleanPhone = String(rawPhone).replace(/[^\d+]/g, '').trim();
    if (!cleanPhone) {
      showToast('No phone number available for this lead.', 'warning');
      return;
    }
    const leadName = `${lead.data?.firstName || ''} ${lead.data?.lastName || ''}`.trim() || lead.data?.fullName || lead.data?.customerName || lead.data?.name || 'Lead';
    showToast(`Calling ${leadName} (${cleanPhone})...`, 'info');

    // Track dial activity
    try {
      await api.put(`/records/leads/${lead._id}`, {
        dialedAt: new Date(),
        callAttempts: ((lead.data?.callAttempts as number) || 0) + 1
      });
    } catch (e) {}

    window.location.href = `tel:${cleanPhone}`;
  };

  const isLeadDialed = (lead: LeadRecord) => {
    const savedStatus = (lead.data?.status || lead.data?.dialStatus || '').toString().trim().toLowerCase();
    const hasCalls = ((lead.data?.callAttempts as number) > 0) || !!lead.data?.dialedAt || !!lead.data?.lastCallDate;
    const isDialedStatus = savedStatus && savedStatus !== 'yet to call' && savedStatus !== 'not called' && savedStatus !== 'new';
    return Boolean(isDialedStatus || hasCalls);
  };

  const totalAllocatedCount = leads.length > 0 ? leads.length : (activeCampaign?.totalAssigned || 0);
  const dialedCount = leads.length > 0 ? leads.filter(l => isLeadDialed(l)).length : (activeCampaign?.dialed || 0);
  const yetToDialCount = Math.max(0, totalAllocatedCount - dialedCount);

  const filteredLeads = React.useMemo(() => {
    if (!leads || leads.length === 0) return [];
    return leads.filter(lead => {
      const isDialed = isLeadDialed(lead);
      
      if (filterTab === 'yetToDial' && isDialed) return false;
      if (filterTab === 'dialed' && !isDialed) return false;
      
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const customer = `${lead.data?.firstName || ''} ${lead.data?.lastName || ''} ${lead.data?.customerName || ''} ${lead.data?.customer || ''}`.toLowerCase();
        const firm = (lead.data?.company || lead.data?.firmName || lead.data?.firm_name || '').toLowerCase();
        const dataCode = (lead.data?.dataCode || lead.data?.data_code || lead.data?.code || '').toLowerCase();
        const phone = (lead.data?.phone || lead.data?.mobile || lead.data?.contactNumber || lead.data?.name_contact_num || '').toLowerCase();
        const location = (lead.data?.city || lead.data?.location || '').toLowerCase();
        const remarks = (leadStates[lead._id]?.remarks || lead.data?.notes || '').toLowerCase();
        const caseDetails = (leadStates[lead._id]?.caseDetails || lead.data?.caseDetails || '').toLowerCase();
        const leadCat = (leadStates[lead._id]?.leadCategory || lead.data?.leadCategory || lead.data?.loanType || '').toLowerCase();
        
        return customer.includes(q) || firm.includes(q) || dataCode.includes(q) || phone.includes(q) || location.includes(q) || remarks.includes(q) || caseDetails.includes(q) || leadCat.includes(q);
      }
      
      return true;
    });
  }, [leads, leadStates, filterTab, searchQuery]);

  // Instant pagination: slices data for instantaneous DOM rendering (<10ms)
  const totalPages = Math.ceil(filteredLeads.length / pageSize) || 1;
  const safeCurrentPage = Math.min(Math.max(1, currentPage), totalPages);
  const startIndex = (safeCurrentPage - 1) * pageSize;
  const paginatedLeads = filteredLeads.slice(startIndex, startIndex + pageSize);

  const handleGoToNextLead = (targetNextId?: string) => {
    const nextId = targetNextId || saveSuccessModal?.nextLeadId;
    setSaveSuccessModal(null);

    if (!nextId) {
      showToast('You have reached the last lead in this list!', 'info');
      return;
    }

    // Calculate target page if next lead is on another page
    const nextIndex = filteredLeads.findIndex(l => l._id === nextId);
    if (nextIndex !== -1) {
      const targetPage = Math.floor(nextIndex / pageSize) + 1;
      if (targetPage !== currentPage) {
        setCurrentPage(targetPage);
      }
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
  }, [saveSuccessModal, filteredLeads, pageSize, currentPage]);

  const handleSaveLead = async (leadId: string) => {
    try {
      const lead = leads.find(l => l._id === leadId);
      if (!lead) return;

      const state = leadStates[leadId];
      const currentStatus = state?.status || lead.data?.status || lead.data?.dialStatus || 'Yet To Call';
      const currentRemarks = state?.remarks ?? (lead.data?.notes || lead.data?.remarks || '');
      const currentCaseDetails = state?.caseDetails ?? (lead.data?.caseDetails || '');
      const currentLeadCategory = state?.leadCategory ?? (lead.data?.leadCategory || lead.data?.loanType || '');

      const currentIndex = filteredLeads.findIndex(l => l._id === leadId);
      const slNo = currentIndex >= 0 ? currentIndex + 1 : 1;
      const nextLead = currentIndex >= 0 && currentIndex + 1 < filteredLeads.length ? filteredLeads[currentIndex + 1] : null;
      const nextLeadId = nextLead?._id;
      const nextSlNo = nextLead ? currentIndex + 2 : undefined;

      const dataCode = lead.data?.dataCode || lead.data?.data_code || lead.data?.code || (lead._id ? `PL-DEMO-DATA-${slNo}` : 'N/A');

      const payload: Record<string, any> = {
        status: currentStatus,
        dialStatus: currentStatus,
        dialedAt: new Date(),
        callAttempts: ((lead.data?.callAttempts as number) || 0) + 1,
        notes: currentRemarks,
        caseDetails: currentCaseDetails,
        leadCategory: currentLeadCategory
      };

      await api.put(`/records/leads/${leadId}`, payload);

      // Update lead in memory so counts & UI update immediately without re-fetching 3,000 leads
      setLeads(prev => prev.map(l => l._id === leadId ? { ...l, data: { ...l.data, ...payload } } : l));

      // Open proper popup matching user's exact design
      setSaveSuccessModal({
        isOpen: true,
        leadId,
        slNo,
        dataCode,
        nextLeadId,
        nextSlNo,
        hasNext: Boolean(nextLead)
      });

      // Refresh campaigns listing in background
      api.get('/records/campaigns/my-campaigns').then(res => {
        const updatedCampaigns: CampaignStats[] = res.data.campaigns || [];
        setCampaigns(updatedCampaigns);
        if (activeCampaign) {
          const found = updatedCampaigns.find(c => c.campaignName === activeCampaign.campaignName);
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
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-10 h-10 border-4 border-orange-500 border-t-transparent rounded-full animate-spin"></div>
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
            onClick={() => fetchCampaigns()}
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
    <div className="space-y-6 max-w-[1400px] mx-auto text-left p-4 sm:p-6">
      
      {!activeCampaign ? (
        // CAMPAIGNS CARDS VIEW
        (() => {
          const filteredCampaigns = campaigns.filter(c => 
            c.campaignName.toLowerCase().includes(searchQuery.trim().toLowerCase())
          );

          return (
            <div className="space-y-4">
              {/* Streamlined Header Summary Bar with Defined Border */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-5 py-4 rounded-xl shadow-xs">
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
                          ({campaigns.length} {campaigns.length === 1 ? 'Active' : 'Active'})
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Select a campaign to initiate telecalling, record call remarks, and update lead status.
                      </p>
                    </div>
                  </div>

                  {/* Compact Stats Indicators with Border */}
                  {campaigns.length > 0 && (
                    <div className="flex items-center gap-4 border-t sm:border-t-0 sm:border-l border-slate-200 dark:border-slate-800 pt-2.5 sm:pt-0 sm:pl-5 flex-shrink-0">
                      <div className="text-left">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Campaigns</span>
                        <span className="text-base font-bold text-slate-800 dark:text-slate-100 font-mono leading-tight">{campaigns.length}</span>
                      </div>
                      <div className="w-px h-7 bg-slate-200 dark:bg-slate-700" />
                      <div className="text-left">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider block">Total Leads</span>
                        <span className="text-base font-bold text-emerald-700 dark:text-emerald-400 font-mono leading-tight">
                          {campaigns.reduce((sum, c) => sum + c.totalAssigned, 0)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Search & Filter Toolbar with Crisp Border */}
              {campaigns.length > 0 && (
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

                  <div className="text-[11.5px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <span>Showing</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{filteredCampaigns.length}</span>
                    <span>of</span>
                    <span className="font-bold text-slate-800 dark:text-slate-200">{campaigns.length}</span>
                    <span>campaigns</span>
                  </div>
                </div>
              )}

              {campaigns.length === 0 ? (
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
                  {filteredCampaigns.map((campaign) => {
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
            </div>
          );
        })()
      ) : (
        // DETAILS VIEW
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white dark:bg-[#111827] p-5 rounded-2xl border border-slate-200/80 dark:border-slate-800 shadow-xs">
            <div className="flex items-center gap-3.5">
              <button 
                onClick={handleBack} 
                className="p-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all shadow-xs cursor-pointer"
                title="Back to Campaigns"
              >
                <Icons.ArrowLeft className="w-5 h-5" />
              </button>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950/60 dark:text-indigo-400 px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                    Call Campaign
                  </span>
                  <span className="text-xs font-semibold text-slate-400">
                    Created {new Date(activeCampaign.createdAt).toLocaleDateString('en-GB')}
                  </span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tight mt-0.5">
                  {activeCampaign.campaignName}
                </h2>
              </div>
            </div>

            {/* Campaign Controls & Progress */}
            <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
              {/* View Switcher */}
              <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => setViewMode('table')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'table'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Icons.Table className="w-3.5 h-3.5" />
                  Table View
                </button>
                <button
                  onClick={() => setViewMode('cards')}
                  className={`py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    viewMode === 'cards'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  <Icons.LayoutGrid className="w-3.5 h-3.5" />
                  Card View
                </button>
              </div>

              <button
                onClick={() => handleDownloadCampaign(activeCampaign.campaignName, leads)}
                className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer uppercase tracking-wider active:scale-95"
              >
                <Icons.Download className="w-3.5 h-3.5" />
                Export CSV
              </button>
              {(() => {
                const pct = activeCampaign.totalAssigned > 0 
                  ? Math.round((activeCampaign.dialed / activeCampaign.totalAssigned) * 100)
                  : 0;
                return (
                  <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2 rounded-xl min-w-[160px]">
                    <div className="flex-1">
                      <div className="flex justify-between text-[11px] font-bold mb-1">
                        <span className="text-slate-500 uppercase tracking-wider">Progress</span>
                        <span className="text-indigo-600 dark:text-indigo-400">{pct}%</span>
                      </div>
                      <div className="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
                        <div className="h-full bg-indigo-600 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>

          {/* ACTIVE CAMPAIGN METRICS GRID MATCHING REFERENCE IMAGE */}
          <div className="space-y-5">
                {/* 3 TOP METRIC CARDS MATCHING REFERENCE IMAGE */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  {/* 1. TOTAL YET TO DIAL */}
                  <div 
                    onClick={() => { setFilterTab('yetToDial'); setCurrentPage(1); }}
                    className={`p-5 rounded-2xl transition-all cursor-pointer flex items-center justify-between border ${
                      filterTab === 'yetToDial'
                        ? 'bg-amber-50/40 dark:bg-amber-950/20 border-2 border-amber-400 dark:border-amber-500 shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-amber-300 dark:hover:border-amber-700/60'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200/60 dark:border-amber-900/50 flex items-center justify-center text-amber-500 flex-shrink-0">
                        <Icons.Clock className="w-6 h-6 stroke-[2.2]" />
                      </div>
                      <div>
                        <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                          TOTAL YET TO DIAL
                        </span>
                        <span className="text-3xl font-black text-amber-500 leading-tight">
                          {yetToDialCount}
                        </span>
                      </div>
                    </div>
                    {filterTab === 'yetToDial' && (
                      <span className="bg-amber-500 text-white font-black text-[10px] px-3 py-1 rounded-full uppercase tracking-wider shadow-xs">
                        ACTIVE FILTER
                      </span>
                    )}
                  </div>

                  {/* 2. TOTAL DIALED */}
                  <div 
                    onClick={() => { setFilterTab('dialed'); setCurrentPage(1); }}
                    className={`p-5 rounded-2xl transition-all cursor-pointer flex items-center justify-between border ${
                      filterTab === 'dialed'
                        ? 'bg-emerald-50/40 dark:bg-emerald-950/20 border-2 border-emerald-400 dark:border-emerald-500 shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-emerald-300 dark:hover:border-emerald-700/60'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/60 dark:border-emerald-900/50 flex items-center justify-center text-emerald-500 flex-shrink-0">
                        <Icons.PhoneCall className="w-6 h-6 stroke-[2.2]" />
                      </div>
                      <div>
                        <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                          TOTAL DIALED
                        </span>
                        <span className="text-3xl font-black text-emerald-600 dark:text-emerald-400 leading-tight">
                          {dialedCount}
                        </span>
                      </div>
                    </div>
                    {filterTab === 'dialed' && (
                      <span className="bg-emerald-600 text-white font-black text-[10px] px-3 py-1 rounded-full uppercase tracking-wider shadow-xs">
                        ACTIVE FILTER
                      </span>
                    )}
                  </div>

                  {/* 3. TOTAL ALLOCATED */}
                  <div 
                    onClick={() => { setFilterTab('all'); setCurrentPage(1); }}
                    className={`p-5 rounded-2xl transition-all cursor-pointer flex items-center justify-between border ${
                      filterTab === 'all'
                        ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-2 border-indigo-400 dark:border-indigo-500 shadow-xs'
                        : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700/60'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200/60 dark:border-indigo-900/50 flex items-center justify-center text-indigo-500 flex-shrink-0">
                        <Icons.Layers className="w-6 h-6 stroke-[2.2]" />
                      </div>
                      <div>
                        <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                          TOTAL ALLOCATED
                        </span>
                        <span className="text-3xl font-black text-slate-900 dark:text-white leading-tight">
                          {totalAllocatedCount}
                        </span>
                      </div>
                    </div>
                    {filterTab === 'all' && (
                      <span className="bg-indigo-600 text-white font-black text-[10px] px-3 py-1 rounded-full uppercase tracking-wider shadow-xs">
                        ACTIVE FILTER
                      </span>
                    )}
                  </div>
                </div>

                {/* SEARCH & FILTER BAR MATCHING REFERENCE IMAGE */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 p-3 sm:p-4 rounded-2xl shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
                  {/* Search input */}
                  <div className="relative flex-1">
                    <Icons.Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Search leads by customer, firm, data code, mobile..."
                      className="w-full h-11 pl-10 pr-9 text-xs sm:text-sm bg-slate-50/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 transition-all"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => {
                          setSearchQuery('');
                          setCurrentPage(1);
                        }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                        title="Clear search"
                      >
                        <Icons.X className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  {/* Filter Tabs */}
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap flex-shrink-0">
                    <button
                      onClick={() => { setFilterTab('yetToDial'); setCurrentPage(1); }}
                      className={`h-11 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                        filterTab === 'yetToDial'
                          ? 'bg-amber-500 text-white shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <Icons.Clock className="w-4 h-4" />
                      <span>Yet To Dial</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
                        filterTab === 'yetToDial' ? 'bg-amber-600/50 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {yetToDialCount}
                      </span>
                    </button>

                    <button
                      onClick={() => { setFilterTab('dialed'); setCurrentPage(1); }}
                      className={`h-11 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                        filterTab === 'dialed'
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <Icons.PhoneCall className="w-4 h-4" />
                      <span>Dialed</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
                        filterTab === 'dialed' ? 'bg-emerald-700/50 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {dialedCount}
                      </span>
                    </button>

                    <button
                      onClick={() => { setFilterTab('all'); setCurrentPage(1); }}
                      className={`h-11 px-4 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer ${
                        filterTab === 'all'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 border border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      <Icons.Layers className="w-4 h-4" />
                      <span>All Leads</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-black ${
                        filterTab === 'all' ? 'bg-indigo-700/50 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                      }`}>
                        {totalAllocatedCount}
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
                            const dataCode = lead.data?.dataCode || lead.data?.data_code || lead.data?.code || (lead._id ? `LND-${lead._id.slice(-6).toUpperCase()}` : 'N/A');
                            const location = lead.data?.city || lead.data?.location || 'N/A';
                            const customer = `${lead.data?.firstName || ''} ${lead.data?.lastName || ''}`.trim() || lead.data?.customerName || lead.data?.customer || 'N/A';
                            const firmName = lead.data?.company || lead.data?.firmName || lead.data?.firm_name || 'N/A';
                            const phoneVal = lead.data?.phone || lead.data?.mobile || lead.data?.name_contact_num || 'N/A';
                            const leadCategory = leadStates[lead._id]?.leadCategory || lead.data?.leadCategory || lead.data?.lead_category || lead.data?.loanType || 'N/A';
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
                                    <span className="font-bold text-slate-900 dark:text-white block">{phoneVal}</span>
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
                                    {CAMPAIGN_STATUSES.map(statusOpt => (
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
                  /* CARD VIEW MATCHING EXACT USER SCREENSHOT (Paginated for Instant Load) */
                  <div className="space-y-5">
                    {paginatedLeads.map((lead, localIdx) => {
                      const idx = startIndex + localIdx;
                      const dataCode = lead.data?.dataCode || lead.data?.data_code || lead.data?.code || (lead._id ? `PL-DEMO-DATA-${idx + 1}` : 'N/A');
                      const customerName = `${lead.data?.firstName || ''} ${lead.data?.lastName || ''}`.trim() || lead.data?.customerName || lead.data?.customer || 'N/A';
                      const location = lead.data?.city || lead.data?.location || 'BLORE';
                      const firmName = lead.data?.company || lead.data?.firmName || lead.data?.firm_name || 'N/A';
                      const rawPhone = lead.data?.phone || lead.data?.mobile || lead.data?.contactNumber || lead.data?.name_contact_num || '';
                      const phoneDisplay = rawPhone ? rawPhone : 'XXXXXXXXXX';
                      const assignedTo = lead.data?.assignedTo || (lead as any).assignedToName || 'Pavitra P';
                      const createdDateStr = lead.data?.createdDate || lead.data?.created_at || (lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-GB') : 'N/A');

                      return (
                        <div
                          key={lead._id}
                          id={`lead-card-${lead._id}`}
                          className={`bg-white dark:bg-slate-900 rounded-2xl border-l-[5px] border-l-indigo-600 border border-slate-200/90 dark:border-slate-800 p-6 shadow-xs hover:shadow-md transition-all duration-300 space-y-5 ${
                            highlightedLeadId === lead._id
                              ? 'ring-4 ring-indigo-500/50 shadow-xl border-indigo-500 scale-[1.005]'
                              : ''
                          }`}
                        >
                          {/* Top Header Row */}
                          <div className="flex items-center justify-between pb-1">
                            <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-black bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-100 dark:border-indigo-900/50">
                              SL No. : {idx + 1}
                            </span>
                            <span className="text-xs text-slate-500 dark:text-slate-400">
                              Created Date: <strong className="text-slate-800 dark:text-slate-200 font-bold">{createdDateStr}</strong>
                            </span>
                          </div>

                          {/* 3-Column Field Grid */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-y-4 gap-x-6 text-left">
                            {/* Row 1 */}
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">DATA CODE:</span>
                              <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 tracking-tight block">{dataCode}</span>
                            </div>
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">CUSTOMER NAME:</span>
                              <span className="text-sm font-black text-slate-800 dark:text-slate-100 block">{customerName}</span>
                            </div>
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">LOCATION:</span>
                              <span className="text-sm font-black text-slate-800 dark:text-slate-100 uppercase block">{location}</span>
                            </div>

                            {/* Row 2 */}
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">FIRM NAME:</span>
                              <span className="text-sm font-black text-slate-800 dark:text-slate-100 truncate block">{firmName}</span>
                            </div>
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">STATUS:</span>
                              <div className="relative">
                                <select
                                  value={leadStates[lead._id]?.status || 'Yet To Call'}
                                  onChange={(e) => handleStatusSelect(lead, e.target.value)}
                                  className="w-full h-10 pl-3 pr-8 text-sm font-bold text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 shadow-3xs cursor-pointer uppercase appearance-none"
                                >
                                  {CAMPAIGN_STATUSES.map(st => (
                                    <option key={st} value={st}>{st.toUpperCase()}</option>
                                  ))}
                                </select>
                                <Icons.ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              </div>
                            </div>
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">CASE DETAILS:</span>
                              <input
                                type="text"
                                placeholder="Case Details"
                                value={leadStates[lead._id]?.caseDetails ?? ''}
                                onChange={(e) => handleFieldChange(lead._id, 'caseDetails', e.target.value)}
                                className="w-full h-10 px-3 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 shadow-3xs"
                              />
                            </div>

                            {/* Row 3 */}
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">LEAD CATEGORY:</span>
                              <input
                                type="text"
                                placeholder="Lead Category"
                                value={leadStates[lead._id]?.leadCategory ?? ''}
                                onChange={(e) => handleFieldChange(lead._id, 'leadCategory', e.target.value)}
                                className="w-full h-10 px-3 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 shadow-3xs"
                              />
                            </div>
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">REMARKS:</span>
                              <input
                                type="text"
                                placeholder="Remarks"
                                value={leadStates[lead._id]?.remarks ?? ''}
                                onChange={(e) => handleFieldChange(lead._id, 'remarks', e.target.value)}
                                className="w-full h-10 px-3 text-sm text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 shadow-3xs"
                              />
                            </div>
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">MOBILE NUMBER:</span>
                              <span className="text-sm font-black text-slate-800 dark:text-slate-100 block">{phoneDisplay}</span>
                            </div>

                            {/* Row 4 */}
                            <div>
                              <span className="block text-[11px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-1">ASSIGNED TO:</span>
                              <span className="text-sm font-black text-indigo-600 dark:text-indigo-400 block">{assignedTo}</span>
                            </div>
                          </div>

                          {/* Card Actions Bottom Row */}
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
                            {/* Left Side: WA CHAT & CALL */}
                            <div className="flex items-center gap-2.5">
                              <button
                                onClick={() => handleWhatsAppChat(lead)}
                                className="h-9 px-4 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-300 font-bold text-xs uppercase tracking-wider rounded-lg flex items-center gap-2 cursor-pointer transition-all shadow-3xs active:scale-95"
                              >
                                <Icons.MessageSquare className="w-4 h-4 text-emerald-600" />
                                <span>WA CHAT</span>
                              </button>
                              <button
                                onClick={() => handleInitiateCall(lead)}
                                className="h-9 px-4 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:border-blue-800 dark:text-blue-300 font-bold text-xs uppercase tracking-wider rounded-lg flex items-center gap-2 cursor-pointer transition-all shadow-3xs active:scale-95"
                              >
                                <Icons.PhoneCall className="w-4 h-4 text-blue-600" />
                                <span>CALL</span>
                              </button>
                            </div>

                            {/* Right Side: SAVE, SAVE & NEXT, EDIT */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <button
                                onClick={() => handleSaveLead(lead._id)}
                                className="h-9 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs uppercase tracking-wider rounded-lg flex items-center gap-1.5 cursor-pointer transition-all shadow-xs active:scale-95"
                                title="Save lead and view confirmation popup"
                              >
                                <Icons.Save className="w-4 h-4" />
                                <span>SAVE</span>
                              </button>
                              <button
                                onClick={() => navigate(`/modules/leads/${lead._id}`)}
                                className="h-9 px-3.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700 font-bold text-xs uppercase tracking-wider rounded-lg flex items-center gap-1.5 cursor-pointer transition-all shadow-3xs active:scale-95"
                              >
                                <Icons.Edit className="w-3.5 h-3.5" />
                                <span>EDIT</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* BOTTOM PAGINATION CONTROLS BAR */}
                {filteredLeads.length > 0 && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 px-5 py-3.5 rounded-2xl shadow-xs flex flex-col sm:flex-row items-center justify-between gap-4 mt-4">
                    {/* Left: Summary text */}
                    <div className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                      Showing <span className="font-bold text-slate-800 dark:text-slate-200">{startIndex + 1}</span> to{' '}
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {Math.min(startIndex + pageSize, filteredLeads.length)}
                      </span>{' '}
                      of <span className="font-bold text-indigo-600 dark:text-indigo-400">{filteredLeads.length}</span> leads
                    </div>

                    {/* Center: Per Page selector */}
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                      <span>Rows per page:</span>
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                        className="h-8 px-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-800 dark:text-slate-200 font-bold focus:outline-none focus:border-indigo-500 cursor-pointer"
                      >
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={200}>200</option>
                      </select>
                    </div>

                    {/* Right: Page navigation buttons */}
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setCurrentPage(1)}
                        disabled={safeCurrentPage === 1}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1"
                        title="First Page"
                      >
                        <Icons.ChevronsLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={safeCurrentPage === 1}
                        className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1"
                      >
                        <Icons.ChevronLeft className="w-4 h-4" />
                        <span>Prev</span>
                      </button>

                      <span className="px-3 text-xs font-bold text-slate-700 dark:text-slate-200">
                        Page <strong className="text-indigo-600 dark:text-indigo-400 font-black">{safeCurrentPage}</strong> of{' '}
                        <strong>{totalPages}</strong>
                      </span>

                      <button
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={safeCurrentPage === totalPages}
                        className="h-8 px-3 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1"
                      >
                        <span>Next</span>
                        <Icons.ChevronRight className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={safeCurrentPage === totalPages}
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-600 dark:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1"
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
    </div>
  );
}
