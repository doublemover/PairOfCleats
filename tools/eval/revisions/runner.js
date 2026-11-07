import { randomUUID } from 'node:crypto';
import { captureRevisionOracle } from '../../../src/contracts/validators/revision-oracle.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { bootstrapPositiveRuleView, applyPositiveRuleSupportDelta, describePositiveRuleView,
  positiveRuleSupportId, positiveRuleViewWork } from '../../../src/index/semantic/views/positive-rules.js';
import { compileRevisionScenario, revisionStateId, revisionScenarioId, revisionKey, sealRevisionEdits } from './scenario.js';
import { compareRevisionOutputs, normalizeRevisionOutput } from './reference.js';

const owned = new WeakMap();
const immutable = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value;
};
const get = handle => {
  const state = handle && typeof handle === 'object' ? owned.get(handle) : null;
  if (!state) throw Object.assign(new TypeError('Original revision execution handle required.'), { code: 'ERR_REVISION_ORACLE_HANDLE' }); return state;
};
const project = view => {
  const report = describePositiveRuleView(view);
  return normalizeRevisionOutput({ complete: report.qualification.membership === 'complete-least-fixpoint-in-declared-model',
    facts: report.facts.map(fact => ({ id: fact.id, present: fact.present,
      producers: fact.producers.map(({ kind, originId, body }) => ({ kind, originId, body })) })) });
};
const limits = options => {
  const { maxMs = 1000, maxValuations = 4096, maxOutputBytes = 262144 } = options;
  for (const [name, value, maximum, minimum] of [['maxMs', maxMs, 1000, 1], ['maxValuations', maxValuations, 4096, 1],
    ['maxOutputBytes', maxOutputBytes, 1048576, 16384]]) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new RangeError('Invalid revision execution allowance: ' + name);
  }
  return { maxMs, maxValuations, maxOutputBytes };
};

/** The only candidate is the registered existing finite positive-rule owner.
 * There is no supplied program, shell command, dynamic module or callback route. */
export const runRevisionScenario = (input, options = {}) => {
  const began = performance.now(), { signal = null } = options, bounds = limits(options);
  throwIfAborted(signal);
  const compiled = compileRevisionScenario(input), checkpoints = [];
  let current = null, outputBytes = 4096, exhausted = false;
  const withinTime = () => performance.now() - began < bounds.maxMs;
  for (const [index, state] of compiled.states.entries()) {
    throwIfAborted(signal);
    const stateId = revisionStateId(state), checkpointId = index ? compiled.scenario.revisions[index - 1].id : 'base';
    if (exhausted || !withinTime()) { checkpoints.push({ index, checkpointId, stateId, outcome: 'not-run', reason: 'run-work-or-output-budget' }); continue; }
    const candidateBegan = performance.now();
    let truthChanges = null, producerChanges = null;
    if (current === null) current = bootstrapPositiveRuleView(state, { signal });
    else {
      const edit = compiled.scenario.revisions[index - 1], before = compiled.states[index - 1];
      const remove = new Set(edit.removeOriginIds);
      const delta = applyPositiveRuleSupportDelta(current, { expectedRootId: current.rootId,
        removeSupportIds: before.supports.filter(row => remove.has(row.originId)).map(positiveRuleSupportId), addSupports: edit.addSupports }, { signal });
      current = delta.view; truthChanges = delta.truthChanges.length; producerChanges = delta.producerChanges.length;
    }
    const candidateMs = performance.now() - candidateBegan, actual = project(current), candidateWork = positiveRuleViewWork(current);
    const freshBegan = performance.now(), fresh = bootstrapPositiveRuleView(state, { signal }), rebuilt = project(fresh);
    const rebuildMs = performance.now() - freshBegan;
    const oracleBegan = performance.now();
    const claim = compareRevisionOutputs({ scenario: compiled.scenario, checkpoint: index, actual,
      oracleOptions: { signal, maxValuations: bounds.maxValuations, check: withinTime } });
    const rebuildEqual = revisionKey(actual) === revisionKey(rebuilt) && current.rootId === fresh.rootId;
    const row = { index, checkpointId, stateId, outcome: !rebuildEqual ? 'fail' : claim.outcome,
      candidateRootId: current.rootId, rebuildRootId: fresh.rootId, candidateExecutionId: randomUUID(), rebuildExecutionId: randomUUID(),
      actualId: revisionScenarioId(actual), rebuildId: revisionScenarioId(rebuilt),
      claims: [{ tier: 'independent-finite-reference', relation: 'exact-membership-and-direct-producer-bag', ...claim },
        { tier: 'same-implementation-clean-rebuild', relation: 'exact-output-and-root', outcome: rebuildEqual ? 'pass' : 'fail' }],
      work: { candidateMs, rebuildMs, referenceMs: performance.now() - oracleBegan, valuations: claim.valuations,
        truthChanges, producerChanges, ...candidateWork } };
    const bytes = Buffer.byteLength(revisionKey(row));
    // Reserve bounded not-run rows for every remaining declared checkpoint.
    if (outputBytes + bytes + (compiled.states.length - index - 1) * 512 > bounds.maxOutputBytes) {
      exhausted = true; checkpoints.push({ index, checkpointId, stateId, outcome: 'not-run', reason: 'run-work-or-output-budget' });
    } else { checkpoints.push(row); outputBytes += bytes; }
    if (!withinTime()) exhausted = true;
  }
  const outcome = checkpoints.some(row => row.outcome === 'fail') ? 'fail'
    : checkpoints.every(row => row.outcome === 'pass') ? 'pass' : 'unknown';
  const executionId = randomUUID(), receipt = immutable(captureRevisionOracle('receipt', { schemaVersion: 1, kind: 'finite-positive-revision-run',
    scenarioId: compiled.scenarioId, executionId, profile: compiled.scenario.profile, family: compiled.scenario.family, seed: compiled.scenario.seed,
    outcome, checkpoints, candidateStrategy: 'existing-complete-declared-model-recomputation',
    oracle: 'intersection-of-all-Horn-closed-valuations-v1', semantics: 'Boolean-membership-and-bag-of-direct-producers; not-all-derivations',
    sourceAuthority: 'supplied-model-only', programSemantics: 'not-established', bounds, elapsedMs: performance.now() - began }));
  if (Buffer.byteLength(revisionKey(receipt)) > bounds.maxOutputBytes) throw new RangeError('Revision receipt exceeds its output allowance; no execution handle published.');
  const handle = Object.freeze({ executionId, scenarioId: compiled.scenarioId }); owned.set(handle, { compiled, receipt }); return handle;
};
export const readRevisionRun = handle => get(handle).receipt;
export const retireRevisionRun = handle => {
  const state = get(handle); owned.delete(handle); return Object.freeze({ executionId: state.receipt.executionId, retired: true });
};

