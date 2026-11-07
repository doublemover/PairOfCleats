import { randomUUID } from 'node:crypto';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { bootstrapAdjacencyView } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapRelationalJoin, applyRelationalJoinDelta, describeRelationalJoin, relationalJoinWork } from '../../../src/index/semantic/views/relational-join.js';
import { REVISION_RELATIONAL_SCHEMA, REVISION_RELATIONAL_RECEIPT_SCHEMA } from '../../../src/contracts/schemas/revision-relational.js';
import { revisionKey, revisionScenarioId } from './scenario.js';

const owned = new WeakMap(), ajv = createAjv({ strict: true, allErrors: true }), validate = compileSchema(ajv, REVISION_RELATIONAL_SCHEMA);
const validateReceipt = compileSchema(ajv, REVISION_RELATIONAL_RECEIPT_SCHEMA);
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_REVISION_RELATIONAL_SCENARIO' });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const get = handle => { const state = owned.get(handle); if (!state) throw fail('Original relational revision execution required.'); return state; };
const supportKey = row => revisionKey([row.occurrenceId, row.supportId]);
const payload = row => revisionKey([row.from, row.to, row.sourceRef]);
const sorted = rows => rows.sort((a, b) => supportKey(a) < supportKey(b) ? -1 : supportKey(a) > supportKey(b) ? 1 : 0);
const stateId = state => revisionScenarioId({ profile: 'finite-relational-revisions-v1', state });

/** Independent history interpretation, not candidate delta propagation. Recount
 * every admitted original contribution at each checkpoint, including duplicates. */
const stateAt = (scenario, checkpoint) => {
  const rowsAt = side => {
    const contributions = [...scenario.initial[side], ...scenario.revisions.slice(0, checkpoint).flatMap(edit => edit[side])];
    const keys = [...new Set(contributions.map(supportKey))], rows = [];
    for (const id of keys) {
      const matching = contributions.filter(row => supportKey(row) === id), first = matching[0];
      if (matching.some(row => payload(row) !== payload(first))) throw fail('One original support cannot change payload within the revision scenario.');
      const count = matching.reduce((total, row) => total + Number(row.multiplicity), 0);
      if (count < 0 || count > 8) throw fail('Tiny reference supports must have zero through eight copies at every checkpoint.');
      if (count) rows.push({ ...first, multiplicity: String(count) });
    }
    if (rows.length > 8) throw fail('Tiny reference side exceeds eight retained supports.'); return sorted(rows);
  };
  const boundary = checkpoint ? scenario.revisions[checkpoint - 1] : scenario.initial;
  return { definition: scenario.definition, world: checkpoint ? boundary.toWorld : scenario.world,
    left: rowsAt('left'), right: rowsAt('right'), leftComplete: boundary.leftComplete, rightComplete: boundary.rightComplete };
};
const compile = input => {
  const scenario = captureSemanticRequest(input, REVISION_RELATIONAL_SCHEMA);
  if (!validate(scenario)) throw fail('Invalid finite relational revision scenario.'); revisionKey(scenario);
  for (const side of ['left', 'right']) if (new Set(scenario.initial[side].map(supportKey)).size !== scenario.initial[side].length) throw fail('Duplicate initial occurrence/support identity.');
  const states = [], ids = new Set(['base']);
  for (let index = 0; index <= scenario.revisions.length; index++) {
    const state = stateAt(scenario, index);
    if (index) {
      const edit = scenario.revisions[index - 1];
      if (ids.has(edit.id) || edit.beforeId !== stateId(states.at(-1)) || edit.afterId !== stateId(state)) throw fail('Duplicate/stale revision identity or realized-state precondition.');
      ids.add(edit.id);
    }
    states.push(state);
  }
  return { scenario, states, scenarioId: revisionScenarioId(scenario) };
};
const seal = (scenario, edits) => {
  const draft = { ...scenario, revisions: edits }, revisions = [];
  for (let index = 0; index < edits.length; index++) revisions.push({ ...edits[index], beforeId: stateId(stateAt(draft, index)), afterId: stateId(stateAt(draft, index + 1)) });
  return compile({ ...scenario, revisions }).scenario;
};

const inputDefinition = (scenario, side) => ({ viewId: 'revision-' + side, producerId: 'finite-relational-revision-fixture', producerEpoch: '1',
  ruleVersion: '1', configHash: scenario.definition.configHash, domainId: scenario.definition[side + 'DomainId'], algebra: 'signed-occurrence-bag-v1' });
const fresh = (scenario, state) => bootstrapRelationalJoin({ definition: scenario.definition,
  left: bootstrapAdjacencyView({ definition: inputDefinition(scenario, 'left'), world: state.world, rows: state.left, complete: state.leftComplete }),
  right: bootstrapAdjacencyView({ definition: inputDefinition(scenario, 'right'), world: state.world, rows: state.right, complete: state.rightComplete }) });
