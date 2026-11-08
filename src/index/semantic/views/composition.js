import { types } from 'node:util';
import { createAjv, compileSchema } from '../../../shared/validation/ajv-factory.js';
import { throwIfAborted, isAbortError } from '../../../shared/abort.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { isSemanticJsonBudgetError } from '../canonical-json-bounds.js';
import { VIEW_COMPOSITION_DEFINITION_SCHEMA, VIEW_COMPOSITION_LIMITS } from '../../../contracts/schemas/view-composition.js';
import { bootstrapAdjacencyView, readAdjacencyViewInput, applyAdjacencyDelta, readAdjacencyTransition,
  observeAdjacencyIdentity, adjacencyViewRetainedBytes } from './adjacency-delta.js';
import { bootstrapSelectedAdjacency, applySelectedAdjacencyTransition, describeSelectedAdjacency, selectedAdjacencyWork } from './selected-adjacency.js';
import { bootstrapGroupedAdjacency, applyGroupedAdjacencyTransition, describeGroupedAdjacency, groupedAdjacencyWork } from './grouped-adjacency.js';
import { bootstrapRelationalJoin, applyRelationalJoinTransitions, describeRelationalJoin, relationalJoinWork } from './relational-join.js';
import { openOccurrenceCursor } from '../../../semantic/relations/factor.js';
import { finiteViewFields, captureFiniteViewDefinition, captureFiniteViewJson } from './finite-input.js';

export const VIEW_COMPOSITION_PROFILE = 'finite-adjacency-composition-v1';
const owned = new WeakMap(), allowanceErrors = new WeakSet();
const validate = compileSchema(createAjv({ strict: true }), VIEW_COMPOSITION_DEFINITION_SCHEMA);
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_VIEW_COMPOSITION_CONTRACT' });
const fields = (value, required, optional = []) => finiteViewFields(value, required, optional, fail);
const hash = value => semanticHash('finite-adjacency-composition.v1', value, { maxBytes: VIEW_COMPOSITION_LIMITS.retainedBytes });
const encode = (value, maxBytes) => canonicalSemanticJson(value, { maxBytes });
const get = handle => { const state = owned.get(handle); if (!state) throw fail('Original composed view required.'); return state; };
const operations = {
  select: { bootstrap: bootstrapSelectedAdjacency, apply: applySelectedAdjacencyTransition, inspect: describeSelectedAdjacency, work: selectedAdjacencyWork },
  join: { bootstrap: bootstrapRelationalJoin, apply: applyRelationalJoinTransitions, inspect: describeRelationalJoin, work: relationalJoinWork },
  group: { bootstrap: bootstrapGroupedAdjacency, apply: applyGroupedAdjacencyTransition, inspect: describeGroupedAdjacency, work: groupedAdjacencyWork }
};
const budget = (limit, status = 'retention-budget') => {
  const error = Object.assign(new RangeError('Composed view allowance exceeded: ' + limit), { limit, status });
  allowanceErrors.add(error); throw error;
};
const limitsFor = input => {
  const limits = { ...VIEW_COMPOSITION_LIMITS, ...(input === undefined ? {} : fields(input, [], Object.keys(VIEW_COMPOSITION_LIMITS))) };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > VIEW_COMPOSITION_LIMITS[name]) throw fail('Composition allowances may only be tightened.');
  return Object.freeze(limits);
};
const captureDefinition = input => {
  const definition = captureFiniteViewDefinition(captureFiniteViewJson(input, VIEW_COMPOSITION_LIMITS.retainedBytes, fail), VIEW_COMPOSITION_DEFINITION_SCHEMA, fail);
  if (!validate(definition)) throw fail('Invalid composed view definition.');
  const domains = new Map(), stages = new Set();
  for (const source of definition.inputs) {
    if (domains.has(source.id)) throw fail('Repeated input identity.'); domains.set(source.id, source.domainId);
  }
  for (const stage of definition.stages) {
    if (domains.has(stage.id) || stage.definition.id !== stage.id) throw fail('Stage identity is ambiguous.');
    const parents = stage.kind === 'join' ? [stage.left, stage.right] : [stage.input];
    const expected = stage.kind === 'join' ? [stage.definition.leftDomainId, stage.definition.rightDomainId] : [stage.definition.inputDomainId];
    if (parents.some((parent, index) => !domains.has(parent) || domains.get(parent) !== expected[index])) throw fail('Topological original domain dependencies required.');
    domains.set(stage.id, stage.definition.domainId); stages.add(stage.id);
  }
  if (definition.outputs.some(id => !stages.has(id))) throw fail('Only declared stage outputs may be exposed.');
  return definition;
};
const captureInputs = (input, definition) => {
  if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype
    || input.length !== definition.inputs.length || Reflect.ownKeys(input).length !== input.length + 1) throw fail('Exact passive original input array required.');
  const result = new Map(), roots = new Set();
  for (let index = 0; index < input.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) throw fail('Input accessors and sparse arrays are unavailable.');
    const entry = fields(descriptor.value, ['id', 'view']), source = definition.inputs.find(source => source.id === entry.id);
    if (!source || result.has(entry.id) || readAdjacencyViewInput(entry.view).definition.domainId !== source.domainId
      || roots.has(entry.view.rootId)) throw fail('Declare each original input root once and share its DAG edges.');
    result.set(entry.id, entry.view); roots.add(entry.view.rootId);
  }
  return result;
};
const derivedDefinition = (definition, stage) => ({ viewId: stage.id, producerId: VIEW_COMPOSITION_PROFILE,
  producerEpoch: '1', ruleVersion: definition.ruleVersion, configHash: hash(definition), domainId: stage.definition.domainId, algebra: 'signed-occurrence-bag-v1' });
