import { connectDB, disconnectDB } from '../config/db';
import dotenv from 'dotenv';
import path from 'path';
import Status from '../models/Status';
import Organization from '../models/Organization';
import CustomRecord from '../models/CustomRecord';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  await connectDB();
  const org = await Organization.findOne();
  if (!org) return;

  // Fix typo in records if any
  const updateRes = await CustomRecord.updateMany(
    { organizationId: org._id, 'data.status': 'Not Intested' },
    { $set: { 'data.status': 'Not Interested' } }
  );
  console.log('Fixed Not Intested records:', updateRes.modifiedCount);

  const statusesToAdd = [
    { name: 'Yet To Call', icon: 'PhoneForwarded', color: '#4F46E5', category: 'pipeline', pipelinePosition: 1, isFinal: false, dashboardVisibility: true, order: 1 },
    { name: 'Negotiation', icon: 'TrendingUp', color: '#EA580C', category: 'pipeline', pipelinePosition: 9, isFinal: false, dashboardVisibility: true, order: 9 },
    { name: 'Not Connected', icon: 'PhoneMissed', color: '#7C3AED', category: 'followups', pipelinePosition: 0, isFinal: false, dashboardVisibility: true, order: 14 },
    { name: 'Not Interested', icon: 'XCircle', color: '#64748B', category: 'overview', pipelinePosition: 0, isFinal: true, isSuccess: false, dashboardVisibility: true, order: 15 }
  ];

  for (const st of statusesToAdd) {
    const existing = await Status.findOne({ organizationId: org._id, name: new RegExp('^' + st.name + '$', 'i') });
    if (!existing) {
      console.log('Adding status:', st.name);
      await Status.create({
        ...st,
        organizationId: org._id
      });
    }
  }

  const allStatuses = await Status.find({ organizationId: org._id });
  console.log('Total Statuses in DB now:', allStatuses.length);

  await disconnectDB();
}
main().catch(console.error);
