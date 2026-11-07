import { createAjv, compileSchema } from '../../../shared/validation/ajv-factory.js';
import { throwIfAborted, isAbortError } from '../../../shared/abort.js';
import { createOccurrenceRelation } from '../../../semantic/relations/factor.js';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { isSemanticJsonBudgetError } from '../canonical-json-bounds.js';
import { readAdjacencyViewInput, applyAdjacencyDelta } from './adjacency-delta.js';
import { RELATIONAL_JOIN_DEFINITION_SCHEMA, RELATIONAL_JOIN_LIMITS } from '../../../contracts/schemas/relational-join.js';
import { finiteViewFields, captureFiniteViewJson, captureFiniteViewDefinition } from './finite-input.js';

const owned = new WeakMap(), budgetErrors = new WeakSet(), ajv = createAjv({ strict: true, allErrors: true });
const validate = compileSchema(ajv, RELATIONAL_JOIN_DEFINITION_SCHEMA);
const fail = message => Object.assign(new TypeError(message), { code: 'ERR_RELATIONAL_JOIN_CONTRACT' });
const budget = limit => {
  const error = Object.assign(new RangeError('Relational view allowance exceeded: ' + limit), { code: 'ERR_RELATIONAL_JOIN_BUDGET', limit });
  budgetErrors.add(error); return error;
};
const key = (value, maxBytes = RELATIONAL_JOIN_LIMITS.retainedBytes) => canonicalSemanticJson(value, { maxBytes });
const hash = value => semanticHash('relational-join.v1', value, { maxBytes: RELATIONAL_JOIN_LIMITS.retainedBytes });
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value;
};
const get = handle => { const state = owned.get(handle); if (!state) throw fail('Original relational view required.'); return state; };
const fields = (value, required, optional = []) => finiteViewFields(value, required, optional, fail);
const limitsFor = value => {
  if (value === undefined) return RELATIONAL_JOIN_LIMITS;
  const limits = { ...RELATIONAL_JOIN_LIMITS, ...fields(value, [], Object.keys(RELATIONAL_JOIN_LIMITS)) };
  for (const [name, value] of Object.entries(limits)) if (!Number.isSafeInteger(value) || value < 1 || value > RELATIONAL_JOIN_LIMITS[name]) throw fail('Relational allowances may only be tightened.');
  return freeze(limits);
};
const sourceKey = row => key([row.occurrenceId, row.supportId]);
const compareRows = (a, b) => sourceKey(a) < sourceKey(b) ? -1 : sourceKey(a) > sourceKey(b) ? 1 : 0;
const captureBatch = (value, maxBytes) => captureFiniteViewJson(value, maxBytes, fail);

const build = ({ definition, left, right, limits, ledger }, signal) => {
  const l = readAdjacencyViewInput(left), r = readAdjacencyViewInput(right);
  if (key(l.world) !== key(r.world) || definition.leftDomainId !== l.definition.domainId || definition.rightDomainId !== r.definition.domainId) {
    throw fail('Join inputs must share an exact world and the declared original input domains.');
  }
  if (l.rows.length + r.rows.length > limits.inputSupports) throw budget('inputSupports');
  let work = 0;
  const tick = () => { throwIfAborted(signal); if (++work > limits.work) throw budget('work'); };
  const rightByKey = new Map(), rows = [];
  for (const row of r.rows) { tick(); if (!rightByKey.has(row.from)) rightByKey.set(row.from, []); rightByKey.get(row.from).push(row); }
  const emit = (a, b) => {
    if (rows.length >= limits.outputSupports) throw budget('outputSupports');
    const coefficient = BigInt(a.multiplicity) * (b ? BigInt(b.multiplicity) : 1n);
    if (coefficient.toString().length > 128) throw budget('coefficientDigits');
    const parents = { left: { occurrenceId: a.occurrenceId, supportId: a.supportId, sourceRef: a.sourceRef },
      right: b ? { occurrenceId: b.occurrenceId, supportId: b.supportId, sourceRef: b.sourceRef } : null };
    const parentInput = row => ({ occurrenceId: row.occurrenceId, supportId: row.supportId, from: row.from, to: row.to, sourceRef: row.sourceRef });
    const supportId = hash({ operator: definition.operator, parents: { left: parentInput(a), right: b ? parentInput(b) : null } });
    rows.push({ occurrenceId: 'join:' + supportId, supportId, from: a.from, to: b ? b.to : a.to,
      multiplicity: coefficient.toString(), sourceRef: null, parents });
  };
  let unresolvedLeftSupports = 0;
  for (const row of l.rows) {
    tick(); const matches = rightByKey.get(row.to) || [];
    if (definition.operator === 'inner-join') for (const match of matches) { tick(); emit(row, match); }
    else if (!matches.length) {
      if (r.complete) emit(row, null); else unresolvedLeftSupports++;
    }
  }
  rows.sort(compareRows);
  const snapshot = { schemaVersion: 1, definition, world: l.world, inputRoots: { left: left.rootId, right: right.rootId },
    rows, capturedDomainComplete: l.complete && r.complete, unresolvedLeftSupports, ledger };
  // Admit the complete result. Never publish a capped prefix as an exact view.
  const encoded = key(snapshot, limits.retainedBytes); throwIfAborted(signal);
  const report = freeze(JSON.parse(encoded));
  const relation = createOccurrenceRelation({ world: report.world, relationId: definition.id, atomRoleId: 'finite-relational-parent-pair',
    schema: [{ name: 'from', type: 'string', nullable: false }, { name: 'to', type: 'string', nullable: false }],
    rows: report.rows.map(row => ({ occurrenceId: row.occurrenceId, supportId: row.supportId, tuple: [row.from, row.to],
      multiplicity: row.multiplicity, sourceRef: null })), complete: report.capturedDomainComplete, maxRetainedBytes: limits.retainedBytes });
  const handle = Object.freeze({ rootId: hash(report), relation, publication: 'private-unpublished', semanticClosure: 'not-implied' });
  throwIfAborted(signal);
  owned.set(handle, { definition, left, right, limits, ledger, report, work }); return handle;
};

