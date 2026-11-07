import { randomUUID } from 'node:crypto';
import { captureSemanticRequest } from '../../../src/semantic/request-snapshot.js';
import { createAjv, compileSchema } from '../../../src/shared/validation/ajv-factory.js';
import { throwIfAborted } from '../../../src/shared/abort.js';
import { bootstrapAdjacencyView } from '../../../src/index/semantic/views/adjacency-delta.js';
import { bootstrapRelationalJoin, applyRelationalJoinDelta, describeRelationalJoin, relationalJoinWork } from '../../../src/index/semantic/views/relational-join.js';
import { bootstrapGroupedAdjacency, applyGroupedAdjacencyDelta, describeGroupedAdjacency, groupedAdjacencyWork } from '../../../src/index/semantic/views/grouped-adjacency.js';
import { bootstrapSelectedAdjacency, applySelectedAdjacencyDelta, describeSelectedAdjacency, selectedAdjacencyWork } from '../../../src/index/semantic/views/selected-adjacency.js';
import { finiteViewFields, captureFiniteViewJson } from '../../../src/index/semantic/views/finite-input.js';
import { REVISION_RELATIONAL_SCHEMA, REVISION_RELATIONAL_RECEIPT_SCHEMA, REVISION_RELATIONAL_VERSION, REVISION_RELATIONAL_PROFILE } from '../../../src/contracts/schemas/revision-relational.js';
import { revisionKey, revisionScenarioId } from './scenario.js';
import { minimizeRevisionSequence } from './minimize.js';

const owned = new WeakMap(), ajv = createAjv({ strict: true, allErrors: true }), validate = compileSchema(ajv, REVISION_RELATIONAL_SCHEMA);
const validateReceipt = compileSchema(ajv, REVISION_RELATIONAL_RECEIPT_SCHEMA);
export { REVISION_RELATIONAL_PROFILE };
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_REVISION_RELATIONAL_SCENARIO' });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const get = handle => { const state = owned.get(handle); if (!state) throw fail('Original relational revision execution required.'); return state; };
const supportKey = row => revisionKey([row.occurrenceId, row.supportId]);
const payload = row => revisionKey([row.from, row.to, row.sourceRef]);
const sorted = rows => rows.sort((a, b) => supportKey(a) < supportKey(b) ? -1 : supportKey(a) > supportKey(b) ? 1 : 0);
const stateId = state => revisionScenarioId({ profile: REVISION_RELATIONAL_PROFILE, state });
const binary = definition => ['inner-join', 'left-anti-join'].includes(definition.operator);
const ownerFor = definition => definition.operator === 'grouped-adjacency'
  ? { bootstrap: bootstrapGroupedAdjacency, apply: applyGroupedAdjacencyDelta, inspect: describeGroupedAdjacency, work: groupedAdjacencyWork }
  : definition.operator === 'select-project-adjacency'
    ? { bootstrap: bootstrapSelectedAdjacency, apply: applySelectedAdjacencyDelta, inspect: describeSelectedAdjacency, work: selectedAdjacencyWork }
    : { bootstrap: bootstrapRelationalJoin, apply: applyRelationalJoinDelta, inspect: describeRelationalJoin, work: relationalJoinWork };

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
    if (!binary(scenario.definition) && (state.right.length || !state.rightComplete)) throw fail('Unary scenarios require an empty complete unused right domain.');
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
  ruleVersion: '1', configHash: scenario.definition.configHash, domainId: binary(scenario.definition) ? scenario.definition[side + 'DomainId'] : scenario.definition.inputDomainId,
  algebra: 'signed-occurrence-bag-v1' });
