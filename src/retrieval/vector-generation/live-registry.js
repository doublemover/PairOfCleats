import { canonicalSemanticJson, semanticHash } from '../../index/semantic/identity.js';

const owners = new WeakMap();
const key = canonicalSemanticJson;
const maxIncarnation = 18446744073709551615n;
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name) && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const fail = message => { throw new TypeError('Vector registry: ' + message); };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const incarnationValid = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value)
  && BigInt(value) <= maxIncarnation;
const content = row => ({ logicalId: row.logicalId, sourceSupports: row.sourceSupports,
  tokenSpanId: row.tokenSpanId, vectorRoot: row.vectorRoot, state: row.state, incarnation: row.incarnation });

/** Immutable exact membership and physical-placement metadata, admitted against a pinned vector owner. */
export const createLiveVectorRegistry = ({ descriptor, rows, maxBytes = 8 * 1024 * 1024 }) => {
  const names = ['repositoryId', 'generationId', 'storageEpoch', 'rowMapId', 'representationId', 'modelId',
    'codecEpoch', 'originalVectorRoot', 'dimension', 'metric', 'normalization'];
  if (!fields(descriptor, names) || names.filter(name => name !== 'dimension').some(name => !text(descriptor[name]))
    || !hash(descriptor.originalVectorRoot) || !Number.isSafeInteger(descriptor.dimension) || descriptor.dimension < 1
    || !['dot', 'cosine', 'l2'].includes(descriptor.metric)
    || !Array.isArray(rows) || rows.length > 65536 || !Number.isSafeInteger(maxBytes)
    || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) fail('invalid generation descriptor');
  const ids = new Set(), slots = new Set(), rowIds = new Set();
  let bytes = Buffer.byteLength(key(descriptor));
  for (const row of rows) {
    if (!fields(row, ['logicalId', 'sourceSupports', 'tokenSpanId', 'vectorRoot', 'state', 'rowId', 'slot', 'incarnation'])
      || !text(row.logicalId) || ids.has(row.logicalId) || !Array.isArray(row.sourceSupports)
      || !row.sourceSupports.length || row.sourceSupports.length > 64 || row.sourceSupports.some(value => !text(value))
      || new Set(row.sourceSupports).size !== row.sourceSupports.length || !text(row.tokenSpanId) || !hash(row.vectorRoot)
      || !['live', 'tombstone'].includes(row.state) || !Number.isSafeInteger(row.rowId) || row.rowId < 0
      || !Number.isSafeInteger(row.slot) || row.slot < 0 || !incarnationValid(row.incarnation)
      || rowIds.has(row.rowId) || slots.has(row.slot)) fail('invalid or aliased logical placement');
    ids.add(row.logicalId); slots.add(row.slot); rowIds.add(row.rowId);
    bytes += Buffer.byteLength(key(row));
    if (bytes > maxBytes) throw new RangeError('Vector registry byte allowance exceeded.');
  }
  const snapshot = freeze(JSON.parse(key({ descriptor, rows: [...rows].sort((a, b) => a.logicalId < b.logicalId ? -1 : a.logicalId > b.logicalId ? 1 : 0) })));
  const handle = Object.freeze({ rootId: semanticHash('pairofcleats.live-vector-registry.v1', snapshot),
    descriptor: snapshot.descriptor, liveCount: snapshot.rows.filter(row => row.state === 'live').length,
    placementCount: rows.length, membership: 'exact-supplied-registry', retrievalQuality: 'not-qualified' });
  owners.set(handle, { ...snapshot, bySlot: new Map(snapshot.rows.map(row => [row.slot, row])),
    byId: new Map(snapshot.rows.map(row => [row.logicalId, row])) });
  return handle;
};

/** No wrap: exhausted slots require a fresh isolated epoch or retirement by the storage owner. */
export const nextVectorIncarnation = incarnation => {
  if (!incarnationValid(incarnation)) fail('invalid incarnation');
  return BigInt(incarnation) === maxIncarnation ? { status: 'retire-slot', next: null }
    : { status: 'increment', next: (BigInt(incarnation) + 1n).toString() };
};

export const resolveVectorPlacement = (registry, candidate) => {
  const state = owners.get(registry);
  if (!state) fail('owned registry required');
  if (!fields(candidate, ['generationId', 'storageEpoch', 'slot', 'incarnation', 'codecEpoch'])) {
    return { status: 'rejected', reason: 'unqualified-placement' };
  }
  if (candidate.generationId !== state.descriptor.generationId || candidate.storageEpoch !== state.descriptor.storageEpoch
    || candidate.codecEpoch !== state.descriptor.codecEpoch) return { status: 'rejected', reason: 'stale-generation-or-codec' };
  const row = state.bySlot.get(candidate.slot);
  if (!row || row.incarnation !== candidate.incarnation) return { status: 'rejected', reason: 'stale-slot-incarnation' };
  if (row.state !== 'live') return { status: 'rejected', reason: 'logically-deleted' };
  return { status: 'live', logicalId: row.logicalId, rowId: row.rowId, vectorRoot: row.vectorRoot };
};

export const eligibleRegistryRows = (registry, eligibleIds) => {
  const state = owners.get(registry);
  if (!state || !(eligibleIds instanceof Set) || eligibleIds.size > state.rows.length) fail('exact admitted eligibility set required');
  for (const id of eligibleIds) if (!state.byId.has(id) || state.byId.get(id).state !== 'live') fail('eligibility contains missing/deleted identity');
  return state.rows.filter(row => eligibleIds.has(row.logicalId)).map(row => ({ id: row.logicalId, rowId: row.rowId }));
};

/** Verify a post-build physical permutation; changed content/topology belongs to a different intervention. */
export const verifyVectorLayoutRewrite = ({ before, after, beforeEdges, afterEdges }) => {
  const left = owners.get(before), right = owners.get(after);
  if (!left || !right || !Array.isArray(beforeEdges) || !Array.isArray(afterEdges)
    || beforeEdges.length > 262144 || afterEdges.length > 262144) fail('bounded owned layout inputs required');
  for (const name of ['repositoryId', 'representationId', 'modelId', 'codecEpoch', 'originalVectorRoot', 'dimension', 'metric', 'normalization']) {
    if (left.descriptor[name] !== right.descriptor[name]) return { status: 'rejected', reason: 'representation-changed' };
  }
  if (left.descriptor.storageEpoch === right.descriptor.storageEpoch
    || left.descriptor.generationId === right.descriptor.generationId) return { status: 'rejected', reason: 'isolated-new-generation-required' };
  if (key(left.rows.map(content)) !== key(right.rows.map(content))) return { status: 'rejected', reason: 'logical-content-changed' };
  const normalize = (registry, edges) => edges.map(edge => {
    if (!fields(edge, ['from', 'to'])) fail('exact directed edge required');
    const from = resolveVectorPlacement(registry, edge.from), to = resolveVectorPlacement(registry, edge.to);
    if (from.status !== 'live' || to.status !== 'live') fail('stale or deleted graph endpoint');
    return key([from.logicalId, to.logicalId]);
  }).sort();
  if (key(normalize(before, beforeEdges)) !== key(normalize(after, afterEdges))) return { status: 'rejected', reason: 'topology-changed' };
  return { status: 'same-logical-content-and-directed-edge-bag', beforeRoot: before.rootId, afterRoot: after.rootId,
    publication: 'not-attempted', retrievalQuality: 'not-qualified', physicalStorageReclamation: 'owner-lease-required' };
};
