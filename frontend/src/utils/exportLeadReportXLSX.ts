import * as XLSX from 'xlsx';

export const exportLeadReportXLSX = (leads: any[], fileNamePrefix: string = 'Lead_Report') => {
  // Exact 19 Columns matching user specification and screenshots (Images 1, 2, 3)
  const headers = [
    'Sl.No.:',
    'Createddate',
    'data code',
    'location',
    'Customer Name',
    'Company name',
    'Mobile No',
    'Status',
    'CASE DEATAILS',
    'Remarks',
    'lead_category',
    'Loan Amount',
    'Loan type',
    'Bank Names',
    'Source',
    'PSM',
    'Assigned To',
    'FollowUp Date',
    'Modified Date'
  ];

  const formatDateShort = (dateStr?: any) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  };

  const formatDateTimeFull = (dateStr?: any) => {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = d.getDate();
    const year = d.getFullYear();
    let hours = d.getHours();
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return `${month} ${day} ${year}, ${hours}:${minutes} ${ampm}`;
  };

  const formatCurrency = (val: any) => {
    if (val === undefined || val === null || val === '') return 'N/A';
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const dataRows = (leads || []).map((lead: any, idx: number) => {
    const data = lead.data || lead;
    const slNo = idx + 1;
    const createdDate = formatDateShort(lead.createdAt || data.createdAt || data.createddate);

    const dataCode = String(data.dataCode || data.data_code || data.code || 'N/A').trim();
    const location = String(data.location || data.city || data.presentAddress || 'N/A').trim();

    const customerName = String(
      `${data.firstName || ''} ${data.lastName || ''}`.trim() ||
      data.customerName ||
      data.fullName ||
      data.customer ||
      data.costomer ||
      data.name ||
      'N/A'
    ).trim();

    const companyName = String(data.company || data.firmName || data.firm_name || data.firm || data.companyName || 'N/A').trim();
    const mobileNo = String(data.phone || data.mobile || data.contactNum || data.contact_num || data.mobileNo || 'N/A').trim();
    const status = String(data.status || 'HOT LEADS').trim().toUpperCase();
    const caseDetails = String(data.caseDetails || data.case_details || data.caseStatus || data.case_status || 'N/A').trim();
    const remarks = String(data.remarks || data.notes || data.remark || 'N/A').trim();
    const leadCategory = String(data.leadCategory || data.lead_category || data.category || 'N/A').trim();

    const loanAmountRaw = data.loanAmount || data.budget || data.amount || data.requiredLoan;
    const loanAmount = formatCurrency(loanAmountRaw);

    const loanType = String(data.loanType || data.loanProduct || data.product || data.serviceType || 'SALARIED PERSONAL LOAN').trim().toUpperCase();
    const bankNames = String(data.bankNames || data.bank || data.businessPartner || data.preferredBank || 'N/A').trim();
    const source = String(data.source || data.creatorName || data.assignedAgent || 'Ink CRM').trim();
    const psm = String(data.psm || data.psmName || data.psm_name || 'N/A').trim();

    let assignedTo = 'Unassigned';
    if (data.assignedTo) {
      if (typeof data.assignedTo === 'object') {
        assignedTo = `${data.assignedTo.firstName || ''} ${data.assignedTo.lastName || ''}`.trim() || data.assignedTo.name || data.assignedTo.email || 'Assigned';
      } else {
        assignedTo = String(data.assignedTo);
      }
    } else if (lead.assignedToUser) {
      assignedTo = `${lead.assignedToUser.firstName || ''} ${lead.assignedToUser.lastName || ''}`.trim();
    } else if (lead.assignedToName) {
      assignedTo = String(lead.assignedToName);
    }

    const followUpDate = data.followUpDate ? formatDateShort(data.followUpDate) : 'N/A';
    const modifiedDate = formatDateTimeFull(lead.updatedAt || data.updatedAt || lead.createdAt);

    return {
      'Sl.No.:': slNo,
      'Createddate': createdDate,
      'data code': dataCode,
      'location': location,
      'Customer Name': customerName,
      'Company name': companyName,
      'Mobile No': mobileNo,
      'Status': status,
      'CASE DEATAILS': caseDetails,
      'Remarks': remarks,
      'lead_category': leadCategory,
      'Loan Amount': loanAmount,
      'Loan type': loanType,
      'Bank Names': bankNames,
      'Source': source,
      'PSM': psm,
      'Assigned To': assignedTo,
      'FollowUp Date': followUpDate,
      'Modified Date': modifiedDate
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(dataRows, { header: headers });

  // Dynamic column widths calculation
  const colWidths = headers.map(header => {
    let maxLen = header.length;
    dataRows.forEach(row => {
      const val = row[header as keyof typeof row];
      if (val !== undefined && val !== null) {
        maxLen = Math.max(maxLen, String(val).length);
      }
    });
    return { wch: Math.max(maxLen + 4, 14) };
  });

  // Explicit string formatting for Mobile No to prevent scientific notation (9.6E+09)
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const mobileColIdx = headers.indexOf('Mobile No');

  if (mobileColIdx !== -1) {
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: mobileColIdx });
      const cell = worksheet[cellAddress];
      if (cell) {
        cell.t = 's'; // Force STRING cell type
        cell.z = '@'; // Force Text format
      }
    }
  }

  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lead Report');

  const cleanPrefix = (fileNamePrefix || 'Lead_Report').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const dateStamp = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `${cleanPrefix}_${dateStamp}.xlsx`);
};