const parentIds = stage => stage.kind === 'join' ? [stage.left, stage.right] : [stage.input];
const supportKey = row => JSON.stringify([row.occurrenceId, row.supportId]);
const requireConsumed = result => {
  if (result.consumed) return;
  if (!['cancelled', 'work-budget', 'retention-budget', 'checkpoint-required'].includes(result.status)) throw fail('Original input replay is not a new composition transition.');
  budget(result.limit || result.status, result.status);
};
const stageRows = (stage, operator, report, signal) => {
  if (stage.kind !== 'group') return { work: report.rows.length, rows: report.rows.map(({ occurrenceId, supportId, from, to, multiplicity }) =>
    ({ occurrenceId, supportId, from, to, multiplicity, sourceRef: null })) };
  // This exact owner gives each complete group coefficient one. It is safe to
  // enumerate groups here; arbitrary occurrence coefficients are never expanded.
  if (BigInt(operator.relation.cardinality) > 256n) throw fail('Original grouped relation exceeds its owner bound.');
  const cursor = openOccurrenceCursor({ relation: operator.relation });
  try {
    const page = cursor.next({ limit: 256, workBudget: 65536, maxBytes: 2 * 1024 * 1024, signal });
    throwIfAborted(signal);
    if (page.state !== 'exhausted') budget('group-projection');
    return { work: page.consumedWork, rows: page.items.map(row => {
      if (row.occurrences.length !== 1 || row.occurrences[0].copyOrdinal !== '0') throw fail('Original coefficient-one grouped row required.');
      return { occurrenceId: row.occurrences[0].occurrenceId, supportId: row.occurrences[0].supportId,
        from: row.tuple[stage.projectFrom], to: row.tuple[stage.projectTo], multiplicity: '1', sourceRef: null };
    }) };
  } finally { cursor.close(); }
};
const rowDelta = (oldRows, nextRows, tick) => {
  const old = new Map(oldRows.map(row => [supportKey(row), row])), next = new Map(nextRows.map(row => [supportKey(row), row])), edits = [];
  for (const id of new Set([...old.keys(), ...next.keys()])) {
    tick(); const before = old.get(id), after = next.get(id);
    const count = BigInt(after?.multiplicity || '0') - BigInt(before?.multiplicity || '0');
    if (before && after && encode([before.from, before.to, before.sourceRef], 16384) !== encode([after.from, after.to, after.sourceRef], 16384)) throw fail('A derived support changed its original payload.');
    if (count !== 0n) edits.push({ ...(after || before), multiplicity: count.toString() });
  }
  return edits;
};
const affectedStages = (definition, ids) => {
  const affected = new Set(ids);
  for (const stage of definition.stages) if (parentIds(stage).some(id => affected.has(id))) affected.add(stage.id);
  return new Set(definition.stages.filter(stage => affected.has(stage.id)).map(stage => stage.id));
};
const invalidatedStages = invalidations => new Set(invalidations.flatMap(entry => entry.stages));
const build = ({ definition, inputs, limits, ledger, prior = null, sourceBatches = new Map(), invalidations = [], inputWork = 0 }, signal) => {
  let workUnits = inputWork, retainedBytes = 0;
  const tick = (amount = 1) => { throwIfAborted(signal); workUnits += amount; if (workUnits > limits.work) budget('work', 'work-budget'); };
  const charge = data => { retainedBytes += Buffer.byteLength(encode(data, limits.retainedBytes)); if (retainedBytes > limits.retainedBytes) budget('retainedBytes'); };
  const retainedInputs = new WeakSet();
  const chargeInput = view => {
    if (retainedInputs.has(view)) return; retainedInputs.add(view); retainedBytes += adjacencyViewRetainedBytes(view);
    if (retainedBytes > limits.retainedBytes) budget('retainedBytes');
  };
  const views = new Map(inputs), transitions = new Map(sourceBatches), stages = new Map(), stageReceipts = [];
  for (const view of inputs.values()) { tick(); chargeInput(view); }
  for (const stage of definition.stages) {
    tick(); const op = operations[stage.kind], ids = parentIds(stage), previous = prior?.stages.get(stage.id);
    const changed = !previous || ids.some(id => transitions.has(id)); let operator, view, batch = null, metrics;
    if (!changed) { ({ operator, view } = previous); metrics = { workUnits: 0, strategy: 'reused-original-inputs' }; }
    else {
      const args = stage.kind === 'join' ? { left: views.get(stage.left), right: views.get(stage.right) } : { input: views.get(stage.input) };
      if (!previous) operator = op.bootstrap({ definition: stage.definition, ...args }, { signal });
      else {
        const inputTransition = id => transitions.get(id) ?? observeAdjacencyIdentity(views.get(id));
        const originalInputs = ids.map(inputTransition);
        const updated = op.apply(previous.operator, { batchId: ledger.at(-1).batchId, expectedRootId: previous.operator.rootId,
          ...(stage.kind === 'join' ? { left: originalInputs[0].batch, right: originalInputs[1].batch } : { input: originalInputs[0].batch }) },
        stage.kind === 'join' ? { left: originalInputs[0].receipt, right: originalInputs[1].receipt } : originalInputs[0].receipt, { signal });
        requireConsumed(updated);
        operator = updated.view;
      }
      const report = op.inspect(operator), projected = stageRows(stage, operator, report, signal), rows = projected.rows;
      metrics = op.work(operator); tick(metrics.workUnits + projected.work);
      if (!previous) view = bootstrapAdjacencyView({ definition: derivedDefinition(definition, stage), world: report.world,
        rows, complete: report.capturedDomainComplete, maxBytes: Math.min(limits.retainedBytes, 2 * 1024 * 1024) });
      else {
        const original = readAdjacencyViewInput(previous.view);
        batch = { batchId: ledger.at(-1).batchId, definition: original.definition, fromWorld: original.world, toWorld: report.world,
          baseRoot: previous.view.rootId, edits: rowDelta(original.rows, rows, tick), capturedDomainComplete: report.capturedDomainComplete };
        const next = applyAdjacencyDelta(previous.view, batch, { signal, maxWork: limits.work - workUnits });
        requireConsumed(next);
        tick(readAdjacencyTransition(next, previous.view, batch).inputWork); view = next.view;
        transitions.set(stage.id, { batch, receipt: next });
      }
      charge(report);
    }
    const report = op.inspect(operator);
    if (!changed) charge(report);
    chargeInput(view);
    stages.set(stage.id, { operator, view }); views.set(stage.id, view);
    stageReceipts.push({ id: stage.id, parents: ids, inputRoots: ids.map(id => views.get(id).rootId),
      operatorRootId: operator.rootId, outputRootId: view.rootId, capturedDomainComplete: report.capturedDomainComplete, maintenance: metrics });
  }
  const report = JSON.parse(encode({ schemaVersion: 1, profile: VIEW_COMPOSITION_PROFILE, definition,
    inputRoots: definition.inputs.map(source => ({ id: source.id, rootId: inputs.get(source.id).rootId })), stages: stageReceipts,
    outputs: definition.outputs.map(id => ({ id, rootId: views.get(id).rootId,
      availability: invalidatedStages(invalidations).has(id) ? 'invalidated' : 'available' })), ledger, invalidations,
    status: invalidations.length ? 'invalidated' : 'materialized-private', publication: 'not-attempted', semanticClosure: 'not-implied' }, limits.retainedBytes));
  charge(report); throwIfAborted(signal);
  const handle = Object.freeze({ rootId: hash(report), profile: VIEW_COMPOSITION_PROFILE, publication: 'private-unpublished' });
  owned.set(handle, { definition, inputs, limits, ledger, stages, views, report, invalidations,
    work: { workUnits, retainedBytes, stages: stageReceipts.map(stage => ({ id: stage.id, ...stage.maintenance })) } }); return handle;
};

