import { connectDB, disconnectDB } from '../config/db';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Import models
import Organization from '../models/Organization';
import Role from '../models/Role';
import User from '../models/User';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import DashboardLayout from '../models/DashboardLayout';
import Workflow from '../models/Workflow';
import Status from '../models/Status';
import AuditLog from '../models/AuditLog';
import Document from '../models/Document';
import Activity from '../models/Activity';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const dumpDir = path.resolve(__dirname, '../../../database-dump');

async function exportDb() {
  try {
    await connectDB();

    // Ensure output directory exists
    if (!fs.existsSync(dumpDir)) {
      fs.mkdirSync(dumpDir, { recursive: true });
    }

    const collections = [
      { name: 'organizations', model: Organization as any },
      { name: 'roles', model: Role as any },
      { name: 'users', model: User as any },
      { name: 'moduledefinitions', model: ModuleDefinition as any },
      { name: 'customrecords', model: CustomRecord as any },
      { name: 'dashboardlayouts', model: DashboardLayout as any },
      { name: 'workflows', model: Workflow as any },
      { name: 'statuses', model: Status as any },
      { name: 'auditlogs', model: AuditLog as any },
      { name: 'documents', model: Document as any },
      { name: 'activities', model: Activity as any }
    ];

    for (const col of collections) {
      console.log(`Exporting ${col.name}...`);
      const data = await col.model.find({}).lean();
      const filePath = path.join(dumpDir, `${col.name}.json`);
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      console.log(`Saved ${data.length} records to ${filePath}`);
    }

    console.log('Database export completed successfully!');
  } catch (error) {
    console.error('Failed to export database:', error);
  } finally {
    await disconnectDB();
  }
}

exportDb();
