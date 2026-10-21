import { connectDB, disconnectDB } from '../config/db';
import dotenv from 'dotenv';
import path from 'path';
import Status from '../models/Status';
import Organization from '../models/Organization';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const EXACT_11_STATUSES = [
  { name: 'HOT LEADS', icon: 'Flame', color: '#0284C7', category: 'pipeline', pipelinePosition: 2, isFinal: false, dashboardVisibility: true, order: 1 },
  { name: 'WARM LEADS', icon: 'Sun', color: '#F59E0B', category: 'pipeline', pipelinePosition: 3, isFinal: false, dashboardVisibility: true, order: 2 },
  { name: 'CEBIL PENDING', icon: 'FileWarning', color: '#E11D48', category: 'pipeline', pipelinePosition: 5, isFinal: false, dashboardVisibility: true, order: 3 },
  { name: 'DOCUMENT PENDING', icon: 'FileText', color: '#0284C7', category: 'pipeline', pipelinePosition: 6, isFinal: false, dashboardVisibility: true, order: 4 },
  { name: 'APPROVAL PENDING', icon: 'Clock', color: '#EA580C', category: 'pipeline', pipelinePosition: 7, isFinal: false, dashboardVisibility: true, order: 5 },
  { name: 'APPROVED BUT NOT DISBUSE', icon: 'CheckCircle', color: '#F59E0B', category: 'pipeline', pipelinePosition: 8, isFinal: false, dashboardVisibility: true, order: 6 },
  { name: 'DISBUSED', icon: 'Banknote', color: '#16A34A', category: 'pipeline', pipelinePosition: 9, isFinal: true, isSuccess: true, dashboardVisibility: true, order: 7 },
  { name: 'REJECTED', icon: 'XOctagon', color: '#E11D48', category: 'overview', pipelinePosition: 10, isFinal: true, isSuccess: false, dashboardVisibility: true, order: 8 },
  { name: 'FOLLOWUP', icon: 'PhoneCall', color: '#0284C7', category: 'followups', pipelinePosition: 11, isFinal: false, dashboardVisibility: true, order: 9 },
  { name: 'DROPPED', icon: 'ArrowDownCircle', color: '#EA580C', category: 'overview', pipelinePosition: 12, isFinal: true, isSuccess: false, dashboardVisibility: true, order: 10 },
  { name: 'PENDING', icon: 'Hourglass', color: '#F59E0B', category: 'followups', pipelinePosition: 13, isFinal: false, dashboardVisibility: true, order: 11 }
];

async function main() {
  await connectDB();
  const org = await Organization.findOne();
  if (!org) return;

  await Status.deleteMany({ organizationId: org._id });
  for (const st of EXACT_11_STATUSES) {
    await Status.create({
      ...st,
      organizationId: org._id
    });
  }

  const allStatuses = await Status.find({ organizationId: org._id }).sort({ order: 1 });
  console.log('Total Statuses in DB now:', allStatuses.length);

  await disconnectDB();
}
main().catch(console.error);
