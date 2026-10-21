import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { connectDB, disconnectDB } from '../config/db';
import Organization from '../models/Organization';
import Role from '../models/Role';
import User from '../models/User';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import DashboardLayout from '../models/DashboardLayout';
import Status from '../models/Status';
import { logger } from './logger';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const createRolePermissions = (modulePaths: string[]) => ({
  modules: modulePaths.map((p) => ({
    moduleName: p,
    create: true,
    read: 'all' as const,
    update: 'all' as const,
    delete: 'all' as const
  })),
  fields: [],
  menus: [
    'dashboard', 'leads', 'campaigns', 'campaignassignments',
    'lead_reports', 'telecaller_reports', 'telecaller_monthly',
    'funnel_daily', 'funnel_monthly', 'funnel_annual',
    'settings', 'access_privilege', 'lead_transfer', 'lead_import_delete', 'users_management',
    ...modulePaths
  ]
});

const defaultDepartments = [
  { name: 'Telemarketing', code: 'TELEMARKETING' },
  { name: 'Management', code: 'MANAGEMENT' },
  { name: 'SALES MANAGER', code: 'SALES_MANAGER' },
  { name: 'Accounts', code: 'ACCOUNTS' },
  { name: 'RELATIONSHIP MANAGER', code: 'RELATIONSHIP_MANAGER' },
  { name: 'PRODUCTS SALES MANAGER', code: 'PRODUCTS_SALES_MANAGER' },
  { name: 'AREA SALES MANAGER', code: 'AREA_SALES_MANAGER' },
  { name: 'PARTNER', code: 'PARTNER' },
  { name: 'BUSINESS CORRESPONDENT', code: 'BUSINESS_CORRESPONDENT' },
  { name: 'SPOKE', code: 'SPOKE' }
];

const defaultStatuses = [
  { name: 'HOT LEADS', icon: 'Flame', color: '#0284C7', category: 'pipeline', pipelinePosition: 1, isFinal: false, dashboardVisibility: true, order: 1 },
  { name: 'WARM LEADS', icon: 'Sun', color: '#F59E0B', category: 'pipeline', pipelinePosition: 2, isFinal: false, dashboardVisibility: true, order: 2 },
  { name: 'CEBIL PENDING', icon: 'FileWarning', color: '#E11D48', category: 'pipeline', pipelinePosition: 3, isFinal: false, dashboardVisibility: true, order: 3 },
  { name: 'DOCUMENT PENDING', icon: 'FileText', color: '#0284C7', category: 'pipeline', pipelinePosition: 4, isFinal: false, dashboardVisibility: true, order: 4 },
  { name: 'APPROVAL PENDING', icon: 'Clock', color: '#EA580C', category: 'pipeline', pipelinePosition: 5, isFinal: false, dashboardVisibility: true, order: 5 },
  { name: 'APPROVED BUT NOT DISBUSE', icon: 'CheckCircle', color: '#F59E0B', category: 'pipeline', pipelinePosition: 6, isFinal: false, dashboardVisibility: true, order: 6 },
  { name: 'DISBUSED', icon: 'Banknote', color: '#16A34A', category: 'pipeline', pipelinePosition: 7, isFinal: true, isSuccess: true, dashboardVisibility: true, order: 7 },
  { name: 'REJECTED', icon: 'XOctagon', color: '#E11D48', category: 'overview', pipelinePosition: 8, isFinal: true, isSuccess: false, dashboardVisibility: true, order: 8 },
  { name: 'FOLLOWUP', icon: 'PhoneCall', color: '#0284C7', category: 'followups', pipelinePosition: 9, isFinal: false, dashboardVisibility: true, order: 9 },
  { name: 'DROPPED', icon: 'ArrowDownCircle', color: '#EA580C', category: 'overview', pipelinePosition: 10, isFinal: true, isSuccess: false, dashboardVisibility: true, order: 10 },
  { name: 'PENDING', icon: 'Hourglass', color: '#F59E0B', category: 'followups', pipelinePosition: 11, isFinal: false, dashboardVisibility: true, order: 11 }
];