const batchFor = (scenario, view, edit) => {
  const report = describeRelationalJoin(view);
  const side = name => ({ batchId: edit.id + ':' + name, definition: inputDefinition(scenario, name),
    fromWorld: report.world, toWorld: edit.toWorld, baseRoot: report.inputRoots[name], edits: edit[name], capturedDomainComplete: edit[name + 'Complete'] });
  return { batchId: edit.id, expectedRootId: view.rootId, left: side('left'), right: side('right') };
};
const normalize = value => {
  // Candidate rows come only from the registered original operator, not data
  // claiming to be an admitted execution. Canonical capture owns comparisons.
  return JSON.parse(revisionKey({ capturedDomainComplete: value.capturedDomainComplete, unresolvedLeftSupports: value.unresolvedLeftSupports,
    rows: value.rows.map(row => ({ from: row.from, to: row.to, multiplicity: row.multiplicity, parents: row.parents }))
      .sort((a, b) => revisionKey(a) < revisionKey(b) ? -1 : revisionKey(a) > revisionKey(b) ? 1 : 0) }));
};
const reference = (state, { signal = null, check = () => true, maxReferencePairs = 4096 } = {}) => {
  let work = 0;
  const expand = rows => rows.flatMap(row => Array.from({ length: Number(row.multiplicity) }, () => row));
  const left = expand(state.left), right = expand(state.right), results = new Map();
  const parent = row => ({ occurrenceId: row.occurrenceId, supportId: row.supportId, sourceRef: row.sourceRef });
  const add = (a, b) => {
    const row = { from: a.from, to: b ? b.to : a.to, parents: { left: parent(a), right: b ? parent(b) : null } }, id = revisionKey(row);
    if (!results.has(id)) results.set(id, { ...row, count: 0 }); results.get(id).count++;
  };
  for (const a of left) {
    throwIfAborted(signal); if (!check()) return { outcome: 'unknown', reason: 'reference-work-budget', work, output: null };
    let matches = 0;
    for (const b of right) {
      if (work >= maxReferencePairs) return { outcome: 'unknown', reason: 'reference-pair-budget', work, output: null };
      work++;
      if (a.to === b.from) { matches++; if (state.definition.operator === 'inner-join') add(a, b); }
    }
    if (state.definition.operator === 'left-anti-join' && !matches && state.rightComplete) add(a, null);
  }
  const output = normalize({ capturedDomainComplete: state.leftComplete && state.rightComplete,
    unresolvedLeftSupports: state.definition.operator === 'left-anti-join' && !state.rightComplete
      ? state.left.filter(a => !state.right.some(b => a.to === b.from)).length : 0,
    rows: [...results.values()].map(({ count, ...row }) => ({ ...row, multiplicity: String(count) })) });
  return { outcome: 'complete', reason: null, work, output };
};

/** Deterministic bounded original records; no source compiler or executable
 * generator is inferred from a supplied scenario/profile label. */