/** Bounded arrangement plus exact full affected-view recomputation. This is an
 * in-memory finite operator, without source extraction or publication authority. */
export const bootstrapRelationalJoin = (value, options = {}) => {
  const input = fields(value, ['definition', 'left', 'right'], ['limits']);
  const definition = captureFiniteViewDefinition(input.definition, RELATIONAL_JOIN_DEFINITION_SCHEMA, fail);
  if (!validate(definition)) throw fail('Invalid relational operator definition.');
  const limits = limitsFor(input.limits);
  // Resolve originals before consulting the caller's cancellation source.
  readAdjacencyViewInput(input.left); readAdjacencyViewInput(input.right);
  return build({ definition, left: input.left, right: input.right, limits, ledger: [] }, options.signal);
};
export const describeRelationalJoin = handle => get(handle).report;
export const relationalJoinWork = handle => Object.freeze({ workUnits: get(handle).work, strategy: 'full-affected-view-recomputation' });

/** Both original input transitions and the result must succeed before a new
 * private cohort is returned. Failed/bounded work never consumes the old cohort. */
export const applyRelationalJoinDelta = (handle, value, options = {}) => {
  const state = get(handle);
  const batch = captureBatch(value, state.limits.retainedBytes);
  fields(batch, ['batchId', 'expectedRootId', 'left', 'right']);
  if (typeof batch.batchId !== 'string' || !batch.batchId.length || batch.batchId.length > 128) throw fail('Invalid relational batch identity.');
  const digest = hash(batch), previous = state.ledger.find(row => row.batchId === batch.batchId);
  if (previous) {
    if (previous.digest !== digest) throw fail('Relational batch replay changed content.');
    return { status: 'replayed', consumed: false, view: handle };
  }
  if (batch.expectedRootId !== handle.rootId || key(batch.left.toWorld) !== key(batch.right.toWorld)) throw fail('Relational cohort has the wrong base or mixed destination worlds.');
  if (state.ledger.length >= 128) return { status: 'checkpoint-required', consumed: false, view: handle };
  const { signal = null } = options;
  if (signal?.aborted) return { status: 'cancelled', consumed: false, view: handle };
  try {
    const stopped = result => {
      if (result.consumed) return null;
      if (!['cancelled', 'work-budget', 'retention-budget', 'checkpoint-required'].includes(result.status)) throw fail('Original input replay is not a new relational transition.');
      return { status: result.status, consumed: false, view: handle };
    };
    const inputOptions = { signal, maxWork: Math.min(state.limits.work, state.limits.inputSupports * 4) };
    const left = applyAdjacencyDelta(state.left, batch.left, inputOptions), leftStop = stopped(left);
    if (leftStop) return leftStop;
    const right = applyAdjacencyDelta(state.right, batch.right, inputOptions), rightStop = stopped(right);
    if (rightStop) return rightStop;
    const view = build({ ...state, left: left.view, right: right.view, ledger: [...state.ledger, { batchId: batch.batchId, digest }] }, signal);
    return { status: 'materialized-private', consumed: true, view, maintenance: 'full-affected-view-recomputation', publication: 'not-attempted' };
  } catch (error) {
    if (isAbortError(error)) return { status: 'cancelled', consumed: false, view: handle };
    if (isSemanticJsonBudgetError(error)) return { status: 'retention-budget', consumed: false, view: handle, limit: 'retainedBytes' };
    if (budgetErrors.has(error)) return { status: error.limit === 'work' ? 'work-budget' : 'retention-budget', consumed: false, view: handle, limit: error.limit };
    throw error;
  }
};
