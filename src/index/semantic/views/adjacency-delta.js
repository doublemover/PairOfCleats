import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { validateSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';
import { createOccurrenceRelation } from '../../../semantic/relations/factor.js';

const owned = new WeakMap();
const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const fail = message => { throw new TypeError('Adjacency delta: ' + message); };
const MAX_INPUT_BYTES = 64 * 1024 * 1024;
const captureInput = (input, maxBytes) => JSON.parse(canonicalSemanticJson(input, {
  maxBytes,
  onObjectEncoded(original) {
    // The shared encoder owns values without invoking accessors. Reject hidden
    // decorations too, rather than normalizing them away during JSON capture.
    const names = Object.getOwnPropertyNames(original);
    if (names.length !== Object.keys(original).length + (Array.isArray(original) ? 1 : 0)) {
      fail('nonenumerable or decorated input is not passive JSON');
    }
  }
}));

const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const worldValid = world => fields(world, ['generation', 'repositoryNamespace', 'contextKey'])
  && validateSemanticEnvelope('generation', world.generation).ok && text(world.repositoryNamespace) && text(world.contextKey);
const definitionValid = value => fields(value, ['viewId', 'producerId', 'producerEpoch', 'ruleVersion', 'configHash', 'domainId', 'algebra'])
  && Object.values(value).every(text) && /^[a-f0-9]{64}$/.test(value.configHash)
  && value.algebra === 'signed-occurrence-bag-v1';
const rowValid = (row, signed) => fields(row, ['occurrenceId', 'supportId', 'from', 'to', 'multiplicity', 'sourceRef'])
  && ['occurrenceId', 'supportId', 'from', 'to'].every(name => text(row[name]))
  && (row.sourceRef === null || text(row.sourceRef)) && typeof row.multiplicity === 'string'
  && (signed ? /^-?[1-9][0-9]{0,127}$/ : /^[1-9][0-9]{0,127}$/).test(row.multiplicity);
const supportKey = row => key([row.occurrenceId, row.supportId]);
const payload = row => key([row.from, row.to, row.sourceRef]);
const sortRows = rows => rows.sort((a, b) => supportKey(a) < supportKey(b) ? -1 : supportKey(a) > supportKey(b) ? 1 : 0);
const aggregates = rows => {
  const result = new Map();
  for (const row of rows) {
    const id = key([row.from, row.to]);
    result.set(id, (result.get(id) || 0n) + BigInt(row.multiplicity));
  }
  return result;
};
const make = ({ definition, world, rows, ledger, complete, maxBytes }) => {
  const snapshot = { definition, world, rows: sortRows(rows), ledger, complete };
  const encoded = key(snapshot, { maxBytes });
  const immutable = freeze(JSON.parse(encoded));
  const relation = createOccurrenceRelation({ world, relationId: definition.viewId,
    atomRoleId: 'adjacency-input', schema: [
      { name: 'from', type: 'string', nullable: false }, { name: 'to', type: 'string', nullable: false }
    ], rows: immutable.rows.map(row => ({ occurrenceId: row.occurrenceId, supportId: row.supportId,
      tuple: [row.from, row.to], multiplicity: row.multiplicity, sourceRef: row.sourceRef })), complete, maxRetainedBytes: maxBytes });
  const handle = Object.freeze({ rootId: semanticHash('pairofcleats.adjacency-view.v1', immutable),
    world: immutable.world, definition: immutable.definition, relation, supportCount: rows.length,
    capturedDomainComplete: complete, publication: 'private-unpublished', semanticClosure: 'not-implied' });
  owned.set(handle, { ...immutable, maxBytes });
  return handle;
};

/** Nonrecursive exact input-edge view; a source receipt must declare its captured domain. */
export const bootstrapAdjacencyView = input => {
  if (!input || typeof input !== 'object') fail('invalid bootstrap');
  const limit = Object.getOwnPropertyDescriptor(input, 'maxBytes');
  if (limit && !Object.hasOwn(limit, 'value')) fail('byte allowance must be passive data');
  const maxBytes = limit?.value === undefined ? 8 * 1024 * 1024 : limit.value;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_INPUT_BYTES) fail('invalid bootstrap allowance');
  const captured = captureInput(input, maxBytes);
  const names = ['definition', 'world', 'rows', 'complete', ...(Object.hasOwn(captured, 'maxBytes') ? ['maxBytes'] : [])];
  if (!fields(captured, names)) fail('invalid bootstrap fields');
  const { definition, world, rows, complete } = captured;
  if (!definitionValid(definition) || !worldValid(world) || !Array.isArray(rows) || rows.length > 16384
    || typeof complete !== 'boolean') fail('invalid bootstrap');
  const seen = new Set();
  for (const row of rows) {
    if (!rowValid(row, false) || seen.has(supportKey(row))) fail('invalid or duplicated support');
    seen.add(supportKey(row));
  }
  return make({ definition, world, rows, ledger: [], complete, maxBytes });
};

