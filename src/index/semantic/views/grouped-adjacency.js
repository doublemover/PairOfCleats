import { createAjv, compileSchema } from '../../../shared/validation/ajv-factory.js';
import { throwIfAborted } from '../../../shared/abort.js';
import { createOccurrenceRelation } from '../../../semantic/relations/factor.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { readAdjacencyViewInput } from './adjacency-delta.js';
import { finiteViewFields, captureFiniteViewDefinition } from './finite-input.js';
import { createFiniteUnaryTransition } from './finite-unary-transition.js';
import { GROUPED_ADJACENCY_DEFINITION_SCHEMA, GROUPED_ADJACENCY_LIMITS } from '../../../contracts/schemas/grouped-adjacency.js';

const owned = new WeakMap(), budgets = new WeakSet(), ajv = createAjv({ strict: true, allErrors: true });
const validate = compileSchema(ajv, GROUPED_ADJACENCY_DEFINITION_SCHEMA);
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_GROUPED_ADJACENCY_CONTRACT' });
const fields = (value, required, optional = []) => finiteViewFields(value, required, optional, fail);
const budget = limit => {
  const error = Object.assign(new RangeError('Grouped adjacency allowance exceeded: ' + limit), { code: 'ERR_GROUPED_ADJACENCY_BUDGET', limit });
  budgets.add(error); return error;
};
const key = (value, maxBytes = GROUPED_ADJACENCY_LIMITS.retainedBytes) => canonicalSemanticJson(value, { maxBytes });
const hash = value => semanticHash('grouped-adjacency.v1', value, { maxBytes: GROUPED_ADJACENCY_LIMITS.retainedBytes });
const order = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const get = handle => { const state = owned.get(handle); if (!state) throw fail('Original grouped adjacency view required.'); return state; };
const limitsFor = value => {
  const limits = value === undefined ? GROUPED_ADJACENCY_LIMITS
    : { ...GROUPED_ADJACENCY_LIMITS, ...fields(value, [], Object.keys(GROUPED_ADJACENCY_LIMITS)) };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > GROUPED_ADJACENCY_LIMITS[name]) throw fail('Grouped adjacency allowances may only be tightened.');
  return freeze(limits);
};