/** Deterministic deletion minimization. Keep the original result and accept a
 * smaller witness only after the same named checkpoint/fact disagreement runs
 * again under the registered candidate and independent complete oracle. */
export const minimizeRevisionFailure = (handle, { checkpointId, factId, maxAttempts = 32, maxMs = 1000, signal = null } = {}) => {
  const original = get(handle), began = performance.now(); throwIfAborted(signal);
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 64 || !Number.isSafeInteger(maxMs) || maxMs < 1 || maxMs > 1000) {
    throw new RangeError('Invalid revision minimization allowance.');
  }
  const isFailure = receipt => receipt.checkpoints.some(row => row.checkpointId === checkpointId && row.claims?.some(claim =>
    claim.tier === 'independent-finite-reference' && claim.outcome === 'fail' && claim.differences.some(row => row.id === factId)));
  if (!isFailure(original.receipt)) throw new TypeError('Original execution has no matching independent failure.');
  let scenario = original.compiled.scenario; const attempts = [];
  for (let index = scenario.revisions.length - 1; index >= 0 && attempts.length < maxAttempts; index--) {
    throwIfAborted(signal);
    const remainingMs = Math.floor(maxMs - (performance.now() - began)); if (remainingMs < 1) break;
    if (scenario.revisions[index].id === checkpointId) continue;
    const removedRevisionId = scenario.revisions[index].id;
    let candidate;
    try { candidate = sealRevisionEdits(scenario, scenario.revisions.filter((_, position) => position !== index)); }
    catch (error) {
      if (error?.code !== 'ERR_REVISION_ORACLE_SCENARIO') throw error;
      attempts.push({ removedRevisionId, outcome: 'invalid-precondition', accepted: false }); continue;
    }
    const trial = runRevisionScenario(candidate, { maxMs: Math.min(remainingMs, 1000), signal });
    try {
      const receipt = readRevisionRun(trial), accepted = isFailure(receipt);
      attempts.push({ removedRevisionId, executionId: receipt.executionId, scenarioId: receipt.scenarioId, outcome: receipt.outcome, accepted });
      if (accepted) scenario = candidate;
    } finally { retireRevisionRun(trial); }
  }
  return immutable({ schemaVersion: 1, kind: 'finite-positive-revision-minimization', originalExecutionId: original.receipt.executionId,
    originalScenarioId: original.compiled.scenarioId, minimizedScenarioId: revisionScenarioId(scenario), checkpointId, factId, scenario,
    attempts, changed: revisionScenarioId(scenario) !== original.compiled.scenarioId, predicate: 'same-checkpoint-and-fact-independent-disagreement-v1',
    scope: 'revision-deletion-only; no-source-or-program-minimality', elapsedMs: performance.now() - began });
};
