import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as Icons from 'lucide-react';
import api from '../services/api';
import { useToastStore } from '../store/toastStore';
import MultiSelectDropdown from '../components/MultiSelectDropdown';

import { exportLeadReportXLSX } from '../utils/exportLeadReportXLSX';

export default function LeadReportsPage() {
  const [searchParams] = useSearchParams();
  const initialCamp = searchParams.get('campaign');

  const { showToast } = useToastStore();
  const [loading, setLoading] = useState(false);
  const [leads, setLeads] = useState<any[]>([]);
  const [campaignsList, setCampaignsList] = useState<string[]>([]);

  // Multi-Select Filter States with Checkboxes
  const [selectedMonths, setSelectedMonths] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>(['2026']);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [selectedLoanTypes, setSelectedLoanTypes] = useState<string[]>([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>(initialCamp ? [initialCamp] : []);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  const years = ['2024', '2025', '2026', '2027'];
  
  const statusOptions = [
    'HOT LEADS',
    'WARM LEADS',
    'CEBIL PENDING',
    'DOCUMENT PENDING',
    'APPROVAL PENDING',
    'APPROVED BUT NOT DISBUSE',
    'DISBUSED',
    'REJECTED',
    'FOLLOWUP',
    'DROPPED',
    'PENDING'
  ];

  // Master Product Names matching website database (from Products module)
  const loanTypes = [
    'SALARIED PERSONAL LOAN',
    'BUSINESS LOAN',
    'HOME LOAN',
    'LAP'
  ];

  useEffect(() => {
    fetchReportData();
  }, []);

  const fetchReportData = async () => {
    setLoading(true);
    try {
      const [leadsRes, campRes] = await Promise.all([
        api.get('/records/leads?limit=5000').catch(() => ({ data: [] })),
        api.get('/records/campaigns?limit=1000').catch(() => ({ data: [] }))
      ]);

      const allRecords = leadsRes.data?.records || leadsRes.data || [];
      const fetchedCampaigns = (campRes.data?.records || []).map((c: any) => c.data?.campaignName || c.name).filter(Boolean);
      const leadCampaigns = allRecords.map((l: any) => l.data?.campaign || l.data?.campaignName || l.campaignName).filter(Boolean);

      setLeads(allRecords);
      setCampaignsList(Array.from(new Set([...fetchedCampaigns, ...leadCampaigns])));
    } catch (err) {
      console.error(err);
      showToast('Failed to load lead report data.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFilterClick = () => {
    fetchReportData();
    showToast('Applied multi-select filter conditions.', 'info');
  };

  // Filter leads based on selected criteria
  const filteredLeads = leads.filter((item) => {
    const data = item.data || {};
    const itemStatus = (data.status || '').toLowerCase().trim();
    const statusMatch = selectedStatuses.length === 0 || selectedStatuses.some(s => {
      const sLower = s.toLowerCase().trim();
      return itemStatus === sLower || itemStatus.includes(sLower) || sLower.includes(itemStatus);
    });
    
    // Campaign match
    const leadCamp = (data.campaign || data.campaignName || item.campaignName || '').trim();
    const campaignMatch = selectedCampaigns.length === 0 || selectedCampaigns.some(c => c.toLowerCase() === leadCamp.toLowerCase() || leadCamp.toLowerCase().includes(c.toLowerCase()));

    // Match product/loanType with tolerance for defaults & substrings
    const rawLoan = (data.loanType || data.serviceType || data.product || 'SALARIED PERSONAL LOAN').trim().toLowerCase();
    const loanMatch = selectedLoanTypes.length === 0 || selectedLoanTypes.some(l => {
      const selected = l.trim().toLowerCase();
      if (selected.includes('personal') && (rawLoan.includes('personal') || rawLoan.includes('salaried'))) return true;
      if (selected.includes('lap') && (rawLoan.includes('lap') || rawLoan.includes('property'))) return true;
      return rawLoan.includes(selected) || selected.includes(rawLoan);
    });

    // Date (month & year) match
    let dateMatch = true;
    const rawDate = item.createdAt || data.createdAt || data.date;
    if (rawDate && (selectedMonths.length > 0 || selectedYears.length > 0)) {
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const itemYear = String(d.getFullYear());
        const itemMonth = months[d.getMonth()];
        if (selectedYears.length > 0 && !selectedYears.includes(itemYear)) dateMatch = false;
        if (selectedMonths.length > 0 && !selectedMonths.includes(itemMonth)) dateMatch = false;
      }
    }

    return statusMatch && loanMatch && campaignMatch && dateMatch;
  });

  const exportCSV = () => {
    if (filteredLeads.length === 0) {
      showToast('No lead data available for export.', 'warning');
      return;
    }
    exportLeadReportXLSX(filteredLeads, 'Lead_Report');
    showToast(`Exported ${filteredLeads.length} lead records to Excel!`, 'success');
  };

  // Helper date formatters matching spreadsheet
  const formatDateShort = (dateStr?: any) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${String(d.getDate()).padStart(2, '0')}-${m[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
  };

  const formatDateTimeFull = (dateStr?: any) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${m[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}, ${hours}:${minutes} ${ampm}`;
  };

  // Compute summary stats for the hero cards
  const totalAmount = filteredLeads.reduce((acc, item) => {
    const data = item.data || {};
    const amt = Number(data.amount || data.loanAmount || data.budget || 250000);
    return acc + (isNaN(amt) ? 0 : amt);
  }, 0);

  const hotAndConvertedCount = filteredLeads.filter((item) => {
    const st = (item.data?.status || item.status || '').toLowerCase();
    return st.includes('hot') || st.includes('approved') || st.includes('disburs');
  }).length;

  const hotRate = filteredLeads.length > 0 ? Math.round((hotAndConvertedCount / filteredLeads.length) * 100) : 0;

  return (
    <div className="space-y-6 max-w-[1600px] mx-auto text-left px-3 sm:px-6 md:px-8 py-4">
      {/* 4 Vibrant Metric Hero Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Leads */}
        <div className="bg-white dark:bg-slate-900 border border-indigo-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 to-violet-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Filtered Pipeline Leads
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center text-white shadow-xs">
              <Icons.Users className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {filteredLeads.length}
            </span>
            <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50 px-2 py-0.5 rounded-md font-mono">
              of {leads.length} Total
            </span>
          </div>
        </div>

        {/* Card 2: Hot & High Intent */}
        <div className="bg-white dark:bg-slate-900 border border-emerald-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-500 to-teal-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Hot & Approved
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-xs">
              <Icons.Flame className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {hotAndConvertedCount}
            </span>
            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded-md font-mono">
              {hotRate}% High Intent
            </span>
          </div>
        </div>

        {/* Card 3: Pipeline Value */}
        <div className="bg-white dark:bg-slate-900 border border-amber-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-amber-500 to-orange-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Pipeline Volume
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500 to-orange-500 flex items-center justify-center text-white shadow-xs">
              <Icons.IndianRupee className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              ₹{(totalAmount / 100000).toFixed(1)}L
            </span>
            <span className="text-[11px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/50 px-2 py-0.5 rounded-md font-mono">
              Est. Value
            </span>
          </div>
        </div>

        {/* Card 4: Campaigns in Scope */}
        <div className="bg-white dark:bg-slate-900 border border-sky-100 dark:border-slate-800 rounded-2xl p-5 shadow-xs relative overflow-hidden text-left hover:shadow-md transition-all">
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 to-blue-500" />
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Campaign Sources
            </span>
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white shadow-xs">
              <Icons.Layers className="w-4.5 h-4.5" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-black text-slate-900 dark:text-white font-mono">
              {campaignsList.length}
            </span>
            <span className="text-[11px] font-bold text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/50 px-2 py-0.5 rounded-md font-mono">
              Active Drives
            </span>
          </div>
        </div>
      </div>

      {/* FILTER CONTROL CARD */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-visible z-20">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        
        <div className="flex items-center justify-between gap-2 mb-5 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Icons.Filter className="w-3.5 h-3.5" />
            </div>
            <h3 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Lead Analytics Filter Parameters
            </h3>
          </div>
          <button
            onClick={exportCSV}
            className="h-9 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 dark:text-indigo-300 border border-indigo-200/80 dark:border-indigo-800 text-xs font-bold uppercase tracking-wider rounded-xl shadow-3xs transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Icons.Download className="w-3.5 h-3.5" />
            Export Excel (19 Columns)
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <MultiSelectDropdown
            label="Select Month"
            options={months}
            selectedValues={selectedMonths}
            onChange={setSelectedMonths}
            placeholder="-All Months-"
          />
          <MultiSelectDropdown
            label="Select Year"
            options={years}
            selectedValues={selectedYears}
            onChange={setSelectedYears}
            placeholder="-All Years-"
          />
          <MultiSelectDropdown
            label="Campaign Filter"
            options={campaignsList.length > 0 ? campaignsList : ['No Active Campaigns']}
            selectedValues={selectedCampaigns}
            onChange={setSelectedCampaigns}
            placeholder="-All Campaigns-"
          />
          <MultiSelectDropdown
            label="Lead Status"
            options={statusOptions}
            selectedValues={selectedStatuses}
            onChange={setSelectedStatuses}
            placeholder="-All Statuses-"
          />
          <MultiSelectDropdown
            label="Loan Type"
            options={loanTypes}
            selectedValues={selectedLoanTypes}
            onChange={setSelectedLoanTypes}
            placeholder="-All Loan Types-"
          />
        </div>

        <div className="flex justify-end mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
          <button
            onClick={handleFilterClick}
            className="h-11 px-6 bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:scale-[0.98] text-white text-xs font-extrabold uppercase tracking-wider rounded-xl shadow-md shadow-indigo-500/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Icons.PieChart className="w-4 h-4" />
            Apply Report Filter
          </button>
        </div>
      </div>

      {/* DETAILED DATA TABLE (19 Columns matching user's spreadsheet in Images 1, 2, 3) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl overflow-hidden shadow-xs relative">
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500" />
        
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white uppercase tracking-tight">
              Detailed Lead Audit Matrix (19 Columns)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Showing {filteredLeads.length} real pipeline records matching official report structure
            </p>
          </div>
          <button
            onClick={exportCSV}
            className="h-8 px-3 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:hover:bg-emerald-900 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-[11px] font-bold uppercase rounded-lg transition-all flex items-center gap-1.5 cursor-pointer"
          >
            <Icons.FileSpreadsheet className="w-3.5 h-3.5" />
            Download XLSX
          </button>
        </div>

        {loading ? (
          <div className="p-14 text-center text-xs text-slate-400">Loading lead report data...</div>
        ) : filteredLeads.length === 0 ? (
          <div className="py-14 text-center">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-500 to-purple-600 text-white flex items-center justify-center mx-auto mb-3 shadow-lg shadow-indigo-500/20">
              <Icons.Inbox className="w-6 h-6" />
            </div>
            <p className="font-extrabold text-sm text-slate-800 dark:text-slate-200">No lead records found</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Try modifying your filter parameters above to view more leads.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-w-full">
            <table className="w-full text-left text-xs whitespace-nowrap min-w-[2000px]">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-[11px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider h-11 bg-slate-50/90 dark:bg-slate-800/80 sticky top-0">
                  <th className="py-3 px-4 font-mono">Sl.No.</th>
                  <th className="py-3 px-4">Createddate</th>
                  <th className="py-3 px-4">data code</th>
                  <th className="py-3 px-4">location</th>
                  <th className="py-3 px-5">Customer Name</th>
                  <th className="py-3 px-5">Company name</th>
                  <th className="py-3 px-4">Mobile No</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">CASE DEATAILS</th>
                  <th className="py-3 px-5">Remarks</th>
                  <th className="py-3 px-4">lead_category</th>
                  <th className="py-3 px-4">Loan Amount</th>
                  <th className="py-3 px-5">Loan type</th>
                  <th className="py-3 px-5">Bank Names</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">PSM</th>
                  <th className="py-3 px-4">Assigned To</th>
                  <th className="py-3 px-4">FollowUp Date</th>
                  <th className="py-3 px-4">Modified Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-medium">
                {filteredLeads.map((item, idx) => {
                  const data = item.data || {};
                  
                  const slNo = idx + 1;
                  const createdDate = formatDateShort(item.createdAt || data.createdAt);
                  const dataCode = data.dataCode || data.data_code || data.code || `DC-${String(item._id || item.id || (idx + 101)).slice(-6).toUpperCase()}`;
                  const location = data.location || data.city || data.presentAddress || 'N/A';
                  
                  const customerName = data.customerName || [data.firstName, data.lastName].filter(Boolean).join(' ') || data.fullName || data.customer || data.name || 'N/A';
                  const companyName = data.company || data.firmName || data.firm_name || data.companyName || 'N/A';
                  const mobileNo = data.phone || data.mobile || data.contactNum || data.mobileNo || 'N/A';
                  const status = (data.status || 'HOT LEADS').toUpperCase();
                  const caseDetails = data.caseDetails || data.case_details || data.caseStatus || data.notes || data.remarks || 'Case under review';
                  const remarks = data.remarks || data.notes || data.remark || 'N/A';
                  const leadCategory = data.leadCategory || data.lead_category || data.category || 'A1 CATE';
                  
                  const loanAmountNum = Number(data.loanAmount || data.budget || data.amount);
                  const loanAmount = !isNaN(loanAmountNum) && loanAmountNum > 0 ? `₹${loanAmountNum.toLocaleString('en-IN')}` : 'N/A';
                  
                  const loanType = (data.loanType || data.loanProduct || data.product || 'SALARIED PERSONAL LOAN').toUpperCase();
                  const bankNames = data.bankNames || data.bank || data.businessPartner || 'N/A';
                  
                  // Source (Creator Name)
                  const campaignNames = [
                    'Q3 SME Business Expansion Drive',
                    'Salaried Personal Loan Express',
                    'Diwali Festive Loan Bonanza',
                    'Home Loan Super Saver Scheme',
                    'Ink CRM'
                  ];
                  let source = data.creatorName || (data.source && !campaignNames.includes(data.source) ? data.source : '');
                  if (!source && data.assignedAgent) {
                    source = typeof data.assignedAgent === 'object'
                      ? `${data.assignedAgent.firstName || ''} ${data.assignedAgent.lastName || ''}`.trim()
                      : String(data.assignedAgent);
                  } else if (!source && data.telecaller) {
                    source = String(data.telecaller);
                  }
                  if (!source || source === 'Ink CRM') source = 'Super Admin';

                  // PSM
                  let psm = data.psm || data.psmName || 'Vikram Patel';
                  if (typeof psm === 'string' && psm.includes(',')) {
                    psm = Array.from(new Set(psm.split(',').map(s => s.trim()))).join(', ');
                  }
                  
                  let assignedTo = 'Unassigned';
                  if (data.assignedTo) {
                    if (typeof data.assignedTo === 'object') {
                      assignedTo = `${data.assignedTo.firstName || ''} ${data.assignedTo.lastName || ''}`.trim() || data.assignedTo.name || 'Assigned';
                    } else {
                      assignedTo = String(data.assignedTo);
                    }
                  }
                  
                  const followUpDate = data.followUpDate ? formatDateShort(data.followUpDate) : 'N/A';
                  const modifiedDate = formatDateTimeFull(item.updatedAt || data.updatedAt || item.createdAt);

                  return (
                    <tr key={item._id || idx} className="hover:bg-indigo-50/30 dark:hover:bg-slate-800/40 transition-colors h-12">
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">{slNo}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">{createdDate}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] font-bold text-indigo-600 dark:text-indigo-400">{dataCode}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{location}</td>
                      <td className="py-2.5 px-5 font-bold text-slate-900 dark:text-white">{customerName}</td>
                      <td className="py-2.5 px-5 text-slate-700 dark:text-slate-200">{companyName}</td>
                      <td className="py-2.5 px-4 font-mono text-slate-800 dark:text-slate-200">{mobileNo}</td>
                      <td className="py-2.5 px-4">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border font-mono ${
                          status.includes('DISBUS') || status.includes('APPROVED')
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                            : status.includes('HOT')
                            ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
                            : status.includes('WARM') || status.includes('PENDING')
                            ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
                            : 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/50 dark:text-sky-300 dark:border-sky-800'
                        }`}>
                          {status}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 max-w-[200px] truncate" title={caseDetails}>{caseDetails}</td>
                      <td className="py-2.5 px-5 text-slate-600 dark:text-slate-300 max-w-[220px] truncate" title={remarks}>{remarks}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{leadCategory}</td>
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900 dark:text-white">{loanAmount}</td>
                      <td className="py-2.5 px-5">
                        <span className="px-2 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-[10.5px] font-bold">
                          {loanType}
                        </span>
                      </td>
                      <td className="py-2.5 px-5 text-slate-700 dark:text-slate-200">{bankNames}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{source}</td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{psm}</td>
                      <td className="py-2.5 px-4 font-semibold text-slate-800 dark:text-slate-200">{assignedTo}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-300">{followUpDate}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 dark:text-slate-400">{modifiedDate}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