export const bootstrapViewComposition = (input, options = {}) => {
  const value = fields(input, ['definition', 'inputs'], ['limits']), definition = captureDefinition(value.definition);
  const inputs = captureInputs(value.inputs, definition), limits = limitsFor(value.limits);
  return build({ definition, inputs, limits, ledger: [] }, options.signal);
};
export const describeViewComposition = handle => {
  // A fresh passive copy prevents a report reader changing private replay state.
  return JSON.parse(encode(get(handle).report, VIEW_COMPOSITION_LIMITS.retainedBytes));
};
export const viewCompositionWork = handle => JSON.parse(encode(get(handle).work, VIEW_COMPOSITION_LIMITS.retainedBytes));
export const viewCompositionInput = (handle, id) => {
  const view = get(handle).inputs.get(id); if (!view) throw fail('Undeclared original input.'); return view;
};
export const viewCompositionOutput = (handle, id) => {
  const state = get(handle);
  if (invalidatedStages(state.invalidations).has(id)) throw fail('Invalidated output requires a new bootstrap.');
  if (!state.definition.outputs.includes(id)) throw fail('Undeclared output.'); return state.views.get(id);
};
export const applyViewCompositionDelta = (handle, input, options = {}) => {
  const state = get(handle), batch = captureFiniteViewJson(input, state.limits.retainedBytes, fail);
  fields(batch, ['batchId', 'expectedRootId', 'inputs']);
  if (typeof batch.batchId !== 'string' || !batch.batchId.length || batch.batchId.length > 128 || !Array.isArray(batch.inputs)
    || batch.inputs.length > state.definition.inputs.length) throw fail('Invalid composition delta.');
  const digest = hash(batch), replay = state.ledger.find(entry => entry.batchId === batch.batchId);
  if (replay) { if (replay.digest !== digest) throw fail('Composition replay changed content.'); return { status: 'replayed', consumed: false, view: handle }; }
  if (batch.expectedRootId !== handle.rootId) throw fail('Wrong composition base.');
  const requested = new Set();
  for (const change of batch.inputs) {
    fields(change, ['id', 'batch']);
    if (!state.inputs.has(change.id) || requested.has(change.id)) throw fail('Duplicate or undeclared original source.'); requested.add(change.id);
  }
  const affected = affectedStages(state.definition, batch.inputs.map(change => change.id));
  if ([...invalidatedStages(state.invalidations)].some(id => affected.has(id))) return { status: 'rebootstrap-required', consumed: false, view: handle };
  if (state.ledger.length + state.invalidations.length >= state.limits.revisions) return { status: 'checkpoint-required', consumed: false, view: handle };
  if (options.signal?.aborted) return { status: 'cancelled', consumed: false, view: handle };
  try {
    const inputs = new Map(state.inputs), sourceBatches = new Map(); let inputWork = 0;
    for (const change of batch.inputs) {
      fields(change, ['id', 'batch']);
      if (!inputs.has(change.id) || sourceBatches.has(change.id)) throw fail('Duplicate or undeclared original source.');
      const original = inputs.get(change.id), next = applyAdjacencyDelta(original, change.batch, { signal: options.signal, maxWork: state.limits.work - inputWork });
      requireConsumed(next);
      inputWork += readAdjacencyTransition(next, original, change.batch).inputWork;
      inputs.set(change.id, next.view); sourceBatches.set(change.id, { batch: change.batch, receipt: next });
    }
    const view = build({ ...state, inputs, prior: state, sourceBatches, inputWork, ledger: [...state.ledger, { batchId: batch.batchId, digest }] }, options.signal);
    return { status: 'materialized-private', consumed: true, view, publication: 'not-attempted' };
  } catch (error) {
    if (isAbortError(error)) return { status: 'cancelled', consumed: false, view: handle };
    if (isSemanticJsonBudgetError(error)) return { status: 'retention-budget', consumed: false, view: handle };
    if (allowanceErrors.has(error)) return { status: error.status, limit: error.limit, consumed: false, view: handle };
    throw error;
  }
};

