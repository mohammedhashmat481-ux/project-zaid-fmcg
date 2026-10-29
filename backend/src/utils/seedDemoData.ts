import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { connectDB, disconnectDB } from '../config/db';
import Organization from '../models/Organization';
import Role from '../models/Role';
import User from '../models/User';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import ReportDefinition from '../models/ReportDefinition';
import Activity from '../models/Activity';
import Status from '../models/Status';
import { logger } from './logger';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export async function seedDemoData(shouldDisconnect = false) {
  await connectDB();
  logger.info('[Demo Seeder] Starting comprehensive demo data population...');

  // 1. Get primary Organization
  const org = await Organization.findOne({});
  if (!org) {
    logger.error('[Demo Seeder] No organization found. Please run initial seeder first.');
    return;
  }
  const orgId = org._id || org.id;
  logger.info(`[Demo Seeder] Organization: ${org.name} (${orgId})`);

  // 2. Ensure Roles exist
  const roles = await Role.find({ organizationId: orgId });
  const roleMap: Record<string, any> = {};
  roles.forEach((r: any) => {
    roleMap[r.name] = r;
  });

  const superAdminRole = roleMap['Super Admin'] || roles[0];
  const telecallerRole = roleMap['TELI CALLER'] || roleMap['ADMIN'] || superAdminRole;
  const managerRole = roleMap['ARIA SALES MANAGER'] || roleMap['SALES MANAGER'] || superAdminRole;

  // 3. Ensure Demo Users exist
  const passwordHash = await bcrypt.hash('novaleadnexa1309', 10);
  const demoUsersToCreate = [
    {
      firstName: 'Rahul',
      lastName: 'Verma',
      email: 'rahul.verma@inkcrm.com',
      roleId: telecallerRole._id || telecallerRole.id,
      department: 'Telemarketing',
      userCode: 'TC-RAHUL-101'
    },
    {
      firstName: 'Ananya',
      lastName: 'Sharma',
      email: 'ananya.sharma@inkcrm.com',
      roleId: telecallerRole._id || telecallerRole.id,
      department: 'Telemarketing',
      userCode: 'TC-ANANYA-102'
    },
    {
      firstName: 'Priya',
      lastName: 'Singh',
      email: 'priya.singh@inkcrm.com',
      roleId: telecallerRole._id || telecallerRole.id,
      department: 'Telemarketing',
      userCode: 'TC-PRIYA-103'
    },
    {
      firstName: 'Vikram',
      lastName: 'Patel',
      email: 'vikram.patel@inkcrm.com',
      roleId: managerRole._id || managerRole.id,
      department: 'SALES MANAGER',
      userCode: 'SM-VIKRAM-201'
    },
    {
      firstName: 'Sneha',
      lastName: 'Kulkarni',
      email: 'sneha.kulkarni@inkcrm.com',
      roleId: telecallerRole._id || telecallerRole.id,
      department: 'Telemarketing',
      userCode: 'TC-SNEHA-104'
    }
  ];

  const superAdminUser = await User.findOne({ email: 'admin@crm.com' });
  let vikramUser: any = null;

  const agentNames: string[] = ['Super Admin'];
  for (const u of demoUsersToCreate) {
    let userDoc = await User.findOne({ email: u.email });
    if (!userDoc) {
      userDoc = await User.create({
        organizationId: orgId,
        roleId: u.roleId,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        passwordHash,
        plainPassword: 'novaleadnexa1309',
        department: u.department,
        userCode: u.userCode,
        isVerified: true,
        isActive: true,
        isApproved: true,
        approvalStatus: 'approved',
        skipFace: true,
        skipLocation: true,
        twoFactor: { enabled: false },
        faceRecognition: { enabled: false }
      });
      logger.info(`[Demo Seeder] Created User: ${u.firstName} ${u.lastName} (${u.email})`);
    }

    if (u.firstName === 'Vikram') {
      vikramUser = userDoc;
      if (superAdminUser && !userDoc.reportingManager) {
        userDoc.reportingManager = superAdminUser._id;
        await userDoc.save();
      }
    } else if (vikramUser && !userDoc.reportingManager) {
      userDoc.reportingManager = vikramUser._id;
      await userDoc.save();
    }

    agentNames.push(`${u.firstName} ${u.lastName}`);
  }

  // 4. Ensure Module Definitions exist
  const leadModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'leads' });
  const campaignModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaigns' });
  const campaignAssignmentModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'campaignassignments' });
  const bankMasterModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'bankmasters' });
  const bankingPartnerModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'bankingpartners' });
  const productModule = await ModuleDefinition.findOne({ organizationId: orgId, apiPath: 'products' });

  if (!leadModule || !campaignModule) {
    logger.error('[Demo Seeder] Core modules missing. Exiting.');
    return;
  }

  // 5. Seed Bank Masters
  if (bankMasterModule) {
    const defaultBanks = [
      { bankName: 'STATE BANK OF INDIA', code: 'SBI' },
      { bankName: 'HDFC BANK', code: 'HDFC' },
      { bankName: 'ICICI BANK', code: 'ICICI' },
      { bankName: 'AXIS BANK', code: 'AXIS' },
      { bankName: 'KOTAK MAHINDRA BANK', code: 'KOTAK' },
      { bankName: 'BANK OF BARODA', code: 'BOB' },
      { bankName: 'PUNJAB NATIONAL BANK', code: 'PNB' }
    ];

    for (const b of defaultBanks) {
      const existing = await CustomRecord.findOne({
        organizationId: orgId,
        moduleId: bankMasterModule._id,
        'data.bankName': b.bankName
      });
      if (!existing) {
        await CustomRecord.create({
          organizationId: orgId,
          moduleId: bankMasterModule._id,
          data: b
        });
      }
    }
    logger.info('[Demo Seeder] Bank Masters verified & populated.');
  }

  // 6. Seed Products (Loan Types)
  if (productModule) {
    const defaultProducts = [
      { name: 'SALARIED PERSONAL LOAN', category: 'Retail Loan' },
      { name: 'BUSINESS LOAN', category: 'Commercial Loan' },
      { name: 'HOME LOAN', category: 'Mortgage Loan' },
      { name: 'LAP', category: 'Loan Against Property' }
    ];

    for (const p of defaultProducts) {
      const existing = await CustomRecord.findOne({
        organizationId: orgId,
        moduleId: productModule._id,
        'data.name': p.name
      });
      if (!existing) {
        await CustomRecord.create({
          organizationId: orgId,
          moduleId: productModule._id,
          data: p
        });
      }
    }
    logger.info('[Demo Seeder] Products verified & populated.');
  }

  // 7. Seed Banking Partners (PSM Mappings)
  if (bankingPartnerModule) {
    const defaultMappings = [
      {
        bank: 'HDFC BANK, ICICI BANK',
        loanType: 'SALARIED PERSONAL LOAN',
        psm: 'Rahul Verma'
      },
      {
        bank: 'STATE BANK OF INDIA, BANK OF BARODA',
        loanType: 'HOME LOAN',
        psm: 'Ananya Sharma'
      },
      {
        bank: 'AXIS BANK, KOTAK MAHINDRA BANK',
        loanType: 'BUSINESS LOAN',
        psm: 'Vikram Patel'
      },
      {
        bank: 'HDFC BANK, AXIS BANK',
        loanType: 'LAP',
        psm: 'Priya Singh'
      }
    ];

    for (const m of defaultMappings) {
      const existing = await CustomRecord.findOne({
        organizationId: orgId,
        moduleId: bankingPartnerModule._id,
        'data.loanType': m.loanType,
        'data.psm': m.psm
      });
      if (!existing) {
        await CustomRecord.create({
          organizationId: orgId,
          moduleId: bankingPartnerModule._id,
          data: m
        });
      }
    }
    logger.info('[Demo Seeder] Banking Partner PSM Mappings verified & populated.');
  }

  // 8. Seed Campaigns
  const demoCampaigns = [
    {
      campaignName: 'Diwali Festive Loan Bonanza',
      status: 'Active',
      type: 'Cold Call',
      budget: 500000,
      startDate: '2026-07-01',
      endDate: '2026-12-31',
      notes: 'High intent personal & salaried loan drive with reduced processing fees.'
    },
    {
      campaignName: 'Q3 SME Business Expansion Drive',
      status: 'Active',
      type: 'Email',
      budget: 350000,
      startDate: '2026-07-15',
      endDate: '2026-11-30',
      notes: 'Targeting commercial retail stores and manufacturing MSMEs.'
    },
    {
      campaignName: 'Home Loan Super Saver Scheme',
      status: 'Active',
      type: 'Social Media',
      budget: 600000,
      startDate: '2026-08-01',
      endDate: '2026-12-31',
      notes: 'Affordable residential mortgage and balance transfer campaign.'
    },
    {
      campaignName: 'Salaried Personal Loan Express',
      status: 'Active',
      type: 'Cold Call',
      budget: 450000,
      startDate: '2026-07-01',
      endDate: '2026-10-31',
      notes: 'Fast-track 24h approval for top-tier corporate employees.'
    }
  ];

  const campaignMap: Record<string, any> = {};
  for (const c of demoCampaigns) {
    let rec = await CustomRecord.findOne({
      organizationId: orgId,
      moduleId: campaignModule._id,
      'data.campaignName': c.campaignName
    });
    if (!rec) {
      rec = await CustomRecord.create({
        organizationId: orgId,
        moduleId: campaignModule._id,
        data: c
      });
      logger.info(`[Demo Seeder] Created Campaign: ${c.campaignName}`);
    }
    campaignMap[c.campaignName] = rec;
  }

  // 9. Clear older leads or ensure rich comprehensive leads across all statuses
  const existingLeadCount = await CustomRecord.countDocuments({
    organizationId: orgId,
    moduleId: leadModule._id
  });

  logger.info(`[Demo Seeder] Current leads count: ${existingLeadCount}. Populating rich realistic leads...`);

  // Delete placeholder leads if they only had HotLeadXX dummy names
  if (existingLeadCount > 0) {
    const sample = await CustomRecord.findOne({ organizationId: orgId, moduleId: leadModule._id });
    if (sample && sample.data?.firstName && sample.data.firstName.startsWith('HotLead')) {
      logger.info('[Demo Seeder] Replacing dummy placeholder leads with rich realistic records...');
      await CustomRecord.deleteMany({ organizationId: orgId, moduleId: leadModule._id });
    }
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 5);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];

  const realisticLeadsData = [
    // ── HOT LEADS (8) ──
    {
      firstName: 'Ramesh', lastName: 'Chandra', phone: '9820123456', email: 'ramesh.chandra@tcs.com',
      company: 'Tata Consultancy Services', salary: 125000, budget: 1500000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'HOT LEADS', dialStatus: 'Hot Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Rahul Verma', city: 'Mumbai', state: 'Maharashtra', followUpDate: todayStr,
      createdDate: '2026-07-08T10:30:00.000Z', notes: 'Immediate requirement for home renovation. Documentation ready.'
    },
    {
      firstName: 'Sunita', lastName: 'Gupta', phone: '9811234567', email: 'sunita.g@infosys.com',
      company: 'Infosys Technologies', salary: 95000, budget: 1200000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'HOT LEADS', dialStatus: 'Hot Lead', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Ananya Sharma', city: 'Bengaluru', state: 'Karnataka', followUpDate: todayStr,
      createdDate: '2026-07-14T11:45:00.000Z', notes: 'Interested in competitive interest rate. Salary slips verified.'
    },
    {
      firstName: 'Amitabh', lastName: 'Saxena', phone: '9845345678', email: 'amitabh@saxenaretail.in',
      company: 'Saxena Retail Enterprises', salary: 350000, budget: 4500000, loanType: 'BUSINESS LOAN',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Vikram Patel',
      status: 'HOT LEADS', dialStatus: 'Hot Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Delhi', state: 'Delhi', followUpDate: todayStr,
      createdDate: '2026-07-22T14:15:00.000Z', notes: 'GST returns for 2 years submitted. Ready for field investigation.'
    },
    {
      firstName: 'Pooja', lastName: 'Hegde', phone: '9833456789', email: 'pooja.h@wipro.com',
      company: 'Wipro Limited', salary: 140000, budget: 6500000, loanType: 'HOME LOAN',
      bank: 'STATE BANK OF INDIA', businessPartner: 'STATE BANK OF INDIA', psm: 'Ananya Sharma',
      status: 'HOT LEADS', dialStatus: 'Hot Lead', source: 'Home Loan Super Saver Scheme', campaign: 'Home Loan Super Saver Scheme', campaignName: 'Home Loan Super Saver Scheme',
      assignedTo: 'Priya Singh', city: 'Hyderabad', state: 'Telangana', followUpDate: todayStr,
      createdDate: '2026-07-28T09:20:00.000Z', notes: 'Builder property agreement finalized in Gachibowli.'
    },
    {
      firstName: 'Karan', lastName: 'Mehra', phone: '9711567890', email: 'karan@mehralogistics.com',
      company: 'Mehra Logistics Pvt Ltd', salary: 280000, budget: 3500000, loanType: 'BUSINESS LOAN',
      bank: 'KOTAK MAHINDRA BANK', businessPartner: 'KOTAK MAHINDRA BANK', psm: 'Vikram Patel',
      status: 'HOT LEADS', dialStatus: 'Hot Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Sneha Kulkarni', city: 'Pune', state: 'Maharashtra', followUpDate: tomorrowStr,
      createdDate: '2026-08-05T15:10:00.000Z', notes: 'Fleet expansion working capital loan.'
    },
    {
      firstName: 'Deepika', lastName: 'Padukone', phone: '9920678901', email: 'deepika.p@accenture.com',
      company: 'Accenture Solutions', salary: 180000, budget: 2000000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'HOT LEADS', dialStatus: 'Hot Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Rahul Verma', city: 'Mumbai', state: 'Maharashtra', followUpDate: tomorrowStr,
      createdDate: '2026-09-03T16:00:00.000Z', notes: 'Needs top-up loan on existing account.'
    },
    {
      firstName: 'Rohit', lastName: 'Sharma', phone: '9821789012', email: 'rohit@reliancejio.com',
      company: 'Reliance Jio Infocomm', salary: 210000, budget: 8500000, loanType: 'HOME LOAN',
      bank: 'STATE BANK OF INDIA', businessPartner: 'STATE BANK OF INDIA', psm: 'Ananya Sharma',
      status: 'HOT LEADS', dialStatus: 'Hot Lead', source: 'Home Loan Super Saver Scheme', campaign: 'Home Loan Super Saver Scheme', campaignName: 'Home Loan Super Saver Scheme',
      assignedTo: 'Ananya Sharma', city: 'Ahmedabad', state: 'Gujarat', followUpDate: nextWeekStr,
      createdDate: '2026-10-15T12:00:00.000Z', notes: 'Property sanctioning approved, awaiting disbursement date.'
    },
    {
      firstName: 'Kavita', lastName: 'Nair', phone: '9840890123', email: 'kavita.nair@cognizant.com',
      company: 'Cognizant Technology', salary: 110000, budget: 1800000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'HOT LEADS', dialStatus: 'Hot Lead', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Sneha Kulkarni', city: 'Chennai', state: 'Tamil Nadu', followUpDate: todayStr,
      createdDate: '2026-10-18T10:00:00.000Z', notes: 'Medical emergency personal loan, high priority callback.'
    },

    // ── WARM LEADS (6) ──
    {
      firstName: 'Manish', lastName: 'Tiwari', phone: '9810901234', email: 'manish@tiwaripharmacy.com',
      company: 'Tiwari Healthcare', salary: 150000, budget: 2500000, loanType: 'BUSINESS LOAN',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Vikram Patel',
      status: 'WARM LEADS', dialStatus: 'Warm Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Jaipur', state: 'Rajasthan', followUpDate: tomorrowStr,
      createdDate: '2026-07-11T11:20:00.000Z', notes: 'Considering offer from Axis vs HDFC.'
    },
    {
      firstName: 'Alok', lastName: 'Verma', phone: '9831012345', email: 'alok.v@tcs.com',
      company: 'Tata Consultancy Services', salary: 85000, budget: 900000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'WARM LEADS', dialStatus: 'Warm Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Rahul Verma', city: 'Kolkata', state: 'West Bengal', followUpDate: nextWeekStr,
      createdDate: '2026-07-19T13:40:00.000Z', notes: 'Wants to discuss tenure extension to 5 years.'
    },
    {
      firstName: 'Neelam', lastName: 'Deshmukh', phone: '9822123456', email: 'neelam@deshmukhind.com',
      company: 'Deshmukh Industries', salary: 320000, budget: 5000000, loanType: 'LAP',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Priya Singh',
      status: 'WARM LEADS', dialStatus: 'Warm Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Priya Singh', city: 'Pune', state: 'Maharashtra', followUpDate: nextWeekStr,
      createdDate: '2026-08-12T14:30:00.000Z', notes: 'Property valuation document scheduled for next Tuesday.'
    },
    {
      firstName: 'Rajesh', lastName: 'Kumar', phone: '9876543210', email: 'rajesh.k@hcl.com',
      company: 'HCL Technologies', salary: 130000, budget: 1400000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'WARM LEADS', dialStatus: 'Warm Lead', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Ananya Sharma', city: 'Noida', state: 'Uttar Pradesh', followUpDate: todayStr,
      createdDate: '2026-09-10T10:15:00.000Z', notes: 'Comparing ROI with PSU banks.'
    },
    {
      firstName: 'Gaurav', lastName: 'Bansal', phone: '9818234567', email: 'gaurav@bansalexports.com',
      company: 'Bansal Agro Exports', salary: 450000, budget: 7500000, loanType: 'BUSINESS LOAN',
      bank: 'KOTAK MAHINDRA BANK', businessPartner: 'KOTAK MAHINDRA BANK', psm: 'Vikram Patel',
      status: 'WARM LEADS', dialStatus: 'Warm Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Delhi', state: 'Delhi', followUpDate: tomorrowStr,
      createdDate: '2026-10-02T16:45:00.000Z', notes: 'Audited balance sheet sent to underwriter.'
    },
    {
      firstName: 'Shweta', lastName: 'Iyer', phone: '9841345678', email: 'shweta.iyer@lnt.com',
      company: 'Larsen & Toubro', salary: 160000, budget: 5500000, loanType: 'HOME LOAN',
      bank: 'BANK OF BARODA', businessPartner: 'BANK OF BARODA', psm: 'Ananya Sharma',
      status: 'WARM LEADS', dialStatus: 'Warm Lead', source: 'Home Loan Super Saver Scheme', campaign: 'Home Loan Super Saver Scheme', campaignName: 'Home Loan Super Saver Scheme',
      assignedTo: 'Ananya Sharma', city: 'Chennai', state: 'Tamil Nadu', followUpDate: nextWeekStr,
      createdDate: '2026-10-12T11:00:00.000Z', notes: 'Awaiting OC from developer.'
    },

    // ── CEBIL PENDING (4) ──
    {
      firstName: 'Sanjay', lastName: 'Mishra', phone: '9819456789', email: 'sanjay.m@mahindra.com',
      company: 'Mahindra & Mahindra', salary: 75000, budget: 800000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'CEBIL PENDING', dialStatus: 'Not Connected', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Rahul Verma', city: 'Mumbai', state: 'Maharashtra', followUpDate: tomorrowStr,
      createdDate: '2026-07-16T12:00:00.000Z', notes: 'Experian score discrepancy reported. Verification initiated.'
    },
    {
      firstName: 'Vikas', lastName: 'Dubey', phone: '9820567890', email: 'vikas@dubeyhardware.in',
      company: 'Dubey Hardware Stores', salary: 120000, budget: 1500000, loanType: 'BUSINESS LOAN',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Vikram Patel',
      status: 'CEBIL PENDING', dialStatus: 'Yet To Call', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Sneha Kulkarni', city: 'Kanpur', state: 'Uttar Pradesh', followUpDate: nextWeekStr,
      createdDate: '2026-08-20T14:00:00.000Z', notes: 'Previous credit card settlement letter awaited.'
    },
    {
      firstName: 'Archana', lastName: 'Joshi', phone: '9823678901', email: 'archana@joshicaterers.com',
      company: 'Joshi Caterers', salary: 90000, budget: 1100000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'CEBIL PENDING', dialStatus: 'Yet To Call', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Priya Singh', city: 'Pune', state: 'Maharashtra', followUpDate: tomorrowStr,
      createdDate: '2026-09-18T15:30:00.000Z', notes: 'CIBIL report pulled, bureau score is 695.'
    },
    {
      firstName: 'Harish', lastName: 'Rawat', phone: '9811789012', email: 'harish@delhicloth.com',
      company: 'Delhi Cloth Mills', salary: 110000, budget: 2200000, loanType: 'BUSINESS LOAN',
      bank: 'PUNJAB NATIONAL BANK', businessPartner: 'PUNJAB NATIONAL BANK', psm: 'Vikram Patel',
      status: 'CEBIL PENDING', dialStatus: 'Yet To Call', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Delhi', state: 'Delhi', followUpDate: nextWeekStr,
      createdDate: '2026-10-10T11:15:00.000Z', notes: 'Underwriting hold for score clarification.'
    },

    // ── DOCUMENT PENDING (4) ──
    {
      firstName: 'Pankaj', lastName: 'Tripathi', phone: '9821890123', email: 'pankaj@tripathimotors.com',
      company: 'Tripathi Auto Spares', salary: 200000, budget: 3000000, loanType: 'BUSINESS LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'DOCUMENT PENDING', dialStatus: 'Warm Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Rahul Verma', city: 'Patna', state: 'Bihar', followUpDate: todayStr,
      createdDate: '2026-07-25T16:20:00.000Z', notes: '6 months bank statement pending upload.'
    },
    {
      firstName: 'Meenakshi', lastName: 'Sundaram', phone: '9840901234', email: 'meenakshi@chennaitextiles.com',
      company: 'Sundaram Weaving Mills', salary: 175000, budget: 4000000, loanType: 'LAP',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Priya Singh',
      status: 'DOCUMENT PENDING', dialStatus: 'Yet To Call', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Priya Singh', city: 'Madurai', state: 'Tamil Nadu', followUpDate: tomorrowStr,
      createdDate: '2026-08-18T10:45:00.000Z', notes: 'Title deed chain documents requested by legal team.'
    },
    {
      firstName: 'Naveen', lastName: 'Reddy', phone: '9849012345', email: 'naveen.r@techm.com',
      company: 'Tech Mahindra', salary: 135000, budget: 1600000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'DOCUMENT PENDING', dialStatus: 'Warm Lead', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Ananya Sharma', city: 'Hyderabad', state: 'Telangana', followUpDate: nextWeekStr,
      createdDate: '2026-09-22T13:00:00.000Z', notes: 'Form 16 part B pending from employer.'
    },
    {
      firstName: 'Ritu', lastName: 'Bhasin', phone: '9818123456', email: 'ritu@bhasindesign.com',
      company: 'Bhasin Interiors', salary: 190000, budget: 4800000, loanType: 'HOME LOAN',
      bank: 'STATE BANK OF INDIA', businessPartner: 'STATE BANK OF INDIA', psm: 'Ananya Sharma',
      status: 'DOCUMENT PENDING', dialStatus: 'Yet To Call', source: 'Home Loan Super Saver Scheme', campaign: 'Home Loan Super Saver Scheme', campaignName: 'Home Loan Super Saver Scheme',
      assignedTo: 'Ananya Sharma', city: 'Gurugram', state: 'Haryana', followUpDate: todayStr,
      createdDate: '2026-10-14T09:30:00.000Z', notes: 'Encumbrance Certificate applied at sub-registrar.'
    },

    // ── APPROVAL PENDING (4) ──
    {
      firstName: 'Tarun', lastName: 'Kapoor', phone: '9810234567', email: 'tarun.k@airtel.in',
      company: 'Bharti Airtel', salary: 220000, budget: 2500000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'APPROVAL PENDING', dialStatus: 'Hot Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Rahul Verma', city: 'Delhi', state: 'Delhi', followUpDate: tomorrowStr,
      createdDate: '2026-07-29T11:00:00.000Z', notes: 'Credit manager review in progress. Sanction letter expected today.'
    },
    {
      firstName: 'Anand', lastName: 'Mahindra', phone: '9820345678', email: 'anand@mahindralogistics.com',
      company: 'Mahindra Transport Corp', salary: 500000, budget: 8000000, loanType: 'BUSINESS LOAN',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Vikram Patel',
      status: 'APPROVAL PENDING', dialStatus: 'Hot Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Mumbai', state: 'Maharashtra', followUpDate: tomorrowStr,
      createdDate: '2026-08-25T14:20:00.000Z', notes: 'Risk committee clearance completed.'
    },
    {
      firstName: 'Siddharth', lastName: 'Malhotra', phone: '9821456789', email: 'sid.m@deloitte.com',
      company: 'Deloitte India', salary: 195000, budget: 7000000, loanType: 'HOME LOAN',
      bank: 'STATE BANK OF INDIA', businessPartner: 'STATE BANK OF INDIA', psm: 'Ananya Sharma',
      status: 'APPROVAL PENDING', dialStatus: 'Hot Lead', source: 'Home Loan Super Saver Scheme', campaign: 'Home Loan Super Saver Scheme', campaignName: 'Home Loan Super Saver Scheme',
      assignedTo: 'Ananya Sharma', city: 'Bengaluru', state: 'Karnataka', followUpDate: nextWeekStr,
      createdDate: '2026-09-28T16:00:00.000Z', notes: 'Technical valuation clear. Final sign-off pending.'
    },
    {
      firstName: 'Preeti', lastName: 'Zinta', phone: '9819567890', email: 'preeti@kingshospital.com',
      company: 'Kings Care Hospital', salary: 260000, budget: 3500000, loanType: 'LAP',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Priya Singh',
      status: 'APPROVAL PENDING', dialStatus: 'Hot Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Priya Singh', city: 'Chandigarh', state: 'Punjab', followUpDate: todayStr,
      createdDate: '2026-10-17T10:15:00.000Z', notes: 'Legal vetting positive. Sanction committee meets today.'
    },

    // ── APPROVED BUT NOT DISBUSE (3) ──
    {
      firstName: 'Varun', lastName: 'Dhawan', phone: '9820678901', email: 'varun.d@kpmg.com',
      company: 'KPMG India', salary: 170000, budget: 1800000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'APPROVED BUT NOT DISBUSE', dialStatus: 'Hot Lead', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Sneha Kulkarni', city: 'Mumbai', state: 'Maharashtra', followUpDate: tomorrowStr,
      createdDate: '2026-07-30T10:00:00.000Z', notes: 'Sanction letter issued. Customer signing loan kit.'
    },
    {
      firstName: 'Kriti', lastName: 'Sanon', phone: '9811789012', email: 'kriti.s@pwc.com',
      company: 'PricewaterhouseCoopers', salary: 230000, budget: 7500000, loanType: 'HOME LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'APPROVED BUT NOT DISBUSE', dialStatus: 'Hot Lead', source: 'Home Loan Super Saver Scheme', campaign: 'Home Loan Super Saver Scheme', campaignName: 'Home Loan Super Saver Scheme',
      assignedTo: 'Rahul Verma', city: 'Delhi', state: 'Delhi', followUpDate: nextWeekStr,
      createdDate: '2026-08-28T12:00:00.000Z', notes: 'Cheque preparation in progress. Awaiting stamp duty receipt.'
    },
    {
      firstName: 'Aditya', lastName: 'Roy', phone: '9833890123', email: 'aditya@roycreatives.com',
      company: 'Roy Advertising Agency', salary: 300000, budget: 4000000, loanType: 'BUSINESS LOAN',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Vikram Patel',
      status: 'APPROVED BUT NOT DISBUSE', dialStatus: 'Hot Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Kolkata', state: 'West Bengal', followUpDate: todayStr,
      createdDate: '2026-09-29T15:00:00.000Z', notes: 'Disbursement mandate signed. Transfer expected within 48h.'
    },

    // ── DISBUSED (5) ──
    {
      firstName: 'Sunil', lastName: 'Shetty', phone: '9820901234', email: 'sunil@shettyfitness.com',
      company: 'Shetty Wellness Centers', salary: 400000, budget: 5000000, loanType: 'BUSINESS LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'DISBUSED', dialStatus: 'Hot Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Rahul Verma', city: 'Mangalore', state: 'Karnataka', followUpDate: null,
      createdDate: '2026-07-15T09:00:00.000Z', notes: 'Loan disbursed successfully. Welcome kit dispatched.'
    },
    {
      firstName: 'Ajay', lastName: 'Devgn', phone: '9821012345', email: 'ajay@devgnfilms.in',
      company: 'Devgn Productions', salary: 600000, budget: 8500000, loanType: 'LAP',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Priya Singh',
      status: 'DISBUSED', dialStatus: 'Hot Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Priya Singh', city: 'Mumbai', state: 'Maharashtra', followUpDate: null,
      createdDate: '2026-07-28T11:30:00.000Z', notes: 'Funds credited to current account. First EMI due next month.'
    },
    {
      firstName: 'Madhuri', lastName: 'Dixit', phone: '9822123456', email: 'madhuri@danceacademy.com',
      company: 'Dixit Performing Arts', salary: 250000, budget: 6000000, loanType: 'HOME LOAN',
      bank: 'STATE BANK OF INDIA', businessPartner: 'STATE BANK OF INDIA', psm: 'Ananya Sharma',
      status: 'DISBUSED', dialStatus: 'Hot Lead', source: 'Home Loan Super Saver Scheme', campaign: 'Home Loan Super Saver Scheme', campaignName: 'Home Loan Super Saver Scheme',
      assignedTo: 'Ananya Sharma', city: 'Nagpur', state: 'Maharashtra', followUpDate: null,
      createdDate: '2026-08-30T14:15:00.000Z', notes: 'Disbursement DD handed over to seller.'
    },
    {
      firstName: 'Rajkumar', lastName: 'Rao', phone: '9811234567', email: 'rajkumar@cinemaarts.in',
      company: 'Cinema Arts Studio', salary: 180000, budget: 2000000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'DISBUSED', dialStatus: 'Hot Lead', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Sneha Kulkarni', city: 'Gurugram', state: 'Haryana', followUpDate: null,
      createdDate: '2026-09-25T16:00:00.000Z', notes: 'Disbursement completed via NEFT.'
    },
    {
      firstName: 'Ayushmann', lastName: 'Khurrana', phone: '9818345678', email: 'ayush@mediacorp.com',
      company: 'National Media Corp', salary: 220000, budget: 2200000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'DISBUSED', dialStatus: 'Hot Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Rahul Verma', city: 'Chandigarh', state: 'Punjab', followUpDate: null,
      createdDate: '2026-10-08T10:30:00.000Z', notes: 'Loan sanctioned and disbursed within 24 hours.'
    },

    // ── REJECTED (3) ──
    {
      firstName: 'Mohan', lastName: 'Lal', phone: '9847456789', email: 'mohanlal@keralatrades.in',
      company: 'Kerala Spices Trading', salary: 50000, budget: 1500000, loanType: 'BUSINESS LOAN',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Vikram Patel',
      status: 'REJECTED', dialStatus: 'Call Rejected', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Kochi', state: 'Kerala', followUpDate: null,
      createdDate: '2026-07-20T11:00:00.000Z', notes: 'Negative profile check and past default on auto loan.'
    },
    {
      firstName: 'Nandita', lastName: 'Das', phone: '9830567890', email: 'nandita@dascultural.org',
      company: 'Das NGO Foundation', salary: 40000, budget: 800000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'REJECTED', dialStatus: 'Call Rejected', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Ananya Sharma', city: 'Bhubaneswar', state: 'Odisha', followUpDate: null,
      createdDate: '2026-08-15T15:20:00.000Z', notes: 'Salary below minimum banking policy threshold.'
    },
    {
      firstName: 'Jitendra', lastName: 'Kumar', phone: '9810678901', email: 'jeetu@kotatutorials.in',
      company: 'Kota Science Institute', salary: 65000, budget: 1200000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'REJECTED', dialStatus: 'Call Rejected', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Sneha Kulkarni', city: 'Kota', state: 'Rajasthan', followUpDate: null,
      createdDate: '2026-09-12T12:00:00.000Z', notes: 'Multiple inquiries within last 30 days.'
    },

    // ── FOLLOWUP (5) ──
    {
      firstName: 'Boman', lastName: 'Irani', phone: '9820789012', email: 'boman@iraniphoto.com',
      company: 'Irani Photography Studio', salary: 140000, budget: 1600000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'FOLLOWUP', dialStatus: 'Warm Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Rahul Verma', city: 'Mumbai', state: 'Maharashtra', followUpDate: todayStr,
      createdDate: '2026-07-24T10:00:00.000Z', notes: 'Asked to call back post lunch regarding insurance bundling.'
    },
    {
      firstName: 'Farhan', lastName: 'Akhtar', phone: '9821890123', email: 'farhan@excelent.com',
      company: 'Excel Entertainment', salary: 350000, budget: 4500000, loanType: 'LAP',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Priya Singh',
      status: 'FOLLOWUP', dialStatus: 'Warm Lead', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Priya Singh', city: 'Mumbai', state: 'Maharashtra', followUpDate: todayStr,
      createdDate: '2026-08-22T13:30:00.000Z', notes: 'Requested revised repayment schedule over 7 years.'
    },
    {
      firstName: 'Juhi', lastName: 'Chawla', phone: '9822901234', email: 'juhi@chawlafarms.com',
      company: 'Chawla Agro Farms', salary: 280000, budget: 5200000, loanType: 'HOME LOAN',
      bank: 'STATE BANK OF INDIA', businessPartner: 'STATE BANK OF INDIA', psm: 'Ananya Sharma',
      status: 'FOLLOWUP', dialStatus: 'Warm Lead', source: 'Home Loan Super Saver Scheme', campaign: 'Home Loan Super Saver Scheme', campaignName: 'Home Loan Super Saver Scheme',
      assignedTo: 'Ananya Sharma', city: 'Pune', state: 'Maharashtra', followUpDate: tomorrowStr,
      createdDate: '2026-09-08T11:45:00.000Z', notes: 'Travelling overseas, call after arrival on Friday.'
    },
    {
      firstName: 'Kunal', lastName: 'Kapoor', phone: '9811012345', email: 'kunal@crowdfunding.in',
      company: 'Impact Creators Hub', salary: 190000, budget: 2000000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'FOLLOWUP', dialStatus: 'Warm Lead', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Sneha Kulkarni', city: 'Delhi', state: 'Delhi', followUpDate: todayStr,
      createdDate: '2026-10-05T14:00:00.000Z', notes: 'Requested WhatsApp summary of fees and foreclosure terms.'
    },
    {
      firstName: 'Pankhuri', lastName: 'Awasthy', phone: '9833123456', email: 'pankhuri@awasthycreations.in',
      company: 'Awasthy Fashion House', salary: 165000, budget: 3000000, loanType: 'BUSINESS LOAN',
      bank: 'KOTAK MAHINDRA BANK', businessPartner: 'KOTAK MAHINDRA BANK', psm: 'Vikram Patel',
      status: 'FOLLOWUP', dialStatus: 'Warm Lead', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Lucknow', state: 'Uttar Pradesh', followUpDate: nextWeekStr,
      createdDate: '2026-10-16T16:15:00.000Z', notes: 'Reviewing proposal with chartered accountant.'
    },

    // ── DROPPED (2) ──
    {
      firstName: 'Vijay', lastName: 'Raaz', phone: '9810234567', email: 'vijay@raaztheatre.in',
      company: 'Raaz Street Theatre', salary: 70000, budget: 500000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Rahul Verma',
      status: 'DROPPED', dialStatus: 'Not Intested', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Rahul Verma', city: 'Delhi', state: 'Delhi', followUpDate: null,
      createdDate: '2026-07-17T14:00:00.000Z', notes: 'Client opted out, arranged funds through family.'
    },
    {
      firstName: 'Saurabh', lastName: 'Shukla', phone: '9820345678', email: 'saurabh@shuklastudios.com',
      company: 'Shukla Script Lab', salary: 150000, budget: 2000000, loanType: 'BUSINESS LOAN',
      bank: 'AXIS BANK', businessPartner: 'AXIS BANK', psm: 'Vikram Patel',
      status: 'DROPPED', dialStatus: 'Not Intested', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Mumbai', state: 'Maharashtra', followUpDate: null,
      createdDate: '2026-08-19T11:00:00.000Z', notes: 'Decided not to expand studio this quarter.'
    },

    // ── PENDING (3) ──
    {
      firstName: 'Nawazuddin', lastName: 'Siddiqui', phone: '9821456789', email: 'nawaz@siddiquifilms.com',
      company: 'Budhana Media House', salary: 320000, budget: 4500000, loanType: 'LAP',
      bank: 'HDFC BANK', businessPartner: 'HDFC BANK', psm: 'Priya Singh',
      status: 'PENDING', dialStatus: 'Yet To Call', source: 'Diwali Festive Loan Bonanza', campaign: 'Diwali Festive Loan Bonanza', campaignName: 'Diwali Festive Loan Bonanza',
      assignedTo: 'Priya Singh', city: 'Muzaffarnagar', state: 'Uttar Pradesh', followUpDate: tomorrowStr,
      createdDate: '2026-07-26T16:00:00.000Z', notes: 'Initial intake logged via web form. Telecaller contact pending.'
    },
    {
      firstName: 'Radhika', lastName: 'Apte', phone: '9822567890', email: 'radhika@aptetheatre.in',
      company: 'Apte Dramatics', salary: 210000, budget: 1900000, loanType: 'SALARIED PERSONAL LOAN',
      bank: 'ICICI BANK', businessPartner: 'ICICI BANK', psm: 'Rahul Verma',
      status: 'PENDING', dialStatus: 'Yet To Call', source: 'Salaried Personal Loan Express', campaign: 'Salaried Personal Loan Express', campaignName: 'Salaried Personal Loan Express',
      assignedTo: 'Ananya Sharma', city: 'Pune', state: 'Maharashtra', followUpDate: todayStr,
      createdDate: '2026-08-27T10:30:00.000Z', notes: 'Lead imported via Excel batch.'
    },
    {
      firstName: 'Jaideep', lastName: 'Ahlawat', phone: '9811678901', email: 'jaideep@ahlawatsecurity.com',
      company: 'Ahlawat Security Services', salary: 180000, budget: 3200000, loanType: 'BUSINESS LOAN',
      bank: 'KOTAK MAHINDRA BANK', businessPartner: 'KOTAK MAHINDRA BANK', psm: 'Vikram Patel',
      status: 'PENDING', dialStatus: 'Yet To Call', source: 'Q3 SME Business Expansion Drive', campaign: 'Q3 SME Business Expansion Drive', campaignName: 'Q3 SME Business Expansion Drive',
      assignedTo: 'Vikram Patel', city: 'Rohtak', state: 'Haryana', followUpDate: nextWeekStr,
      createdDate: '2026-10-19T15:00:00.000Z', notes: 'Inquiry received through partner channel.'
    }
  ];

  const createdLeads: any[] = [];
  let leadCodeIdx = 101;

  const usedPhones = new Set<string>();

  for (const item of realisticLeadsData) {
    const dataCode = `LND-${leadCodeIdx++}`;
    const fullName = `${item.firstName} ${item.lastName}`;

    let phoneNum = String(item.phone || `98${10000000 + leadCodeIdx}`).trim();
    if (usedPhones.has(phoneNum)) {
      phoneNum = `98${String(10000000 + leadCodeIdx + 500)}`;
    }
    usedPhones.add(phoneNum);

    const creatorName = item.assignedTo || 'Super Admin';
    const caseDetails = item.notes || `Requirement for ${item.loanType} - verification in progress`;

    const leadRecord = await CustomRecord.create({
      organizationId: orgId,
      moduleId: leadModule._id,
      createdBy: org.adminDetails?.username || null,
      updatedBy: org.adminDetails?.username || null,
      createdAt: new Date(item.createdDate),
      updatedAt: new Date(item.createdDate),
      data: {
        firstName: item.firstName,
        lastName: item.lastName,
        fullName: fullName,
        customerName: fullName,
        phone: phoneNum,
        email: item.email,
        company: item.company,
        firmName: item.company,
        salary: item.salary,
        turnover: item.salary,
        budget: item.budget,
        loanAmount: item.budget,
        loanType: item.loanType,
        product: item.loanType,
        bank: item.bank,
        bankNames: item.bank,
        businessPartner: item.businessPartner,
        psm: item.psm,
        status: item.status,
        dialStatus: item.dialStatus,
        source: creatorName,
        creatorName: creatorName,
        caseDetails: caseDetails,
        leadCategory: 'A1 CATE',
        campaign: item.campaign,
        campaignName: item.campaignName,
        assignedTo: item.assignedTo,
        telecaller: item.assignedTo,
        assignedAgent: item.assignedTo,
        city: item.city,
        state: item.state,
        location: `${item.city}, ${item.state}`,
        presentAddress: `${item.city}, ${item.state}`,
        dataCode: dataCode,
        followUpDate: item.followUpDate,
        notes: item.notes,
        remarks: item.notes,
        currency: 'INR'
      }
    });

    createdLeads.push(leadRecord);

    // Create Activity entry for recent activities
    await Activity.create({
      organizationId: orgId,
      recordId: leadRecord._id || leadRecord.id,
      userId: superAdminRole?._id || null,
      type: 'status_change',
      details: {
        fieldName: 'status',
        oldValue: 'New',
        newValue: item.status,
        customerName: fullName,
        leadCode: dataCode
      },
      createdAt: new Date(item.createdDate)
    });
  }

  logger.info(`[Demo Seeder] Successfully inserted ${createdLeads.length} leads across all 11 stages!`);

  // 10. Seed Campaign Assignments (campaignassignments module)
  if (campaignAssignmentModule && createdLeads.length > 0) {
    const existingAssignCount = await CustomRecord.countDocuments({
      organizationId: orgId,
      moduleId: campaignAssignmentModule._id
    });

    if (existingAssignCount === 0) {
      for (let i = 0; i < Math.min(createdLeads.length, 25); i++) {
        const lead = createdLeads[i];
        const cName = lead.data?.campaign || 'Diwali Festive Loan Bonanza';
        await CustomRecord.create({
          organizationId: orgId,
          moduleId: campaignAssignmentModule._id,
          data: {
            assignmentName: `Assignment-${lead.data?.dataCode || i + 1}`,
            campaign: cName,
            lead: `${lead.data?.fullName} (${lead.data?.phone})`,
            leadId: lead._id || lead.id,
            assignedDate: lead.data?.followUpDate || todayStr,
            assignedTo: lead.data?.assignedTo
          }
        });
      }
      logger.info('[Demo Seeder] Campaign Assignments populated.');
    }
  }

  // 11. Seed Custom Report Definitions (report_definitions table)
  const existingReportsCount = await ReportDefinition.countDocuments({
    organizationId: orgId
  });

  if (existingReportsCount === 0) {
    const defaultReports = [
      {
        name: 'Lead Pipeline Stage Breakdown',
        description: 'Visualizes conversion funnel distribution across all 11 sales pipeline stages.',
        moduleId: leadModule._id,
        chartType: 'pie',
        groupByField: 'status',
        metricField: 'budget',
        aggregation: 'count',
        columns: ['fullName', 'phone', 'loanType', 'budget', 'status', 'assignedTo', 'bank'],
        createdBy: superAdminRole?._id || 'admin'
      },
      {
        name: 'Loan Amount Volume by Product',
        description: 'Total loan volume aggregated across Salaried Personal, Business, Home Loans, and LAP.',
        moduleId: leadModule._id,
        chartType: 'bar',
        groupByField: 'loanType',
        metricField: 'budget',
        aggregation: 'sum',
        columns: ['fullName', 'loanType', 'budget', 'bank', 'psm', 'status'],
        createdBy: superAdminRole?._id || 'admin'
      },
      {
        name: 'Partner Bank Distribution',
        description: 'Share of approved and disbursed leads routed through key partner banks.',
        moduleId: leadModule._id,
        chartType: 'donut',
        groupByField: 'bank',
        metricField: 'budget',
        aggregation: 'count',
        columns: ['fullName', 'bank', 'loanType', 'budget', 'psm', 'status'],
        createdBy: superAdminRole?._id || 'admin'
      },
      {
        name: 'Monthly Lead Generation by Campaign',
        description: 'Lead generation volume grouped across active marketing campaigns.',
        moduleId: leadModule._id,
        chartType: 'bar',
        groupByField: 'campaign',
        metricField: 'budget',
        aggregation: 'count',
        columns: ['fullName', 'campaign', 'loanType', 'budget', 'assignedTo', 'status'],
        createdBy: superAdminRole?._id || 'admin'
      }
    ];

    for (const r of defaultReports) {
      await ReportDefinition.create({
        organizationId: orgId,
        ...r
      });
      logger.info(`[Demo Seeder] Created Report: ${r.name}`);
    }
  }

  logger.info('[Demo Seeder] All comprehensive demo data has been seeded successfully!');
  if (shouldDisconnect) {
    await disconnectDB();
  }
}

if (require.main === module) {
  seedDemoData(true).catch((err) => {
    logger.error('Error running demo seeder:', err);
    process.exit(1);
  });
}
