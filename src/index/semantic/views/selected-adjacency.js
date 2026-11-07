import { createAjv, compileSchema } from '../../../shared/validation/ajv-factory.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { createOccurrenceRelation } from '../../../semantic/relations/factor.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { readAdjacencyViewInput } from './adjacency-delta.js';
import { finiteViewFields, captureFiniteViewDefinition } from './finite-input.js';
import { createFiniteUnaryTransition } from './finite-unary-transition.js';
import { SELECTED_ADJACENCY_DEFINITION_SCHEMA, SELECTED_ADJACENCY_LIMITS } from '../../../contracts/schemas/selected-adjacency.js';

const owned = new WeakMap(), budgets = new WeakSet(), ajv = createAjv({ strict: true, allErrors: true });
const validate = compileSchema(ajv, SELECTED_ADJACENCY_DEFINITION_SCHEMA);
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_SELECTED_ADJACENCY_CONTRACT' });
const fields = (value, required, optional = []) => finiteViewFields(value, required, optional, fail);
const budget = limit => {
  const error = Object.assign(new RangeError('Selected adjacency allowance exceeded: ' + limit), { code: 'ERR_SELECTED_ADJACENCY_BUDGET', limit });
  budgets.add(error); return error;
};
const key = (value, maxBytes = SELECTED_ADJACENCY_LIMITS.retainedBytes) => canonicalSemanticJson(value, { maxBytes });
const hash = value => semanticHash('selected-adjacency.v1', value, { maxBytes: SELECTED_ADJACENCY_LIMITS.retainedBytes });
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const get = handle => { const state = owned.get(handle); if (!state) throw fail('Original selected adjacency view required.'); return state; };
const limitsFor = value => {
  const limits = value === undefined ? SELECTED_ADJACENCY_LIMITS : { ...SELECTED_ADJACENCY_LIMITS, ...fields(value, [], Object.keys(SELECTED_ADJACENCY_LIMITS)) };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > SELECTED_ADJACENCY_LIMITS[name]) throw fail('Selected adjacency allowances may only be tightened.');
  return freeze(limits);
};
const parentKey = parent => key([parent.occurrenceId, parent.supportId]);
const matches = (definition, parent) => definition.whereField === null || parent[definition.whereField] === definition.whereEquals;
const project = (definition, parent, prior = null) => {
  const { multiplicity, ...origin } = parent;
  const supportId = prior?.supportId ?? hash({ definition, parent: origin });
  return { occurrenceId: 'selected:' + supportId, supportId, from: parent[definition.projectFrom], to: parent[definition.projectTo],
    multiplicity, sourceRef: null, parent };
};
const inputFor = (input, definition, limits) => {
  const original = readAdjacencyViewInput(input);
  if (original.definition.domainId !== definition.inputDomainId) throw fail('Selected adjacency input has the wrong original domain.');
  if (original.rows.length > limits.inputSupports) throw budget('inputSupports');
  return original;
};
const build = ({ definition, input, limits, ledger }, signal, prepared = null) => {
  const original = inputFor(input, definition, limits);
  const rows = prepared?.rows ?? []; let work = prepared?.work ?? 0, supportHashes = prepared?.supportHashes ?? 0;
  if (!prepared) for (const parent of original.rows) {
    throwIfAborted(signal); if (++work > limits.work) throw budget('work');
    if (!matches(definition, parent)) continue;
    if (rows.length >= limits.outputSupports) throw budget('outputSupports');
    rows.push(project(definition, parent)); supportHashes++;
  }
  const report = freeze(JSON.parse(key({ schemaVersion: 1, definition, world: original.world, inputRootId: input.rootId,
    rows, capturedDomainComplete: original.complete, ledger }, limits.retainedBytes)));
  const relation = createOccurrenceRelation({ world: report.world, relationId: definition.id, atomRoleId: 'finite-select-project-parent',
    schema: [{ name: 'from', type: 'string', nullable: false }, { name: 'to', type: 'string', nullable: false }],
    rows: report.rows.map(row => ({ occurrenceId: row.occurrenceId, supportId: row.supportId,
      tuple: [row.from, row.to], multiplicity: row.multiplicity, sourceRef: null })),
    complete: original.complete, maxRetainedBytes: limits.retainedBytes });
  const handle = Object.freeze({ rootId: hash(report), relation, publication: 'private-unpublished', semanticClosure: 'not-implied' });
  throwIfAborted(signal); owned.set(handle, { definition, input, limits, ledger, report, work, supportHashes,
    strategy: prepared ? 'incremental-selected-supports' : 'full-affected-view-recomputation' }); return handle;
};

