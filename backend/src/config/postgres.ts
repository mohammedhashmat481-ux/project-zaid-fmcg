import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

let pool: Pool | null = null;
let pgliteInstance: PGlite | null = null;

const dbDataDir = path.resolve(__dirname, '../../../pg-data');

export const getPgDriver = (): { type: 'pool' | 'pglite'; client: Pool | PGlite } => {
  if (pool) return { type: 'pool', client: pool };
  if (pgliteInstance) return { type: 'pglite', client: pgliteInstance };
  throw new Error('PostgreSQL connection has not been initialized.');
};

export const queryPg = async (sql: string, params: any[] = []): Promise<any> => {
  if (pool) {
    const res = await pool.query(sql, params);
    return res.rows;
  }
  if (pgliteInstance) {
    const res = await pgliteInstance.query(sql, params);
    return res.rows;
  }
  throw new Error('PostgreSQL database not initialized.');
};

export const execPg = async (sql: string): Promise<any> => {
  if (pool) {
    const res = await pool.query(sql);
    return res;
  }
  if (pgliteInstance) {
    const res = await pgliteInstance.exec(sql);
    return res;
  }
  throw new Error('PostgreSQL database not initialized.');
};

export const connectPostgres = async (): Promise<void> => {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

  if (dbUrl && dbUrl.startsWith('postgres')) {
    console.log('[PostgreSQL] Connecting via Pool to DATABASE_URL...');
    pool = new Pool({
      connectionString: dbUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });

    try {
      const client = await pool.connect();
      console.log('[PostgreSQL] Pool connected successfully to PostgreSQL server.');
      client.release();
    } catch (err: any) {
      console.error('[PostgreSQL] Connection Pool error:', err.message);
      console.log('[PostgreSQL] Falling back to local embedded PGlite storage engine...');
      pool = null;
    }
  }

  if (!pool) {
    if (!fs.existsSync(dbDataDir)) {
      fs.mkdirSync(dbDataDir, { recursive: true });
    }
    const stalePid = path.join(dbDataDir, 'postmaster.pid');
    if (fs.existsSync(stalePid)) {
      try {
        fs.unlinkSync(stalePid);
        console.log('[PostgreSQL] Stale postmaster.pid cleaned up successfully.');
      } catch (err: any) {
        console.warn('[PostgreSQL] Could not remove postmaster.pid:', err.message);
      }
    }
    console.log(`[PostgreSQL] Initializing local PostgreSQL storage engine at: ${dbDataDir}`);
    pgliteInstance = new PGlite(dbDataDir);
    await pgliteInstance.waitReady;
    console.log('[PostgreSQL] Local PGlite engine ready.');
  }

  await initPostgresSchema();
};

