import { connectDB, disconnectDB } from '../config/db';
import dotenv from 'dotenv';
import path from 'path';
import Organization from '../models/Organization';
import ModuleDefinition from '../models/ModuleDefinition';
import CustomRecord from '../models/CustomRecord';
import User from '../models/User';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function addFollowups() {
  try {
    await connectDB();

    // 1. Get organization for sales subdomain
    const org = await Organization.findOne({ subdomain: 'sales' });
    if (!org) {
      console.error('Organization with subdomain "sales" not found.');
      return;
    }

    // 2. Find Lead Module Definition
    const leadModule = await ModuleDefinition.findOne({ 
      organizationId: org._id, 
      apiPath: 'leads' 
    });
    if (!leadModule) {
      console.error('Leads module definition not found.');
      return;
    }

    // 3. Find a user in the organization to assign as creator
    const user = await User.findOne({ organizationId: org._id });
    if (!user) {
      console.error('No user found for organization.');
      return;
    }

    // 4. Create today's date in local time
    const today = new Date(); // local current time (July 10, 2026)
    console.log('Setting followUpDate to:', today.toISOString());

    // 5. Create 3 new followup leads
    const followupLeads = [
      {
        firstName: 'Vikram',
        lastName: 'Sen',
        email: 'vikram.sen@gmail.com',
        phone: '9888777666',
        status: 'Followup',
        loanType: 'LAP (LOAN AGAINST PROPERTY)',
        budget: 4500000,
        source: 'Website',
        bankName: 'Axis Bank',
        followUpDate: today,
        notes: 'Interested in property loan. Schedule site verification.'
      },
      {
        firstName: 'Neha',
        lastName: 'Patel',
        email: 'neha.patel@yahoo.com',
        phone: '9777666555',
        status: 'Followup',
        loanType: 'SALARIED PERSONAL LOAN',
        budget: 800000,
        source: 'Referral',
        bankName: 'KOTAK Bank',
        followUpDate: today,
        notes: 'Needs quick personal loan for emergency. Call at 2:00 PM.'
      },
      {
        firstName: 'Rohan',
        lastName: 'Mehta',
        email: 'rohan.mehta@outlook.com',
        phone: '9666555444',
        status: 'Followup',
        loanType: 'BUSINESS LOAN',
        budget: 2500000,
        source: 'Cold Call',
        bankName: 'ICICI Bank',
        followUpDate: today,
        notes: 'Requires working capital for warehouse expansion.'
      }
    ];

    for (const lead of followupLeads) {
      const record = await CustomRecord.create({
        organizationId: org._id,
        moduleId: leadModule._id,
        createdBy: user._id,
        updatedBy: user._id,
        data: lead
      });
      console.log(`Successfully added lead: ${lead.firstName} ${lead.lastName} (ID: ${record._id})`);
    }

    console.log('Successfully seeded 3 today followup leads!');
  } catch (error) {
    console.error('Error adding followups:', error);
  } finally {
    await disconnectDB();
  }
}

addFollowups();
