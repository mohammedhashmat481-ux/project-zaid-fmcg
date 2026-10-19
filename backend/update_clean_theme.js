const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');
const path = require('path');

async function run() {
  const dbPath = path.resolve(__dirname, '../pg-data');
  console.log('Connecting to PGlite at:', dbPath);
  const p = new PGlite(dbPath);

  const hash = await bcrypt.hash('password', 10);

  // 1. Update organization to light mode and clean name
  const themeSettings = JSON.stringify({
    mode: 'light',
    primaryColor: '79 70 229',
    sidebarBg: '#0f172a',
    headerBg: '#ffffff',
    fontFamily: 'Inter'
  });

  await p.query(
    "UPDATE organizations SET name = $1, theme_settings = $2 WHERE subdomain = 'sales'",
    ['inkCRM Platform', themeSettings]
  );
  console.log('Updated sales organization to light mode & inkCRM Platform');

  // 2. Ensure admin@gmail.com has correct password and is fully approved
  await p.query(
    "UPDATE users SET password_hash = $1, is_active = true, is_approved = true, approval_status = 'approved', skip_face = true, skip_location = true WHERE email = 'admin@gmail.com'",
    [hash]
  );

  // 3. Ensure ink@crm.com exists
  const existingInk = await p.query("SELECT id FROM users WHERE email = 'ink@crm.com'");
  if (existingInk.rows.length === 0) {
    await p.query(
      `INSERT INTO users (
        id, organization_id, role_id, first_name, last_name, email, password_hash,
        is_verified, is_active, is_approved, approval_status, skip_face, skip_location
      ) VALUES (
        '6abf6d7469e1273be2fc1c99', '6abf6d7469e1273be2fc1c2e', '6abf6d7469e1273be2fc1c41',
        'Super', 'Admin', 'ink@crm.com', $1, true, true, true, 'approved', true, true
      )`,
      [hash]
    );
    console.log('Created user ink@crm.com');
  }

  // 4. Ensure admin@crm.com exists
  const existingAdmin = await p.query("SELECT id FROM users WHERE email = 'admin@crm.com'");
  if (existingAdmin.rows.length === 0) {
    await p.query(
      `INSERT INTO users (
        id, organization_id, role_id, first_name, last_name, email, password_hash,
        is_verified, is_active, is_approved, approval_status, skip_face, skip_location
      ) VALUES (
        '6abf6d7469e1273be2fc1c98', '6abf6d7469e1273be2fc1c2e', '6abf6d7469e1273be2fc1c41',
        'Admin', 'User', 'admin@crm.com', $1, true, true, true, 'approved', true, true
      )`,
      [hash]
    );
    console.log('Created user admin@crm.com');
  }

  const check = await p.query("SELECT id, name, theme_settings FROM organizations WHERE subdomain = 'sales'");
  console.log('Current sales organization:', check.rows[0]);

  await p.close();
  console.log('Done!');
}

run().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
