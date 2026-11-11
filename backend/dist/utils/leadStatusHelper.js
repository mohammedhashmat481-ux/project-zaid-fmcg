"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STANDARD_PIPELINE_STATUSES = exports.RAW_CAMPAIGN_DISPOSITIONS = void 0;
exports.getRealLeadStatuses = getRealLeadStatuses;
exports.getRealLeadRegex = getRealLeadRegex;
const Status_1 = __importDefault(require("../models/Status"));
exports.RAW_CAMPAIGN_DISPOSITIONS = new Set([
    'NEW',
    'YET TO CALL',
    'NOT CALLED',
    'UNASSIGNED',
    'NUMBER BUSY',
    'BUSY',
    'OUT OF SERVICE',
    'NO INCOMING CALLS',
    'SWITCH OFF',
    'SWITCHED OFF',
    'CALL REJECTED',
    'NOT CONNECTED',
    'NOT REACHABLE',
    'NOT INTESTED',
    'NOT INTERESTED',
    'NOT EXISTS',
    'DOES NOT EXIST',
    'NO ANSWER',
    'NO BUSINESS',
    'WRONG NUMBER',
    'REPEATED NUMBER'
]);
exports.STANDARD_PIPELINE_STATUSES = [
    'HOT', 'HOT LEAD', 'HOT LEADS',
    'WARM', 'WARM LEAD', 'WARM LEADS',
    'COOL', 'COOL LEAD', 'COOL LEADS',
    'CEBIL PENDING', 'CEDIL PENDING', 'CEBIL',
    'DOCUMENT PENDING', 'DOCUMENTS PENDING', 'DOCS PENDING',
    'APPROVAL PENDING', 'APPROVALS PENDING',
    'APPROVED BUT NOT DISBUSE', 'APPROVED BUT NOT DISBUSED', 'APPROVED BUT NOT DISBURSE',
    'DISBUSED', 'DISBURSED',
    'REJECTED', 'REJECT',
    'FOLLOWUP', 'FOLLOW-UP', 'FOLLOW UP',
    'DROPPED', 'DROP',
    'PENDING',
    'GIVEN LOGIN', 'LOGIN',
    'PROPOSAL', 'NEGOTIATION',
    'INK WORLDWIDE'
];
/**
 * Returns a Set of uppercase status names that constitute legitimate pipeline leads
 * (both standard CRM pipeline stages and organization-configured custom statuses),
 * strictly excluding raw campaign dialing dispositions.
 */
async function getRealLeadStatuses(organizationId) {
    const statusSet = new Set();
    for (const s of exports.STANDARD_PIPELINE_STATUSES) {
        statusSet.add(s.toUpperCase().trim());
    }
    if (organizationId) {
        try {
            const configuredStatusRecords = await Status_1.default.find({ organizationId }).select('name').lean();
            for (const st of configuredStatusRecords) {
                if (st.name) {
                    const upper = st.name.toUpperCase().trim();
                    if (!exports.RAW_CAMPAIGN_DISPOSITIONS.has(upper)) {
                        statusSet.add(upper);
                        const noLeads = upper.replace(/\s+LEADS?$/i, '').trim();
                        if (noLeads)
                            statusSet.add(noLeads);
                        statusSet.add(`${noLeads || upper} LEADS`);
                        statusSet.add(`${noLeads || upper} LEAD`);
                    }
                }
            }
        }
        catch (_) { }
    }
    return statusSet;
}
/**
 * Returns a regex string matching any legitimate pipeline lead status.
 */
async function getRealLeadRegex(organizationId) {
    const statusSet = await getRealLeadStatuses(organizationId);
    const escaped = Array.from(statusSet).map(s => s.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
    return `^\\s*(${escaped.join('|')})\\s*$`;
}