const advance = (state, next, ledger, signal) => {
  const { definition, limits } = state, input = next.view, original = inputFor(input, definition, limits);
  const changed = next.supportChanges.length, retained = state.report.rows.length;
  // Choose estimated row/hash work in this finite exact operator. Both
  // strategies seal the same report/relation. Include retained-row rebuilding
  // and comparison work, not just the number of source edits, in the estimate.
  const estimate = retained * (2 + Math.ceil(Math.log2(retained + changed + 1))) + changed * 4;
  if (estimate >= original.rows.length) return build({ ...state, input, ledger }, signal);
  let work = 0, supportHashes = 0;
  const tick = () => { throwIfAborted(signal); if (++work > limits.work) throw budget('work'); };
  const rows = new Map(), updates = []; let additions = 0;
  for (const row of state.report.rows) { tick(); rows.set(parentKey(row.parent), row); }
  for (const change of next.supportChanges) {
    tick(); if (!matches(definition, change)) continue;
    const identity = parentKey(change), previous = rows.get(identity);
    const count = BigInt(previous?.multiplicity ?? '0') + BigInt(change.multiplicity);
    if (count < 0n) throw fail('Original selected support underflow.');
    if (count === 0n) { rows.delete(identity); continue; }
    updates.push({ identity, change, previous, count }); if (!previous) additions++;
  }
  // Admit the final atomic bag after all removals. Input ordering must not turn
  // a same-size support replacement into a temporary output-cap failure.
  if (rows.size + additions > limits.outputSupports) throw budget('outputSupports');
  for (const { identity, change, previous, count } of updates) {
    tick(); const parent = { ...change, multiplicity: count.toString() };
    rows.set(identity, project(definition, parent, previous)); if (!previous) supportHashes++;
  }
  const ordered = [...rows.entries()].sort(([left], [right]) => { tick(); return left < right ? -1 : left > right ? 1 : 0; });
  return build({ ...state, input, ledger }, signal, { rows: ordered.map(([, row]) => { tick(); return row; }), work, supportHashes });
};
export const bootstrapSelectedAdjacency = (value, options = {}) => {
  const captured = fields(value, ['definition', 'input'], ['limits']);
  const definition = captureFiniteViewDefinition(captured.definition, SELECTED_ADJACENCY_DEFINITION_SCHEMA, fail);
  if (!validate(definition)) throw fail('Invalid selected adjacency definition.');
  readAdjacencyViewInput(captured.input); const limits = limitsFor(captured.limits);
  return build({ definition, input: captured.input, limits, ledger: [] }, options.signal);
};
export const describeSelectedAdjacency = handle => get(handle).report;
export const selectedAdjacencyWork = handle => {
  const state = get(handle); return Object.freeze({ workUnits: state.work, derivedSupportHashes: state.supportHashes, strategy: state.strategy });
};
const transitions = createFiniteUnaryTransition({ getState: get, fail, hash, build, advance,
  readBudget: error => budgets.has(error) ? { limit: error.limit } : null });
export const applySelectedAdjacencyDelta = transitions.apply;
export const applySelectedAdjacencyTransition = transitions.prepared;
