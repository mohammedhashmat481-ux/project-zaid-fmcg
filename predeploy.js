const fs = require('fs');
const path = require('path');
const { Pool } = require('./backend/node_modules/pg');

console.log('=========================================================');
console.log(' Running inkCRM Pre-deployment Validation Checks (PostgreSQL)');
console.log('=========================================================');

let validationFailed = false;

// Helper to log errors
const logError = (msg) => {
  console.error(`❌ [ERROR] ${msg}`);
  validationFailed = true;
};

// Helper to log success
const logSuccess = (msg) => {
  console.log(`✅ [SUCCESS] ${msg}`);
};

// 1. Verify Directories Exist
const folders = ['uploads', 'logs', 'backend/dist', 'frontend/dist'];
folders.forEach(f => {
  const p = path.resolve(__dirname, f);
  if (!fs.existsSync(p)) {
    if (f === 'uploads' || f === 'logs') {
      fs.mkdirSync(p, { recursive: true });
      logSuccess(`Created missing directory: ${f}`);
    } else {
      logError(`Missing required build folder: ${f}. Please run builds first.`);
    }
  } else {
    logSuccess(`Directory found: ${f}`);
  }
});

// 2. Verify backend/.env and Required Environment Variables
const envPath = path.resolve(__dirname, 'backend/.env');
let envVars = {};
if (!fs.existsSync(envPath)) {
  logError('backend/.env file is missing!');
} else {
  logSuccess('backend/.env file found.');
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      envVars[key] = val;
    }
  });

  const requiredVars = ['JWT_SECRET', 'JWT_REFRESH_SECRET', 'ENCRYPTION_KEY'];
  requiredVars.forEach(v => {
    if (!envVars[v] && !process.env[v]) {
      logError(`Environment variable '${v}' is missing or empty in backend/.env`);
    } else {
      logSuccess(`Environment variable verified: ${v}`);
    }
  });

  const encKey = envVars['ENCRYPTION_KEY'] || process.env.ENCRYPTION_KEY;
  if (encKey && encKey.length < 16) {
    logError("ENCRYPTION_KEY must be at least 16 characters long.");
  }
}

// 3. Verify Database Connectivity (PostgreSQL)
const dbUrl = process.env.DATABASE_URL || envVars['DATABASE_URL'];

if (dbUrl && dbUrl.startsWith('postgres')) {
  console.log(`Testing connection to PostgreSQL server...`);
  const pool = new Pool({
    connectionString: dbUrl,
    connectionTimeoutMillis: 5000
  });

  pool.query('SELECT 1')
    .then(() => {
      logSuccess('Successfully connected to PostgreSQL database.');
      pool.end();
      finalize();
    })
    .catch(err => {
      logError(`Failed to connect to PostgreSQL: ${err.message}`);
      pool.end();
      finalize();
    });
} else {
  // Local embedded PGlite engine mode
  const pgDataDir = path.resolve(__dirname, 'pg-data');
  if (!fs.existsSync(pgDataDir)) {
    fs.mkdirSync(pgDataDir, { recursive: true });
  }
  logSuccess(`Using local PostgreSQL storage engine at: ${pgDataDir}`);
  finalize();
}

function finalize() {
  console.log('=========================================================');
  if (validationFailed) {
    console.error('❌ PRE-DEPLOYMENT VALIDATION FAILED!');
    console.error('Please fix the errors above before deploying.');
    console.log('=========================================================');
    process.exit(1);
  } else {
    console.log('✅ ALL PRE-DEPLOYMENT CHECKS PASSED!');
    console.log('inkCRM is fully ready for PostgreSQL production.');
    console.log('=========================================================');
    process.exit(0);
  }
}
