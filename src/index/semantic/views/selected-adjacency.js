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
const build = ({ definition, input, limits, ledger }, signal) => {
  const original = readAdjacencyViewInput(input);
  if (original.definition.domainId !== definition.inputDomainId) throw fail('Selected adjacency input has the wrong original domain.');
  if (original.rows.length > limits.inputSupports) throw budget('inputSupports');
  const rows = []; let work = 0;
  for (const parent of original.rows) {
    throwIfAborted(signal); if (++work > limits.work) throw budget('work');
    if (definition.whereField !== null && parent[definition.whereField] !== definition.whereEquals) continue;
    if (rows.length >= limits.outputSupports) throw budget('outputSupports');
    const { multiplicity, ...origin } = parent;
    const supportId = hash({ definition, parent: origin });
    rows.push({ occurrenceId: 'selected:' + supportId, supportId, from: parent[definition.projectFrom], to: parent[definition.projectTo],
      multiplicity, sourceRef: null, parent });
  }
  const report = freeze(JSON.parse(key({ schemaVersion: 1, definition, world: original.world, inputRootId: input.rootId,
    rows, capturedDomainComplete: original.complete, ledger }, limits.retainedBytes)));
  const relation = createOccurrenceRelation({ world: report.world, relationId: definition.id, atomRoleId: 'finite-select-project-parent',
    schema: [{ name: 'from', type: 'string', nullable: false }, { name: 'to', type: 'string', nullable: false }],
    rows: report.rows.map(row => ({ occurrenceId: row.occurrenceId, supportId: row.supportId,
      tuple: [row.from, row.to], multiplicity: row.multiplicity, sourceRef: null })),
    complete: original.complete, maxRetainedBytes: limits.retainedBytes });
  const handle = Object.freeze({ rootId: hash(report), relation, publication: 'private-unpublished', semanticClosure: 'not-implied' });
  throwIfAborted(signal); owned.set(handle, { definition, input, limits, ledger, report, work }); return handle;
};
export const bootstrapSelectedAdjacency = (value, options = {}) => {
  const captured = fields(value, ['definition', 'input'], ['limits']);
  const definition = captureFiniteViewDefinition(captured.definition, SELECTED_ADJACENCY_DEFINITION_SCHEMA, fail);
  if (!validate(definition) || (definition.whereField === null) !== (definition.whereEquals === null)) throw fail('Invalid selected adjacency definition.');
  readAdjacencyViewInput(captured.input); const limits = limitsFor(captured.limits);
  return build({ definition, input: captured.input, limits, ledger: [] }, options.signal);
};
export const describeSelectedAdjacency = handle => get(handle).report;
export const selectedAdjacencyWork = handle => Object.freeze({ workUnits: get(handle).work, strategy: 'full-affected-view-recomputation' });
export const applySelectedAdjacencyDelta = createFiniteUnaryTransition({ getState: get, fail, hash, build,
  readBudget: error => budgets.has(error) ? { limit: error.limit } : null });
