#!/bin/bash

# Configuration
BACKUP_DIR="/var/backups/inkcrm"
DB_URL=${DATABASE_URL:-"postgresql://postgres:postgres@127.0.0.1:5432/inkcrm"}
TIMESTAMP=$(date +"%F_%H-%M-%S")
BACKUP_NAME="inkcrm_pg_backup_$TIMESTAMP"

echo "========================================================="
echo " Starting inkCRM PostgreSQL Database Backup"
echo " Time: $(date)"
echo "========================================================="

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"

# Perform pg_dump
echo "Running pg_dump to $BACKUP_DIR/$BACKUP_NAME.sql.gz..."
pg_dump "$DB_URL" | gzip > "$BACKUP_DIR/$BACKUP_NAME.sql.gz"

if [ $? -eq 0 ]; then
  echo "✅ Backup created successfully at $BACKUP_DIR/$BACKUP_NAME.sql.gz"
  
  # Retention policy: remove backups older than 14 days
  echo "Applying retention policy (deleting backups older than 14 days)..."
  find "$BACKUP_DIR" -type f -name "inkcrm_pg_backup_*.sql.gz" -mtime +14 -delete
  echo "Retention policy complete."
else
  echo "❌ Error: PostgreSQL Database backup failed!"
  exit 1
fi

echo "========================================================="
echo " Backup Process Completed Successfully"
echo "========================================================="