const fresh = (scenario, state) => {
  const left = bootstrapAdjacencyView({ definition: inputDefinition(scenario, 'left'), world: state.world, rows: state.left, complete: state.leftComplete });
  return ownerFor(scenario.definition).bootstrap({ definition: scenario.definition, ...(binary(scenario.definition) ? { left,
    right: bootstrapAdjacencyView({ definition: inputDefinition(scenario, 'right'), world: state.world, rows: state.right, complete: state.rightComplete }) } : { input: left }) });
};
const batchFor = (scenario, view, edit) => {
  const report = ownerFor(scenario.definition).inspect(view);
  const side = name => ({ batchId: edit.id + ':' + name, definition: inputDefinition(scenario, name),
    fromWorld: report.world, toWorld: edit.toWorld, baseRoot: binary(scenario.definition) ? report.inputRoots[name] : report.inputRootId,
    edits: edit[name], capturedDomainComplete: edit[name + 'Complete'] });
  return { batchId: edit.id, expectedRootId: view.rootId, ...(binary(scenario.definition) ? { left: side('left'), right: side('right') } : { input: side('left') }) };
};
const normalize = (value, operator, relationCardinality) => {
  // Candidate rows come only from the registered original operator, not data
  // claiming to be an admitted execution. Canonical capture owns comparisons.
  const rows = value.rows.map(row => operator === 'grouped-adjacency' ? row
    : operator === 'select-project-adjacency' ? { from: row.from, to: row.to, multiplicity: row.multiplicity, parent: row.parent }
      : { from: row.from, to: row.to, multiplicity: row.multiplicity, parents: row.parents });
  return JSON.parse(revisionKey({ operator, relationCardinality, capturedDomainComplete: value.capturedDomainComplete,
    unresolvedLeftSupports: binary({ operator }) ? value.unresolvedLeftSupports : 0, rows: rows
      .sort((a, b) => revisionKey(a) < revisionKey(b) ? -1 : revisionKey(a) > revisionKey(b) ? 1 : 0) }));
};
const reference = (state, { signal = null, check = () => true, maxReferenceWork = 4096 } = {}) => {
  let work = 0, reason = null;
  const unknown = () => ({ outcome: 'unknown', reason, work, output: null });
  const tick = () => {
    throwIfAborted(signal);
    if (!check()) { reason = 'reference-time-budget'; return false; }
    if (work >= maxReferenceWork) { reason = 'reference-operation-budget'; return false; }
    work++; return true;
  };
  throwIfAborted(signal);
  if (!check()) { reason = 'reference-time-budget'; return unknown(); }
  if (!binary(state.definition)) {
    const copies = [];
    for (const row of state.left) for (let copy = 0; copy < Number(row.multiplicity); copy++) {
      if (!tick()) return unknown(); copies.push(row);
    }
    let rows;
    if (state.definition.operator === 'grouped-adjacency') {
      const field = state.definition.groupBy, opposite = field === 'from' ? 'to' : 'from';
      rows = [];
      for (const groupKey of [...new Set(copies.map(row => row[field]))].sort()) {
        const values = [];
        for (const copy of copies) { if (!tick()) return unknown(); if (copy[field] === groupKey) values.push(copy[opposite]); }
        values.sort(); const alternatives = state.left.filter(row => row[field] === groupKey);
        rows.push({ key: groupKey, supportCount: alternatives.length, weightedCount: String(values.length), distinctValueCount: new Set(values).size,
          minimum: values[0], maximum: values.at(-1), status: state.leftComplete ? 'exact-in-captured-domain' : 'observed-in-incomplete-domain', alternatives });
      }
    } else {
      const selected = new Map();
      for (const copy of copies) {
        if (!tick()) return unknown();
        if (state.definition.whereField !== null && copy[state.definition.whereField] !== state.definition.whereEquals) continue;
        const row = { from: copy[state.definition.projectFrom], to: copy[state.definition.projectTo], parent: copy }, id = revisionKey(row);
        if (!selected.has(id)) selected.set(id, { ...row, count: 0 }); selected.get(id).count++;
      }
      rows = [...selected.values()].map(({ count, ...row }) => ({ ...row, multiplicity: String(count) }));
    }
    const cardinality = state.definition.operator === 'grouped-adjacency' ? state.leftComplete ? rows.length : 0
      : rows.reduce((total, row) => total + Number(row.multiplicity), 0);
    return { outcome: 'complete', reason: null, work, output: normalize({ rows, capturedDomainComplete: state.leftComplete }, state.definition.operator, String(cardinality)) };
  }
  const expand = rows => rows.flatMap(row => Array.from({ length: Number(row.multiplicity) }, () => row));
  const left = expand(state.left), right = expand(state.right), results = new Map();
  const parent = row => ({ occurrenceId: row.occurrenceId, supportId: row.supportId, sourceRef: row.sourceRef });
  const add = (a, b) => {
    const row = { from: a.from, to: b ? b.to : a.to, parents: { left: parent(a), right: b ? parent(b) : null } }, id = revisionKey(row);
    if (!results.has(id)) results.set(id, { ...row, count: 0 }); results.get(id).count++;
  };
  for (const a of left) {
    if (!right.length && !tick()) return unknown();
    let matches = 0;
    for (const b of right) {
      if (!tick()) return unknown();
      if (a.to === b.from) { matches++; if (state.definition.operator === 'inner-join') add(a, b); }
    }
    if (state.definition.operator === 'left-anti-join' && !matches && state.rightComplete) add(a, null);
  }
  const rows = [...results.values()].map(({ count, ...row }) => ({ ...row, multiplicity: String(count) }));
  const output = normalize({ capturedDomainComplete: state.leftComplete && state.rightComplete,
    unresolvedLeftSupports: state.definition.operator === 'left-anti-join' && !state.rightComplete
      ? state.left.filter(a => !state.right.some(b => a.to === b.from)).length : 0,
    rows }, state.definition.operator, String(rows.reduce((total, row) => total + Number(row.multiplicity), 0)));
  return { outcome: 'complete', reason: null, work, output };
};