/** Rebuild stage arrangements under the same current original inputs. Source
 * support histories remain owned and retained; pending invalidations cannot be
 * cleared by checkpointing old source observations. */
export const checkpointViewComposition = (handle, options = {}) => {
  const state = get(handle);
  if (state.invalidations.length) return { status: 'rebootstrap-required', consumed: false, view: handle };
  if (options.signal?.aborted) return { status: 'cancelled', consumed: false, view: handle };
  const view = build({ definition: state.definition, inputs: state.inputs, limits: state.limits, ledger: [] }, options.signal);
  return { status: 'materialized-private', consumed: true, view, publication: 'not-attempted' };
};

/** Invalidation only withholds outputs. It never confirms semantic observations
 * or clears an invalidation through a caller-supplied freshness boolean. Other
 * independent output components retain their original immutable inputs. */
export const invalidateViewComposition = (handle, input, options = {}) => {
  const state = get(handle), event = captureFiniteViewJson(input, 16384, fail);
  fields(event, ['invalidationId', 'expectedRootId', 'targets', 'reason']);
  if (typeof event.invalidationId !== 'string' || !event.invalidationId.length || event.invalidationId.length > 128
    || typeof event.reason !== 'string' || !event.reason.length || event.reason.length > 512
    || !Array.isArray(event.targets) || !event.targets.length || event.targets.length > 16 || new Set(event.targets).size !== event.targets.length
    || event.targets.some(id => !state.views.has(id))) throw fail('Exact bounded invalidation targets required.');
  const digest = hash(event), previous = state.invalidations.find(entry => entry.id === event.invalidationId);
  if (previous) { if (previous.digest !== digest) throw fail('Invalidation replay changed content.'); return { status: 'replayed', consumed: false, view: handle }; }
  if (event.expectedRootId !== handle.rootId) throw fail('Wrong invalidation base.');
  if (state.ledger.length + state.invalidations.length >= state.limits.revisions) return { status: 'checkpoint-required', consumed: false, view: handle };
  if (options.signal?.aborted) return { status: 'cancelled', consumed: false, view: handle };
  const targets = new Set(event.targets), affected = affectedStages(state.definition, targets);
  for (const id of targets) if (state.stages.has(id)) affected.add(id);
  const invalidations = [...state.invalidations, { id: event.invalidationId, digest, reason: event.reason, stages: [...affected].sort() }];
  const invalid = invalidatedStages(invalidations), maintenance = id => ({ workUnits: 0,
    strategy: invalid.has(id) ? 'invalidated-retained-historical' : 'reused-original-inputs' });
  const report = JSON.parse(encode({ ...state.report, invalidations, status: 'invalidated',
    stages: state.report.stages.map(stage => ({ ...stage, maintenance: maintenance(stage.id) })),
    outputs: state.report.outputs.map(output => ({ ...output, availability: invalid.has(output.id) ? 'invalidated' : 'available' })) }, state.limits.retainedBytes));
  const retainedBytes = state.work.retainedBytes - Buffer.byteLength(encode(state.report, state.limits.retainedBytes)) + Buffer.byteLength(encode(report, state.limits.retainedBytes));
  if (retainedBytes > state.limits.retainedBytes) return { status: 'retention-budget', consumed: false, view: handle };
  throwIfAborted(options.signal);
  const view = Object.freeze({ rootId: hash(report), profile: VIEW_COMPOSITION_PROFILE, publication: 'private-unpublished' });
  owned.set(view, { ...state, report, invalidations, work: { workUnits: 0, retainedBytes,
    stages: state.report.stages.map(stage => ({ id: stage.id, ...maintenance(stage.id) })) } });
  return { status: 'invalidated', consumed: true, view, publication: 'not-attempted' };
};
