import * as XLSX from 'xlsx';

export interface FunnelExportData {
  period: string;
  datePreset: string;
  dateRange: {
    startDate: string;
    endDate: string;
    formatted: string;
  };
  previousDateRange?: {
    startDate: string;
    endDate: string;
    formatted: string;
  };
  summary: {
    totalLeads: number;
    newLeads: number;
    activeLeads: number;
    convertedLeads: number;
    lostLeads: number;
    overallConversionRate: number;
    comparison?: {
      previousTotalLeads: number;
      previousConvertedLeads: number;
      previousConversionRate: number;
      leadGrowthPct: number;
      conversionRateDiff: number;
    };
  };
  funnelStages: Array<{
    order: number;
    name: string;
    count: number;
    percentage: number;
    progressionRate: number;
    dropOffRate: number;
  }>;
  leads: any[];
}

export const exportFunnelAnalyticsXLSX = (data: FunnelExportData) => {
  const wb = XLSX.utils.book_new();

  // 1. Summary Sheet
  const summaryRows: any[][] = [
    ['CRM SALES FUNNEL & CONVERSION ANALYTICS REPORT'],
    ['Generated On', new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })],
    ['Period', data.period.toUpperCase()],
    ['Date Preset', data.datePreset.replace(/_/g, ' ').toUpperCase()],
    ['Selected Date Range', data.dateRange.formatted],
    ['Previous Date Range', data.previousDateRange?.formatted || 'N/A'],
    [],
    ['KEY PERFORMANCE INDICATORS (KPIs)'],
    ['Metric', 'Current Period', 'Previous Period', 'Growth / Delta'],
    [
      'Total Leads',
      data.summary.totalLeads,
      data.summary.comparison?.previousTotalLeads ?? 'N/A',
      `${data.summary.comparison?.leadGrowthPct ?? 0}%`
    ],
    ['New Leads', data.summary.newLeads, '-', '-'],
    ['Active Pipeline Leads', data.summary.activeLeads, '-', '-'],
    [
      'Converted / Won Leads',
      data.summary.convertedLeads,
      data.summary.comparison?.previousConvertedLeads ?? 'N/A',
      '-'
    ],
    ['Lost / Dropped Leads', data.summary.lostLeads, '-', '-'],
    [
      'Overall Conversion Rate',
      `${data.summary.overallConversionRate}%`,
      `${data.summary.comparison?.previousConversionRate ?? 0}%`,
      `${data.summary.comparison?.conversionRateDiff ?? 0}% diff`
    ]
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary KPIs');

  // 2. Stage Progression Sheet
  const stageHeaders = [
    'Stage #',
    'Pipeline Stage Name',
    'Lead Count',
    '% of Total Leads',
    'Progression Rate to Next Stage',
    'Stage Drop-Off Rate'
  ];

  const stageRows = (data.funnelStages || []).map((st) => [
    st.order,
    st.name,
    st.count,
    `${st.percentage}%`,
    `${st.progressionRate}%`,
    `${st.dropOffRate}%`
  ]);

  const wsStages = XLSX.utils.aoa_to_sheet([
    ['PIPELINE STAGE PROGRESSION & DROP-OFF CONVERSION MATRIX'],
    [`Period: ${data.period.toUpperCase()} (${data.dateRange.formatted})`],
    [],
    stageHeaders,
    ...stageRows
  ]);
  XLSX.utils.book_append_sheet(wb, wsStages, 'Stage Conversion Matrix');

  // 3. Lead Details Sheet
  const leadHeaders = [
    'SI No.',
    'Lead No.',
    'Customer / Lead Name',
    'Company / Firm',
    'Mobile Number',
    'Email Address',
    'Loan Product',
    'Loan Amount',
    'Bank Partner',
    'Assigned Agent',
    'Lead Source',
    'Current Stage / Status',
    'Created Date',
    'Follow-up Date'
  ];

  const leadRows = (data.leads || []).map((lead, idx) => {
    return [
      idx + 1,
      lead.leadNo || `LEAD-${idx + 1}`,
      lead.customerName || 'N/A',
      lead.companyName || '—',
      lead.mobile || '—',
      lead.email || '—',
      lead.loanType || '—',
      lead.loanAmount || '—',
      lead.bankPartner || '—',
      lead.assignedTo || 'Unassigned',
      lead.source || '—',
      lead.status || lead.stage || '—',
      lead.createdAt ? new Date(lead.createdAt).toLocaleDateString('en-IN') : '—',
      lead.followupDate || '—'
    ];
  });

  const wsLeads = XLSX.utils.aoa_to_sheet([
    ['DETAILED FUNNEL LEAD RECORDS'],
    [`Period: ${data.period.toUpperCase()} (${data.dateRange.formatted}) | Total Records: ${data.leads?.length || 0}`],
    [],
    leadHeaders,
    ...leadRows
  ]);
  XLSX.utils.book_append_sheet(wb, wsLeads, 'Lead Records');

  const filename = `CRM_Funnel_Report_${data.period}_${data.datePreset}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
};
