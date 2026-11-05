import * as XLSX from 'xlsx';

export const exportLeadReportXLSX = (leads: any[], fileNamePrefix: string = 'Lead_Report') => {
  // Exact 19 Columns matching user specification and screenshots (Images 1, 2)
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
    const cleanNum = String(val).replace(/[^0-9.]/g, '');
    const num = Number(cleanNum);
    if (isNaN(num)) return String(val);
    return `₹${num.toLocaleString('en-IN')}`;
  };

  const cleanVal = (val: any) => {
    if (val === undefined || val === null) return '';
    const s = String(val).trim();
    if (s === 'N/A' || s === 'undefined' || s === 'null' || s === '—' || s === '-') return '';
    return s;
  };

  const isLeadDialed = (lead: any, data: any) => {
    if (data.dialedAt || data.lastCallDate) return true;
    if (data.callAttempts && Number(data.callAttempts) > 0) return true;
    const dialSt = (data.dialStatus || '').toString().trim().toUpperCase();
    if (dialSt && !['YET TO CALL', 'NOT CALLED', 'NEW', 'YET TO DIAL', ''].includes(dialSt)) return true;
    const st = (data.status || '').toString().trim().toUpperCase();
    if (st && !['YET TO CALL', 'NOT CALLED', 'NEW', 'YET TO DIAL', ''].includes(st)) return true;
    return false;
  };

  const dataRows = (leads || []).map((lead: any, idx: number) => {
    const data = lead.data || lead;
    const slNo = idx + 1;
    const isDialed = isLeadDialed(lead, data);

    // Data Code: strictly the authentic code from assigning Excel (e.g. DMIBL-01, DMIBL-36)
    // Never fallback to fake artificial string like CAMPAIGN-DATA-1
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

    // Location: strictly what was provided in assigning Excel or during dialing
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

    // Customer Name resolution
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

    const rawCreatedDate = cleanVal(
      data['Createddate'] ||
      data['Created Date'] ||
      data['createddate'] ||
      data['created_date'] ||
      data.createdDate ||
      data.Createddate
    );

    const campSource = cleanVal(data.campaignName || data.campaign || data.source || fileNamePrefix);

    if (!isDialed) {
      // YET TO DIAL:
      // Preserves all original data from assigning Excel sheet as it was.
      // Dial-time updates that haven't happened yet remain blank. Status is "Yet To Dial".
      return {
        'Sl.No.': slNo,
        'Createddate': rawCreatedDate ? (formatDateShort(rawCreatedDate) || rawCreatedDate) : '',
        'data code': dataCode,
        'location': location,
        'Customer Name': customerName,
        'Company name': companyName,
        'Mobile No': mobileNo,
        'Status': 'Yet To Dial',
        'CASE DEATAILS': cleanVal(data.caseDetails || data.case_details || ''),
        'Remarks': cleanVal(data.remarks || data.notes || data.remark || '').replace(/<[^>]*>/g, ''),
        'lead_category': cleanVal(data.leadCategory || data.lead_category || data.category || ''),
        'Loan Amount': data.loanAmount || data.amount || data.budget ? formatCurrency(data.loanAmount || data.amount || data.budget) : '',
        'Loan type': cleanVal(data.loanType || data.product || data.serviceType || ''),
        'Bank Names': cleanVal(data.bankPartner || data.bankNames || data.bank || data.businessPartner || ''),
        'Source': campSource,
        'PSM': cleanVal(data.psm || data.psmName || ''),
        'Assigned To': assignedTo,
        'FollowUp Date': '',
        'Modified Date': ''
      };
    }

    // DIALED:
    // Shows all information entered after dialing, plus original assigning data.
    // If telecaller missed or left any field blank, it renders blank.
    const dialedDateRaw = data.dialedAt || data.lastCallDate || rawCreatedDate || lead.createdAt || data.createdAt;
    const createdDate = formatDateShort(dialedDateRaw) || (rawCreatedDate ? formatDateShort(rawCreatedDate) : '');
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
    } else {
      source = campSource;
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

    const followUpDate = (data.followUpDate || data.followupDate) ? formatDateShort(data.followUpDate || data.followupDate) : '';
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

  // Fast column width calculation
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