/** Atomic private transition. Batch transport may replay; identical replay never reapplies support. */
export const applyAdjacencyDelta = (view, input, options = {}) => {
  const state = owned.get(view);
  if (!state) fail('unknown view; rebuild required');
  // Capture before option getters, cancellation polls or other caller effects.
  // Validation, digest, coalescing, next world and ledger consume only this value.
  const batch = captureInput(input, state.maxBytes);
  const { signal = null, maxWork = 32768 } = options;
  if (!fields(batch, ['batchId', 'definition', 'fromWorld', 'toWorld', 'baseRoot', 'edits', 'capturedDomainComplete'])
    || !text(batch.batchId) || !definitionValid(batch.definition) || !worldValid(batch.fromWorld)
    || !worldValid(batch.toWorld) || !text(batch.baseRoot) || !Array.isArray(batch.edits) || batch.edits.length > 16384
    || typeof batch.capturedDomainComplete !== 'boolean' || !Number.isSafeInteger(maxWork) || maxWork < 0
    || key(batch.definition) !== key(state.definition)) fail('invalid typed batch or model identity; rebuild required');
  for (const edit of batch.edits) if (!rowValid(edit, true)) fail('invalid signed support edit');
  const digest = semanticHash('pairofcleats.adjacency-batch.v1', batch, { maxBytes: state.maxBytes });
  const previous = state.ledger.find(entry => entry.batchId === batch.batchId);
  if (previous) {
    if (previous.digest !== digest) fail('batch identity replay changed content');
    return { status: 'replayed', view, consumed: false, supportChanges: [], membershipChanges: [] };
  }
  if (batch.baseRoot !== view.rootId || key(batch.fromWorld) !== key(state.world)) fail('wrong base root/world');
  if (state.ledger.length >= 1024) return { status: 'checkpoint-required', view, consumed: false };
  if (signal?.aborted) return { status: 'cancelled', view, consumed: false };
  if (batch.edits.length + state.rows.length > maxWork) return { status: 'work-budget', view, consumed: false };
  // Coalesce by immutable producer support, not tuple membership or edit arrival order.
  const changes = new Map();
  for (const edit of batch.edits) {
    const id = supportKey(edit), prior = changes.get(id);
    if (prior && payload(prior.row) !== payload(edit)) fail('one support cannot identify two payloads');
    changes.set(id, { row: edit, amount: (prior?.amount || 0n) + BigInt(edit.multiplicity) });
  }
  const next = new Map(state.rows.map(row => [supportKey(row), row]));
  const supportChanges = [];
  for (const [id, change] of changes) {
    if (signal?.aborted) return { status: 'cancelled', view, consumed: false };
    const prior = next.get(id);
    if (prior && payload(prior) !== payload(change.row)) fail('support payload changed without new occurrence identity');
    const count = (prior ? BigInt(prior.multiplicity) : 0n) + change.amount;
    if (count < 0n) fail('negative accumulated support');
    if (count.toString().length > 128) fail('coefficient allowance exceeded');
    if (count === 0n) next.delete(id);
    else next.set(id, { ...change.row, multiplicity: count.toString() });
    if (change.amount !== 0n) supportChanges.push({ ...change.row, multiplicity: change.amount.toString() });
  }
  if (next.size > 16384) return { status: 'retention-budget', view, consumed: false };
  const oldCounts = aggregates(state.rows), newCounts = aggregates([...next.values()]), membershipChanges = [];
  for (const id of new Set([...oldCounts.keys(), ...newCounts.keys()])) {
    const oldPresent = (oldCounts.get(id) || 0n) > 0n, newPresent = (newCounts.get(id) || 0n) > 0n;
    if (oldPresent !== newPresent) {
      const [from, to] = JSON.parse(id); membershipChanges.push({ from, to, polarity: newPresent ? 1 : -1 });
    }
  }
  if (signal?.aborted) return { status: 'cancelled', view, consumed: false };
  const nextView = make({ ...state, world: batch.toWorld, rows: [...next.values()],
    ledger: [...state.ledger, { batchId: batch.batchId, digest }], complete: batch.capturedDomainComplete });
  return { status: 'materialized-private', view: nextView, consumed: true,
    supportChanges: freeze(sortRows(supportChanges)), membershipChanges: freeze(membershipChanges),
    maintenance: 'nonrecursive-signed-bag', publication: 'not-attempted' };
};

/** Empty lookup is about the declared captured domain, never global source/analysis closure. */
export const lookupAdjacencyView = (view, from) => {
  const state = owned.get(view);
  if (!state || !text(from)) fail('owned lookup required');
  const rows = state.rows.filter(row => row.from === from);
  return freeze({ rootId: view.rootId, world: state.world, from, supports: rows,
    observation: rows.length ? 'present' : state.complete ? 'absent-in-captured-domain' : 'unknown',
    dependency: { rootId: view.rootId, domainId: state.definition.domainId, key: from,
      capturedDomainComplete: state.complete }, semanticClosure: 'not-implied' });
};
