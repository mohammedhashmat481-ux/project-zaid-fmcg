import * as XLSX from 'xlsx';

export const exportLeadReportXLSX = (leads: any[], fileNamePrefix: string = 'Lead_Report') => {
  // Exact 19 Columns matching user specification and screenshots
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
    'lead_Category',
    'Loan Amount',
    'Loan type',
    'Bank Names',
    'Source',
    'PSM',
    'Assigned To',
    'Follow Up Date',
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
    const s = String(val).trim();
    if (['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(s.toUpperCase())) return '';
    if (s.startsWith('₹')) return s;
    const cleanNumStr = s.replace(/,/g, '').trim();
    const num = Number(cleanNumStr);
    if (!isNaN(num) && cleanNumStr !== '') {
      return `₹${num.toLocaleString('en-IN')}`;
    }
    return s;
  };

  const cleanVal = (val: any) => {
    if (val === undefined || val === null) return '';
    const s = String(val).trim();
    if (s === 'N/A' || s === 'undefined' || s === 'null' || s === '—' || s === '-') return '';
    return s;
  };

  // Check if status is a genuine user-updated status
  // "NEW", "YET TO CALL", "NOT CALLED", "YET TO DIAL" are default un-dialed states, never updated statuses.
  const isRealUpdatedStatus = (val?: any): boolean => {
    if (!val) return false;
    const s = String(val).trim().toUpperCase();
    if (['', 'NEW', 'YET TO CALL', 'NOT CALLED', 'YET TO DIAL', 'N/A', 'UNDEFINED', 'NULL'].includes(s)) {
      return false;
    }
    return true;
  };

  const isLeadDialed = (lead: any, data: any): boolean => {
    return isRealUpdatedStatus(data.status) || isRealUpdatedStatus(data.dialStatus);
  };

  // Checks whether a string value is just the campaign name, campaign code, or system noise
  const isCampaignString = (val?: any, campName?: string): boolean => {
    if (!val) return true;
    const s = String(val).trim().toLowerCase();
    if (['', 'n/a', 'undefined', 'null', '—', '-', 'system', 'excel import', 'csv import', 'bulk import'].includes(s)) return true;
    if (campName) {
      const cleanCamp = campName.trim().toLowerCase();
      if (cleanCamp && (s === cleanCamp || s.includes(cleanCamp) || cleanCamp.includes(s))) return true;
    }
    if (s.includes('vc-') || s.startsWith('camp-') || s.includes('campaign')) return true;
    if (/^[0-9a-fA-F]{24}$/.test(s) || /^[0-9a-fA-F-]{36}$/.test(s)) return true;
    return false;
  };

  // Resolves the creator/source name: always the person who created/handled the lead, NEVER the campaign name and NEVER Super Admin if an assigned agent exists
  const resolveSourceName = (lead: any, data: any, campName: string): string => {
    // 1. Resolve assigned telecaller or dialer
    let assignedCaller = '';
    if (data.assignedTo) {
      if (typeof data.assignedTo === 'object') {
        assignedCaller = `${data.assignedTo.firstName || ''} ${data.assignedTo.lastName || ''}`.trim() || data.assignedTo.name || '';
      } else {
        assignedCaller = String(data.assignedTo).trim();
      }
    } else if (lead.assignedToUser) {
      assignedCaller = `${lead.assignedToUser.firstName || ''} ${lead.assignedToUser.lastName || ''}`.trim();
    } else if (lead.assignedToName) {
      assignedCaller = String(lead.assignedToName).trim();
    } else if (data.dialedBy) {
      assignedCaller = String(data.dialedBy).trim();
    } else if (data.callerName) {
      assignedCaller = String(data.callerName).trim();
    } else if (data.telecaller) {
      assignedCaller = String(data.telecaller).trim();
    }

    if (['N/A', 'UNDEFINED', 'NULL', '—', '-'].includes(assignedCaller.toUpperCase())) {
      assignedCaller = '';
    }

    // 2. Direct explicit source if it is a real user name
    const rawSource = cleanVal(data.source);
    if (rawSource && !isCampaignString(rawSource, campName)) {
      if (rawSource.toLowerCase() === 'super admin' && assignedCaller && assignedCaller.toLowerCase() !== 'super admin') {
        return assignedCaller;
      }
      return rawSource;
    }

    // 3. Creator candidates
    const candidates = [
      data.dialedBy,
      data.callerName,
      assignedCaller,
      data.creatorName,
      data.createdByName,
      lead.createdByName,
      data.creator,
      lead.createdBy,
      data.createdBy,
      data.assignedByName,
      data.assignedBy,
      data.sourceUser,
      data.importedBy
    ];

    for (const cand of candidates) {
      if (cand) {
        const s = typeof cand === 'object' ? `${cand.firstName || ''} ${cand.lastName || ''}`.trim() || cand.name : String(cand).trim();
        if (s && !isCampaignString(s, campName)) {
          if (s.toLowerCase() === 'super admin' && assignedCaller && assignedCaller.toLowerCase() !== 'super admin') {
            return assignedCaller;
          }
          return s;
        }
      }
    }

    if (lead.createdBy && typeof lead.createdBy === 'object') {
      const fullName = `${lead.createdBy.firstName || ''} ${lead.createdBy.lastName || ''}`.trim();
      if (fullName && !isCampaignString(fullName, campName)) {
        if (fullName.toLowerCase() === 'super admin' && assignedCaller && assignedCaller.toLowerCase() !== 'super admin') {
          return assignedCaller;
        }
        return fullName;
      }
    }

    if (assignedCaller && !isCampaignString(assignedCaller, campName)) {
      return assignedCaller;
    }

    return 'Telecaller';
  };

  // Order leads: all DIALED leads come first in serial order, followed by all YET-TO-DIAL leads
  const dialedLeads: any[] = [];
  const yetToDialLeads: any[] = [];

  (leads || []).forEach((lead: any) => {
    const data = lead.data || lead;
    if (isLeadDialed(lead, data)) {
      dialedLeads.push(lead);
    } else {
      yetToDialLeads.push(lead);
    }
  });

  const orderedLeads = [...dialedLeads, ...yetToDialLeads];

  const dataRows = orderedLeads.map((lead: any, idx: number) => {
    const data = lead.data || lead;
    const slNo = idx + 1;
    const isDialed = isLeadDialed(lead, data);

    // Data Code
    const rawDc = cleanVal(
      data['data code'] ||
      data['Data Code'] ||
      data['DATA CODE'] ||
      data.dataCode ||
      data.data_code ||
      data.datacode ||
      data.code ||
      data.leadCode ||
      data.lead_code ||
      data.customercode
    );
    const dataCode = rawDc || '';

    // Location
    const location = cleanVal(
      data['location'] ||
      data['Location'] ||
      data['LOCATION'] ||
      data.location ||
      data.city ||
      data.presentAddress ||
      data.place ||
      data.area ||
      data.district ||
      data.branch ||
      data.state
    );

    // Customer Name
    let rawCustomer = '';
    const nameCandidates = [
      data['Customer Name'],
      data['Customer name'],
      data['customer name'],
      data['CUSTOMER NAME'],
      data.customerName,
      data.customer_name,
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

    const companyName = cleanVal(
      data['Company name'] ||
      data['Company Name'] ||
      data['company name'] ||
      data['COMPANY NAME'] ||
      data.company ||
      data.firmName ||
      data.firm_name ||
      data.firm ||
      data.companyName ||
      data.employer ||
      data.organization
    );

    const mobileNo = cleanVal(
      data['Mobile No'] ||
      data['Mobile no'] ||
      data['mobile no'] ||
      data['MOBILE NO'] ||
      data.phone ||
      data.mobile ||
      data.contactNumber ||
      data.contactNum ||
      data.contact_num ||
      data.mobileNo ||
      data.name_contact_num ||
      data.contact
    );

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
    } else if (data.telecaller) {
      assignedTo = String(data.telecaller);
    }
    assignedTo = cleanVal(assignedTo);
    if (assignedTo.toUpperCase() === 'N/A' || assignedTo.toUpperCase() === 'UNDEFINED') assignedTo = '';

    const rawCreatedDate = cleanVal(
      data['Createddate'] ||
      data['Created Date'] ||
      data['createddate'] ||
      data['created_date'] ||
      data.createdDate ||
      data.Createddate ||
      lead.createdAt
    );

    const source = resolveSourceName(lead, data, fileNamePrefix);

    // Common Extraction for Loan Amount, Loan Type, Bank Names, PSM across all possible aliases
    const rawLoanAmount = cleanVal(
      data.loanAmount ||
      data.loan_amount ||
      data['Loan Amount'] ||
      data['Loan amount'] ||
      data['loan amount'] ||
      data['loan_amount'] ||
      data['LOAN AMOUNT'] ||
      data.amount ||
      data['Amount'] ||
      data['amount'] ||
      data.budget ||
      data['Budget'] ||
      data['budget'] ||
      data.requiredLoan ||
      data['Required Loan'] ||
      data.reqLoan ||
      data.requestedAmount
    );
    const loanAmount = rawLoanAmount ? formatCurrency(rawLoanAmount) : '';

    const loanType = cleanVal(
      data.loanType ||
      data.loan_type ||
      data.product ||
      data.productType ||
      data.serviceType ||
      data.loanProduct ||
      data['Loan type'] ||
      data['Loan Type'] ||
      data['loan type'] ||
      data['LOAN TYPE'] ||
      data['Product'] ||
      data['product'] ||
      data['PRODUCT'] ||
      data['Loan Product'] ||
      data['loan product']
    );

    const bankNames = cleanVal(
      data.bankNames ||
      data.bank ||
      data.bankPartner ||
      data.bank_partner ||
      data.businessPartner ||
      data.preferredBank ||
      data['Bank Names'] ||
      data['Bank Name'] ||
      data['bank name'] ||
      data['Bank'] ||
      data['BANK'] ||
      data['Bank names'] ||
      data['bank names'] ||
      data['Business Partner'] ||
      data['business partner']
    );

    let rawPsm = '';
    if (data.psm) {
      if (typeof data.psm === 'object') {
        rawPsm = `${data.psm.firstName || ''} ${data.psm.lastName || ''}`.trim() || data.psm.name || '';
      } else {
        rawPsm = String(data.psm);
      }
    } else if (data.psmName) {
      rawPsm = String(data.psmName);
    } else if (data.psm_name) {
      rawPsm = String(data.psm_name);
    } else if (data['PSM'] || data['psm'] || data['Psm']) {
      rawPsm = String(data['PSM'] || data['psm'] || data['Psm']);
    } else if (data.manager || data.managerName) {
      rawPsm = String(data.manager || data.managerName);
    }
    let psm = cleanVal(rawPsm);
    if (psm.toUpperCase() === 'N/A' || psm.toLowerCase().includes('demo') || (fileNamePrefix && psm.toLowerCase() === fileNamePrefix.toLowerCase())) {
      psm = '';
    }

    const caseDetails = cleanVal(
      data.caseDetails ||
      data.case_details ||
      data.caseStatus ||
      data.case_status ||
      data['CASE DEATAILS'] ||
      data['CASE DETAILS'] ||
      data['Case Details'] ||
      data['Case details']
    );

    const remarks = cleanVal(
      data.remarks ||
      data.notes ||
      data.remark ||
      data['Remarks'] ||
      data['remarks'] ||
      data['Notes'] ||
      data['notes']
    ).replace(/<[^>]*>/g, '');

    const leadCategory = cleanVal(
      data.leadCategory ||
      data.lead_category ||
      data.category ||
      data['lead_Category'] ||
      data['lead_category'] ||
      data['Lead Category'] ||
      data['Lead category']
    );

    if (!isDialed) {
      // YET TO DIAL:
      // Status is strictly "Yet To Dial" (never "NEW")
      // Source is strictly the telecaller/creator's name (never the campaign name)
      return {
        'Sl.No.': slNo,
        'Createddate': rawCreatedDate ? (formatDateShort(rawCreatedDate) || rawCreatedDate) : '',
        'data code': dataCode,
        'location': location,
        'Customer Name': customerName,
        'Company name': companyName,
        'Mobile No': mobileNo,
        'Status': 'Yet To Dial',
        'CASE DEATAILS': caseDetails,
        'Remarks': remarks,
        'lead_Category': leadCategory,
        'Loan Amount': loanAmount,
        'Loan type': loanType,
        'Bank Names': bankNames,
        'Source': source,
        'PSM': psm,
        'Assigned To': assignedTo || source,
        'Follow Up Date': '',
        'Modified Date': ''
      };
    }

    // DIALED:
    // Only updated statuses appear (uppercase), never "NEW"
    // Source is strictly creator / telecaller name, never campaign name
    const dialedDateRaw = data.dialedAt || data.lastCallDate || rawCreatedDate || lead.createdAt || data.createdAt;
    const createdDate = formatDateShort(dialedDateRaw) || (rawCreatedDate ? formatDateShort(rawCreatedDate) : '');
    const dialedAgent = cleanVal(data.dialedBy || data.callerName || assignedTo);

    const rawStatus = data.status || data.dialStatus;
    const status = isRealUpdatedStatus(rawStatus) ? String(rawStatus).trim().toUpperCase() : 'Yet To Dial';

    const followUpDate = (data.followUpDate || data.followupDate || data.follow_up_date) ? formatDateShort(data.followUpDate || data.followupDate || data.follow_up_date) : '';
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
      'lead_Category': leadCategory,
      'Loan Amount': loanAmount,
      'Loan type': loanType,
      'Bank Names': bankNames,
      'Source': source,
      'PSM': psm,
      'Assigned To': dialedAgent || assignedTo || source,
      'Follow Up Date': followUpDate,
      'Modified Date': modifiedDate
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(dataRows, { header: headers });

  // Column width calculation
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
