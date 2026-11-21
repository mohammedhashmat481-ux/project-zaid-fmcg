import { Pool, PoolClient } from 'pg';
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

const getConfiguredDataDir = (): string => {
  const envDir = process.env.PG_DATA_DIR;
  if (envDir) {
    return path.isAbsolute(envDir) ? envDir : path.resolve(process.cwd(), envDir);
  }
  return path.resolve(__dirname, '../../../pg-data');
};

const dbDataDir = getConfiguredDataDir();

export const getPgDriver = (): { type: 'pool' | 'pglite'; client: Pool | PGlite } => {
  if (pool) return { type: 'pool', client: pool };
  if (pgliteInstance) return { type: 'pglite', client: pgliteInstance };
  throw new Error('PostgreSQL connection has not been initialized.');
};

export interface PgExecutor {
  query: (sql: string, params?: any[]) => Promise<any>;
  exec?: (sql: string) => Promise<any>;
}

/**
 * Execute a unit of work inside an isolated database transaction with guaranteed client checkout & release.
 * In a pooled environment, this ensures all queries run strictly on the SAME client and releases the client in finally.
 */
export const withTransaction = async <T>(
  callback: (executor: PgExecutor) => Promise<T>
): Promise<T> => {
  if (pool) {
    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      const executor: PgExecutor = {
        query: async (sql: string, params: any[] = []) => {
          const res = await client.query(sql, params);
          return res.rows;
        },
        exec: async (sql: string) => {
          return client.query(sql);
        }
      };
      const result = await callback(executor);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackErr: any) {
        console.error('[PostgreSQL Transaction] Rollback error:', rollbackErr.message);
      }
      throw err;
    } finally {
      client.release();
    }
  } else if (pgliteInstance) {
    const pglite = pgliteInstance;
    try {
      await pglite.exec('BEGIN');
      const executor: PgExecutor = {
        query: async (sql: string, params: any[] = []) => {
          const res = await pglite.query(sql, params);
          return res.rows;
        },
        exec: async (sql: string) => {
          return pglite.exec(sql);
        }
      };
      const result = await callback(executor);
      await pglite.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        await pglite.exec('ROLLBACK');
      } catch (rollbackErr: any) {
        console.error('[PGlite Transaction] Rollback error:', rollbackErr.message);
      }
      throw err;
    }
  } else {
    throw new Error('PostgreSQL database not initialized.');
  }
};

export const queryPg = async (sql: string, params: any[] = []): Promise<any> => {
  const start = Date.now();
  let rows: any;
  if (pool) {
    const res = await pool.query(sql, params);
    rows = res.rows;
  } else if (pgliteInstance) {
    const res = await pgliteInstance.query(sql, params);
    rows = res.rows;
  } else {
    throw new Error('PostgreSQL database not initialized.');
  }

  const duration = Date.now() - start;
  if (duration > 150) {
    const preview = sql.replace(/\s+/g, ' ').slice(0, 120);
    console.warn(`[SLOW DB QUERY >150ms] ${duration}ms: ${preview}...`);
  }
  return rows;
};

export const execPg = async (sql: string): Promise<any> => {
  const start = Date.now();
  let res: any;
  if (pool) {
    res = await pool.query(sql);
  } else if (pgliteInstance) {
    res = await pgliteInstance.exec(sql);
  } else {
    throw new Error('PostgreSQL database not initialized.');
  }

  const duration = Date.now() - start;
  if (duration > 150) {
    const preview = sql.replace(/\s+/g, ' ').slice(0, 120);
    console.warn(`[SLOW DB EXEC >150ms] ${duration}ms: ${preview}...`);
  }
  return res;
};

