import { connectDB, disconnectDB } from '../config/db';
import { queryPg, withTransaction } from '../config/postgres';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'backend/.env') });

/**
 * Script: cleanDuplicateLeads.ts
 *
 * Safe Multi-Partner / Double-Submit Lead Deduplication Engine
 *
 * Options:
 *   --preview       (Default) Read-only report. Modifies ZERO records.
 *   --burst-only    (Recommended) Only cleans duplicate leads created at the same time
 *                   (within 15 minutes of each other, e.g. yesterday's partner split bug).
 *                   Safely leaves historical campaign leads untouched.
 *   --all-time      Cleans all duplicate phone numbers across the entire database history.
 *   --execute       Applies the cleanup with automatic database backup & partner merge.
 */

interface LeadRow {
  id: string;
  organization_id: string;
  module_id: string;
  phone_number: string;
  partner: string;
  lead_name: string;
  created_at: Date;
}

interface DuplicateCluster {
  phoneNumber: string;
  leadName: string;
  primaryId: string;
  primaryCreatedAt: Date;
  cloneIds: string[];
  cloneCreatedAts: Date[];
  allPartners: string[];
  isBurst: boolean; // Created within 15 minutes of each other
}

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isAllTime = args.includes('--all-time');
  const isBurstOnly = !isAllTime || args.includes('--burst-only');
  const isPreview = !isExecute || args.includes('--preview');

  console.log('========================================================================');
  console.log(`[Lead Deduplication] Mode: ${isExecute ? 'EXECUTE (CLEANUP & MERGE)' : 'PREVIEW ONLY (READ-ONLY)'}`);
  console.log(`[Lead Deduplication] Scope: ${isAllTime ? 'ALL TIME (All historical duplicates)' : 'BURST CLONES ONLY (Created within 15 mins / Yesterday)'}`);
  console.log('========================================================================\n');

  await connectDB();

  try {
    const moduleRes = await queryPg(
      `SELECT id, organization_id, name, api_path FROM module_definitions WHERE api_path = 'leads'`
    );

    if (!moduleRes || moduleRes.length === 0) {
      console.log('[Lead Deduplication] No "leads" module found.');
      return;
    }

    const leadModuleIds = moduleRes.map((m: any) => m.id);

    // 1. Fetch all leads with non-empty phone numbers ordered by phone and creation time
    const fetchSql = `
      SELECT 
        id,
        organization_id,
        module_id,
        TRIM(LOWER(COALESCE(NULLIF(data->>'phone', ''), NULLIF(data->>'mobile', ''), NULLIF(data->>'phoneNumber', '')))) as phone_number,
        COALESCE(data->>'businessPartner', '') as partner,
        COALESCE(data->>'leadName', data->>'name', '') as lead_name,
        created_at
      FROM custom_records
      WHERE module_id = ANY($1::varchar[])
        AND (
          (data->>'phone' IS NOT NULL AND TRIM(data->>'phone') != '')
          OR (data->>'mobile' IS NOT NULL AND TRIM(data->>'mobile') != '')
          OR (data->>'phoneNumber' IS NOT NULL AND TRIM(data->>'phoneNumber') != '')
        )
      ORDER BY organization_id, module_id, phone_number, created_at ASC, id ASC;
    `;

    console.log('[Lead Deduplication] Scanning database records...');
    const allRecords: any[] = await queryPg(fetchSql, [leadModuleIds]);
    console.log(`[Lead Deduplication] Total leads analyzed: ${allRecords.length}`);

    // 2. Group by (organization_id + module_id + phone_number)
    const phoneGroups = new Map<string, any[]>();
    for (const r of allRecords) {
      const key = `${r.organization_id}::${r.module_id}::${r.phone_number}`;
      if (!phoneGroups.has(key)) {
        phoneGroups.set(key, []);
      }
      phoneGroups.get(key)!.push(r);
    }

    const burstClusters: DuplicateCluster[] = [];
    const historicalClusters: DuplicateCluster[] = [];

    const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

    for (const [key, records] of phoneGroups.entries()) {
      if (records.length <= 1) continue;

      // Check time differences between records
      // If records were created within 15 minutes of the first record, they are burst duplicates (the partner split bug)
      let currentCluster: any[] = [records[0]];

      for (let i = 1; i < records.length; i++) {
        const prev = records[i - 1];
        const curr = records[i];
        const diffMs = Math.abs(new Date(curr.created_at).getTime() - new Date(prev.created_at).getTime());

        if (diffMs <= FIFTEEN_MINUTES_MS) {
          // Burst clone! (Created simultaneously or within 15 mins)
          currentCluster.push(curr);
        } else {
          // Time gap > 15 mins: this is a separate historical event
          if (currentCluster.length > 1) {
            burstClusters.push(createCluster(currentCluster, true));
          }
          currentCluster = [curr];
        }
      }

      if (currentCluster.length > 1) {
        burstClusters.push(createCluster(currentCluster, true));
      }

      // Also record all-time cluster
      historicalClusters.push(createCluster(records, false));
    }

    function createCluster(recs: any[], isBurst: boolean): DuplicateCluster {
      const primary = recs[0];
      const clones = recs.slice(1);
      const partners: string[] = [];
      recs.forEach(r => {
        if (r.partner) {
          r.partner.split(',').forEach((p: string) => {
            const trimmed = p.trim();
            if (trimmed && !partners.includes(trimmed)) partners.push(trimmed);
          });
        }
      });

      return {
        phoneNumber: primary.phone_number,
        leadName: primary.lead_name,
        primaryId: primary.id,
        primaryCreatedAt: new Date(primary.created_at),
        cloneIds: clones.map(c => c.id),
        cloneCreatedAts: clones.map(c => new Date(c.created_at)),
        allPartners: partners,
        isBurst
      };
    }

    const totalBurstClones = burstClusters.reduce((sum, c) => sum + c.cloneIds.length, 0);
    const totalHistoricalClones = historicalClusters.reduce((sum, c) => sum + c.cloneIds.length, 0);

    console.log('\n--- Analysis Breakdown ---');
    console.log(`1. BURST DUPLICATES (Created within 15 mins of each other / Partner Split Bug):`);
    console.log(`   - Duplicate Groups : ${burstClusters.length}`);
    console.log(`   - Excess Clones    : ${totalBurstClones} duplicate leads`);
    console.log(`\n2. ALL-TIME REPEATS (Includes historical campaigns dating back weeks):`);
    console.log(`   - Duplicate Groups : ${historicalClusters.length}`);
    console.log(`   - Excess Clones    : ${totalHistoricalClones} duplicate leads`);

    // Choose target clusters based on selected mode
    const targetClusters = isAllTime ? historicalClusters : burstClusters;
    const targetExcessCount = isAllTime ? totalHistoricalClones : totalBurstClones;

    console.log(`\n--- Target for Cleanup (${isAllTime ? 'ALL-TIME' : 'BURST ONLY - RECOMMENDED'}) ---`);
    console.log(`Selected Groups: ${targetClusters.length}`);
    console.log(`Clones to remove: ${targetExcessCount}`);

    console.log('\n--- Sample Duplicate Groups to be Cleaned (First 5) ---');
    for (let i = 0; i < Math.min(5, targetClusters.length); i++) {
      const c = targetClusters[i];
      console.log(`Group #${i + 1}:`);
      console.log(`  Customer Name   : ${c.leadName || 'N/A'}`);
      console.log(`  Phone Number    : ${c.phoneNumber}`);
      console.log(`  Keep Primary ID : ${c.primaryId} (Created: ${c.primaryCreatedAt.toISOString()})`);
      console.log(`  Clone IDs (${c.cloneIds.length}): ${c.cloneIds.join(', ')}`);
      console.log(`  Merged Partners : ${c.allPartners.join(', ') || 'None'}`);
    }

    if (isPreview) {
      console.log('\n========================================================================');
      console.log('[PREVIEW MODE COMPLETE] ZERO records were modified or deleted.');
      console.log('\nRECOMMENDED SAFE ACTION:');
      console.log('To clean up ONLY the simultaneous burst duplicates (yesterday\'s bug) safely:');
      console.log('  node dist/utils/cleanDuplicateLeads.js --burst-only --execute');
      console.log('\nOr, if you want to clean ALL duplicates across all historical time:');
      console.log('  node dist/utils/cleanDuplicateLeads.js --all-time --execute');
      console.log('========================================================================\n');
      return;
    }

    // 3. EXECUTE MODE: Safe transaction with backup table creation
    console.log(`\n[Lead Deduplication] Starting Safe Cleanup in Execute Mode (${isAllTime ? 'ALL-TIME' : 'BURST-ONLY'})...`);
    const allRemovableIds: string[] = [];
    const updatesToPrimary: { id: string; mergedPartners: string }[] = [];

    for (const c of targetClusters) {
      allRemovableIds.push(...c.cloneIds);
      if (c.allPartners.length > 0) {
        updatesToPrimary.push({
          id: c.primaryId,
          mergedPartners: c.allPartners.join(', ')
        });
      }
    }

    if (allRemovableIds.length === 0) {
      console.log('[Lead Deduplication] No records to remove.');
      return;
    }

    const backupTableName = `backup_duplicate_leads_${Date.now()}`;

    await withTransaction(async (executor) => {
      // Step A: Create backup table with exact duplicates
      console.log(`[Backup] Creating backup table: "${backupTableName}"...`);
      await executor.query(
        `CREATE TABLE "${backupTableName}" (LIKE custom_records INCLUDING ALL)`
      );
      const batchSize = 1000;
      for (let i = 0; i < allRemovableIds.length; i += batchSize) {
        const batch = allRemovableIds.slice(i, i + batchSize);
        await executor.query(
          `INSERT INTO "${backupTableName}" SELECT * FROM custom_records WHERE id = ANY($1::varchar[])`,
          [batch]
        );
        console.log(`[Backup] Backed up ${Math.min(i + batchSize, allRemovableIds.length)} / ${allRemovableIds.length} records...`);
      }
      console.log(`[Backup] Safely backed up all ${allRemovableIds.length} duplicate records to "${backupTableName}".`);

      // Step B: Update primary records with merged business partners so zero partner data is lost
      console.log(`[Merge] Updating primary records with merged business partners...`);
      let updateCount = 0;
      for (let i = 0; i < updatesToPrimary.length; i++) {
        const update = updatesToPrimary[i];
        if (update.mergedPartners) {
          await executor.query(
            `UPDATE custom_records 
             SET data = jsonb_set(COALESCE(data, '{}'::jsonb), '{businessPartner}', to_jsonb($1::text)),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [update.mergedPartners, update.id]
          );
          updateCount++;
        }
        if ((i + 1) % 1000 === 0 || i === updatesToPrimary.length - 1) {
          console.log(`[Merge] Processed ${i + 1} / ${updatesToPrimary.length} primary records...`);
        }
      }
      console.log(`[Merge] Successfully updated ${updateCount} primary leads with merged partner lists.`);

      // Step C: Delete redundant clone IDs in safe batches of 1000
      console.log(`[Cleanup] Deleting ${allRemovableIds.length} redundant clone records...`);
      for (let i = 0; i < allRemovableIds.length; i += batchSize) {
        const batch = allRemovableIds.slice(i, i + batchSize);
        await executor.query(
          `DELETE FROM custom_records WHERE id = ANY($1::varchar[])`,
          [batch]
        );
        console.log(`[Cleanup] Deleted ${Math.min(i + batchSize, allRemovableIds.length)} / ${allRemovableIds.length} records...`);
      }
      console.log(`[Cleanup] Successfully removed ${allRemovableIds.length} duplicate clone records.`);
    });

    // Clear server cache so dashboard immediately reflects the cleaned counts
    try {
      const { serverCache } = require('./cache');
      serverCache.clear();
    } catch (_) {}

    console.log('\n========================================================================');
    console.log('✅ Deduplication completed successfully!');
    console.log(`- Redundant records removed : ${allRemovableIds.length}`);
    console.log(`- Backup preserved in table : ${backupTableName}`);
    console.log(`- Zero customer or bank partner data was lost.`);
    console.log('========================================================================\n');

  } catch (error: any) {
    console.error('\n[Lead Deduplication] Error during deduplication:', error.message);
  } finally {
    await disconnectDB();
  }
}

main().catch(console.error);
