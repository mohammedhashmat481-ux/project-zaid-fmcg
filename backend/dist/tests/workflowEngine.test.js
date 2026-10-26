"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const postgres_1 = require("../config/postgres");
const Workflow_1 = __importDefault(require("../models/Workflow"));
const CustomRecord_1 = __importDefault(require("../models/CustomRecord"));
const Organization_1 = __importDefault(require("../models/Organization"));
const Notification_1 = __importDefault(require("../models/Notification"));
const workflowEngine_1 = require("../services/workflowEngine");
async function runTests() {
    console.log('=== Starting WorkflowEngine and PgModel Dotted-Key Test Suite ===\n');
    await (0, postgres_1.connectPostgres)();
    let passed = 0;
    let failed = 0;
    function assert(condition, testName) {
        if (condition) {
            console.log(`[PASS] ${testName}`);
            passed++;
        }
        else {
            console.error(`[FAIL] ${testName}`);
            failed++;
        }
    }
    const testSuffix = Date.now().toString();
    const testOrgId = 'test_org_' + testSuffix;
    const testUserId = 'test_user_' + testSuffix;
    const testModuleId = 'mod_leads_' + testSuffix;
    try {
        // -------------------------------------------------------------
        // Test 1: Query with trigger.event and trigger.module (Reproduced 42P01 error before fix)
        // -------------------------------------------------------------
        console.log('--- Test 1: Workflow queries with dotted trigger fields ---');
        const wf1 = await Workflow_1.default.create({
            organizationId: testOrgId,
            moduleId: testModuleId,
            name: 'Test Lead Assignment Workflow',
            trigger: {
                event: 'create',
                module: testModuleId
            },
            conditions: [
                { field: 'status', operator: 'equals', value: 'Hot Lead' },
                { field: 'score', operator: 'greater_than', value: '50', delay: 10 }
            ],
            actions: [
                {
                    type: 'notification',
                    params: {
                        title: 'Hot Lead Alert',
                        message: 'A new hot lead was created by workflow.'
                    }
                }
            ],
            isEnabled: true
        });
        // Before the fix, querying 'trigger.module' or 'trigger.event' threw:
        // "error: missing FROM-clause entry for table 'trigger'" (code 42P01)
        const foundWfs = await Workflow_1.default.find({
            organizationId: testOrgId,
            'trigger.event': 'create',
            'trigger.module': testModuleId
        });
        assert(foundWfs.length === 1 && foundWfs[0]._id === wf1._id, 'Workflow.find with trigger.event and trigger.module succeeds');
        // -------------------------------------------------------------
        // Test 2: Nested array and numeric comparison on JSON columns
        // -------------------------------------------------------------
        console.log('\n--- Test 2: Numeric comparisons in dotted keys ---');
        const matchedDelayedWfs = await Workflow_1.default.find({
            organizationId: testOrgId,
            'conditions.1.delay': { $gt: 5 }
        });
        assert(matchedDelayedWfs.length === 1, 'Workflow.find with conditions.1.delay > 5 matches (10 > 5)');
        const unmatchedDelayedWfs = await Workflow_1.default.find({
            organizationId: testOrgId,
            'conditions.1.delay': { $gt: 15 }
        });
        assert(unmatchedDelayedWfs.length === 0, 'Workflow.find with conditions.1.delay > 15 does not match (10 > 15 is false)');
        // Test on CustomRecord data.amount with numeric vs string comparison
        // In string comparison, '9000' > '50000' is true! In numeric comparison, 9000 > 50000 is false.
        const recHigh = await CustomRecord_1.default.create({
            organizationId: testOrgId,
            moduleId: testModuleId,
            createdBy: testUserId,
            data: { leadName: 'Alice', amount: 100000, status: 'Hot Lead', score: 85 }
        });
        const recLow = await CustomRecord_1.default.create({
            organizationId: testOrgId,
            moduleId: testModuleId,
            createdBy: testUserId,
            data: { leadName: 'Bob', amount: 9000, status: 'Cold Lead', score: 20 }
        });
        const highAmountRecs = await CustomRecord_1.default.find({
            organizationId: testOrgId,
            'data.amount': { $gt: 50000 }
        });
        assert(highAmountRecs.length === 1 && highAmountRecs[0]._id === recHigh._id, 'CustomRecord.find with data.amount > 50000 correctly matches 100000 and ignores 9000');
        // -------------------------------------------------------------
        // Test 3: Boolean comparisons in dotted keys
        // -------------------------------------------------------------
        console.log('\n--- Test 3: Boolean comparisons in dotted keys ---');
        const testOrg = await Organization_1.default.create({
            name: 'Test Org ' + testSuffix,
            subdomain: 'test-org-' + testSuffix,
            themeSettings: { darkMode: true, compactMode: false }
        });
        const darkOrgs = await Organization_1.default.find({
            _id: testOrg._id,
            'themeSettings.darkMode': true
        });
        assert(darkOrgs.length === 1, 'Organization.find with themeSettings.darkMode: true matches');
        const lightOrgs = await Organization_1.default.find({
            _id: testOrg._id,
            'themeSettings.darkMode': false
        });
        assert(lightOrgs.length === 0, 'Organization.find with themeSettings.darkMode: false does not match');
        // -------------------------------------------------------------
        // Test 4: $in, $nin, and $exists operators on dotted JSON fields
        // -------------------------------------------------------------
        console.log('\n--- Test 4: $in, $nin, $exists on dotted keys ---');
        const inRecs = await CustomRecord_1.default.find({
            organizationId: testOrgId,
            'data.status': { $in: ['Hot Lead', 'Warm Lead'] }
        });
        assert(inRecs.length === 1 && inRecs[0]._id === recHigh._id, 'CustomRecord.find with data.status $in matches Hot Lead');
        const ninRecs = await CustomRecord_1.default.find({
            organizationId: testOrgId,
            'data.status': { $nin: ['Cold Lead'] }
        });
        assert(ninRecs.length === 1 && ninRecs[0]._id === recHigh._id, 'CustomRecord.find with data.status $nin excludes Cold Lead');
        const existsRecs = await CustomRecord_1.default.find({
            organizationId: testOrgId,
            'data.amount': { $exists: true }
        });
        assert(existsRecs.length === 2, 'CustomRecord.find with data.amount $exists matches both records');
        // -------------------------------------------------------------
        // Test 5: End-to-End Workflow Execution (Lead Creation -> Action Fires)
        // -------------------------------------------------------------
        console.log('\n--- Test 5: End-to-End Workflow Execution on Lead Creation ---');
        // Calling WorkflowEngine.trigger on lead creation
        await workflowEngine_1.WorkflowEngine.trigger(testOrgId, testModuleId, 'create', recHigh);
        // The workflow should have matched (status === 'Hot Lead') and executed action 'notification'
        const notifications = await Notification_1.default.find({
            organizationId: testOrgId,
            userId: testUserId,
            title: 'Hot Lead Alert'
        });
        assert(notifications.length === 1 && notifications[0].message === 'A new hot lead was created by workflow.', 'WorkflowEngine.trigger end-to-end: matched lead creation and fired notification action');
        // Test non-matching lead (recLow has status 'Cold Lead')
        await workflowEngine_1.WorkflowEngine.trigger(testOrgId, testModuleId, 'create', recLow);
        const notificationsAfterLow = await Notification_1.default.find({
            organizationId: testOrgId,
            userId: testUserId,
            title: 'Hot Lead Alert'
        });
        assert(notificationsAfterLow.length === 1, 'WorkflowEngine.trigger correctly ignored lead that does not satisfy conditions');
        // -------------------------------------------------------------
        // Test 6: End-to-End Workflow Execution on Lead Update with fieldTrigger
        // -------------------------------------------------------------
        console.log('\n--- Test 6: End-to-End Workflow on Lead Update with fieldTrigger ---');
        const wfUpdate = await Workflow_1.default.create({
            organizationId: testOrgId,
            moduleId: testModuleId,
            name: 'Status Change Workflow',
            trigger: {
                event: 'update',
                fieldTrigger: 'status',
                module: testModuleId
            },
            conditions: [
                { field: 'status', operator: 'equals', value: 'Converted' }
            ],
            actions: [
                {
                    type: 'notification',
                    params: {
                        title: 'Lead Converted!',
                        message: 'Lead was successfully converted.'
                    }
                }
            ],
            isEnabled: true
        });
        recHigh.data.status = 'Converted';
        // 6a. Trigger with unchanged field ('phone') -> should NOT fire
        await workflowEngine_1.WorkflowEngine.trigger(testOrgId, testModuleId, 'update', recHigh, ['phone']);
        const convertedNotifsUnchanged = await Notification_1.default.find({
            organizationId: testOrgId,
            title: 'Lead Converted!'
        });
        assert(convertedNotifsUnchanged.length === 0, 'Workflow skipped when trigger field did not change');
        // 6b. Trigger with changed field ('status') -> SHOULD fire
        await workflowEngine_1.WorkflowEngine.trigger(testOrgId, testModuleId, 'update', recHigh, ['status']);
        const convertedNotifsChanged = await Notification_1.default.find({
            organizationId: testOrgId,
            title: 'Lead Converted!'
        });
        assert(convertedNotifsChanged.length === 1, 'Workflow fired when trigger field changed');
        // -------------------------------------------------------------
        // Cleanup Test Data
        // -------------------------------------------------------------
        console.log('\n--- Cleaning up test artifacts ---');
        await Workflow_1.default.deleteMany({ organizationId: testOrgId });
        await CustomRecord_1.default.deleteMany({ organizationId: testOrgId });
        await Notification_1.default.deleteMany({ organizationId: testOrgId });
        await Organization_1.default.deleteOne({ _id: testOrg._id });
        console.log('Cleanup completed successfully.');
    }
    catch (err) {
        console.error('Unexpected error during test execution:', err);
        failed++;
    }
    finally {
        await (0, postgres_1.disconnectPostgres)();
    }
    console.log(`\n========================================`);
    console.log(`Test Results: ${passed} Passed, ${failed} Failed`);
    console.log(`========================================\n`);
    if (failed > 0) {
        process.exit(1);
    }
    else {
        process.exit(0);
    }
}
runTests();
