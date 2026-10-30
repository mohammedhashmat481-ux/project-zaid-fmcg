#!/bin/bash
set -e

# Increase Node memory allocation for low-RAM VPS servers (2GB RAM)
export NODE_OPTIONS="--max-old-space-size=1536"

echo "========================================================="
echo " Starting inkCRM Production Deployment Automation"
echo " Time: $(date)"
echo " Memory Limit: $NODE_OPTIONS"
echo "========================================================="

# 1. Pull latest code
echo "Checking git status..."
git status

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

# Auto-sync built frontend to all active Nginx root directories on server
echo "Scanning active Nginx site configurations for web roots..."
NGINX_ROOTS=$(grep -rn "root " /etc/nginx/sites-enabled/ /etc/nginx/conf.d/ 2>/dev/null | awk '{print $3}' | tr -d ';')
echo "Detected Nginx root directories: $NGINX_ROOTS"
for dir in $NGINX_ROOTS; do
  if [ -d "$dir" ] && [ "$dir" != "$(pwd)/frontend/dist" ]; then
    echo "Syncing frontend dist to Nginx root: $dir"
    cp -r frontend/dist/* "$dir/" || true
  fi
done

for web_root in "/var/www/inkcrm/frontend/dist" "/var/www/inkCRM/frontend/dist" "/var/www/novaleadnexa/frontend/dist" "/var/www/novaleadnexa.in/frontend/dist" "/var/www/project-zaid-fmcg/frontend/dist" "/usr/share/nginx/html"; do
  if [ -d "$web_root" ] && [ "$web_root" != "$(pwd)/frontend/dist" ]; then
    echo "Syncing frontend dist to $web_root..."
    cp -r frontend/dist/* "$web_root/" || true
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

echo "========================================================="
echo " inkCRM Production Deployment Completed Successfully! 🎉"
echo "========================================================="
