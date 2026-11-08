import assert from 'node:assert/strict';
import { aggregateRiskMemberStatus, createRiskMemberAttestation, federatedRiskProjectionErrors } from '../../src/context-pack/federated-risk.js';
import { CONTEXT_PACK_RISK_FIELD_SCOPES } from '../../src/contracts/context-pack-risk-contract.js';
import { enforceContextPackResponseBudget } from '../../src/context-pack/response-budget.js';

const source = name => ({ status: 'ok', degraded: false, reason: null,
  provenance: { indexSignature: 'index-' + name, compatibilityKey: 'compat-' + name,
    effectiveConfigFingerprint: 'config-' + name, ruleBundle: { fingerprint: 'rules-' + name } },
  analysisStatus: { code: 'ok', strictFailure: false, summaryOnly: false }, support: null, stats: null, caps: { hits: [] } });
const a = createRiskMemberAttestation(source('a'), 'repo-a'), b = createRiskMemberAttestation(source('b'), 'repo-b');
assert.notEqual(a.attestationId, b.attestationId);
assert.deepEqual(a.provenance, source('a').provenance); assert.deepEqual(b.provenance, source('b').provenance);
const changed = source('b'); changed.provenance.ruleBundle.fingerprint = 'rules-b-new';
assert.notEqual(createRiskMemberAttestation(changed, 'repo-b').attestationId, b.attestationId);
assert.equal(createRiskMemberAttestation(source('a'), 'repo-a').attestationId, a.attestationId);
const ref = member => ({ repo: { repoId: member.repoId, attestationId: member.attestationId } });
const payload = members => ({ primary: {}, risk: { provenance: null, support: null, stats: null, caps: null,
  ...Object.fromEntries(['status', 'reason', 'degraded'].map(key => [key, aggregateRiskMemberStatus(members)[key]])),
  analysisStatus: aggregateRiskMemberStatus(members), summary: ref(members[0]),
  flows: members.map(member => ({ ...ref(member), source: ref(member), sink: ref(member),
    path: { nodes: [ref(member)] }, evidence: { callSitesByStep: [[{ details: ref(member) }]] } })),
  federation: { enabled: true, attestations: members, fieldScopes: CONTEXT_PACK_RISK_FIELD_SCOPES,
    selection: { selectedRepoIds: members.map(member => member.repoId) }, skippedRepos: [] } } });
assert.deepEqual(federatedRiskProjectionErrors(payload([a, b])), []);
for (const mutate of [value => { value.risk.flows[1].repo.attestationId = 'rpa1:' + '0'.repeat(64); },
  value => { value.risk.flows[1].source.repo.repoId = 'repo-a'; },
  value => { value.risk.flows[1].source.repo = ref(a).repo; },
  value => { value.risk.federation.attestations[1].provenance.indexSignature = 'forged'; },
  value => { value.risk.federation.attestations.pop(); }, value => { value.risk.provenance = a.provenance; }]) {
  const invalid = structuredClone(payload([a, b])); mutate(invalid);
  assert.ok(federatedRiskProjectionErrors(invalid).length > 0, 'a retained finding cannot lose or substitute its exact qualification');
}
const capped = source('b'); capped.analysisStatus = { code: 'capped', strictFailure: true, summaryOnly: false };
capped.caps.hits = ['maxFlows'];
const cappedMember = createRiskMemberAttestation(capped, 'repo-b');
const aggregate = aggregateRiskMemberStatus([a, cappedMember]);
assert.equal(aggregate.code, 'capped'); assert.equal(aggregate.strictFailure, true); assert.equal(aggregate.degraded, false);
assert.deepEqual(aggregate.capsHit, ['maxFlows']);
const falseClean = payload([a, cappedMember]); falseClean.risk.analysisStatus.code = 'ok';
assert.ok(federatedRiskProjectionErrors(falseClean).length > 0);
for (const member of [createRiskMemberAttestation(null, 'repo-b'),
  createRiskMemberAttestation({ ...source('b'), degraded: true,
    analysisStatus: { code: 'degraded', strictFailure: true } }, 'repo-b')]) {
  const status = aggregateRiskMemberStatus([a, member]); assert.equal(status.strictFailure, true); assert.equal(status.degraded, true);
}
assert.equal(aggregateRiskMemberStatus([a, b], true).code, 'capped');
const large = payload([a, b]); large.risk.federation.attestations[1].provenance.indexSignature = 'x'.repeat(140000);
const compacted = enforceContextPackResponseBudget(large);
assert.equal(compacted.risk, null, 'response compaction removes the complete finding/attestation owner together');
assert.ok(compacted.warnings.some(warning => warning.omitted.includes('risk')));
const strict = payload([a, b]); strict.risk.federation.attestations[1].provenance.indexSignature = 'x'.repeat(140000);
assert.throws(() => enforceContextPackResponseBudget(strict, { strictRisk: true }), { code: 'ERR_CONTEXT_PACK_RESPONSE_BUDGET' });
console.log('Federated risk retains member qualifications, rejects dangling/substituted references and keeps conservative aggregate completion.');
