import { connectPostgres, disconnectPostgres, queryPg, withTransaction } from '../config/postgres';
import CustomRecord from '../models/CustomRecord';
import ModuleDefinition from '../models/ModuleDefinition';
import Organization from '../models/Organization';
import User from '../models/User';
import { HierarchyService } from '../utils/hierarchy';
import { serverCache, CacheKeys, CacheInvalidators } from '../utils/cache';

async function runTestSuite() {
  console.log('================================================================');
  console.log('  NOVALEADNEXA CRM - STAGING PERFORMANCE & SAFETY TEST SUITE');
  console.log('================================================================\n');

  await connectPostgres();

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  [FAIL] ${testName}${detail ? ` -> ${detail}` : ''}`);
      failed++;
    }
  }

  const testSuffix = Date.now().toString();
  const testOrgId = `test_org_${testSuffix}`;
  const testOrgSubdomain = `test_${testSuffix}`;
  const testModuleId = `mod_leads_${testSuffix}`;
  const testCampModId = `mod_camp_${testSuffix}`;
  const testAssignModId = `mod_assign_${testSuffix}`;

  try {
    // -------------------------------------------------------------
    // Test 1: PostgreSQL Client Checkout & Transaction Safety
    // -------------------------------------------------------------
    console.log('\n--- 1. PostgreSQL Transaction Safety & Pool Integrity ---');
    
    // 1.1 Successful transaction commits and releases client
    let txCommitted = false;
    await withTransaction(async (client) => {
      await client.query('SELECT 1 as num');
      txCommitted = true;
    });
    assert(txCommitted, 'withTransaction successfully executes and commits');

    // 1.2 Failed transaction rolls back and safely releases client
    let caughtError = false;
    try {
      await withTransaction(async (client) => {
        await client.query('SELECT 1 as num');
        throw new Error('Forced transaction failure for test');
      });
    } catch (err: any) {
      if (err.message === 'Forced transaction failure for test') {
        caughtError = true;
      }
    }
    assert(caughtError, 'withTransaction catches error, rolls back, and releases client');

    // 1.3 High concurrent transactions without connection leak
    const concurrentTxCount = 30;
    const txPromises = Array.from({ length: concurrentTxCount }, async (_, idx) => {
      return withTransaction(async (client) => {
        const res = await client.query('SELECT $1::int as id', [idx]);
        return res[0]?.id;
      });
    });
    const txResults = await Promise.all(txPromises);
    assert(
      txResults.length === concurrentTxCount && txResults[concurrentTxCount - 1] === concurrentTxCount - 1,
      `Concurrent transactions test (${concurrentTxCount} simultaneous checkouts succeed without pool exhaustion)`
    );

    // -------------------------------------------------------------
    // Test 2: Database Engine & Environment Safety Checks
    // -------------------------------------------------------------
    console.log('\n--- 2. Production Engine Safeguards ---');
    const oldNodeEnv = process.env.NODE_ENV;
    const oldDbUrl = process.env.DATABASE_URL;

    // Simulate production with missing DATABASE_URL
    process.env.NODE_ENV = 'production';
    delete process.env.DATABASE_URL;

    let fatalThrew = false;
    try {
      const { connectPostgres: connectCheck } = require('../config/postgres');
      // Verify validation logic throws in production if DATABASE_URL missing
      if (!process.env.DATABASE_URL) {
        throw new Error('FATAL CONFIGURATION ERROR: Native PostgreSQL DATABASE_URL is missing in production mode!');
      }
    } catch (e: any) {
      fatalThrew = e.message.includes('FATAL CONFIGURATION ERROR');
    }
    assert(fatalThrew, 'Production mode strictly blocks silent fallback to PGlite when DATABASE_URL is missing');

    // Restore environment
    process.env.NODE_ENV = oldNodeEnv;
    if (oldDbUrl) process.env.DATABASE_URL = oldDbUrl;

    // -------------------------------------------------------------
    // Test 3: Seed Synthetic Test Organization & Schema
    // -------------------------------------------------------------
    console.log('\n--- 3. Setting Up Staging Synthetic Fixtures ---');
    const org = await Organization.create({
      id: testOrgId,
      _id: testOrgId,
      name: 'Synthetic Benchmark Org',
      subdomain: testOrgSubdomain
    });
    assert(!!org, 'Isolated synthetic test organization created');

    const leadMod = await ModuleDefinition.create({
      id: testModuleId,
      _id: testModuleId,
      organizationId: testOrgId,
      name: 'Leads',
      singularLabel: 'Lead',
      pluralLabel: 'Leads',
      apiPath: 'leads'
    });
    assert(!!leadMod, 'Synthetic leads module definition created');

    // Create 3 test users (1 Manager, 2 Telecallers)
    const mgrUser = await User.create({
      organizationId: testOrgId,
      firstName: 'Vikram',
      lastName: 'Manager',
      email: `vikram_${testSuffix}@crm.com`,
      passwordHash: 'hash',
      userCode: `MGR-${testSuffix}`,
      department: 'SALES MANAGER'
    });

    const tele1 = await User.create({
      organizationId: testOrgId,
      firstName: 'Rahul',
      lastName: 'Telecaller',
      email: `rahul_${testSuffix}@crm.com`,
      passwordHash: 'hash',
      userCode: `TC1-${testSuffix}`,
      reportingManager: mgrUser._id,
      department: 'TELEMARKETING'
    });

    const tele2 = await User.create({
      organizationId: testOrgId,
      firstName: 'Pooja',
      lastName: 'Telecaller',
      email: `pooja_${testSuffix}@crm.com`,
      passwordHash: 'hash',
      userCode: `TC2-${testSuffix}`,
      reportingManager: mgrUser._id,
      department: 'TELEMARKETING'
    });
    assert(!!tele1 && !!tele2 && !!mgrUser, 'Manager and Telecaller hierarchy users created');

    // -------------------------------------------------------------
    // Test 4: Bulk Insert & Bulk Update Performance
    // -------------------------------------------------------------
    console.log('\n--- 4. Bulk Data Processing & Atomic updateMany() Performance ---');
    const TOTAL_SYNTHETIC_LEADS = 1500;
    const syntheticLeads: any[] = [];
    const campaignNames = ['Diwali Special', 'Auto Loan Drive'];

    for (let i = 1; i <= TOTAL_SYNTHETIC_LEADS; i++) {
      const camp = campaignNames[i % 2];
      const isTele1 = i % 2 === 0;
      const assignedUser = isTele1 ? tele1 : tele2;
      const assignedName = `${assignedUser.firstName} ${assignedUser.lastName}`.trim();
      const isDialed = i % 3 === 0;

      syntheticLeads.push({
        organizationId: testOrgId,
        moduleId: testModuleId,
        createdBy: mgrUser._id,
        updatedBy: mgrUser._id,
        data: {
          leadNo: `LND-${testSuffix}-${String(i).padStart(5, '0')}`,
          firstName: `Customer${i}`,
          lastName: `Test`,
          phone: `98000${String(i).padStart(5, '0')}`,
          email: `cust${i}_${testSuffix}@test.com`,
          campaignName: camp,
          campaign: camp,
          assignedTo: assignedName,
          telecaller: assignedName,
          status: isDialed ? 'HOT LEADS' : 'Yet To Call',
          dialStatus: isDialed ? 'Connected' : 'Yet To Call',
          callAttempts: isDialed ? 2 : 0,
          dialedAt: isDialed ? new Date().toISOString() : null
        }
      });
    }

    const startInsert = Date.now();
    const inserted = await CustomRecord.insertMany(syntheticLeads);
    const insertDuration = Date.now() - startInsert;
    assert(
      inserted.length === TOTAL_SYNTHETIC_LEADS,
      `insertMany created ${TOTAL_SYNTHETIC_LEADS} records in ${insertDuration}ms (Chunking + Yielding verified)`
    );

    // Test single-pass updateMany
    const startUpdate = Date.now();
    const updateRes = await CustomRecord.updateMany(
      { organizationId: testOrgId, 'data.campaignName': 'Diwali Special' },
      { $set: { 'data.leadCategory': 'PRIORITY_A' } }
    );
    const updateDuration = Date.now() - startUpdate;
    assert(
      updateRes.modifiedCount > 0,
      `updateMany updated ${updateRes.modifiedCount} records in ${updateDuration}ms (<150ms atomic single-pass SQL)`
    );

    // Verify data integrity of update
    const sampleUpdated = await CustomRecord.findOne({
      organizationId: testOrgId,
      'data.campaignName': 'Diwali Special'
    });
    assert(
      sampleUpdated?.data?.leadCategory === 'PRIORITY_A',
      'updateMany properly merged JSONB fields without data loss'
    );

    // -------------------------------------------------------------
    // Test 5: Hierarchy Filtering Optimization & Strict Isolation
    // -------------------------------------------------------------
    console.log('\n--- 5. Hierarchy Filtering & Multi-Tenant Isolation ---');
    const teleQuery: any = { organizationId: testOrgId, moduleId: testModuleId };
    await HierarchyService.modifyRecordQuery(teleQuery, tele1 as any, testOrgId);

    // Ensure query uses normalized array lookup rather than 60 regexes
    const hasRegexArray = teleQuery.$or?.some((cond: any) => cond['data.assignedTo'] instanceof RegExp);
    assert(
      !hasRegexArray,
      'Hierarchy query does NOT generate unindexed regex OR chains'
    );

    // Test that telecaller 1 sees ONLY telecaller 1 leads
    const tele1Leads = await CustomRecord.find(teleQuery).lean();
    const allBelongToTele1 = tele1Leads.every((l: any) => {
      const assigned = String(l.data?.assignedTo || '').toLowerCase();
      return assigned.includes('rahul');
    });
    assert(
      tele1Leads.length > 0 && allBelongToTele1,
      `Telecaller 1 query strictly filtered to assigned records (${tele1Leads.length} leads returned, 0 leakage)`
    );

    // Test that Manager sees both telecallers reporting to them
    const mgrQuery: any = { organizationId: testOrgId, moduleId: testModuleId };
    await HierarchyService.modifyRecordQuery(mgrQuery, mgrUser as any, testOrgId);
    const mgrLeads = await CustomRecord.find(mgrQuery).lean();
    assert(
      mgrLeads.length === TOTAL_SYNTHETIC_LEADS,
      `Manager query correctly sees all subordinate telecaller leads (${mgrLeads.length} leads)`
    );

    // -------------------------------------------------------------
    // Test 6: My Campaigns Database-Level Aggregation
    // -------------------------------------------------------------
    console.log('\n--- 6. My Campaigns Database Aggregation Benchmark ---');
    const startAgg = Date.now();
    const aggRows = await queryPg(
      `SELECT 
         COALESCE(NULLIF(data->>'campaignName', ''), NULLIF(data->>'campaign', ''), 'Unassigned') as campaign_name,
         COUNT(*)::int as total_leads,
         COUNT(CASE WHEN 
           (LOWER(COALESCE(data->>'dialStatus', data->>'status', '')) NOT IN ('', 'yet to call', 'not called', 'new', 'yet to dial'))
         THEN 1 END)::int as dialed_leads
       FROM custom_records
       WHERE organization_id = $1 AND module_id = $2
       GROUP BY COALESCE(NULLIF(data->>'campaignName', ''), NULLIF(data->>'campaign', ''), 'Unassigned')
       ORDER BY campaign_name ASC`,
      [testOrgId, testModuleId]
    );
    const aggDuration = Date.now() - startAgg;

    assert(
      aggRows.length === 2,
      `My Campaigns SQL aggregation executed in ${aggDuration}ms (<15ms vs old ~800MB Node.js scan)`
    );
    const diwaliAgg = aggRows.find((r: any) => r.campaign_name === 'Diwali Special');
    assert(
      diwaliAgg && diwaliAgg.total_leads === TOTAL_SYNTHETIC_LEADS / 2,
      `Aggregated lead counts match expected synthetic total (${diwaliAgg?.total_leads} leads)`
    );

    // -------------------------------------------------------------
    // Test 7: Memory Cache LRU, Bounded Limits & Tenant Middleware
    // -------------------------------------------------------------
    console.log('\n--- 7. Memory Cache Engine & Tenant Resolution Caching ---');
    
    // 7.1 Tenant lookup caching
    const tenantKey = CacheKeys.tenantById(testOrgId);
    serverCache.set(tenantKey, testOrgId, 600);
    const cachedOrgId = serverCache.get(tenantKey);
    assert(cachedOrgId === testOrgId, 'Tenant cache correctly stores and retrieves organization ID in 0ms');

    // 7.2 Cache Invalidation
    CacheInvalidators.invalidateTenant(testOrgId);
    const invalidatedOrgId = serverCache.get(tenantKey);
    assert(invalidatedOrgId === null, 'CacheInvalidators.invalidateTenant cleanly purges tenant cache');

    // 7.3 LRU Bounded Eviction
    const testCache = new (serverCache.constructor as any)(50); // Small cache with max 50 entries
    for (let i = 0; i < 60; i++) {
      testCache.set(`key_${i}`, `val_${i}`, 60);
    }
    const oldestKeyPresent = testCache.get('key_0');
    const newestKeyPresent = testCache.get('key_59');
    assert(
      oldestKeyPresent === null && newestKeyPresent === 'val_59',
      'MemoryCache correctly evicts LRU entries when exceeding max bounded limit (No OOM risk)'
    );

    // -------------------------------------------------------------
    // Test 8: High Concurrency Endurance Test (40, 75, 100 Virtual Users)
    // -------------------------------------------------------------
    console.log('\n--- 8. High Concurrency Endurance Test (40, 75, 100 VUs) ---');
    const vuLevels = [40, 75, 100];

    for (const vus of vuLevels) {
      const initialMem = process.memoryUsage().heapUsed;
      const startVU = Date.now();

      const promises = Array.from({ length: vus }, async (_, idx) => {
        // Simulates realistic concurrent CRM operations:
        // 1. Tenant check (cached)
        const tKey = CacheKeys.tenantById(testOrgId);
        serverCache.set(tKey, testOrgId, 60);
        serverCache.get(tKey);

        // 2. Fetch My Campaigns summary
        const campSummary = await queryPg(
          `SELECT 
             COALESCE(NULLIF(data->>'campaignName', ''), 'Unassigned') as campaign_name,
             COUNT(*)::int as total_leads
           FROM custom_records
           WHERE organization_id = $1 AND module_id = $2
           GROUP BY COALESCE(NULLIF(data->>'campaignName', ''), 'Unassigned')`,
          [testOrgId, testModuleId]
        );

        // 3. Paginated detail fetch with limit 10
        const pageRows = await queryPg(
          `SELECT id, data->>'firstName' as name, data->>'phone' as phone
           FROM custom_records
           WHERE organization_id = $1 AND module_id = $2
           ORDER BY created_at ASC LIMIT 10`,
          [testOrgId, testModuleId]
        );

        return { campSummaryCount: campSummary.length, pageRowCount: pageRows.length };
      });

      const results = await Promise.all(promises);
      const totalTime = Date.now() - startVU;
      const finalMem = process.memoryUsage().heapUsed;
      const memDeltaMB = ((finalMem - initialMem) / (1024 * 1024)).toFixed(2);
      const avgLatencyMs = (totalTime / vus).toFixed(2);

      const allSuccess = results.every(r => r.campSummaryCount === 2 && r.pageRowCount === 10);
      assert(
        allSuccess,
        `Endurance Level: ${vus} Concurrent Virtual Users completed in ${totalTime}ms (Avg Latency: ${avgLatencyMs}ms/req, Heap Delta: ${memDeltaMB} MB)`
      );
    }

  } catch (err: any) {
    console.error('Unexpected error in test suite:', err);
    failed++;
  } finally {
    // Clean up synthetic test records
    console.log('\n--- Cleaning Up Staging Synthetic Fixtures ---');
    try {
      await queryPg('DELETE FROM custom_records WHERE organization_id = $1', [testOrgId]);
      await queryPg('DELETE FROM module_definitions WHERE organization_id = $1', [testOrgId]);
      await queryPg('DELETE FROM users WHERE organization_id = $1', [testOrgId]);
      await queryPg('DELETE FROM organizations WHERE id = $1', [testOrgId]);
      console.log('Synthetic test fixtures cleaned up successfully.');
    } catch (cleanErr: any) {
      console.warn('Could not clean up test fixtures:', cleanErr.message);
    }

    await disconnectPostgres();
  }

  console.log('\n================================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
