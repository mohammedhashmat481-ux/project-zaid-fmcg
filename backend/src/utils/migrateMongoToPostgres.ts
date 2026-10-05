import mongoose from 'mongoose';
import { connectPostgres, disconnectPostgres } from '../config/postgres';
import Organization from '../models/Organization';
import Role from '../models/Role';
import User from '../models/User';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import Activity from '../models/Activity';
import AuditLog from '../models/AuditLog';
import DocumentModel from '../models/Document';
import Notification from '../models/Notification';
import Status from '../models/Status';
import Workflow from '../models/Workflow';
import ReportDefinition from '../models/ReportDefinition';
import DashboardLayout from '../models/DashboardLayout';

export async function migrateMongoToPostgres() {
  console.log('=== STARTING MONGODB TO POSTGRESQL DATA MIGRATION ===');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/project_zaid';
  console.log(`Connecting to MongoDB at ${mongoUri}...`);

  try {
    await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
    console.log('MongoDB connected successfully.');
  } catch (err: any) {
    console.log(`Could not connect to MongoDB at ${mongoUri} (${err.message}). Skipping MongoDB data import.`);
    await connectPostgres();
    return;
  }

  await connectPostgres();

  const db = mongoose.connection.db;
  if (!db) {
    console.error('MongoDB database object not available.');
    return;
  }

  // 1. Migrate Organizations
  const orgs = await db.collection('organizations').find({}).toArray();
  console.log(`Migrating ${orgs.length} Organization(s)...`);
  for (const doc of orgs) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await Organization.findById(cleanDoc._id);
    if (!existing) {
      await Organization.create(cleanDoc);
    }
  }

  // 2. Migrate Roles
  const roles = await db.collection('roles').find({}).toArray();
  console.log(`Migrating ${roles.length} Role(s)...`);
  for (const doc of roles) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await Role.findById(cleanDoc._id);
    if (!existing) {
      await Role.create(cleanDoc);
    }
  }

  // 3. Migrate Users
  const users = await db.collection('users').find({}).toArray();
  console.log(`Migrating ${users.length} User(s)...`);
  for (const doc of users) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await User.findById(cleanDoc._id);
    if (!existing) {
      await User.create(cleanDoc);
    }
  }

  // 4. Migrate Module Definitions
  const modules = await db.collection('moduledefinitions').find({}).toArray();
  console.log(`Migrating ${modules.length} ModuleDefinition(s)...`);
  for (const doc of modules) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await ModuleDefinition.findById(cleanDoc._id);
    if (!existing) {
      await ModuleDefinition.create(cleanDoc);
    }
  }

  // 5. Migrate Custom Records
  const records = await db.collection('customrecords').find({}).toArray();
  console.log(`Migrating ${records.length} CustomRecord(s)...`);
  for (const doc of records) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await CustomRecord.findById(cleanDoc._id);
    if (!existing) {
      await CustomRecord.create(cleanDoc);
    }
  }

  // 6. Migrate Activities
  const activities = await db.collection('activities').find({}).toArray();
  console.log(`Migrating ${activities.length} Activity record(s)...`);
  for (const doc of activities) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await Activity.findById(cleanDoc._id);
    if (!existing) {
      await Activity.create(cleanDoc);
    }
  }

  // 7. Migrate Audit Logs
  const auditLogs = await db.collection('auditlogs').find({}).toArray();
  console.log(`Migrating ${auditLogs.length} AuditLog(s)...`);
  for (const doc of auditLogs) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await AuditLog.findById(cleanDoc._id);
    if (!existing) {
      await AuditLog.create(cleanDoc);
    }
  }

  // 8. Migrate Documents
  const documents = await db.collection('documents').find({}).toArray();
  console.log(`Migrating ${documents.length} Document(s)...`);
  for (const doc of documents) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await DocumentModel.findById(cleanDoc._id);
    if (!existing) {
      await DocumentModel.create(cleanDoc);
    }
  }

  // 9. Migrate Notifications
  const notifications = await db.collection('notifications').find({}).toArray();
  console.log(`Migrating ${notifications.length} Notification(s)...`);
  for (const doc of notifications) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await Notification.findById(cleanDoc._id);
    if (!existing) {
      await Notification.create(cleanDoc);
    }
  }

  // 10. Migrate Statuses
  const statuses = await db.collection('statuses').find({}).toArray();
  console.log(`Migrating ${statuses.length} Status(es)...`);
  for (const doc of statuses) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await Status.findById(cleanDoc._id);
    if (!existing) {
      await Status.create(cleanDoc);
    }
  }

  // 11. Migrate Workflows
  const workflows = await db.collection('workflows').find({}).toArray();
  console.log(`Migrating ${workflows.length} Workflow(s)...`);
  for (const doc of workflows) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await Workflow.findById(cleanDoc._id);
    if (!existing) {
      await Workflow.create(cleanDoc);
    }
  }

  // 12. Migrate Report Definitions
  const reports = await db.collection('reportdefinitions').find({}).toArray();
  console.log(`Migrating ${reports.length} ReportDefinition(s)...`);
  for (const doc of reports) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await ReportDefinition.findById(cleanDoc._id);
    if (!existing) {
      await ReportDefinition.create(cleanDoc);
    }
  }

  // 13. Migrate Dashboard Layouts
  const layouts = await db.collection('dashboardlayouts').find({}).toArray();
  console.log(`Migrating ${layouts.length} DashboardLayout(s)...`);
  for (const doc of layouts) {
    const cleanDoc = mapMongoDoc(doc);
    const existing = await DashboardLayout.findById(cleanDoc._id);
    if (!existing) {
      await DashboardLayout.create(cleanDoc);
    }
  }

  console.log('=== MONGODB TO POSTGRESQL MIGRATION COMPLETE ===');
  await mongoose.disconnect();
}

function mapMongoDoc(doc: any): any {
  if (!doc) return doc;
  const copy: any = { ...doc };

  if (copy._id) {
    copy._id = copy._id.toString();
  }

  Object.keys(copy).forEach((k) => {
    if (copy[k] && typeof copy[k] === 'object' && copy[k]._bsontype === 'ObjectID') {
      copy[k] = copy[k].toString();
    }
  });

  return copy;
}

if (require.main === module) {
  migrateMongoToPostgres()
    .then(() => {
      console.log('Migration script finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration script failed:', err);
      process.exit(1);
    });
}