export const initPostgresSchema = async (): Promise<void> => {
  console.log('[PostgreSQL] Validating & Initializing Database Schema...');

  const schemaSql = `
    CREATE TABLE IF NOT EXISTS organizations (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      subdomain VARCHAR(255) NOT NULL UNIQUE,
      logo_url TEXT,
      favicon_url TEXT,
      login_bg_url TEXT,
      theme_settings JSONB DEFAULT '{}'::jsonb,
      enabled_modules JSONB DEFAULT '[]'::jsonb,
      company_code VARCHAR(255),
      registration_id VARCHAR(255),
      start_date VARCHAR(255),
      end_date VARCHAR(255),
      company_doc_url TEXT,
      phone_number VARCHAR(255),
      mobile VARCHAR(255),
      email VARCHAR(255),
      fax VARCHAR(255),
      website VARCHAR(255),
      currency VARCHAR(32) DEFAULT 'INR',
      address TEXT,
      city VARCHAR(255),
      state VARCHAR(255),
      country VARCHAR(255),
      postal_code VARCHAR(64),
      admin_details JSONB DEFAULT '{}'::jsonb,
      subscription JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_orgs_subdomain ON organizations(subdomain);

    CREATE TABLE IF NOT EXISTS roles (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      is_system BOOLEAN DEFAULT FALSE,
      permissions JSONB DEFAULT '{}'::jsonb,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(organization_id);

    CREATE TABLE IF NOT EXISTS users (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      role_id VARCHAR(64),
      first_name VARCHAR(255) NOT NULL,
      last_name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      plain_password TEXT,
      is_verified BOOLEAN DEFAULT FALSE,
      two_factor JSONB DEFAULT '{"enabled": false}'::jsonb,
      face_recognition JSONB DEFAULT '{"enabled": false}'::jsonb,
      registered_location JSONB,
      registration_location JSONB,
      current_location JSONB,
      location_verification_skipped BOOLEAN DEFAULT FALSE,
      login_history JSONB DEFAULT '[]'::jsonb,
      location_radius NUMERIC DEFAULT 100,
      avatar_url TEXT,
      refresh_tokens JSONB DEFAULT '[]'::jsonb,
      active_devices JSONB DEFAULT '[]'::jsonb,
      failed_login_attempts INT DEFAULT 0,
      last_failed_login_at TIMESTAMPTZ,
      user_code VARCHAR(255),
      skip_face BOOLEAN DEFAULT FALSE,
      skip_location BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      is_approved BOOLEAN DEFAULT FALSE,
      approval_status VARCHAR(64) DEFAULT 'pending',
      reporting_manager VARCHAR(64),
      department VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS module_definitions (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      singular_label VARCHAR(255) NOT NULL,
      plural_label VARCHAR(255) NOT NULL,
      api_path VARCHAR(255) NOT NULL,
      icon VARCHAR(255) DEFAULT 'FileText',
      description TEXT,
      is_system BOOLEAN DEFAULT FALSE,
      fields JSONB DEFAULT '[]'::jsonb,
      relationships JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_mod_org_api ON module_definitions(organization_id, api_path);

    CREATE TABLE IF NOT EXISTS custom_records (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      module_id VARCHAR(64) NOT NULL,
      data JSONB DEFAULT '{}'::jsonb,
      created_by VARCHAR(64),
      updated_by VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_cr_org_mod ON custom_records(organization_id, module_id);
    CREATE INDEX IF NOT EXISTS idx_cr_created_at ON custom_records(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cr_email ON custom_records((data->>'email'));
    CREATE INDEX IF NOT EXISTS idx_cr_phone ON custom_records((data->>'phone'));
    CREATE INDEX IF NOT EXISTS idx_cr_status ON custom_records((data->>'status'));
    CREATE INDEX IF NOT EXISTS idx_cr_source ON custom_records((data->>'source'));
    CREATE INDEX IF NOT EXISTS idx_cr_assigned ON custom_records((data->>'assignedTo'));

    CREATE TABLE IF NOT EXISTS activities (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      record_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      type VARCHAR(64) NOT NULL,
      details JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_activities_org_rec ON activities(organization_id, record_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS audit_logs (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      action VARCHAR(255) NOT NULL,
      resource VARCHAR(255) NOT NULL,
      resource_id VARCHAR(255),
      old_value JSONB,
      new_value JSONB,
      ip_address VARCHAR(255),
      user_agent TEXT,
      browser VARCHAR(255),
      device VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_audit_org_created ON audit_logs(organization_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS documents (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      file_path TEXT NOT NULL,
      mime_type VARCHAR(255) NOT NULL,
      size BIGINT NOT NULL,
      version INT DEFAULT 1,
      uploaded_by VARCHAR(64) NOT NULL,
      record_id VARCHAR(64),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_docs_org_rec ON documents(organization_id, record_id);

    CREATE TABLE IF NOT EXISTS notifications (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(64) DEFAULT 'info',
      is_read BOOLEAN DEFAULT FALSE,
      link TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_notifications_usr ON notifications(organization_id, user_id, is_read);

    CREATE TABLE IF NOT EXISTS statuses (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      color VARCHAR(64) DEFAULT '#4F46E5',
      icon VARCHAR(64) DEFAULT 'Circle',
      pipeline_position INT DEFAULT 0,
      dashboard_visibility BOOLEAN DEFAULT TRUE,
      is_final BOOLEAN DEFAULT FALSE,
      is_success BOOLEAN DEFAULT FALSE,
      order_num INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_statuses_org_order ON statuses(organization_id, order_num);

    CREATE TABLE IF NOT EXISTS workflows (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      module_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      trigger JSONB NOT NULL,
      conditions JSONB DEFAULT '[]'::jsonb,
      actions JSONB DEFAULT '[]'::jsonb,
      is_enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_workflows_org_mod ON workflows(organization_id, module_id, is_enabled);

    CREATE TABLE IF NOT EXISTS report_definitions (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      module_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      chart_type VARCHAR(64) NOT NULL,
      group_by_field VARCHAR(255),
      metric_field VARCHAR(255),
      aggregation VARCHAR(64) DEFAULT 'count',
      filters JSONB DEFAULT '[]'::jsonb,
      columns JSONB DEFAULT '[]'::jsonb,
      created_by VARCHAR(64) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_reports_org_mod ON report_definitions(organization_id, module_id);

    CREATE TABLE IF NOT EXISTS dashboard_layouts (
      id VARCHAR(64) PRIMARY KEY,
      organization_id VARCHAR(64) NOT NULL,
      user_id VARCHAR(64),
      name VARCHAR(255) DEFAULT 'My Dashboard',
      is_default BOOLEAN DEFAULT FALSE,
      widgets JSONB DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_dash_org_user ON dashboard_layouts(organization_id, user_id);
  `;

  await execPg(schemaSql);
};

export const disconnectPostgres = async (): Promise<void> => {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[PostgreSQL] Connection Pool closed.');
  }
  if (pgliteInstance) {
    await pgliteInstance.close();
    pgliteInstance = null;
    console.log('[PostgreSQL] Local PGlite closed.');
  }
};
