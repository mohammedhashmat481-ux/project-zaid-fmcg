import { connectDB, disconnectDB } from '../config/db';
import dotenv from 'dotenv';
import path from 'path';
import User from '../models/User';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  await connectDB();
  
  // Set all existing users to approved
  const res = await User.updateMany(
    {},
    {
      $set: {
        isApproved: true,
        approvalStatus: 'approved',
        isActive: true
      }
    }
  );
  console.log('Updated existing users to approved:', res.modifiedCount);

  const users = await User.find().select('firstName lastName email isApproved approvalStatus isActive');
  console.log(users);

  await disconnectDB();
}
main().catch(console.error);