export async function seedNewTenantData(organizationId: any, adminUserId?: any) {
  logger.info(`[Auto-Seeder] Seeding modules, roles, statuses and departments for organization: ${organizationId}`);

  // 1. Create Core System Module Definitions
  const leadModule = await ModuleDefinition.create({
    organizationId,
    name: 'Lead',
    singularLabel: 'Lead',
    pluralLabel: 'Leads',
    apiPath: 'leads',
    icon: 'UserPlus',
    isSystem: true,
    fields: [
      // --- LOAN DETAILS (13 FIELDS) ---
      { name: 'dataCode', label: 'Data Code', type: 'text', required: false },
      {
        name: 'status',
        label: 'Current Status',
        type: 'dropdown',
        required: true,
        defaultValue: 'HOT LEADS',
        options: defaultStatuses.map(s => s.name)
      },
      { name: 'caseDetails', label: 'Case Details', type: 'text', required: false },
      { name: 'leadCategory', label: 'Lead Category', type: 'text', required: false },
      {
        name: 'loanType',
        label: 'Loan Type',
        type: 'dropdown',
        required: true,
        defaultValue: 'SALARIED PERSONAL LOAN',
        options: ['SALARIED PERSONAL LOAN', 'BUSINESS LOAN', 'HOME LOAN', 'LAP']
      },
      { name: 'notes', label: 'Remarks', type: 'textarea', required: false },
      { name: 'budget', label: 'Loan Amount', type: 'currency', required: true },
      { name: 'assignedTo', label: 'Assign To Agent', type: 'dropdown', required: true },
      { name: 'source', label: 'Source', type: 'text', required: false, defaultValue: 'Ink CRM' },
      { name: 'businessPartner', label: 'Business Partners', type: 'dropdown', required: true },
      { name: 'psm', label: 'PSM', type: 'text', required: true },
      { name: 'assignToTeam', label: 'Assign To Team', type: 'dropdown', required: false },
      { name: 'followUpDate', label: 'Follow-Up Date', type: 'date', required: false },

      // --- PERSONAL DETAILS (11 FIELDS) ---
      { name: 'firstName', label: 'First Name', type: 'text', required: true },
      { name: 'lastName', label: 'Last Name', type: 'text', required: false },
      { name: 'company', label: 'Company Name', type: 'text', required: false },
      { name: 'phone', label: 'Mobile', type: 'phone', required: false },
      { name: 'email', label: 'E-Mail', type: 'email', required: false },
      { name: 'city', label: 'City', type: 'text', required: false },
      { name: 'presentAddress', label: 'Present Address', type: 'textarea', required: false },
      { name: 'pinCode', label: 'PinCode', type: 'text', required: false },
      {
        name: 'state',
        label: 'State',
        type: 'dropdown',
        required: false,
        options: [
          'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
          'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
          'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu',
          'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu and Kashmir', 'Chandigarh'
        ]
      },
      {
        name: 'country',
        label: 'Country',
        type: 'dropdown',
        required: false,
        defaultValue: 'INDIA',
        options: ['INDIA', 'USA', 'UAE', 'UK', 'Other']
      },
      { name: 'salary', label: 'Salary', type: 'currency', required: false }
    ]
  });

  const companyModule = await ModuleDefinition.create({
    organizationId,
    name: 'Company',
    singularLabel: 'Company',
    pluralLabel: 'Companies',
    apiPath: 'companies',
    icon: 'Building2',
    isSystem: true,
    fields: [
      { name: 'companyName', label: 'Company Name', type: 'text', required: true, unique: true },
      { name: 'website', label: 'Website', type: 'text', required: false, unique: false },
      { name: 'employees', label: 'Employees', type: 'number', required: false, unique: false },
      { name: 'industry', label: 'Industry', type: 'text', required: false, unique: false }
    ]
  });

  const dealModule = await ModuleDefinition.create({
    organizationId,
    name: 'Deal',
    singularLabel: 'Deal',
    pluralLabel: 'Deals',
    apiPath: 'deals',
    icon: 'Briefcase',
    isSystem: true,
    fields: [
      { name: 'dealName', label: 'Deal Name', type: 'text', required: true, unique: false },
      { name: 'amount', label: 'Amount', type: 'currency', required: true, unique: false },
      { name: 'stage', label: 'Stage', type: 'text', required: true, unique: false },
      { name: 'closingDate', label: 'Closing Date', type: 'date', required: false, unique: false }
    ]
  });

  const departmentModule = await ModuleDefinition.create({
    organizationId,
    name: 'Department',
    singularLabel: 'Department',
    pluralLabel: 'Departments',
    apiPath: 'departments',
    icon: 'FolderTree',
    isSystem: true,
    fields: [
      { name: 'name', label: 'Department Name', type: 'text', required: true, unique: true },
      { name: 'code', label: 'Department Code', type: 'text', required: true, unique: true }
    ]
  });

  const campaignModule = await ModuleDefinition.create({
    organizationId,
    name: 'Campaign',
    singularLabel: 'Campaign',
    pluralLabel: 'Campaigns',
    apiPath: 'campaigns',
    icon: 'Target',
    isSystem: true,
    fields: [
      { name: 'campaignName', label: 'Campaign Name', type: 'text', required: true, unique: true },
      {
        name: 'status',
        label: 'Status',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'Planned',
        options: ['Planned', 'Active', 'Completed', 'Cancelled']
      },
      {
        name: 'type',
        label: 'Type',
        type: 'dropdown',
        required: true,
        unique: false,
        defaultValue: 'Email',
        options: ['Email', 'Social Media', 'Cold Call', 'Webinar', 'Event']
      },
      { name: 'budget', label: 'Budget', type: 'currency', required: false, unique: false },
      { name: 'startDate', label: 'Start Date', type: 'date', required: false, unique: false },
      { name: 'endDate', label: 'End Date', type: 'date', required: false, unique: false },
      { name: 'notes', label: 'Notes', type: 'rich-text', required: false, unique: false }
    ]
  });

  const campaignAssignmentModule = await ModuleDefinition.create({
    organizationId,
    name: 'CampaignAssignment',
    singularLabel: 'Campaign Assignment',
    pluralLabel: 'Campaign Assignments',
    apiPath: 'campaignassignments',
    icon: 'UserCheck',
    isSystem: true,
    fields: [
      { name: 'assignmentName', label: 'Assignment Title', type: 'text', required: true, unique: false },
      { name: 'campaign', label: 'Campaign', type: 'dropdown', required: true, unique: false, options: [] },
      { name: 'lead', label: 'Assigned Lead', type: 'dropdown', required: true, unique: false, options: [] },
      { name: 'assignedDate', label: 'Assigned Date', type: 'date', required: true, unique: false }
    ]
  });

  const bankMasterModule = await ModuleDefinition.create({
    organizationId,
    name: 'BankMaster',
    singularLabel: 'Bank Master',
    pluralLabel: 'Bank Masters',
    apiPath: 'bankmasters',
    icon: 'Landmark',
    isSystem: true,
    fields: [
      { name: 'bankName', label: 'Bank Name', type: 'text', required: true, unique: true },
      { name: 'code', label: 'Bank Code', type: 'text', required: false, unique: false }
    ]
  });

  const bankingPartnerModule = await ModuleDefinition.create({
    organizationId,
    name: 'BankingPartner',
    singularLabel: 'Banking Partner',
    pluralLabel: 'Banking Partners',
    apiPath: 'bankingpartners',
    icon: 'Handshake',
    isSystem: true,
    fields: [
      { name: 'partnerName', label: 'Partner Name', type: 'text', required: true, unique: true },
      { name: 'partnerCode', label: 'Partner Code', type: 'text', required: false, unique: false }
    ]
  });

  const productModule = await ModuleDefinition.create({
    organizationId,
    name: 'Product',
    singularLabel: 'Product',
    pluralLabel: 'Products',
    apiPath: 'products',
    icon: 'Package',
    isSystem: true,
    fields: [
      { name: 'productName', label: 'Product Name', type: 'text', required: true, unique: true },
      { name: 'category', label: 'Category', type: 'text', required: false, unique: false }
    ]
  });

  const allModulePaths = ['leads', 'deals', 'companies', 'campaigns', 'campaignassignments', 'departments', 'bankmasters', 'bankingpartners', 'products'];
  const fullPermissions = createRolePermissions(allModulePaths);

  // 2. Create System Roles
  const superAdminRole = await Role.create({
    organizationId,
    name: 'Super Admin',
    description: 'Full organizational access and administration rights',
    isSystem: true,
    isActive: true,
    permissions: fullPermissions
  });

  await Role.create({
    organizationId,
    name: 'ADMIN',
    description: 'Administrative access',
    isSystem: false,
    isActive: true,
    permissions: fullPermissions
  });

  await Role.create({
    organizationId,
    name: 'PARTNER',
    description: 'Partner role with standard access',
    isSystem: false,
    isActive: true,
    permissions: fullPermissions
  });

  await Role.create({
    organizationId,
    name: 'ARIA SALES MANAGER',
    description: 'Area Sales Manager role',
    isSystem: false,
    isActive: true,
    permissions: fullPermissions
  });

  await Role.create({
    organizationId,
    name: 'TELI CALLER',
    description: 'Telecaller calling team role',
    isSystem: false,
    isActive: true,
    permissions: fullPermissions
  });

  // 3. Create Default Departments
  for (const dept of defaultDepartments) {
    await CustomRecord.create({
      organizationId,
      moduleId: departmentModule._id,
      data: {
        name: dept.name,
        code: dept.code
      },
      createdBy: adminUserId || null,
      updatedBy: adminUserId || null
    });
  }

  // 4. Create Default Pipeline Statuses
  for (const st of defaultStatuses) {
    await Status.create({
      organizationId,
      ...st
    });
  }

  // 5. Create Default Dashboard Layout
  await DashboardLayout.create({
    organizationId,
    userId: adminUserId || null,
    name: 'Main CRM Dashboard',
    isDefault: true,
    widgets: [
      { id: 'widget_1', type: 'leads_count', title: 'Total Leads', x: 0, y: 0, w: 4, h: 2, config: {} },
      { id: 'widget_2', type: 'deals_count', title: 'Open Deals', x: 4, y: 0, w: 4, h: 2, config: {} },
      { id: 'widget_3', type: 'sales_funnel', title: 'Sales Funnel', x: 0, y: 2, w: 8, h: 4, config: {} }
    ]
  });

  return {
    superAdminRole,
    leadModule,
    companyModule,
    dealModule,
    departmentModule
  };
}

