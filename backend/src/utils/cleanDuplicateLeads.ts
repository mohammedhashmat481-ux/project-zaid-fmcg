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
 * Description:
 * Detects and safely resolves duplicate leads created by the multi-partner / double-submit bug.
 *
 * Modes:
 *   1. Preview mode (Default, read-only):
 *      npx ts-node src/utils/cleanDuplicateLeads.ts --preview
 *      Finds duplicates, calculates statistics, and prints sample duplicate groups.
 *      Modifies ZERO data.
 *
 *   2. Execute mode (Safe cleanup with automatic backup):
 *      npx ts-node src/utils/cleanDuplicateLeads.ts --execute
 *      - Backs up all duplicate records into a new table: backup_duplicate_leads_<timestamp>
 *      - Merges business partners from duplicates into the primary lead
 *      - Removes redundant clone records
 */

interface DuplicateGroup {
  organization_id: string;
  module_id: string;
  phone: string;
  lead_name: string;
  count: number;
  record_ids: string[];
  created_dates: string[];
  partners: string[];
}

async function main() {
  const args = process.argv.slice(2);
  const isExecute = args.includes('--execute');
  const isPreview = !isExecute || args.includes('--preview');

  console.log('======================================================');
  console.log(`[Lead Deduplication] Mode: ${isExecute ? 'EXECUTE (CLEANUP & MERGE)' : 'PREVIEW ONLY (READ-ONLY)'}`);
  console.log('======================================================');

  await connectDB();

  try {
    // 1. Identify module_id for 'leads'
    const moduleRes = await queryPg(
      `SELECT id, organization_id, name, api_path FROM module_definitions WHERE api_path = 'leads'`
    );
    
    if (!moduleRes || moduleRes.length === 0) {
      console.log('[Lead Deduplication] No "leads" module found.');
      return;
    }

    const leadModuleIds = moduleRes.map((m: any) => m.id);
    console.log(`[Lead Deduplication] Found ${leadModuleIds.length} lead module definition(s).`);

    // 2. Query potential duplicates based on organization, module, and customer phone/mobile
    // Group by organization_id, module_id, and phone number (where phone is not empty)
    const findDuplicatesSql = `
      WITH duplicate_groups AS (
        SELECT 
          organization_id,
          module_id,
          TRIM(LOWER(COALESCE(NULLIF(data->>'phone', ''), NULLIF(data->>'mobile', ''), NULLIF(data->>'phoneNumber', '')))) as phone_number,
          COUNT(*) as cnt,
          ARRAY_AGG(id ORDER BY created_at ASC, id ASC) as ids,
          ARRAY_AGG(COALESCE(data->>'businessPartner', '') ORDER BY created_at ASC) as partner_list,
          ARRAY_AGG(created_at ORDER BY created_at ASC) as created_times,
          MIN(COALESCE(data->>'leadName', data->>'name', '')) as sample_name
        FROM custom_records
        WHERE module_id = ANY($1::varchar[])
          AND (
            (data->>'phone' IS NOT NULL AND TRIM(data->>'phone') != '')
            OR (data->>'mobile' IS NOT NULL AND TRIM(data->>'mobile') != '')
            OR (data->>'phoneNumber' IS NOT NULL AND TRIM(data->>'phoneNumber') != '')
          )
        GROUP BY 
          organization_id, 
          module_id, 
          TRIM(LOWER(COALESCE(NULLIF(data->>'phone', ''), NULLIF(data->>'mobile', ''), NULLIF(data->>'phoneNumber', ''))))
        HAVING COUNT(*) > 1
      )
      SELECT * FROM duplicate_groups
      ORDER BY cnt DESC;
    `;

    const duplicateRows: any[] = await queryPg(findDuplicatesSql, [leadModuleIds]);

    if (duplicateRows.length === 0) {
      console.log('\n[Lead Deduplication] Excellent! Zero duplicate lead groups found.');
      return;
    }

    let totalDuplicateSets = duplicateRows.length;
    let totalExcessRecords = 0;
    const allRemovableIds: string[] = [];
    const updatesToPrimary: { id: string; mergedPartners: string }[] = [];

    for (const group of duplicateRows) {
      const ids: string[] = group.ids;
      const partners: string[] = group.partner_list || [];
      const primaryId = ids[0];
      const cloneIds = ids.slice(1);

      totalExcessRecords += cloneIds.length;
      allRemovableIds.push(...cloneIds);

      // Collect unique non-empty business partners
      const partnerSet = new Set<string>();
      for (const p of partners) {
        if (!p) continue;
        const split = p.split(',').map((s: string) => s.trim()).filter(Boolean);
        split.forEach((s: string) => partnerSet.add(s));
      }
      const merged = Array.from(partnerSet).join(', ');
      updatesToPrimary.push({ id: primaryId, mergedPartners: merged });
    }

    console.log(`\n--- Deduplication Summary ---`);
    console.log(`Duplicate phone groups found : ${totalDuplicateSets}`);
    console.log(`Total duplicate clone records : ${totalExcessRecords}`);
    console.log(`Primary records to preserve   : ${totalDuplicateSets}`);

    console.log('\n--- Sample Duplicate Groups (First 5) ---');
    for (let i = 0; i < Math.min(5, duplicateRows.length); i++) {
      const g = duplicateRows[i];
      console.log(`Group #${i + 1}:`);
      console.log(`  Customer Name   : ${g.sample_name || 'N/A'}`);
      console.log(`  Phone           : ${g.phone_number}`);
      console.log(`  Total Copies    : ${g.cnt}`);
      console.log(`  Keep Primary ID : ${g.ids[0]} (Created: ${g.created_times[0]})`);
      console.log(`  Clone IDs       : ${g.ids.slice(1).join(', ')}`);
      console.log(`  Merged Partners : ${updatesToPrimary[i]?.mergedPartners || 'None'}`);
    }

    if (isPreview) {
      console.log('\n======================================================');
      console.log('[PREVIEW MODE COMPLETE] ZERO records were modified or deleted.');
      console.log('To safely back up, merge partners, and remove duplicate clones, run:');
      console.log('  npx ts-node src/utils/cleanDuplicateLeads.ts --execute');
      console.log('======================================================\n');
      return;
    }

    // 3. EXECUTE MODE: Safe transaction with backup table creation
    console.log('\n[Lead Deduplication] Starting Safe Cleanup in Execute Mode...');
    const backupTableName = `backup_duplicate_leads_${Date.now()}`;

    await withTransaction(async (executor) => {
      // Step A: Create backup table with exact duplicates
      console.log(`[Backup] Creating backup table: "${backupTableName}"...`);
      await executor.query(
        `CREATE TABLE "${backupTableName}" AS 
         SELECT * FROM custom_records WHERE id = ANY($1::varchar[])`,
        [allRemovableIds]
      );
      console.log(`[Backup] Safely backed up ${allRemovableIds.length} duplicate records to "${backupTableName}".`);

      // Step B: Update primary records with merged business partners so zero partner data is lost
      console.log(`[Merge] Updating primary records with merged business partners...`);
      let updateCount = 0;
      for (const update of updatesToPrimary) {
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
      }
      console.log(`[Merge] Updated ${updateCount} primary leads with merged partner lists.`);

      // Step C: Delete redundant clone IDs in batches of 500
      console.log(`[Cleanup] Deleting ${allRemovableIds.length} redundant clone records...`);
      const batchSize = 500;
      for (let i = 0; i < allRemovableIds.length; i += batchSize) {
        const batch = allRemovableIds.slice(i, i + batchSize);
        await executor.query(
          `DELETE FROM custom_records WHERE id = ANY($1::varchar[])`,
          [batch]
        );
      }
      console.log(`[Cleanup] Successfully removed ${allRemovableIds.length} duplicate clone records.`);
    });

    // Clear server cache so dashboard immediately reflects the cleaned counts
    try {
      const { serverCache } = require('./cache');
      serverCache.clear();
    } catch (_) {}

    console.log('\n======================================================');
    console.log('✅ Deduplication completed successfully!');
    console.log(`- Redundant records removed : ${allRemovableIds.length}`);
    console.log(`- Backup preserved in table : ${backupTableName}`);
    console.log(`- Zero customer data was lost.`);
    console.log('======================================================\n');

  } catch (error: any) {
    console.error('\n[Lead Deduplication] Error during deduplication:', error.message);
  } finally {
    await disconnectDB();
  }
}

main().catch(console.error);