export const connectPostgres = async (): Promise<void> => {
  const dbUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  const isProd = process.env.NODE_ENV === 'production';

  // Strict production safety: In production mode, silent fallback to PGlite is STRICTLY FORBIDDEN
  if (isProd && (!dbUrl || !dbUrl.startsWith('postgres'))) {
    throw new Error(
      'FATAL CONFIGURATION ERROR: In production mode (NODE_ENV=production), a valid PostgreSQL connection string (DATABASE_URL) is MANDATORY. Silent fallback to embedded PGlite is disabled in production to protect customer data integrity and prevent memory exhaustion.'
    );
  }

  if (dbUrl && dbUrl.startsWith('postgres')) {
    console.log('[PostgreSQL] Connecting via Pool to DATABASE_URL...');
    pool = new Pool({
      connectionString: dbUrl,
      max: 25,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000
    });

    try {
      const client = await pool.connect();
      console.log('[PostgreSQL] Pool connected successfully to PostgreSQL server.');
      client.release();
    } catch (err: any) {
      console.error('[PostgreSQL] Connection Pool error:', err.message);
      if (isProd) {
        throw new Error(`FATAL DATABASE ERROR: Could not connect to PostgreSQL server: ${err.message}. Server startup aborted.`);
      }
      console.log('[PostgreSQL] Falling back to local embedded PGlite storage engine (non-production mode)...');
      pool = null;
    }
  }

  if (!pool) {
    const dataDir = getConfiguredDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    const stalePid = path.join(dataDir, 'postmaster.pid');
    if (fs.existsSync(stalePid)) {
      try {
        fs.unlinkSync(stalePid);
        console.log('[PostgreSQL] Stale postmaster.pid cleaned up successfully.');
      } catch (err: any) {
        console.warn('[PostgreSQL] Could not remove postmaster.pid:', err.message);
      }
    }
    console.log(`[PostgreSQL] Initializing local PostgreSQL storage engine at: ${dataDir}`);
    pgliteInstance = new PGlite(dataDir);
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
    CREATE INDEX IF NOT EXISTS idx_users_org_active ON users(organization_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_users_org_dept ON users(organization_id, department);

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
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_created ON custom_records(organization_id, module_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cr_org_created ON custom_records(organization_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cr_created_at ON custom_records(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_cr_email ON custom_records((data->>'email'));
    CREATE INDEX IF NOT EXISTS idx_cr_phone ON custom_records((data->>'phone'));
    CREATE INDEX IF NOT EXISTS idx_cr_status ON custom_records((data->>'status'));
    CREATE INDEX IF NOT EXISTS idx_cr_source ON custom_records((data->>'source'));
    CREATE INDEX IF NOT EXISTS idx_cr_assigned ON custom_records((data->>'assignedTo'));
    CREATE INDEX IF NOT EXISTS idx_cr_followup ON custom_records((data->>'followUpDate'));
    CREATE INDEX IF NOT EXISTS idx_cr_org_followup ON custom_records(organization_id, (data->>'followUpDate'));
    CREATE INDEX IF NOT EXISTS idx_cr_campaign ON custom_records((data->>'campaign'));
    CREATE INDEX IF NOT EXISTS idx_cr_campaign_name ON custom_records((data->>'campaignName'));
    CREATE INDEX IF NOT EXISTS idx_cr_lower_campaign_name ON custom_records (lower(data->>'campaignName'));
    CREATE INDEX IF NOT EXISTS idx_cr_lower_campaign ON custom_records (lower(data->>'campaign'));
    CREATE INDEX IF NOT EXISTS idx_cr_lower_source ON custom_records (lower(data->>'source'));
    CREATE INDEX IF NOT EXISTS idx_cr_lower_assigned ON custom_records (lower(data->>'assignedTo'));
    CREATE INDEX IF NOT EXISTS idx_cr_lower_dial_status ON custom_records (lower(data->>'dialStatus'));
    CREATE INDEX IF NOT EXISTS idx_cr_lower_status ON custom_records (lower(data->>'status'));
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_lower_status ON custom_records (organization_id, module_id, lower(data->>'status'));
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_leadno ON custom_records (organization_id, module_id, (data->>'leadNo'));
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_datacode ON custom_records (organization_id, module_id, lower(data->>'dataCode'));
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_leadname ON custom_records (organization_id, module_id, lower(data->>'leadName'));
    CREATE INDEX IF NOT EXISTS idx_cr_created_asc ON custom_records (created_at ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_created_asc ON custom_records (organization_id, module_id, created_at ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_assigned_lower ON custom_records (organization_id, module_id, lower(trim(data->>'assignedTo')));
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_campname_lower ON custom_records (organization_id, module_id, lower(trim(data->>'campaignName')));
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_campaign_lower ON custom_records (organization_id, module_id, lower(trim(data->>'campaign')));
    CREATE INDEX IF NOT EXISTS idx_cr_org_mod_source_lower ON custom_records (organization_id, module_id, lower(trim(data->>'source')));
    CREATE INDEX IF NOT EXISTS idx_cr_lower_campaign_name_alt ON custom_records (lower(data->>'campaign_name'));
    CREATE INDEX IF NOT EXISTS idx_cr_lower_telecaller ON custom_records (lower(data->>'telecaller'));
    CREATE INDEX IF NOT EXISTS idx_cr_data_gin ON custom_records USING gin (data);

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
    CREATE INDEX IF NOT EXISTS idx_activities_org_user ON activities(organization_id, user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at DESC);

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
    CREATE INDEX IF NOT EXISTS idx_audit_org_user ON audit_logs(organization_id, user_id, created_at DESC);

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
    CREATE INDEX IF NOT EXISTS idx_statuses_org_vis ON statuses(organization_id, dashboard_visibility, order_num);

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