async function createSuperAdmin(organizationId: any, roleId: any, email: string, password: string) {
  const normalizedEmail = email.toLowerCase().trim();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    logger.info(`[Auto-Seeder] User with email ${normalizedEmail} already exists. Skipping.`);
    return existing;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const admin = await User.create({
    organizationId,
    roleId,
    firstName: 'Super',
    lastName: 'Admin',
    email: normalizedEmail,
    passwordHash,
    plainPassword: password,
    isVerified: true,
    isActive: true,
    isApproved: true,
    approvalStatus: 'approved',
    skipFace: true,
    skipLocation: true,
    department: 'Management',
    twoFactor: { enabled: false },
    faceRecognition: { enabled: false }
  });

  logger.info(`[Auto-Seeder] Super Admin user created successfully with email: ${normalizedEmail}`);
  return admin;
}

export async function seedDatabase(shouldDisconnect = false): Promise<void> {
  await connectDB();

  // Idempotency check: Do not re-seed if an organization already exists
  const existingCount = await Organization.countDocuments();
  if (existingCount > 0) {
    logger.info(`[Auto-Seeder] Organizations detected in database (${existingCount} found). Seeding skipped.`);
    if (shouldDisconnect) {
      await disconnectDB();
    }
    return;
  }

  logger.info('[Auto-Seeder] Fresh PostgreSQL database detected. Starting automated initial seeding...');

  // 1. Create First Organization
  const orgName = process.env.ORG_NAME || 'inkSales Enterprises';
  const orgSubdomain = (process.env.ORG_SUBDOMAIN || 'sales').toLowerCase().trim();

  const organization = await Organization.create({
    name: orgName,
    subdomain: orgSubdomain,
    logoUrl: '/logo.png',
    faviconUrl: '/favicon.ico',
    themeSettings: {
      primaryColor: '79 70 229',
      sidebarBg: '#0f172a',
      headerBg: '#ffffff',
      fontFamily: 'Inter',
      mode: 'dark'
    },
    enabledModules: ['dashboard', 'leads', 'deals', 'companies', 'campaigns', 'campaignassignments', 'tasks', 'settings', 'reports', 'workflows', 'departments', 'bankmasters', 'bankingpartners', 'products'],
    subscription: {
      plan: 'enterprise',
      status: 'active',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    },
    currency: 'INR'
  });

  logger.info(`[Auto-Seeder] Created Organization: ${organization.name} (Subdomain: ${organization.subdomain})`);

  // 2. Seed Tenant Modules, Roles, Departments, Statuses
  const tenantData = await seedNewTenantData(organization._id);

  // 3. Handle Super Admin User Creation via Environment Variables
  const adminEmail = process.env.ADMIN_EMAIL ? process.env.ADMIN_EMAIL.trim() : '';
  const adminPassword = process.env.ADMIN_PASSWORD ? process.env.ADMIN_PASSWORD.trim() : '';

  if (!adminEmail || !adminPassword) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('[Auto-Seeder] ADMIN_EMAIL or ADMIN_PASSWORD is missing in production environment. Skipping Super Admin user creation. Please define ADMIN_EMAIL and ADMIN_PASSWORD in your environment variables.');
    } else {
      const fallbackEmail = 'admin@crm.com';
      const fallbackPassword = 'novaleadnexa1309';
      logger.info(`[Auto-Seeder] No ADMIN_EMAIL/ADMIN_PASSWORD provided. In development mode, provisioning Super Admin (${fallbackEmail} / ${fallbackPassword}).`);
      await createSuperAdmin(organization._id, tenantData.superAdminRole._id, fallbackEmail, fallbackPassword);
    }
  } else {
    await createSuperAdmin(organization._id, tenantData.superAdminRole._id, adminEmail, adminPassword);
  }

  logger.info('[Auto-Seeder] Automated PostgreSQL database seeding completed successfully!');

  if (shouldDisconnect) {
    await disconnectDB();
  }
}

if (require.main === module) {
  seedDatabase(true).catch((err) => {
    logger.error('Error running database seeder:', err);
    process.exit(1);
  });
}
