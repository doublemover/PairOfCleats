import { buildTaskPrimaryExcerpt } from './task-policy.js';
import { contextDigest } from '../contracts/context-token-budget.js';
import { stableStringify } from '../shared/stable-json.js';
import { throwIfAborted } from '../shared/abort.js';
import { describeStorageFailure } from '../shared/storage/failure-observation.js';
import { contextEvidenceSourceIdentity, contextEvidenceUnitId, contextEvidencePoolDigest,
  CONTEXT_EVIDENCE_GRAPH_ROLES, CONTEXT_EVIDENCE_ROLES, canonicalContextEvidenceRef } from '../contracts/context-evidence-selection.js';

const rolesByGraph = CONTEXT_EVIDENCE_GRAPH_ROLES;
const roleOrder = CONTEXT_EVIDENCE_ROLES;
const canonicalRef = canonicalContextEvidenceRef;
const refKey = ref => stableStringify(canonicalRef(ref));
const containsCause = (error, expected) => {
  const pending = [error], seen = new Set();
  while (pending.length && seen.size < 16) {
    const value = pending.pop();
    if (value === expected) return true;
    if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value); const cause = Object.getOwnPropertyDescriptor(value, 'cause');
    if (cause && Object.hasOwn(cause, 'value')) pending.push(cause.value);
  }
  return false;
};

/** Capture one bounded graph/source pool before any selector scores a set.
 * Roles come only from actual incident graph kinds. Source units use the same
 * original descriptor/hash/parser owner as the mandatory edit-safe primary. */