const parentKey = row => key([row.occurrenceId, row.supportId]);
const inputFor = (input, definition, limits) => {
  const original = readAdjacencyViewInput(input);
  if (original.definition.domainId !== definition.inputDomainId) throw fail('Grouped adjacency input has the wrong original domain.');
  if (original.rows.length > limits.inputSupports) throw budget('inputSupports');
  return original;
};
const aggregate = (groupKey, parents, definition, complete, tick) => {
  const opposite = definition.groupBy === 'from' ? 'to' : 'from', values = new Set(); let count = 0n;
  for (const row of parents) {
    tick(); count += BigInt(row.multiplicity); values.add(row[opposite]);
    if (count.toString().length > 128) throw budget('coefficientDigits');
  }
  const orderedValues = [...values].sort((a, b) => { tick(); return order(a, b); });
  const alternatives = [...parents].sort((a, b) => { tick(); return order(parentKey(a), parentKey(b)); });
  return { key: groupKey, supportCount: alternatives.length, weightedCount: count.toString(), distinctValueCount: orderedValues.length,
    minimum: orderedValues[0], maximum: orderedValues.at(-1), status: complete ? 'exact-in-captured-domain' : 'observed-in-incomplete-domain', alternatives };
};
const build = ({ definition, input, limits, ledger }, signal, prepared = null) => {
  const original = inputFor(input, definition, limits);
  let work = prepared?.work ?? 0, groupHashes = 0;
  const tick = () => { throwIfAborted(signal); if (++work > limits.work) throw budget('work'); };
  let rows = prepared?.rows;
  if (!prepared) {
    const groups = new Map();
    for (const row of original.rows) {
      tick(); const groupKey = row[definition.groupBy];
      if (!groups.has(groupKey)) {
        if (groups.size >= limits.groups) throw budget('groups');
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(row);
    }
    rows = [...groups].sort(([a], [b]) => { tick(); return order(a, b); })
      .map(([groupKey, parents]) => aggregate(groupKey, parents, definition, original.complete, tick));
  }
  rows = rows.map(row => {
    tick(); const status = original.complete ? 'exact-in-captured-domain' : 'observed-in-incomplete-domain';
    return row.status === status ? row : { ...row, status };
  });
  const report = freeze(JSON.parse(key({ schemaVersion: 1, definition, world: original.world, inputRootId: input.rootId,
    rows, capturedDomainComplete: original.complete, ledger }, limits.retainedBytes)));
  const names = ['key', 'supportCount', 'weightedCount', 'distinctValueCount', 'minimum', 'maximum'];
  const groupIds = new Map();
  const relation = createOccurrenceRelation({ world: report.world, relationId: definition.id, atomRoleId: 'finite-grouped-adjacency',
    schema: names.map(name => ({ name, type: 'string', nullable: false })),
    rows: report.capturedDomainComplete ? report.rows.map(row => {
      tick(); let id = prepared?.groupIds.get(row.key);
      if (id === undefined) { id = hash({ definition, groupKey: row.key, alternatives: row.alternatives }); groupHashes++; }
      groupIds.set(row.key, id);
      return { occurrenceId: 'group:' + id, supportId: id, tuple: names.map(name => String(row[name])), multiplicity: '1', sourceRef: null };
    }) : [], complete: report.capturedDomainComplete, maxRetainedBytes: limits.retainedBytes });
  const handle = Object.freeze({ rootId: hash(report), relation, publication: 'private-unpublished', semanticClosure: 'not-implied' });
  throwIfAborted(signal); owned.set(handle, { definition, input, limits, ledger, report, work, groupIds, groupHashes,
    groupIndex: new Map(report.rows.map(row => [row.key, row])), recomputedGroups: prepared?.recomputedGroups ?? report.rows.length,
    strategy: prepared ? 'affected-group-recomputation' : 'full-affected-view-recomputation' }); return handle;
};

const advance = (state, next, ledger, signal) => {
  const { definition, limits } = state, input = next.view, original = inputFor(input, definition, limits);
  const affected = new Set(next.supportChanges.map(change => change[definition.groupBy]));
  let parentCount = 0;
  for (const groupKey of affected) parentCount += state.groupIndex.get(groupKey)?.alternatives.length ?? 0;
  const estimate = state.report.rows.length + parentCount * 4 + next.supportChanges.length * 4;
  if (estimate >= original.rows.length) return build({ ...state, input, ledger }, signal);
  let work = 0;
  const tick = () => { throwIfAborted(signal); if (++work > limits.work) throw budget('work'); };
  const changedGroups = new Map(), groupIds = new Map(), rows = [];
  for (const groupKey of affected) {
    const parents = new Map();
    for (const row of state.groupIndex.get(groupKey)?.alternatives ?? []) { tick(); parents.set(parentKey(row), row); }
    changedGroups.set(groupKey, parents);
  }
  for (const change of next.supportChanges) {
    tick(); const parents = changedGroups.get(change[definition.groupBy]), identity = parentKey(change);
    const count = BigInt(parents.get(identity)?.multiplicity ?? '0') + BigInt(change.multiplicity);
    if (count < 0n) throw fail('Original grouped support underflow.');
    if (count === 0n) parents.delete(identity); else parents.set(identity, { ...change, multiplicity: count.toString() });
  }
  for (const row of state.report.rows) {
    tick(); if (affected.has(row.key)) continue; rows.push(row);
    const id = state.groupIds.get(row.key); if (id !== undefined) groupIds.set(row.key, id);
  }
  for (const [groupKey, parents] of changedGroups) {
    if (parents.size) rows.push(aggregate(groupKey, [...parents.values()], definition, original.complete, tick));
  }
  // Final atomic groups, not an arrival-order prefix, own capacity admission.
  if (rows.length > limits.groups) throw budget('groups');
  rows.sort((a, b) => { tick(); return order(a.key, b.key); });
  return build({ ...state, input, ledger }, signal, { rows, work, groupIds, recomputedGroups: affected.size });
};

/** Exact grouping retains every source support, so retraction
 * of a winner reveals the next alternative without stale min/max shortcuts. */
export const bootstrapGroupedAdjacency = (value, options = {}) => {
  const captured = fields(value, ['definition', 'input'], ['limits']);
  const definition = captureFiniteViewDefinition(captured.definition, GROUPED_ADJACENCY_DEFINITION_SCHEMA, fail);
  if (!validate(definition)) throw fail('Invalid grouped adjacency definition.');
  readAdjacencyViewInput(captured.input);
  const limits = limitsFor(captured.limits);
  return build({ definition, input: captured.input, limits, ledger: [] }, options.signal);
};
export const describeGroupedAdjacency = handle => get(handle).report;
export const groupedAdjacencyWork = handle => {
  const state = get(handle); return Object.freeze({ workUnits: state.work, recomputedGroups: state.recomputedGroups,
    derivedGroupHashes: state.groupHashes, strategy: state.strategy });
};

const transitions = createFiniteUnaryTransition({ getState: get, fail, hash, build, advance,
  readBudget: error => budgets.has(error) ? { limit: error.limit } : null });
export const applyGroupedAdjacencyDelta = transitions.apply;
export const applyGroupedAdjacencyTransition = transitions.prepared;
