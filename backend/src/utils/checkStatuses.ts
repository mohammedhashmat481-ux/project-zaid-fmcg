import { connectDB, disconnectDB } from '../config/db';
import Status from '../models/Status';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import User from '../models/User';
import Organization from '../models/Organization';

async function main() {
  await connectDB();

  const org = await Organization.findOne();
  if (!org) {
    console.log('No organization found');
    process.exit(1);
  }
  console.log('Org:', org.name, org._id);

  const leadsModule = await ModuleDefinition.findOne({ apiPath: 'leads', organizationId: org._id });
  if (!leadsModule) {
    console.log('No leads module found');
    process.exit(1);
  }
  console.log('Leads Module:', leadsModule._id);

  const adminUser = await User.findOne({ organizationId: org._id });
  if (!adminUser) {
    console.log('No admin user found');
    process.exit(1);
  }

  const statuses = await Status.find({ organizationId: org._id });
  console.log('Found statuses:', statuses.map((s: any) => s.name));

  const existingRecords = await CustomRecord.find({ moduleId: leadsModule._id, organizationId: org._id });
  console.log('Existing records count:', existingRecords.length);
  const statusCounts: Record<string, number> = {};
  existingRecords.forEach((r: any) => {
    const st = r.data?.status || 'Unknown';
    statusCounts[st] = (statusCounts[st] || 0) + 1;
  });
  console.log('Current status distribution:', statusCounts);

  // For any status with 0 leads, let's create 1-2 realistic leads
  for (const st of statuses) {
    const currentCount = existingRecords.filter((r: any) => (r.data?.status || '').toString().trim().toLowerCase() === st.name.trim().toLowerCase()).length;
    if (currentCount === 0) {
      console.log(`Creating sample lead for status: "${st.name}"...`);
      const sampleNames = [
        { first: 'Aditya', last: 'Sharma', firm: 'Apex Infotech Pvt Ltd', amount: '450000', city: 'Mumbai', phone: '9820112233' },
        { first: 'Pooja', last: 'Verma', firm: 'Sunrise Logistics', amount: '620000', city: 'Delhi', phone: '9811445566' },
        { first: 'Rohan', last: 'Mehta', firm: 'Zenith Retailers', amount: '350000', city: 'Bangalore', phone: '9845778899' },
        { first: 'Sneha', last: 'Patel', firm: 'Nova Agro Systems', amount: '800000', city: 'Ahmedabad', phone: '9879112233' },
        { first: 'Karan', last: 'Kapoor', firm: 'Matrix Solutions', amount: '520000', city: 'Pune', phone: '9822334455' },
        { first: 'Ananya', last: 'Iyer', firm: 'Starlight Media', amount: '290000', city: 'Chennai', phone: '9840556677' }
      ];
      const randomSample = sampleNames[Math.floor(Math.random() * sampleNames.length)];
      
      await CustomRecord.create({
        organizationId: org._id,
        moduleId: leadsModule._id,
        createdBy: adminUser._id,
        updatedBy: adminUser._id,
        data: {
          firstName: randomSample.first,
          lastName: randomSample.last,
          leadName: `${randomSample.first} ${randomSample.last}`,
          name: `${randomSample.first} ${randomSample.last}`,
          status: st.name,
          stage: st.name,
          amount: randomSample.amount,
          city: randomSample.city,
          location: randomSample.city,
          company: randomSample.firm,
          firmName: randomSample.firm,
          phone: randomSample.phone,
          mobile: randomSample.phone,
          email: `${randomSample.first.toLowerCase()}.${randomSample.last.toLowerCase()}@example.com`,
          product: 'Business Loan',
          leadNo: `LND-${Math.floor(100000 + Math.random() * 900000)}`,
          dataCode: `LND-${Math.floor(1000 + Math.random() * 9000)}`,
          followupDate: new Date(Date.now() + 86400000).toISOString().split('T')[0]
        }
      });
      console.log(`Created lead for ${st.name}`);
    }
  }

  console.log('All statuses now have at least 1 lead!');
  await disconnectDB();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
