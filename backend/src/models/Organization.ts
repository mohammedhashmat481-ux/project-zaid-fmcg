import { createPgModel, FieldMapping } from './PgModel';

export interface IOrganization {
  _id?: string;
  id?: string;
  name: string;
  subdomain: string;
  logoUrl?: string;
  faviconUrl?: string;
  loginBgUrl?: string;
  themeSettings?: any;
  enabledModules?: string[];
  companyCode?: string;
  registrationId?: string;
  startDate?: string;
  endDate?: string;
  companyDocUrl?: string;
  phoneNumber?: string;
  mobile?: string;
  email?: string;
  fax?: string;
  website?: string;
  currency?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  adminDetails?: any;
  subscription?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

const mappings: FieldMapping[] = [
  { dbColumn: 'id', jsField: 'id' },
  { dbColumn: 'name', jsField: 'name' },
  { dbColumn: 'subdomain', jsField: 'subdomain' },
  { dbColumn: 'logo_url', jsField: 'logoUrl' },
  { dbColumn: 'favicon_url', jsField: 'faviconUrl' },
  { dbColumn: 'login_bg_url', jsField: 'loginBgUrl' },
  { dbColumn: 'theme_settings', jsField: 'themeSettings', isJson: true },
  { dbColumn: 'enabled_modules', jsField: 'enabledModules', isJson: true },
  { dbColumn: 'company_code', jsField: 'companyCode' },
  { dbColumn: 'registration_id', jsField: 'registrationId' },
  { dbColumn: 'start_date', jsField: 'startDate' },
  { dbColumn: 'end_date', jsField: 'endDate' },
  { dbColumn: 'company_doc_url', jsField: 'companyDocUrl' },
  { dbColumn: 'phone_number', jsField: 'phoneNumber' },
  { dbColumn: 'mobile', jsField: 'mobile' },
  { dbColumn: 'email', jsField: 'email' },
  { dbColumn: 'fax', jsField: 'fax' },
  { dbColumn: 'website', jsField: 'website' },
  { dbColumn: 'currency', jsField: 'currency' },
  { dbColumn: 'address', jsField: 'address' },
  { dbColumn: 'city', jsField: 'city' },
  { dbColumn: 'state', jsField: 'state' },
  { dbColumn: 'country', jsField: 'country' },
  { dbColumn: 'postal_code', jsField: 'postalCode' },
  { dbColumn: 'admin_details', jsField: 'adminDetails', isJson: true },
  { dbColumn: 'subscription', jsField: 'subscription', isJson: true },
  { dbColumn: 'created_at', jsField: 'createdAt' },
  { dbColumn: 'updated_at', jsField: 'updatedAt' }
];

const OrganizationModel = createPgModel('organizations', mappings);
export default OrganizationModel;
