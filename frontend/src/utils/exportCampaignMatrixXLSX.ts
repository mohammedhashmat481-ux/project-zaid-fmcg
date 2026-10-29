import * as XLSX from 'xlsx';

export interface CampaignMatrixRow {
  callerName: string;
  data: Record<string, number>;
  total: number;
}

export interface CampaignMatrixData {
  columns: string[];
  rows: CampaignMatrixRow[];
  totals: Record<string, number>;
  grandTotal: number;
}

export interface CampaignSummaryData {
  callsMade: number;
  hotLeads: number;
  logins: number;
  approved: number;
  disbursed: number;
  targetAchievement: number;
  // Legacy fields preserved for backward compatibility
  campaignsAssigned?: number;
  totalLeadsAssigned?: number;
  leadsCalled?: number;
  yetToCall?: number;
  progressPct?: number;
}

/**
 * Exports the Daily, Monthly, or Annual Calling Matrix table matching Image 4
 */
export const exportCampaignMatrixXLSX = (
  matrix: CampaignMatrixData,
  metricTitle: string = 'Calls Made',
  period: string = 'Daily',
  campaignName: string = 'ALL'
) => {
  const { columns, rows, totals, grandTotal } = matrix;

  // Header row matching Image 4
  const headers = ['Caller Name', ...columns, 'Total'];

  // Data rows
  const dataRows: (string | number)[][] = rows.map((r) => {
    const rowValues = columns.map((col) => {
      const val = r.data[col];
      // In Excel sheet, if 0, show empty string or 0 based on style
      return val !== undefined && val !== null ? val : '';
    });
    return [r.callerName, ...rowValues, r.total];
  });

  // Summary footer row
  const footerRow: (string | number)[] = [
    'Total',
    ...columns.map((col) => totals[col] ?? 0),
    grandTotal
  ];

  const fullData = [headers, ...dataRows, footerRow];

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(fullData);

  // Set column widths
  const colWidths = [
    { wch: 26 }, // Caller Name
    ...columns.map(() => ({ wch: 9 })), // Day / Month columns
    { wch: 12 } // Total
  ];
  ws['!cols'] = colWidths;

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `${period} Matrix`);

  // Format filename
  const cleanCamp = campaignName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const cleanMetric = metricTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const now = new Date();
  const dateStamp = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}`;
  const filename = `Campaign_${period}_Matrix_${cleanMetric}_${cleanCamp}_${dateStamp}.xlsx`;

  XLSX.writeFile(wb, filename);
};

/**
 * Exports individual KPI dataset when clicking the pill download button on any of the 6 cards in Image 5
 */
export const exportCampaignKPIDataset = (
  kpiType: 'dials' | 'hot' | 'logins' | 'approved' | 'disbursed' | 'target' | 'campaigns' | 'leads' | 'called' | 'pending' | 'progress',
  summary: CampaignSummaryData,
  matrix: CampaignMatrixData,
  campaignName: string = 'ALL'
) => {
  const wb = XLSX.utils.book_new();
  const now = new Date();
  const dateStamp = `${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}_${String(now.getDate()).padStart(2, '0')}`;

  if (kpiType === 'dials') {
    exportCampaignMatrixXLSX(matrix, 'Calls Made', 'Daily', campaignName);
    return;
  }

  if (kpiType === 'hot') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Hot Leads Count'];
    const rows = matrix.rows.map((r, i) => [i + 1, r.callerName, r.total]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Hot Leads');
    XLSX.writeFile(wb, `Hot_Leads_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'logins') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Logins Count'];
    const rows = matrix.rows.map((r, i) => [i + 1, r.callerName, r.total]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Logins');
    XLSX.writeFile(wb, `Logins_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'approved') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Approved Leads'];
    const rows = matrix.rows.map((r, i) => [i + 1, r.callerName, r.total]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Approved Leads');
    XLSX.writeFile(wb, `Approved_Leads_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'disbursed') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Disbursed Loans'];
    const rows = matrix.rows.map((r, i) => [i + 1, r.callerName, r.total]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Disbursed Loans');
    XLSX.writeFile(wb, `Disbursed_Loans_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'target') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Target Achievement %'];
    const rows = matrix.rows.map((r, i) => [i + 1, r.callerName, `${r.total}%`]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 24 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Target Achievement');
    XLSX.writeFile(wb, `Target_Achievement_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'campaigns') {
    const headers = ['Sl.No.', 'Campaign Metric', 'Value'];
    const rows = [
      [1, 'Calls Made', summary.callsMade],
      [2, 'Hot Leads', summary.hotLeads],
      [3, 'Logins', summary.logins],
      [4, 'Approved', summary.approved],
      [5, 'Disbursed', summary.disbursed],
      [6, 'Target Achievement', `${summary.targetAchievement}%`]
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 15 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Campaign Summary');
    XLSX.writeFile(wb, `Campaign_Summary_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'leads') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Total Assigned Leads'];
    const rows = matrix.rows.map((r, i) => [
      i + 1,
      r.callerName,
      r.total
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Assigned Leads');
    XLSX.writeFile(wb, `Total_Leads_Assigned_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'called') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Leads Called'];
    const rows = matrix.rows.map((r, i) => [
      i + 1,
      r.callerName,
      r.total
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Leads Called');
    XLSX.writeFile(wb, `Leads_Called_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'pending') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Pending Leads (Yet To Call)'];
    const rows = matrix.rows.map((r, i) => [
      i + 1,
      r.callerName,
      r.total
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Pending Leads');
    XLSX.writeFile(wb, `Yet_To_Call_Report_${dateStamp}.xlsx`);
    return;
  }

  if (kpiType === 'progress') {
    const headers = ['Sl.No.', 'Telecaller Name', 'Performance Metric'];
    const rows = matrix.rows.map((r, i) => [
      i + 1,
      r.callerName,
      r.total
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = [{ wch: 8 }, { wch: 26 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Progress Summary');
    XLSX.writeFile(wb, `Campaign_Progress_Report_${dateStamp}.xlsx`);
  }
};