export const generateRelationalRevisionScenario = ({ world, family, seed = 0 }) => {
  if (!['join-cross-term', 'anti-join-support-threshold', 'seeded-bags'].includes(family)
    || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw fail('Unsupported relational revision generator or seed.');
  const row = (id, from, to, multiplicity = '1') => ({ occurrenceId: 'o-' + id, supportId: id, from, to, multiplicity, sourceRef: null });
  const nextWorld = revision => ({ ...world, generation: { ...world.generation, semanticRevision: revision } });
  const operator = family === 'anti-join-support-threshold' ? 'left-anti-join' : 'inner-join';
  const left = [row('l', 'a', 'k', String(1 + seed % 3))], right = [row('r1', 'k', 'b'), row('r2', 'k', 'c', String(1 + (seed >>> 2) % 3))];
  const initial = { left: [], right: [], leftComplete: true, rightComplete: true };
  const edit = (id, index, l, r) => ({ id, toWorld: nextWorld(index), left: l, right: r, leftComplete: true, rightComplete: true });
  let edits;
  if (operator === 'left-anti-join') {
    initial.left = left; initial.right = right;
    edits = [edit('two-to-one', 1, [], [{ ...right[0], multiplicity: '-1' }]),
      edit('one-to-zero', 2, [], [{ ...right[1], multiplicity: '-' + right[1].multiplicity }]), edit('zero-to-one', 3, [], [right[0]])];
  } else edits = [edit('add-both', 1, left, family === 'seeded-bags' ? right : [right[0]]),
    edit('remove-left', 2, [{ ...left[0], multiplicity: '-' + left[0].multiplicity }], []), edit('restore-left', 3, left, [])];
  return seal({ schemaVersion: 1, profile: 'finite-relational-revisions-v1', family, seed, world, initial,
    definition: { schemaVersion: 1, id: 'revision-join', operator, ruleVersion: '1', configHash: 'a'.repeat(64),
      domainId: 'revision-output', leftDomainId: 'revision-left', rightDomainId: 'revision-right' }, revisions: [] }, edits);
};

export const compareRelationalRevisionOutput = ({ scenario, checkpoint, actual }) => {
  const compiled = compile(scenario);
  if (!Number.isInteger(checkpoint) || checkpoint < 0 || checkpoint >= compiled.states.length) throw fail('Invalid relational revision checkpoint.');
  const expected = reference(compiled.states[checkpoint]).output;
  // The diagnostic seam accepts only bounded passive data, without converting
  // copied results into original execution handles or source qualifications.
  actual = JSON.parse(revisionKey(actual));
  return freeze({ outcome: revisionKey(actual) === revisionKey(expected) ? 'pass' : 'fail', expected, actual });
};

export const runRelationalRevisionScenario = (input, { signal = null, maxMs = 1000, maxReferencePairs = 4096 } = {}) => {
  const began = performance.now(); throwIfAborted(signal);
  if (!Number.isInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid relational revision time allowance.');
  if (!Number.isInteger(maxReferencePairs) || maxReferencePairs < 0 || maxReferencePairs > 4096) throw fail('Invalid relational reference pair allowance.');
  const compiled = compile(input), checkpoints = [];
  let current = null, stopped = false, retainedCounterexamples = 0;
  const check = () => performance.now() - began < maxMs;
  for (const [index, state] of compiled.states.entries()) {
    throwIfAborted(signal);
    const checkpointId = index ? compiled.scenario.revisions[index - 1].id : 'base';
    if (stopped || !check()) { checkpoints.push({ index, checkpointId, outcome: 'not-run', reason: 'run-work-budget' }); continue; }
    const candidateBegan = performance.now();
    if (!current) current = fresh(compiled.scenario, state);
    else {
      const transition = applyRelationalJoinDelta(current, batchFor(compiled.scenario, current, compiled.scenario.revisions[index - 1]), { signal });
      if (!transition.consumed) { stopped = true; checkpoints.push({ index, checkpointId, outcome: 'not-run', reason: transition.status }); continue; }
      current = transition.view;
    }
    const actual = normalize(describeRelationalJoin(current)), candidateMs = performance.now() - candidateBegan;
    const rebuildBegan = performance.now(), rebuilt = fresh(compiled.scenario, state), rebuildOutput = normalize(describeRelationalJoin(rebuilt));
    const rebuildMs = performance.now() - rebuildBegan, referenceBegan = performance.now(), oracle = reference(state, { signal, check, maxReferencePairs });
    const independent = oracle.output === null ? 'unknown' : revisionKey(oracle.output) === revisionKey(actual) ? 'pass' : 'fail';
    const parity = revisionKey(actual) === revisionKey(rebuildOutput) && current.relation.rootId === rebuilt.relation.rootId;
    const retainCounterexample = independent === 'fail' && retainedCounterexamples++ === 0;
    checkpoints.push({ index, checkpointId, stateId: stateId(state), outcome: !parity || independent === 'fail' ? 'fail' : independent,
      candidateExecutionId: randomUUID(), rebuildExecutionId: randomUUID(), candidateViewRootId: current.rootId, rebuildViewRootId: rebuilt.rootId,
      candidateRelationRootId: current.relation.rootId, rebuildRelationRootId: rebuilt.relation.rootId,
      candidateOutputId: revisionScenarioId(actual), referenceOutputId: oracle.output ? revisionScenarioId(oracle.output) : null,
      claims: [{ tier: 'independent-tiny-expanded-bag', outcome: independent, reason: oracle.reason,
        counterexample: retainCounterexample ? { expected: oracle.output, actual } : null,
        counterexampleState: independent !== 'fail' ? 'not-applicable' : retainCounterexample ? 'retained' : 'omitted-after-first; failure-retained' },
      { tier: 'same-implementation-clean-rebuild', outcome: parity ? 'pass' : 'fail', identity: 'relation-content; private-ledgers-are-invocation-specific' }],
      work: { candidateMs, rebuildMs, referenceMs: performance.now() - referenceBegan, referencePairs: oracle.work, ...relationalJoinWork(current) },
      capturedDomainComplete: actual.capturedDomainComplete, unresolvedLeftSupports: actual.unresolvedLeftSupports });
  }
  const executionId = randomUUID(), receipt = freeze({ schemaVersion: 1, kind: 'finite-relational-revision-run', scenarioId: compiled.scenarioId,
    executionId, profile: compiled.scenario.profile, outcome: checkpoints.some(row => row.outcome === 'fail') ? 'fail'
      : checkpoints.every(row => row.outcome === 'pass') ? 'pass' : 'unknown', checkpoints,
    scope: 'tiny-supplied-occurrence-bags-and-captured-domain-observations', sourceAuthority: 'not-established', semanticClosure: 'not-implied',
    limits: { maxMs, maxReferencePairs, inputSupportsPerSide: 8, copiesPerSupport: 8, checkpoints: 17, receiptBytes: 262144 }, elapsedMs: performance.now() - began });
  if (Buffer.byteLength(revisionKey(receipt)) > 262144) throw fail('Relational revision receipt exceeds its retained byte allowance.');
  if (!validateReceipt(receipt)) throw fail('Invalid original relational revision receipt.');
  const handle = Object.freeze({ executionId, scenarioId: compiled.scenarioId }); owned.set(handle, { compiled, receipt }); return handle;
};
export const readRelationalRevisionRun = handle => get(handle).receipt;
export const retireRelationalRevisionRun = handle => { const state = get(handle); owned.delete(handle); return Object.freeze({ executionId: state.receipt.executionId, retired: true }); };
