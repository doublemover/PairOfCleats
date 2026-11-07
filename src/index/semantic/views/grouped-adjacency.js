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

const build = ({ definition, input, limits, ledger }, signal) => {
  const original = readAdjacencyViewInput(input);
  if (original.definition.domainId !== definition.inputDomainId) throw fail('Grouped adjacency input has the wrong original domain.');
  if (original.rows.length > limits.inputSupports) throw budget('inputSupports');
  let work = 0;
  const tick = () => { throwIfAborted(signal); if (++work > limits.work) throw budget('work'); };
  const groups = new Map(), opposite = definition.groupBy === 'from' ? 'to' : 'from';
  for (const row of original.rows) {
    tick(); const groupKey = row[definition.groupBy];
    if (!groups.has(groupKey)) {
      if (groups.size >= limits.groups) throw budget('groups');
      groups.set(groupKey, { count: 0n, values: new Set(), alternatives: [] });
    }
    const group = groups.get(groupKey); group.count += BigInt(row.multiplicity);
    if (group.count.toString().length > 128) throw budget('coefficientDigits');
    group.values.add(row[opposite]); group.alternatives.push(row);
  }
  const rows = [...groups].sort(([a], [b]) => { tick(); return order(a, b); }).map(([groupKey, group]) => {
    const values = [...group.values].sort((a, b) => { tick(); return order(a, b); });
    const alternatives = group.alternatives.sort((a, b) => { tick(); return order(key([a.occurrenceId, a.supportId]), key([b.occurrenceId, b.supportId])); });
    return { key: groupKey, supportCount: alternatives.length, weightedCount: group.count.toString(), distinctValueCount: values.length,
      minimum: values[0], maximum: values.at(-1), status: original.complete ? 'exact-in-captured-domain' : 'observed-in-incomplete-domain', alternatives };
  });
  const report = freeze(JSON.parse(key({ schemaVersion: 1, definition, world: original.world, inputRootId: input.rootId,
    rows, capturedDomainComplete: original.complete, ledger }, limits.retainedBytes)));
  const names = ['key', 'supportCount', 'weightedCount', 'distinctValueCount', 'minimum', 'maximum'];
  const relation = createOccurrenceRelation({ world: report.world, relationId: definition.id, atomRoleId: 'finite-grouped-adjacency',
    schema: names.map(name => ({ name, type: 'string', nullable: false })),
    rows: report.capturedDomainComplete ? report.rows.map(row => {
      const id = hash({ definition, groupKey: row.key, alternatives: row.alternatives });
      return { occurrenceId: 'group:' + id, supportId: id, tuple: names.map(name => String(row[name])), multiplicity: '1', sourceRef: null };
    }) : [], complete: report.capturedDomainComplete, maxRetainedBytes: limits.retainedBytes });
  const handle = Object.freeze({ rootId: hash(report), relation, publication: 'private-unpublished', semanticClosure: 'not-implied' });
  throwIfAborted(signal); owned.set(handle, { definition, input, limits, ledger, report, work }); return handle;
};

/** Full affected-view recomputation retains every source support, so retraction
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
export const groupedAdjacencyWork = handle => Object.freeze({ workUnits: get(handle).work, strategy: 'full-affected-view-recomputation' });

export const applyGroupedAdjacencyDelta = createFiniteUnaryTransition({ getState: get, fail, hash, build,
  readBudget: error => budgets.has(error) ? { limit: error.limit } : null });
