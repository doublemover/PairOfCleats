import { semanticHash } from '../index/semantic/identity.js';
import { CONTEXT_PACK_RISK_FEDERATED_REPO_LIMIT } from '../contracts/context-pack-risk-contract.js';

const fields = ['repoId', 'status', 'reason', 'degraded', 'provenance', 'analysisStatus', 'support', 'stats', 'caps'];
export const riskMemberAttestationId = member => 'rpa1:' + semanticHash('pairofcleats.federated-risk-member.v1',
  Object.fromEntries(fields.map(key => [key, member[key] ?? null])));
export const createRiskMemberAttestation = (risk, repoId) => {
  const member = structuredClone({ repoId, status: risk?.status || 'missing', reason: risk?.reason ?? null,
    degraded: risk?.degraded === true, provenance: risk?.provenance ?? null, analysisStatus: risk?.analysisStatus ?? null,
    support: risk?.support ?? null, stats: risk?.stats ?? null, caps: risk?.caps ?? null });
  return { attestationId: riskMemberAttestationId(member), ...member };
};

/** Completion is scoped to all members; base guidance is not peer authority. */
export const aggregateRiskMemberStatus = (members, omitted = false) => {
  const codes = members.map(member => member.analysisStatus?.code || 'unavailable');
  const code = ['missing', 'disabled', 'degraded', 'summary_only', 'unavailable', 'capped']
    .find(value => codes.includes(value)) || (omitted ? 'capped' : codes.every(value => value === 'ok')
      && members.every(member => member.analysisStatus?.strictFailure === false) ? 'ok' : 'unavailable');
  const strictFailure = omitted || code !== 'ok' || members.some(member => member.analysisStatus?.strictFailure !== false);
  const degraded = members.some(member => member.degraded || !member.analysisStatus)
    || ['missing', 'disabled', 'degraded', 'unavailable'].includes(code);
  return { requested: true, status: degraded ? 'degraded' : code === 'summary_only' ? 'summary_only' : 'ok', reason: strictFailure ? 'federated-member-analysis-incomplete' : null,
    degraded, summaryOnly: members.every(member => member.analysisStatus?.summaryOnly === true), code, strictFailure,
    artifactStatus: null, degradedReasons: members.filter(member => member.analysisStatus?.code !== 'ok')
      .map(member => member.repoId + ':' + (member.analysisStatus?.code || 'unavailable')),
    flowsEmitted: null, partialFlowsEmitted: null, uniqueCallSitesReferenced: null,
    capsHit: [...new Set(members.flatMap(member => [...(member.analysisStatus?.capsHit || []), ...(member.caps?.hits || [])]))] };
};

export const federatedRiskProjectionErrors = payload => {
  const risk = payload?.risk, federation = risk?.federation;
  if (!federation?.enabled) return [];
  const errors = [], members = federation.attestations || [], byId = new Map();
  const selected = new Set(federation.selection?.selectedRepoIds || []);
  if (members.length > CONTEXT_PACK_RISK_FEDERATED_REPO_LIMIT || members.length !== selected.size
    || new Set(members.map(member => member.repoId)).size !== members.length) errors.push('/risk/federation must attest each selected member exactly once');
  for (const member of members) {
    if (!selected.has(member.repoId) || byId.has(member.attestationId)
      || member.attestationId !== riskMemberAttestationId(member)) errors.push('/risk/federation member identity mismatch');
    byId.set(member.attestationId, member);
  }
  const check = (node, owner = null) => {
    if (!node) return;
    const member = byId.get(node.repo?.attestationId);
    if (!member || member.repoId !== node.repo?.repoId || (owner && member.attestationId !== owner.attestationId)) {
      errors.push('/risk finding/evidence has no exact member attestation');
    }
  };
  const baseRepo = federation.selection?.selectedRepos?.find(repo => repo.base === true);
  check(risk.summary, baseRepo ? members.find(member => member.repoId === baseRepo.repoId) : null);
  for (const flow of [...(risk.flows || []), ...(risk.partialFlows || [])]) {
    check(flow);
    const owner = byId.get(flow.repo?.attestationId);
    check(flow.source, owner); check(flow.sink, owner); check(flow.frontier, owner);
    for (const blocked of flow.frontier?.blockedExpansions || []) check(blocked, owner);
    for (const node of flow.path?.nodes || []) check(node, owner);
    for (const step of flow.evidence?.callSitesByStep || []) for (const site of step) check(site?.details, owner);
  }
  for (const key of ['provenance', 'support', 'stats', 'caps']) if (risk[key] !== null) errors.push('/risk/' + key + ' must defer to member attestations');
  const aggregate = aggregateRiskMemberStatus(members, (federation.skippedRepos || []).length > 0);
  for (const key of ['code', 'strictFailure', 'degraded', 'summaryOnly', 'status']) {
    if (risk.analysisStatus?.[key] !== aggregate[key]) errors.push('/risk/analysisStatus/' + key + ' does not qualify every member');
  }
  for (const key of ['status', 'reason', 'degraded']) {
    if (risk[key] !== aggregate[key]) errors.push('/risk/' + key + ' does not qualify every member');
  }
  return errors;
};
