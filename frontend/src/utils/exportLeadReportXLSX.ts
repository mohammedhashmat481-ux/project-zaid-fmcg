import * as XLSX from 'xlsx';

export const exportLeadReportXLSX = (leads: any[], fileNamePrefix: string = 'Lead_Report') => {
  // Exact 19 Columns matching user specification and screenshots (Images 1, 2, 3)
  const headers = [
    'Sl.No.',
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
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const year = String(d.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  };

  const formatDateTimeFull = (dateStr?: any) => {
    if (!dateStr) return '';
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
    if (val === undefined || val === null || val === '') return '';
    const num = Number(val);
    if (isNaN(num)) return String(val);
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const cleanVal = (val: any) => {
    if (val === undefined || val === null) return '';
    const s = String(val).trim();
    if (s === 'N/A' || s === 'undefined' || s === 'null') return '';
    return s;
  };

  const isLeadDialed = (lead: any, data: any) => {
    if (data.dialedAt || data.lastCallDate) return true;
    if (data.callAttempts && Number(data.callAttempts) > 0) return true;
    const dialSt = (data.dialStatus || '').toString().trim().toLowerCase();
    if (dialSt && dialSt !== 'yet to call' && dialSt !== 'not called' && dialSt !== 'new' && dialSt !== 'yet to dial' && dialSt !== '') return true;
    const st = (data.status || '').toString().trim().toLowerCase();
    if (st && st !== 'yet to call' && st !== 'not called' && st !== 'new' && st !== 'yet to dial' && st !== '') return true;
    return false;
  };

  const dataRows = (leads || []).map((lead: any, idx: number) => {
    const data = lead.data || lead;
    const slNo = idx + 1;
    const isDialed = isLeadDialed(lead, data);

    const campName = data.campaignName || data.campaign || (data.source && data.source.includes('DEMO') ? data.source : '') || fileNamePrefix;
    const cleanCamp = campName ? String(campName).trim().toUpperCase().replace(/[^A-Z0-9]/g, '-').replace(/-+/g, '-') : 'CAMPAIGN';
    const rawDc = cleanVal(data.dataCode || data.data_code || data.code);
    const dataCode = rawDc || `${cleanCamp}-DATA-${idx + 1}`;

    const location = cleanVal(data.location || data.city || data.presentAddress);

    // Robust Customer Name resolution: check all possible keys and strip any "Unnamed" / "N/A" defaults
    let rawCustomer = '';
    const nameCandidates = [
      data.customerName,
      data.customer_name,
      data['Customer Name'],
      data['Customer name'],
      data['customer name'],
      data['CUSTOMER NAME'],
      data.clientName,
      data['Client Name'],
      data.partyName,
      data['Party Name'],
      data.leadName,
      data['Lead Name'],
      data.applicantName,
      data['Applicant Name'],
      data.borrowerName,
      data['Borrower Name'],
      data.fullName,
      data.name,
      data.customer,
      `${data.firstName || ''} ${data.lastName || ''}`.trim()
    ];

    for (const cand of nameCandidates) {
      if (cand !== undefined && cand !== null) {
        const s = String(cand).trim();
        const upper = s.toUpperCase();
        if (s && upper !== 'UNNAMED' && upper !== 'N/A' && upper !== 'UNDEFINED' && upper !== 'NULL') {
          rawCustomer = s;
          break;
        }
      }
    }
    const customerName = rawCustomer;

    const companyName = cleanVal(data.company || data.firmName || data.firm_name || data.firm || data.companyName);
    const mobileNo = cleanVal(data.phone || data.mobile || data.contactNum || data.contact_num || data.mobileNo || data.contactNumber || data.name_contact_num);

    let assignedTo = '';
    if (data.assignedTo) {
      if (typeof data.assignedTo === 'object') {
        assignedTo = `${data.assignedTo.firstName || ''} ${data.assignedTo.lastName || ''}`.trim() || data.assignedTo.name || data.assignedTo.email || '';
      } else {
        assignedTo = String(data.assignedTo);
      }
    } else if (lead.assignedToUser) {
      assignedTo = `${lead.assignedToUser.firstName || ''} ${lead.assignedToUser.lastName || ''}`.trim();
    } else if (lead.assignedToName) {
      assignedTo = String(lead.assignedToName);
    }
    assignedTo = cleanVal(assignedTo);

    if (!isDialed) {
      // YET TO DIAL:
      // 1. Createddate is strictly BLANK because the lead has not been dialed / created yet
      // 2. Customer Name comes exactly from assigned campaign file, or blank if missing (never "Unnamed")
      // 3. Assigned To is strictly BLANK before dialing
      // 4. All telecalling details are completely BLANK
      return {
        'Sl.No.': slNo,
        'Createddate': '',
        'data code': dataCode,
        'location': location,
        'Customer Name': customerName,
        'Company name': companyName,
        'Mobile No': mobileNo,
        'Status': 'Yet To Dial',
        'CASE DEATAILS': '',
        'Remarks': '',
        'lead_category': '',
        'Loan Amount': '',
        'Loan type': '',
        'Bank Names': '',
        'Source': '',
        'PSM': '',
        'Assigned To': '',
        'FollowUp Date': '',
        'Modified Date': ''
      };
    }

    // DIALED: Exactly output the inputs the telecaller entered
    const dialedDateRaw = data.dialedAt || data.lastCallDate || lead.createdAt || data.createdAt;
    const createdDate = formatDateShort(dialedDateRaw);
    const dialedAgent = cleanVal(data.dialedBy || data.callerName || assignedTo);
    const status = cleanVal(data.status || data.dialStatus) ? String(data.status || data.dialStatus).trim().toUpperCase() : 'HOT LEADS';
    const caseDetails = cleanVal(data.caseDetails || data.case_details || data.caseStatus || data.case_status);
    const remarks = cleanVal(data.remarks || data.notes || data.remark).replace(/<[^>]*>/g, '');
    const leadCategory = cleanVal(data.leadCategory || data.lead_category || data.category);

    const loanAmountRaw = data.loanAmount || data.budget || data.amount || data.requiredLoan;
    const loanAmount = loanAmountRaw ? formatCurrency(loanAmountRaw) : '';

    const loanType = cleanVal(data.loanType || data.loanProduct || data.product || data.serviceType);
    const bankNames = cleanVal(data.bankNames || data.bank || data.bankPartner || data.bank_partner || data.businessPartner || data.preferredBank);

    let source = '';
    if (lead.createdBy && typeof lead.createdBy === 'object') {
      source = `${lead.createdBy.firstName || ''} ${lead.createdBy.lastName || ''}`.trim() || lead.createdBy.name || lead.createdBy.email || '';
    } else if (lead.createdByName) {
      source = lead.createdByName;
    } else if (data.creatorName) {
      source = data.creatorName;
    } else if (data.createdBy) {
      source = data.createdBy;
    } else if (data.assignedByName) {
      source = data.assignedByName;
    } else if (data.source && !data.source.toLowerCase().includes('demo') && !data.source.toLowerCase().includes('campaign')) {
      source = data.source;
    }
    source = cleanVal(source);

    let psm = '';
    if (data.psm) {
      if (typeof data.psm === 'object') {
        psm = `${data.psm.firstName || ''} ${data.psm.lastName || ''}`.trim() || data.psm.name || '';
      } else {
        psm = String(data.psm);
      }
    } else if (data.psmName) {
      psm = String(data.psmName);
    } else if (data.psm_name) {
      psm = String(data.psm_name);
    }
    psm = cleanVal(psm);

    const followUpDate = data.followUpDate ? formatDateShort(data.followUpDate) : '';
    const modifiedDate = formatDateTimeFull(lead.updatedAt || data.dialedAt || data.updatedAt || lead.createdAt);

    return {
      'Sl.No.': slNo,
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
      'Assigned To': dialedAgent || assignedTo,
      'FollowUp Date': followUpDate,
      'Modified Date': modifiedDate
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(dataRows, { header: headers });

  // Fast column width calculation (sample up to 300 rows for instant performance even on 100k rows)
  const sampleRows = dataRows.slice(0, 300);
  const colWidths = headers.map(header => {
    let maxLen = header.length;
    sampleRows.forEach(row => {
      const val = row[header as keyof typeof row];
      if (val !== undefined && val !== null) {
        maxLen = Math.max(maxLen, String(val).length);
      }
    });
    return { wch: Math.max(maxLen + 4, 14) };
  });

  worksheet['!cols'] = colWidths;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Lead Report');

  const cleanPrefix = (fileNamePrefix || 'Lead_Report').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
  const dateStamp = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `${cleanPrefix}_${dateStamp}.xlsx`);
};
