import { canonicalSemanticJson, semanticHash } from './identity.js';
import { throwIfAborted } from '../../shared/abort.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

export const COMPILER_SUMMARY_MANIFEST_VERSION = 4;
export const COMPILER_SUMMARY_MANIFEST_MAX_BYTES = 1048576;
const MAX_ENTRIES = 4096;
const DOMAIN = 'finite-parameter-return-exception-field-may-v1';
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/** Join in the finite powerset domain. Unknown/completeness is separate metadata,
 * never an extra dependency bit or a claim that an empty set proves no flow.
 */
export const joinMayDependencies = (target, values) => {
  let changed = false;
  for (const value of values) if (!target.has(value)) { target.add(value); changed = true; }
  return changed;
};

const immutable = value => {
  const work = [value];
  while (work.length) {
    const current = work.pop();
    if (current && typeof current === 'object') { work.push(...Object.values(current)); Object.freeze(current); }
  }
  return value;
};

/** Shadow records only. No record, hash or completeness flag grants reuse or
 * cross-generation authority. Overflow discards this product, not solver facts.
 */
export const createCompilerSummaryRecorder = ({ identity, signal = null,
  maxBytes = COMPILER_SUMMARY_MANIFEST_MAX_BYTES, maxEntries = MAX_ENTRIES } = {}) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1024 || maxBytes > COMPILER_SUMMARY_MANIFEST_MAX_BYTES
    || !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > MAX_ENTRIES) {
    throw new TypeError('Invalid compiler summary manifest allowance.');
  }
  const owners = new Map();
  let retainedBytes = 0, entries = 0, reason = null;
  const discard = why => { reason ||= why; owners.clear(); return false; };
  const charge = value => {
    if (reason) return false;
    throwIfAborted(signal);
    if (entries >= maxEntries) return discard('summary_manifest_entry_budget');
    const remaining = maxBytes - retainedBytes;
    if (remaining < 1) return discard('summary_manifest_byte_budget');
    try {
      const encoded = canonicalSemanticJson(value, { maxBytes: remaining, check: () => throwIfAborted(signal) });
      retainedBytes += Buffer.byteLength(encoded); entries++;
      return true;
    } catch (error) {
      const observation = observeStorageResource(error, { phase: 'compiler-summary-manifest' });
      observation.requireSettled();
      let code;
      try { code = observation.primary.code; }
      catch (inspection) { throw observation.retain(inspection, { inspectionPresent: true }); }
      observation.requireSettled();
      if (code === 'ERR_SEMANTIC_JSON_BUDGET') return discard('summary_manifest_byte_budget');
      throw error;
    }
  };
  if (!identity) discard('summary_manifest_identity_unavailable');
  else charge(identity);
  const broadIdentityHash = reason ? null : semanticHash('semantic.summary-shadow-identity.v1', identity, { maxBytes });
  const unavailable = () => immutable({ schemaVersion: COMPILER_SUMMARY_MANIFEST_VERSION, domain: DOMAIN,
    mode: 'shadow', qualifiesReuse: false, reuseGuard: 'full-group-rebuild-required', status: 'unavailable', reason,
    limits: { maxBytes, maxEntries }, summaries: [] });
  const register = (id, summary, document) => {
    if (reason) return;
    const source = document.item?.source, partition = document.partition;
    if (!source?.sourceUnitId || !source.byteHash || typeof source.path !== 'string'
      || !partition?.partitionId || !partition.canonicalHash) {
      discard('summary_manifest_identity_unavailable'); return;
    }
    const policy = document.policy?.enrichment || {};
    if (!charge(policy)) return;
    const localInputs = { sourceUnitId: source.sourceUnitId, sourceHash: source.byteHash,
      flowPartitionId: partition.partitionId, flowHash: partition.canonicalHash,
      dependencyIdentityHash: broadIdentityHash,
      policyHash: semanticHash('semantic.summary-shadow-policy.v1', policy,
        { maxBytes, check: () => throwIfAborted(signal) }) };
    const locator = { path: source.path, span: summary.span || null, sourceIdentity: summary.sourceIdentity || null };
    if (charge({ id, localInputs, locator })) owners.set(id, { localInputs, locator,
      reads: new Set(), callees: new Set(), schedulingDependencies: new Set(), contributions: new Map(), supports: new Map() });
  };
  const read = (ownerId, refs) => {
    const owner = owners.get(ownerId);
    if (!owner || reason) return;
    for (const ref of refs) if (!owner.reads.has(ref)) {
      if (!charge([ownerId, ref])) return;
      owner.reads.add(ref);
    }
  };
  const call = (ownerId, targets, project) => {
    const owner = owners.get(ownerId);
    if (!owner || reason) return;
    for (const value of targets) {
      const target = project(value);
      if (owner.callees.has(target)) continue;
      if (!charge([ownerId, target])) return;
      owner.callees.add(target);
    }
  };
  const contribution = (ownerId, occurrence, from, to, callee) => {
    const owner = owners.get(ownerId);
    if (!owner || reason) return;
    const value = { callSite: occurrence, from, to, callee }, id = canonicalSemanticJson(value);
    if (!owner.contributions.has(id) && charge(value)) owner.contributions.set(id, value);
  };
  const scheduling = (ownerId, dependencies) => {
    const owner = owners.get(ownerId);
    if (!owner || reason) return;
    for (const dependency of dependencies) if (!owner.schedulingDependencies.has(dependency)) {
      if (!charge([ownerId, dependency])) return;
      owner.schedulingDependencies.add(dependency);
    }
  };
  const support = (ownerId, channel, values, callSite = null, callee = null) => {
    const owner = owners.get(ownerId);
    if (!owner || reason) return;
    for (const input of values) {
      const value = { channel, input, callSite, callee }, id = canonicalSemanticJson(value);
      if (!owner.supports.has(id) && charge(value)) owner.supports.set(id, value);
      if (reason) return;
    }
  };
  const finish = ({ functions, reverse, converged, ownershipReasons, analysisReasons = [] }) => {
    if (reason) return unavailable();
    const list = (values, project = value => value) => {
      const result = [];
      for (const value of values) {
        if (reason) break;
        const projected = project(value);
        if (reason || !charge(projected)) break;
        result.push(projected);
      }
      return result;
    };
    const refList = values => [...new Set(list(values || [], value => value === null ? null : canonicalSemanticJson(value)))].sort(order);
    const numbers = values => list(values || []).sort((a, b) => a - b);
    const summaries = [];
    for (const [id, owner] of [...owners].sort(([a], [b]) => order(a, b))) {
      throwIfAborted(signal);
      const summary = functions.get(id);
      if (!summary) { discard('summary_manifest_identity_unavailable'); break; }
      const payload = { parameters: list(summary.parameters || [], ref => ref ? canonicalSemanticJson(ref) : null),
        returns: refList(summary.returns), exceptions: refList(summary.exceptions),
        dependencies: numbers(summary.dependencies), exceptionDependencies: numbers(summary.exceptionDependencies),
        effects: list(summary.effectDependencies.values(), effect => ({ parameter: effect.parameter,
          path: list(effect.path), refs: refList(effect.refs), dependencies: numbers(effect.dependencies) }))
          .sort((a, b) => order(canonicalSemanticJson(a), canonicalSemanticJson(b))),
        complete: summary.complete === true, converged: summary.converged === true, widened: summary.widened === true,
        async: summary.async === true, generator: summary.generator === true, constructible: summary.constructible === true,
        restIndex: summary.restIndex ?? -1 };
      const reads = list([...owner.reads].sort(order), ref => ({ ref,
        // Empty predecessors is a recorded negative lookup, not an omitted read.
        predecessors: list(reverse.get(ref) || []).sort(order) }));
      const callees = list([...owner.callees].sort(order), ref => ({ ref, status: functions.has(ref) ? 'available' : 'missing' }));
      const contributions = list([...owner.contributions].sort(([a], [b]) => order(a, b)), ([, value]) => value);
      const supports = list([...owner.supports].sort(([a], [b]) => order(a, b)), ([, value]) => value);
      const schedulingDependencies = list([...owner.schedulingDependencies].sort(order));
      if (reason || !charge(payload)) break;
      const payloadHash = semanticHash('semantic.summary-payload.v2', payload, { maxBytes });
      const supportHash = semanticHash('semantic.summary-support.v3', { reads, callees, contributions, supports, schedulingDependencies }, { maxBytes });
      const identityHash = semanticHash('semantic.summary-generation.v3', { declaration: id, localInputs: owner.localInputs,
        locator: owner.locator, payloadHash, supportHash }, { maxBytes });
      summaries.push({ declaration: id, locator: owner.locator, localInputs: owner.localInputs,
        payload, reads, callees, contributions, supports, schedulingDependencies, payloadHash, supportHash, identityHash });
    }
    if (reason) return unavailable();
    const value = { schemaVersion: COMPILER_SUMMARY_MANIFEST_VERSION, domain: DOMAIN,
      mode: 'shadow', qualifiesReuse: false, reuseGuard: 'full-group-rebuild-required', status: 'recorded', reason: null, identity,
      limits: { maxBytes, maxEntries }, converged, ownershipReasons: [...ownershipReasons].sort(order), analysisReasons: [...analysisReasons].sort(order), summaries };
    // The retained staging allowance also covers framing and immutable projection.
    if (!charge(value)) return unavailable();
    return immutable(JSON.parse(canonicalSemanticJson(value, { maxBytes, check: () => throwIfAborted(signal) })));
  };
  return Object.freeze({ register, read, call, contribution, support, scheduling, finish });
};
