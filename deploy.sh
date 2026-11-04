#!/bin/bash
set -e

# Increase Node memory allocation for low-RAM VPS servers (2GB RAM)
export NODE_OPTIONS="--max-old-space-size=1536"

echo "========================================================="
echo " Starting inkCRM Production Deployment Automation"
echo " Time: $(date)"
echo " Memory Limit: $NODE_OPTIONS"
echo "========================================================="

# 1. Pull latest code from origin main with hard reset to prevent merge blocks
echo "Fetching and syncing latest code from origin main..."
git fetch origin main || true
git reset --hard origin/main || git pull origin main || true
CURRENT_COMMIT=$(git rev-parse --short HEAD)
echo "Deploying commit: $CURRENT_COMMIT - $(git log -1 --pretty=%B | head -n 1)"

# 2. Verify environment files exist
if [ ! -f "backend/.env" ]; then
  echo "❌ Error: backend/.env is missing! Deployment aborted."
  echo "Please configure your environment variables based on backend/.env.example."
  exit 1
fi

if [ ! -f "frontend/.env" ]; then
  echo "⚠️ Warning: frontend/.env is missing! Creating default frontend/.env..."
  echo "VITE_API_URL=/api/v1" > frontend/.env
  echo "VITE_FILE_BASE_URL=" >> frontend/.env
fi

# Clean old build artifacts to force fresh compilation
echo "Cleaning old build artifacts..."
rm -rf backend/dist frontend/dist

# 3. Install backend dependencies and build
echo "Installing backend dependencies..."
cd backend
npm install
chmod +x node_modules/.bin/* 2>/dev/null || true
echo "Compiling TypeScript backend..."
npx tsc
cd ..

# 4. Install frontend dependencies and build
echo "Installing frontend dependencies..."
cd frontend
npm install
chmod +x node_modules/.bin/* 2>/dev/null || true
echo "Building React frontend production package..."
npx vite build
cd ..

# Safe frontend deployment: Sync ONLY to this project's dedicated web root
echo "Setting permissions on project frontend dist..."
chmod -R 755 frontend/dist || true

# Target ONLY this project's specific directory (NEVER touch /var/www/html or other projects on the server like school-erp!)
for web_root in "/var/www/novaleadnexa/frontend/dist" "/var/www/novaleadnexa.in/frontend/dist" "/var/www/project-zaid-fmcg/frontend/dist"; do
  if [ -d "$web_root" ] && [ "$web_root" != "$(pwd)/frontend/dist" ]; then
    echo "Syncing frontend dist to project web root: $web_root..."
    cp -r frontend/dist/* "$web_root/" || true
    chmod -R 755 "$web_root" || true
  fi
done

# 5. Verify build success and run pre-deployment checks
echo "Running Pre-deployment Validation Checks..."
node predeploy.js

# 6. Synchronize module definitions, campaigns, statuses, and permissions
echo "Populating complete database record set and syncing campaign modules..."
cd backend
node dist/utils/syncCampaignModules.js || true
node dist/utils/syncExact11Statuses.js || true
node dist/utils/approveExistingUsers.js || true
node dist/utils/seeder.js || true
cd ..

# 7. PM2 worker configurations & startup
echo "Configuring and restarting PM2 processes..."
pm2 delete inkcrm-backend 2>/dev/null || true
pm2 start ecosystem.config.cjs --env production

# Save PM2 process list to persist across OS reboots
pm2 save

# 8. Clear Nginx cache and reload Nginx web server automatically
echo "Clearing web cache and reloading Nginx web server..."
rm -rf /var/cache/nginx/* 2>/dev/null || true
systemctl reload nginx 2>/dev/null || nginx -s reload 2>/dev/null || true

echo "========================================================="
echo " inkCRM Production Deployment Completed Successfully! 🎉"
echo " Deployed Commit: $CURRENT_COMMIT"
echo " Time: $(date)"
echo "========================================================="
