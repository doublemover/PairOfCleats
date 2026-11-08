import { CALL_ARGUMENTS_SCHEMA, callArgumentProjectionErrors, exactCallArity } from '../call-arguments.js';
import { CALL_SITE_SEMANTIC_REF_SCHEMA } from './call-site-semantic-ref.js';
import { CALLABLE_PARAMETER_SUMMARY_SCHEMA, callableSummaryProjectionErrors } from '../callable-parameters.js';
export const API_CONTRACT_REPORT_VERSION = '1.2.0';
// Keep historical format obligations independent of the next producer version.
const PARAMETER_AUTHORITY_REPORT_VERSIONS = new Set(['1.1.0', '1.2.0', API_CONTRACT_REPORT_VERSION]);
const ARGUMENT_AUTHORITY_REPORT_VERSIONS = new Set(['1.2.0', API_CONTRACT_REPORT_VERSION]);

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const count = { type: 'integer', minimum: 0 };
export const API_CONTRACT_JOIN_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'qualification', 'targetChunkUid', 'symbolId', 'providerScheme', 'indexSignature', 'indexCompatKey'],
  properties: { schemaVersion: { const: 1 }, qualification: { const: 'recorded-target-chunk' },
    targetChunkUid: { type: 'string', minLength: 1 }, symbolId: { type: 'string', minLength: 1 },
    providerScheme: nullableString, indexSignature: nullableString, indexCompatKey: nullableString }
};
const reasons = ['invalid-call', 'conflicting-call-identity', 'invalid-target', 'unresolved-lexical', 'ambiguous-lexical',
  'missing-target', 'unknown-target', 'ambiguous-target', 'generation-mismatch'];
export const API_CONTRACT_CALL_EVIDENCE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['schemaVersion', 'policy', 'inputCallCount', 'duplicateCallCount', 'totalCallCount', 'qualifiedCallCount',
    'unresolvedCallCount', 'unresolvedByReason', 'unresolvedDetails', 'reportedCallCount', 'omittedQualifiedCallCount'],
  properties: { schemaVersion: { const: 1 }, policy: { const: 'recorded-target-only' }, inputCallCount: count,
    duplicateCallCount: count, totalCallCount: count, qualifiedCallCount: count, unresolvedCallCount: count,
    unresolvedByReason: { type: 'object', additionalProperties: false, required: reasons,
      properties: Object.fromEntries(reasons.map(reason => [reason, count])) },
    unresolvedDetails: { const: 'counts-only' }, reportedCallCount: count, omittedQualifiedCallCount: count }
};
export const API_CONTRACT_ENTRY_SCHEMA = {
  type: 'object', required: ['symbol', 'signature', 'observedCalls'], additionalProperties: true,
  properties: {
    symbol: { type: 'object', required: ['symbolId'], additionalProperties: true,
      properties: { symbolId: { type: 'string' }, chunkUid: nullableString, file: nullableString, name: nullableString, kind: nullableString } },
    signature: { type: 'object', additionalProperties: true, properties: { declared: nullableString, tooling: nullableString,
      parameters: CALLABLE_PARAMETER_SUMMARY_SCHEMA } },
    observedCalls: { type: 'array', items: { type: 'object', additionalProperties: true,
      properties: { arguments: CALL_ARGUMENTS_SCHEMA, arity: nullableNumber, args: { type: ['array', 'null'], items: { type: 'string' } }, callSiteId: nullableString,
        file: nullableString, startLine: nullableNumber, confidence: nullableNumber, callerChunkUid: nullableString,
        start: nullableNumber, end: nullableNumber, startCol: nullableNumber, endLine: nullableNumber, endCol: nullableNumber,
        calleeNormalized: nullableString, targetChunkUid: nullableString, join: API_CONTRACT_JOIN_SCHEMA,
        semanticRef: { anyOf: [CALL_SITE_SEMANTIC_REF_SCHEMA, { type: 'null' }] } } } },
    warnings: { type: ['array', 'null'], items: { type: 'object' } }, truncation: { type: ['array', 'null'], items: { type: 'object' } }
  }
};

/** Schema shape alone cannot certify a call-to-symbol or generation join. */
export const apiContractEntryProjectionErrors = (entry, scope = null, requireJoin = false) => {
  const errors = [];
  errors.push(...callableSummaryProjectionErrors(entry.signature?.parameters));
  for (const call of entry.observedCalls || []) {
    if (call.arguments) {
      errors.push(...callArgumentProjectionErrors(call.arguments));
      if (call.arity !== exactCallArity(call)) errors.push('Observed arity differs from argument authority.');
    }
    if (!call.join) { if (requireJoin) errors.push('Qualified API report call is missing join evidence.'); continue; }
    if (call.targetChunkUid !== entry.symbol.chunkUid || call.join.targetChunkUid !== call.targetChunkUid
      || call.join.symbolId !== entry.symbol.symbolId) errors.push('API observed call target differs from its symbol identity.');
    if (scope && (call.join.indexSignature !== (scope.indexSignature || null) || call.join.indexCompatKey !== (scope.indexCompatKey || null))) {
      errors.push('API observed call join differs from the admitted index authority.');
    }
  }
  return errors;
};
export const apiContractProjectionErrors = report => {
  const errors = [], scope = report.provenance || null, evidence = report.callEvidence;
  const seenCalls = new Set();
  let reported = 0;
  for (const entry of report.symbols || []) {
    if (PARAMETER_AUTHORITY_REPORT_VERSIONS.has(report.version) && !entry.signature?.parameters) errors.push('API report entry is missing parameter authority qualification.');
    errors.push(...apiContractEntryProjectionErrors(entry, scope, Boolean(evidence)));
    for (const call of entry.observedCalls || []) {
      reported++;
      if (ARGUMENT_AUTHORITY_REPORT_VERSIONS.has(report.version) && !call.arguments) errors.push('API report call is missing argument authority qualification.');
      if (!call.join) continue;
      if (call.callSiteId) {
        const key = JSON.stringify([call.callSiteId, call.join.indexSignature]);
        if (seenCalls.has(key)) errors.push('API observed call is joined more than once.');
        seenCalls.add(key);
      }
    }
  }
  if (evidence && (evidence.reportedCallCount !== reported || evidence.totalCallCount !== evidence.qualifiedCallCount + evidence.unresolvedCallCount
    || evidence.inputCallCount !== evidence.totalCallCount + evidence.duplicateCallCount
    || evidence.qualifiedCallCount !== evidence.reportedCallCount + evidence.omittedQualifiedCallCount
    || evidence.unresolvedCallCount !== Object.values(evidence.unresolvedByReason).reduce((sum, value) => sum + value, 0))) {
    errors.push('API call evidence accounting is inconsistent.');
  }
  return errors;
};