export const buildContextEvidenceCandidatePool = ({ payload, chunkIndex, repoRoot, taskPolicy, policy, budget, signal }) => {
  const nodes = Array.isArray(payload.graph?.nodes) ? payload.graph.nodes : [];
  const records = nodes.slice(0, policy.maxCandidates).map((node, rank) => {
    const ref = Object.freeze(canonicalRef(node.ref));
    return { id: contextDigest(stableStringify({ ref, rank })), ref, rank,
      distance: Number.isFinite(node.distance) && node.distance >= 0 ? node.distance : null,
      roles: [], priority: 4, unitId: null, sourceIdentity: null,
      status: 'omitted', reason: 'unexamined', marginalGain: null, tokenDelta: null };
  });
  const byRef = new Map();
  for (const record of records) {
    const key = refKey(record.ref); if (!byRef.has(key)) byRef.set(key, []); byRef.get(key).push(record);
  }
  const roleSets = new Map(records.map(row => [row.id, new Set()]));
  const halt = new Error('Context evidence source work allowance exhausted.');
  const check = () => { throwIfAborted(signal); if (budget.shouldStop()) throw halt; };
  let stopReason = null, bytes = 0;
  const candidates = [], unitOwners = new Map([[contextEvidenceUnitId(payload.primary), null]]);
  if (!records.length || !policy.maxSelected || !policy.maxPoolBytes || !policy.maxWorkUnits || !policy.maxWallClockMs || policy.maxMeasurements === 1) {
    for (const row of records) row.reason = !policy.maxSelected ? 'selection-cap' : 'pool-or-work-cap';
    stopReason = !records.length ? nodes.length ? 'maxCandidates' : null : !policy.maxSelected ? 'maxSelected' : !policy.maxPoolBytes ? 'maxPoolBytes' : !policy.maxWorkUnits ? 'maxWorkUnits'
      : !policy.maxWallClockMs ? 'maxWallClockMs' : 'maxMeasurements';
  } else {
    for (const edge of payload.graph?.edges || []) {
      throwIfAborted(signal);
      if (budget.consume(1).stop) break;
      const role = rolesByGraph[edge.graph]; if (!role) continue;
      for (const ref of [edge.from, edge.to]) for (const row of byRef.get(refKey(ref)) || []) roleSets.get(row.id).add(role);
    }
    for (const row of records) {
      row.roles = roleOrder.filter(role => roleSets.get(row.id).has(role));
      if (budget.consume(1).stop) { stopReason = budget.buildTruncation('evidence-selection')?.cap || 'maxWorkUnits'; break; }
      throwIfAborted(signal);
      if (row.ref.type !== 'chunk') { row.reason = 'unqualified-reference-kind'; continue; }
      if (row.ref.chunkUid === payload.primary.ref?.chunkUid) { row.reason = 'mandatory-primary'; continue; }
      if (chunkIndex.ambiguousChunkUids?.has(row.ref.chunkUid)) { row.reason = 'ambiguous-chunk-identity'; continue; }
      const chunk = chunkIndex.byChunkUid.get(row.ref.chunkUid);
      if (!chunk) { row.reason = 'missing-chunk-source'; continue; }
      const remaining = policy.maxPoolBytes - bytes;
      if (remaining <= 0) { stopReason = 'maxPoolBytes'; break; }
      try {
        const warnings = [];
        const primary = buildTaskPrimaryExcerpt({ taskPolicy, chunk, seed: row.ref, repoRoot,
          indexSignature: payload.provenance.indexSignature, maxBytes: remaining, maxTokens: null, signal, warnings,
          maxWorkUnits: Math.max(1, policy.maxWorkUnits - budget.getUsed()), checkDeadline: check,
          onWork: () => { if (budget.consume(1).stop) throw halt; } });
        const unitId = contextEvidenceUnitId(primary);
        row.unitId = unitId; row.sourceIdentity = contextEvidenceSourceIdentity(primary);
        if (unitOwners.has(unitId)) {
          const prior = unitOwners.get(unitId);
          if (prior) for (const role of row.roles) roleSets.get(prior.entry.id).add(role);
          row.reason = 'duplicate-intact-unit'; continue;
        }
        const entry = { id: row.id, unitId, ref: row.ref, file: primary.file, excerpt: primary.excerpt,
          unit: Object.freeze({ ...primary.unit, span: Object.freeze(primary.unit.span.slice()),
            ...(primary.unit.parser ? { parser: Object.freeze({ ...primary.unit.parser }) } : {}) }),
          evidence: Object.freeze({ ...primary.evidence, sourceIdentity: Object.freeze({ ...primary.evidence.sourceIdentity }),
            warningCodes: Object.freeze(primary.evidence.warningCodes.slice()) }), roles: row.roles.slice() };
        // Reserve the largest possible role header before aliases merge into
        // the same intact unit; final reporting measures the actual pool bytes.
        const retainedBytes = Buffer.byteLength(JSON.stringify({ ...entry, roles: roleOrder }));
        if (bytes + retainedBytes > policy.maxPoolBytes) { row.reason = 'pool-byte-cap'; stopReason = 'maxPoolBytes'; continue; }
        bytes += retainedBytes;
        row.status = 'deferred'; row.reason = 'not-selected';
        const candidate = { entry, rank: row.rank, distance: row.distance,
          relevance: row.distance === null ? null : 1 / (1 + row.distance) };
        candidates.push(candidate); unitOwners.set(unitId, candidate);
      } catch (error) {
        throwIfAborted(signal);
        const diagnostic = describeStorageFailure(error, { phase: 'context-evidence-candidate' });
        if (containsCause(error, halt)) { stopReason = budget.buildTruncation('evidence-selection')?.cap || 'maxWorkUnits'; break; }
        if (!['ERR_CONTEXT_PACK_UNIT_UNAVAILABLE', 'ERR_CONTEXT_PACK_UNIT_CANNOT_FIT', 'ERR_CONTEXT_PACK_SOURCE_MISMATCH'].includes(diagnostic.code)) throw error;
        row.reason = diagnostic.code;
      }
    }
  }
  for (const row of records) {
    row.roles = roleOrder.filter(role => roleSets.get(row.id).has(role));
    row.priority = Math.min(4, ...row.roles.map(role => roleOrder.indexOf(role)));
    if (row.reason === 'unexamined') row.reason = stopReason || 'work-cap';
    delete row.rank;
  }
  const frozen = Object.freeze(candidates.map(candidate => {
    candidate.entry.roles = Object.freeze(roleOrder.filter(role => roleSets.get(candidate.entry.id).has(role)));
    return Object.freeze({ ...candidate, priority: Math.min(4, ...candidate.entry.roles.map(role => roleOrder.indexOf(role))),
      entry: Object.freeze(candidate.entry) });
  }));
  stopReason ||= nodes.length > records.length ? 'maxCandidates' : null;
  for (const row of records) {
    Object.freeze(row.roles);
    if (row.sourceIdentity) { Object.freeze(row.sourceIdentity.span); Object.freeze(row.sourceIdentity); }
    Object.freeze(row);
  }
  return Object.freeze({ candidates: frozen, decisions: Object.freeze(records), bytes: frozen.reduce((total, candidate) => total + Buffer.byteLength(JSON.stringify(candidate.entry)), 0), observed: nodes.length,
    omittedBeyondPool: Math.max(0, nodes.length - records.length), stopReason,
    digest: contextEvidencePoolDigest({ indexSignature: payload.provenance.indexSignature, decisions: records, observed: nodes.length }) });
};
