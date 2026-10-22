import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { validateSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';

const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const uniqueTexts = value => Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
const invalid = message => { throw Object.assign(new TypeError(message), { code: 'ERR_ANALYSIS_CAPSULE_CONTRACT' }); };

/** Authoritative finite transfer system is supplied separately from untrusted states. */
export const finiteMaySystemIdentity = system => semanticHash('pairofcleats.finite-may-system.v1', system);
export const finiteMayPayloadIdentity = states => semanticHash('pairofcleats.finite-may-states.v1', states);

/**
 * Independent full-certificate post-fixpoint checker. It never runs a producer's
 * fixed-point worklist, and never equates a post-fixpoint with the least solution.
 * All graph edges, entry seeds and universe closure come from the admitted system.
 */
export const checkFiniteMayCapsule = ({ system, capsule, maxObligations = 100000,
  maxBytes = 8 * 1024 * 1024, signal }) => {
  if (!Number.isSafeInteger(maxObligations) || maxObligations < 0
    || !Number.isSafeInteger(maxBytes) || maxBytes < 1) invalid('Invalid checker allowance.');
  const result = { checker: 'finite-may-postfixpoint-v1', status: 'unknown',
    structuralIntegrity: 'unchecked', identityCompatibility: 'unchecked',
    semanticObligations: 'unchecked', solverClosure: 'not-established',
    precision: 'not-established', checkedObligations: 0, failures: [], frontier: [] };
  const unknown = reason => ({ ...result, frontier: [{ reason }] });
  if (system?.profile !== 'finite-may-set-v1' || system.transferVersion !== 1) return unknown('unsupported-domain-or-transfer');
  if (!system.world || !validateSemanticEnvelope('generation', system.world.generation).ok
    || !['sourceSnapshotId', 'contextKey', 'repositoryNamespace', 'providerId'].every(name => text(system.world[name]))) invalid('Immutable system world required.');
  if (!uniqueTexts(system.universe) || system.universe.length > 4096
    || !uniqueTexts(system.nodes) || !system.nodes.length || system.nodes.length > 16384
    || !Array.isArray(system.edges) || system.edges.length > 65536
    || !Array.isArray(system.entries) || system.entries.length > system.nodes.length
    || !Array.isArray(system.pending) || system.pending.length > 4096) invalid('Invalid finite transfer universe.');
  const universe = new Set(system.universe), nodes = new Set(system.nodes), edgeIds = new Set();
  const validSet = values => uniqueTexts(values) && values.every(value => universe.has(value));
  for (const entry of system.entries) {
    if (!nodes.has(entry.node) || !validSet(entry.facts)) invalid('Invalid authoritative entry condition.');
  }
  for (const edge of system.edges) {
    if (!text(edge.id) || edgeIds.has(edge.id) || !nodes.has(edge.from) || !nodes.has(edge.to)
      || !['identity', 'gen-kill', 'unknown-effect'].includes(edge.operation)) invalid('Invalid transfer edge.');
    edgeIds.add(edge.id);
    if (edge.operation === 'gen-kill' && (!validSet(edge.gen) || !validSet(edge.kill))) invalid('Invalid finite gen/kill transfer.');
  }
  if (!capsule || capsule.schemaVersion !== 1 || capsule.profile !== system.profile
    || capsule.checker !== result.checker || !Array.isArray(capsule.states)
    || capsule.states.length !== system.nodes.length) invalid('Full finite-state certificate required.');
  const payload = key({ system, capsule });
  if (Buffer.byteLength(payload) > maxBytes) return unknown('encoded-byte-allowance');
  if (signal?.aborted) return unknown('cancelled');
  if (capsule.payloadId !== finiteMayPayloadIdentity(capsule.states)) {
    return { ...result, status: 'rejected', structuralIntegrity: 'failed', failures: [{ reason: 'payload-digest-mismatch' }] };
  }
  result.structuralIntegrity = 'checked';
  if (capsule.systemId !== finiteMaySystemIdentity(system)) {
    return { ...result, status: 'stale-identity', identityCompatibility: 'failed', failures: [{ reason: 'system-identity-mismatch' }] };
  }
  result.identityCompatibility = 'checked';
  const states = new Map();
  for (const state of capsule.states) {
    if (!nodes.has(state.node) || states.has(state.node) || !validSet(state.facts)) invalid('Duplicate, missing or out-of-universe invariant.');
    states.set(state.node, new Set(state.facts));
  }
  if (system.extractionClosure !== 'complete-in-model' || system.boundaryClosure !== 'complete-in-model'
    || system.pending.length) return unknown('authoritative-universe-or-boundary-frontier-open');
  const budget = () => {
    if (signal?.aborted) { result.frontier.push({ reason: 'cancelled' }); return false; }
    if (result.checkedObligations >= maxObligations) { result.frontier.push({ reason: 'obligation-allowance' }); return false; }
    result.checkedObligations++;
    return true;
  };
  for (const entry of system.entries) {
    if (!budget()) return result;
    const missing = entry.facts.filter(value => !states.get(entry.node).has(value));
    if (missing.length) result.failures.push({ reason: 'entry-not-covered', node: entry.node, missing });
  }
  // Check every edge, including backedges/recursion, against the simultaneous invariant.
  for (const edge of system.edges) {
    if (!budget()) return result;
    const from = states.get(edge.from), to = states.get(edge.to);
    let required;
    if (edge.operation === 'unknown-effect') required = universe;
    else if (edge.operation === 'identity') required = from;
    else required = new Set([...from].filter(value => !edge.kill.includes(value)).concat(edge.gen));
    const missing = [...required].filter(value => !to.has(value));
    if (missing.length) result.failures.push({ reason: 'transfer-not-covered', edgeId: edge.id, missing });
  }
  if (result.failures.length) return { ...result, status: 'rejected', semanticObligations: 'failed' };
  return { ...result, status: 'checked-in-model', semanticObligations: 'checked',
    solverClosure: 'post-fixpoint', precision: 'sound-overapproximation-not-least',
    systemId: capsule.systemId, payloadId: capsule.payloadId,
    checkId: semanticHash('pairofcleats.finite-may-check.v1', {
      checker: result.checker, systemId: capsule.systemId, payloadId: capsule.payloadId
    }) };
};