/** Deterministic bounded original records; no source compiler or executable
 * generator is inferred from a supplied scenario/profile label. */
export const generateRelationalRevisionScenario = ({ world, family, seed = 0 }) => {
  if (!['join-cross-term', 'anti-join-support-threshold', 'seeded-bags', 'group-extremum-retraction', 'selected-duplicate-projection',
    'group-partial-domain', 'selected-partial-domain', 'anti-join-partial-domain', 'selected-sparse-maintenance', 'join-sparse-maintenance'].includes(family)
    || !Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw fail('Unsupported relational revision generator or seed.');
  const row = (id, from, to, multiplicity = '1') => ({ occurrenceId: 'o-' + id, supportId: id, from, to, multiplicity, sourceRef: null });
  const nextWorld = revision => ({ ...world, generation: { ...world.generation, semanticRevision: revision } });
  if (family.startsWith('group-') || family.startsWith('selected-')) {
    const grouped = family.startsWith('group-'), partial = family.endsWith('partial-domain'), sparse = family === 'selected-sparse-maintenance';
    const parents = sparse ? [row('wanted', 'g', 'a'), ...Array.from({ length: 7 }, (_, index) => row('other-' + index, 'h', 'b'))]
      : [row('low', 'g', 'a', String(1 + seed % 3)), row('middle', 'g', 'm'), row('high', 'g', 'z')];
    const selectedDefinition = { schemaVersion: 1, id: 'revision-unary', ruleVersion: '1', configHash: 'a'.repeat(64),
      domainId: 'revision-output', inputDomainId: 'revision-left', ...(grouped ? { operator: 'grouped-adjacency', groupBy: 'from' }
        : { operator: 'select-project-adjacency', whereField: 'from', whereEquals: 'g', projectFrom: 'from', projectTo: 'from' }) };
    const edit = (id, revision, left, leftComplete = true) => ({ id, toWorld: nextWorld(revision), left, right: [], leftComplete, rightComplete: true });
    const edits = partial || sparse ? [edit('complete-domain', 1, []), edit('lose-domain', 2, [], false), edit('reconfirm-domain', 3, [])]
      : [edit('remove-low', 1, [{ ...parents[0], multiplicity: '-' + parents[0].multiplicity }]),
        edit('remove-high', 2, [{ ...parents[2], multiplicity: '-1' }]), edit('restore-low', 3, [parents[0]])];
    return seal({ schemaVersion: REVISION_RELATIONAL_VERSION, profile: REVISION_RELATIONAL_PROFILE, family, seed, world, definition: selectedDefinition,
      initial: { left: parents, right: [], leftComplete: !(partial || sparse), rightComplete: true }, revisions: [] }, edits);
  }
  const operator = family.startsWith('anti-join-') ? 'left-anti-join' : 'inner-join';
  const left = [row('l', 'a', 'k', String(1 + seed % 3))], right = [row('r1', 'k', 'b'), row('r2', 'k', 'c', String(1 + (seed >>> 2) % 3))];
  const initial = { left: [], right: [], leftComplete: true, rightComplete: true };
  const edit = (id, index, l, r) => ({ id, toWorld: nextWorld(index), left: l, right: r, leftComplete: true, rightComplete: true });
  let edits;
  if (family === 'join-sparse-maintenance') {
    initial.left = Array.from({ length: 8 }, (_, index) => row('padding-' + index, 'a', 'unmatched'));
    initial.right = [right[0]];
    edits = [edit('introduce-match', 1, [{ ...initial.left[0], multiplicity: '-1' }, left[0]], []),
      edit('increase-match', 2, [{ ...left[0], multiplicity: '1' }], []),
      edit('remove-match', 3, [{ ...left[0], multiplicity: '-' + String(Number(left[0].multiplicity) + 1) }], [])];
  } else if (family === 'anti-join-partial-domain') {
    initial.left = left; initial.rightComplete = false;
    edits = [{ ...edit('complete-domain', 1, [], []), rightComplete: true }, edit('block-left', 2, [], [right[0]]),
      { ...edit('lose-domain', 3, [], []), rightComplete: false },
      { ...edit('remove-blocker', 4, [], [{ ...right[0], multiplicity: '-1' }]), rightComplete: false }];
  } else if (operator === 'left-anti-join') {
    initial.left = left; initial.right = right;
    edits = [edit('two-to-one', 1, [], [{ ...right[0], multiplicity: '-1' }]),
      edit('one-to-zero', 2, [], [{ ...right[1], multiplicity: '-' + right[1].multiplicity }]), edit('zero-to-one', 3, [], [right[0]])];
  } else edits = [edit('add-both', 1, left, family === 'seeded-bags' ? right : [right[0]]),
    edit('remove-left', 2, [{ ...left[0], multiplicity: '-' + left[0].multiplicity }], []), edit('restore-left', 3, left, [])];
  return seal({ schemaVersion: REVISION_RELATIONAL_VERSION, profile: REVISION_RELATIONAL_PROFILE, family, seed, world, initial,
    definition: { schemaVersion: 1, id: 'revision-join', operator, ruleVersion: '1', configHash: 'a'.repeat(64),
      domainId: 'revision-output', leftDomainId: 'revision-left', rightDomainId: 'revision-right' }, revisions: [] }, edits);
};

export const compareRelationalRevisionOutput = ({ scenario, checkpoint, actual }) => {
  const compiled = compile(scenario);
  if (!Number.isInteger(checkpoint) || checkpoint < 0 || checkpoint >= compiled.states.length) throw fail('Invalid relational revision checkpoint.');
  const expected = reference(compiled.states[checkpoint]).output;
  // The diagnostic seam accepts only bounded passive data, without converting
  // copied results into original execution handles or source qualifications.
  actual = captureFiniteViewJson(actual, 262144, fail);
  return freeze({ outcome: revisionKey(actual) === revisionKey(expected) ? 'pass' : 'fail', expected, actual });
};

export const runRelationalRevisionScenario = (input, options = {}) => {
  const began = performance.now(), compiled = compile(input);
  const { signal = null, maxMs = 1000, maxReferenceWork = 4096 } = finiteViewFields(options, [], ['signal', 'maxMs', 'maxReferenceWork'], fail);
  throwIfAborted(signal);
  if (!Number.isInteger(maxMs) || maxMs < 1 || maxMs > 1000) throw fail('Invalid relational revision time allowance.');
  if (!Number.isInteger(maxReferenceWork) || maxReferenceWork < 0 || maxReferenceWork > 4096) throw fail('Invalid relational reference work allowance.');
  const checkpoints = [], owner = ownerFor(compiled.scenario.definition), operator = compiled.scenario.definition.operator;
  let current = null, stopped = false, retainedCounterexamples = 0;
  const check = () => performance.now() - began < maxMs;
  for (const [index, state] of compiled.states.entries()) {
    throwIfAborted(signal);
    const checkpointId = index ? compiled.scenario.revisions[index - 1].id : 'base';
    if (stopped || !check()) { checkpoints.push({ index, checkpointId, outcome: 'not-run', reason: 'run-work-budget' }); continue; }
    const candidateBegan = performance.now();
    if (!current) current = fresh(compiled.scenario, state);
    else {
      const transition = owner.apply(current, batchFor(compiled.scenario, current, compiled.scenario.revisions[index - 1]), { signal });
      if (!transition.consumed) { stopped = true; checkpoints.push({ index, checkpointId, outcome: 'not-run', reason: transition.status }); continue; }
      current = transition.view;
    }
    const actual = normalize(owner.inspect(current), operator, current.relation.cardinality), candidateMs = performance.now() - candidateBegan;
    const rebuildBegan = performance.now(), rebuilt = fresh(compiled.scenario, state), rebuildOutput = normalize(owner.inspect(rebuilt), operator, rebuilt.relation.cardinality);
    const rebuildMs = performance.now() - rebuildBegan, referenceBegan = performance.now(), oracle = reference(state, { signal, check, maxReferenceWork });
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
      work: { candidateMs, rebuildMs, referenceMs: performance.now() - referenceBegan, referenceOperations: oracle.work, ...owner.work(current) },
      capturedDomainComplete: actual.capturedDomainComplete, unresolvedLeftSupports: actual.unresolvedLeftSupports });
  }
  const executionId = randomUUID(), receipt = freeze({ schemaVersion: REVISION_RELATIONAL_VERSION, kind: 'finite-relational-revision-run', scenarioId: compiled.scenarioId,
    executionId, profile: compiled.scenario.profile, operator, outcome: checkpoints.some(row => row.outcome === 'fail') ? 'fail'
      : checkpoints.every(row => row.outcome === 'pass') ? 'pass' : 'unknown', checkpoints,
    scope: 'tiny-supplied-occurrence-bags-and-captured-domain-observations', sourceAuthority: 'not-established', semanticClosure: 'not-implied',
    limits: { maxMs, maxReferenceWork, inputSupportsPerSide: 8, copiesPerSupport: 8, checkpoints: 17, receiptBytes: 262144 }, elapsedMs: performance.now() - began });
  if (Buffer.byteLength(revisionKey(receipt)) > 262144) throw fail('Relational revision receipt exceeds its retained byte allowance.');
  if (!validateReceipt(receipt)) throw fail('Invalid original relational revision receipt.');
  const handle = Object.freeze({ executionId, scenarioId: compiled.scenarioId }); owned.set(handle, { compiled, receipt }); return handle;
};
export const readRelationalRevisionRun = handle => get(handle).receipt;
export const retireRelationalRevisionRun = handle => { const state = get(handle); owned.delete(handle); return Object.freeze({ executionId: state.receipt.executionId, retired: true }); };
export const minimizeRelationalRevisionFailure = (handle, { checkpointId, maxAttempts = 32, maxMs = 1000, signal = null } = {}) => {
  const original = get(handle);
  return minimizeRevisionSequence({ originalScenario: original.compiled.scenario, originalReceipt: original.receipt,
    matches: receipt => receipt.checkpoints.some(row => row.checkpointId === checkpointId
      && row.claims?.some(claim => claim.tier === 'independent-tiny-expanded-bag' && claim.outcome === 'fail')),
    seal, invalidScenario: error => error?.code === 'ERR_REVISION_RELATIONAL_SCENARIO', run: runRelationalRevisionScenario,
    read: readRelationalRevisionRun, dispose: retireRelationalRevisionRun, kind: 'finite-relational-revision-minimization', selection: { checkpointId },
    predicate: 'same-checkpoint-independent-bag-disagreement-v1' }, { checkpointId, maxAttempts, maxMs, signal });
};
