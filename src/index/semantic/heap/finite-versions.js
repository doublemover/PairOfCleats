import { createHash } from 'node:crypto';
import { createFiniteHeapBudget, captureFiniteHeapInput, captureFiniteHeapFields, FINITE_HEAP_LIMITS } from './finite-budget.js';
import { addStorageFailureContext } from '../../../shared/storage/operation-error.js';

/** @typedef {{profile:string,worldId:string,regionId:string,contextId:string,allocationId:string,cells:object[],wildcards:object[],predecessors:string[],frontier:string[],epoch:number,versionId:string}} SerializedHeapVersion */
/** @typedef {Readonly<SerializedHeapVersion>} OwnedHeapVersion Private weak receipt and deeply immutable contents required. */
/** @typedef {{values:ReadonlyArray<string>,unknown:boolean,presence:string,closure:string,dependencies:object}} HeapReadProjection */
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const unique = values => [...new Set(values)].sort();
// A nonempty canonical payload gains a comma, the versionId key and one SHA-256
// string. Reserve that exact serialized envelope before sealing its payload.
const VERSION_ID_JSON_BYTES = Buffer.byteLength(',"versionId":"' + '0'.repeat(64) + '"');
const ownedVersions = new WeakMap(), readCache = new Map();
let readCacheBytes = 0;
const diagnostics = { payloadEncodes: 0, payloadEncodedBytes: 0, externalAdmissions: 0, ownedIdentityHits: 0,
  readCacheHits: 0, readCacheMisses: 0, cellVisits: 0, wildcardVisits: 0, valueVisits: 0 };
const operation = (phase, run) => {
  const budget = createFiniteHeapBudget(phase);
  try { return run(budget); }
  catch (error) { throw addStorageFailureContext(error, { finiteHeapPhase: phase, finiteHeapWork: Object.freeze(budget.snapshot()) }); }
};
const freeze = value => {
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue;
    pending.push(...Object.values(item).filter(child => child && typeof child === 'object')); Object.freeze(item);
  }
  return value;
};
const hashEncoded = encoded => createHash('sha256').update('pairofcleats.finite-heap-version.v1\0').update(encoded).digest('hex');
const encodePayload = (value, budget) => {
  const encoded = budget.encode(value, { reserveBytes: VERSION_ID_JSON_BYTES }); diagnostics.payloadEncodes++; diagnostics.payloadEncodedBytes += Buffer.byteLength(encoded); return encoded;
};
const retainOwned = (version, payloadBytes) => {
  freeze(version);
  ownedVersions.set(version, { payloadBytes, versionBytes: payloadBytes + VERSION_ID_JSON_BYTES, cellsByProperty: new Map(version.cells.map(cell => [cell.property, cell])) });
  return version;
};
const seal = (value, budget) => {
  const encoded = encodePayload(value, budget);
  return retainOwned({ ...value, versionId: hashEncoded(encoded) }, Buffer.byteLength(encoded));
};
const assertValues = (values, budget) => {
  if (!Array.isArray(values) || values.length > 4096) throw new TypeError('Bounded abstract values required.');
  for (const value of values) {
    if (!text(value)) throw new TypeError('Bounded abstract values required.');
    budget.value(value); diagnostics.valueVisits++;
  }
};
const fields = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value)
  && required.every(name => Object.hasOwn(value, name)) && Object.keys(value).every(name => required.includes(name) || optional.includes(name));
const uint = value => Number.isSafeInteger(value) && value >= 0;
const assertPayload = (value, budget) => {
  if (!fields(value, ['profile', 'worldId', 'regionId', 'contextId', 'allocationId', 'cardinality', 'closedProperties', 'cells', 'wildcards', 'predecessors', 'epoch', 'frontier'], ['lastWrite'])
    || value.profile !== 'finite-plain-object-v1' || ![value.worldId, value.regionId, value.contextId, value.allocationId].every(text)
    || !['one', 'many'].includes(value.cardinality) || typeof value.closedProperties !== 'boolean' || !uint(value.epoch)
    || !Array.isArray(value.cells) || value.cells.length > 4096 || !Array.isArray(value.wildcards) || value.wildcards.length > 4096
    || !Array.isArray(value.predecessors) || value.predecessors.length > 128
    || value.predecessors.some(id => typeof id !== 'string' || !/^[a-f0-9]{64}$/u.test(id))) throw new TypeError('Unsupported heap version.');
  const names = new Set();
  for (const cell of value.cells) {
    budget.step();
    if (!fields(cell, ['property', 'values', 'presence', 'unknown', 'wildcardAfter']) || !text(cell.property) || names.has(cell.property)
      || !['knownPresent', 'explicitUnset', 'freed', 'unknown'].includes(cell.presence) || typeof cell.unknown !== 'boolean'
      || !uint(cell.wildcardAfter) || cell.wildcardAfter > value.epoch) throw new TypeError('Invalid finite heap cell.');
    names.add(cell.property); assertValues(cell.values, budget);
    if (['explicitUnset', 'freed'].includes(cell.presence) && cell.values.length) throw new TypeError('Unset/freed cells cannot carry current values.');
  }
  for (const write of value.wildcards) {
    budget.step();
    if (!fields(write, ['epoch', 'values', 'writeSite']) || !uint(write.epoch) || write.epoch < 1 || write.epoch > value.epoch || !text(write.writeSite)) throw new TypeError('Invalid finite heap wildcard.');
    assertValues(write.values, budget);
  }
  assertValues(value.frontier, budget);
  if (Object.hasOwn(value, 'lastWrite') && (!fields(value.lastWrite, ['writeSite', 'property', 'update', 'uniquenessReceiptId'])
    || !text(value.lastWrite.writeSite) || !(value.lastWrite.property === null || text(value.lastWrite.property))
    || !['strong', 'weak'].includes(value.lastWrite.update)
    || !(value.lastWrite.uniquenessReceiptId === null || text(value.lastWrite.uniquenessReceiptId)))) throw new TypeError('Invalid finite heap write receipt.');
};
/** A transferred/mutable payload is captured and checked once. Only the returned
 * owned immutable object receives private O(1) identity authority. */
const admit = (version, budget) => {
  const owned = ownedVersions.get(version);
  if (owned) { diagnostics.ownedIdentityHits++; budget.input(owned.versionBytes); return version; }
  const captured = captureFiniteHeapInput(version, budget);
  if (!captured || captured.profile !== 'finite-plain-object-v1' || typeof captured.versionId !== 'string') throw new TypeError('Unsupported heap version.');
  const { versionId, ...payload } = captured;
  assertPayload(payload, budget);
  const encoded = encodePayload(payload, budget);
  if (hashEncoded(encoded) !== versionId) throw new TypeError('Heap version identity mismatch.');
  diagnostics.externalAdmissions++;
  return retainOwned(captured, Buffer.byteLength(encoded));
};
export const admitFiniteHeapVersion = version => operation('payload-admission', budget => admit(version, budget));
export const getFiniteHeapOperationDiagnostics = () => ({ ...diagnostics, readCacheEntries: readCache.size, readCacheBytes });

/** Query-only finite plain-object model; its inputs require upstream model admission. */
export const createFiniteHeapVersion = input => operation('create', budget => {
  input = captureFiniteHeapFields(input, ['worldId', 'regionId', 'contextId', 'allocationId', 'cardinality', 'closedProperties', 'properties'],
    ['worldId', 'regionId', 'contextId', 'allocationId'], budget);
  const { worldId, regionId, contextId, allocationId, cardinality = 'many', closedProperties = false,
    properties = [] } = captureFiniteHeapInput(input, budget);
  if (![worldId, regionId, contextId, allocationId].every(text) || !['one', 'many'].includes(cardinality)
    || typeof closedProperties !== 'boolean' || !Array.isArray(properties) || properties.length > 4096) {
    throw new TypeError('Invalid finite heap region.');
  }
  const names = new Set();
  const cells = properties.map(cell => {
    budget.step();
    if (!text(cell.property) || names.has(cell.property) || !['knownPresent', 'explicitUnset', 'freed', 'unknown'].includes(cell.presence)) {
      throw new TypeError('Unique named heap cells with explicit presence required.');
    }
    names.add(cell.property); assertValues(cell.values, budget);
    if (['explicitUnset', 'freed'].includes(cell.presence) && cell.values.length) throw new TypeError('Unset/freed cells cannot carry current values.');
    return { property: cell.property, values: unique(cell.values), presence: cell.presence,
      unknown: cell.presence === 'unknown', wildcardAfter: 0 };
  }).sort((a, b) => a.property < b.property ? -1 : a.property > b.property ? 1 : 0);
  return seal({ profile: 'finite-plain-object-v1', worldId, regionId, contextId, allocationId,
    cardinality, closedProperties, cells, wildcards: [], predecessors: [], epoch: 0, frontier: [] }, budget);
});

export const writeFiniteHeapVersion = input => operation('write', budget => {
  const { version: inputVersion, ...instruction } = captureFiniteHeapFields(input,
    ['version', 'property', 'values', 'writeSite', 'receiverProof', 'unconditional', 'plainDataProperty', 'noConcurrentWriters'],
    ['version', 'property', 'values', 'writeSite'], budget);
  let version = inputVersion;
  version = admit(version, budget);
  const { property, values, writeSite, receiverProof = null, unconditional = false,
    plainDataProperty = false, noConcurrentWriters = false } = captureFiniteHeapInput(instruction, budget);
  assertValues(values, budget);
  if (!(property === null || text(property)) || !text(writeSite)) throw new TypeError('Qualified heap write required.');
  if (version.epoch === Number.MAX_SAFE_INTEGER) throw new RangeError('Heap epoch allowance exceeded.');
  const next = structuredClone(version); delete next.versionId;
  next.predecessors = [version.versionId]; next.epoch++;
  const strong = property !== null && version.cardinality === 'one' && unconditional && plainDataProperty
    && noConcurrentWriters && receiverProof?.state === 'one-concrete-live-object'
    && receiverProof.worldId === version.worldId && receiverProof.regionId === version.regionId
    && receiverProof.contextId === version.contextId && text(receiverProof.receiptId);
  if (property === null) {
    next.closedProperties = false;
    if (next.wildcards.length >= 4096) throw new RangeError('Heap wildcard retention requires owner continuation.');
    next.wildcards.push({ epoch: next.epoch, values: unique(values), writeSite });
  } else {
    let cell = next.cells.find(row => row.property === property);
    if (!cell) {
      if (next.cells.length >= 4096) throw new RangeError('Heap cell retention requires owner continuation.');
      cell = { property, values: [], presence: 'unknown', unknown: !version.closedProperties, wildcardAfter: 0 };
      next.cells.push(cell);
    }
    const merged = new Set();
    for (const value of strong ? values : [...cell.values, ...values]) {
      budget.value(value); diagnostics.valueVisits++; merged.add(value);
      if (merged.size > 4096) throw new RangeError('Heap value retention requires owner continuation.');
    }
    cell.values = [...merged].sort();
    if (cell.values.length > 4096) throw new RangeError('Heap value retention requires owner continuation.');
    if (strong) { cell.presence = 'knownPresent'; cell.unknown = false; cell.wildcardAfter = next.epoch; }
    else if (cell.presence !== 'knownPresent') cell.unknown = true;
    next.cells.sort((a, b) => a.property < b.property ? -1 : a.property > b.property ? 1 : 0);
  }
  next.lastWrite = { writeSite, property, update: strong ? 'strong' : 'weak',
    uniquenessReceiptId: strong ? receiverProof.receiptId : null };
  return seal(next, budget);
});

/** Reads retain wildcard and physically-missing-cell uncertainty, never invent undefined. */
const readProjection = (version, property, budget) => {
  if (!(property === null || text(property))) throw new TypeError('Invalid heap property demand.');
  const cacheKey = version.versionId + '\0' + JSON.stringify(property), cached = readCache.get(cacheKey);
  if (cached) { readCache.delete(cacheKey); readCache.set(cacheKey, cached); diagnostics.readCacheHits++; return cached.answer; }
  diagnostics.readCacheMisses++;
  const cell = property === null ? null : ownedVersions.get(version).cellsByProperty.get(property);
  const cells = property === null ? version.cells : cell ? [cell] : [];
  const wildcardAfter = property !== null && cells.length ? cells[0].wildcardAfter : 0;
  const wildcards = [], values = new Set();
  const append = list => { for (const value of list) { budget.value(value); diagnostics.valueVisits++; values.add(value); } };
  for (const cell of cells) { budget.step(); diagnostics.cellVisits++; append(cell.values); }
  for (const write of version.wildcards) {
    budget.step(); diagnostics.wildcardVisits++;
    if (write.epoch > wildcardAfter) { wildcards.push(write); append(write.values); }
  }
  const answer = { versionId: version.versionId, regionId: version.regionId, property,
    values: [...values].sort(),
    unknown: cells.some(cell => cell.unknown || cell.presence === 'freed')
      || !cells.length || property === null && !version.closedProperties,
    presence: property !== null && cells.length ? cells[0].presence : 'unknown',
    claim: 'may-values-in-model', closure: version.frontier.length ? 'partial' : 'complete-in-model',
    dependencies: { versionId: version.versionId, wildcardEpochs: wildcards.map(row => row.epoch),
      negativeProperty: !cells.length ? property : null } };
  const encoded = budget.encode(answer), bytes = Buffer.byteLength(encoded) + Buffer.byteLength(cacheKey);
  freeze(answer);
  if (bytes <= FINITE_HEAP_LIMITS.maxReadCacheBytes) {
    while (readCache.size && (readCacheBytes + bytes > FINITE_HEAP_LIMITS.maxReadCacheBytes || readCache.size >= FINITE_HEAP_LIMITS.maxReadCacheEntries)) {
      const oldest = readCache.keys().next().value; readCacheBytes -= readCache.get(oldest).bytes; readCache.delete(oldest);
    }
    readCache.set(cacheKey, { answer, bytes }); readCacheBytes += bytes;
  }
  return answer;
};
/** Internal paged consumer borrows an immutable bounded projection; it does not
 * clone all values merely to present one page. Public full reads stay detached. */
export const readFiniteHeapCellProjection = input => operation('read', budget => {
  const { version, property } = captureFiniteHeapFields(input, ['version', 'property'], ['version', 'property'], budget);
  return readProjection(admit(version, budget), property, budget);
});
export const readFiniteHeapCell = input => {
  const answer = readFiniteHeapCellProjection(input);
  return { ...answer, values: [...answer.values], dependencies: { ...answer.dependencies, wildcardEpochs: [...answer.dependencies.wildcardEpochs] } };
};

/** Branch join materializes may values, retaining the zero-iteration/other-branch alternatives. */
export const joinFiniteHeapVersions = versions => operation('join', budget => {
  if (!Array.isArray(versions) || versions.length < 1 || versions.length > 128) throw new TypeError('Bounded heap predecessor set required.');
  const predecessors = [];
  for (let index = 0; index < versions.length; index++) {
    budget.step(); const descriptor = Object.getOwnPropertyDescriptor(versions, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new TypeError('Heap predecessors must be passive dense entries.');
    predecessors.push(descriptor.value);
  }
  for (const name in versions) {
    budget.step(); if (!Object.hasOwn(versions, name)) continue;
    if (!/^(?:0|[1-9][0-9]*)$/u.test(name) || Number(name) >= versions.length) throw new TypeError('Decorated heap predecessors are not data.');
  }
  if (Object.getOwnPropertySymbols(versions).length) throw new TypeError('Heap predecessor symbols are not data.');
  versions = predecessors.map(version => admit(version, budget));
  const first = versions[0];
  const identity = ['worldId', 'regionId', 'contextId', 'allocationId', 'profile'];
  if (versions.some(version => identity.some(field => version[field] !== first[field]))) throw new TypeError('Cannot join different heap worlds or regions.');
  const nameSet = new Set();
  for (const version of versions) for (const cell of version.cells) {
    budget.step(); nameSet.add(cell.property);
    if (nameSet.size > 4096) throw new RangeError('Joined heap property allowance exceeded.');
  }
  const names = [...nameSet].sort();
  if (names.length > 4096) throw new RangeError('Joined heap property allowance exceeded.');
  const next = { ...first }; delete next.versionId; delete next.lastWrite;
  next.predecessors = unique(versions.map(version => version.versionId)); next.epoch = 0;
  next.cardinality = versions.every(version => version.cardinality === 'one') ? 'one' : 'many';
  next.closedProperties = versions.every(version => version.closedProperties);
  next.cells = names.map(property => {
    const reads = versions.map(version => readProjection(version, property, budget));
    const valueSet = new Set();
    for (const read of reads) for (const value of read.values) {
      budget.value(value); diagnostics.valueVisits++; valueSet.add(value);
      if (valueSet.size > 4096) throw new RangeError('Joined heap value allowance exceeded.');
    }
    const values = [...valueSet].sort();
    if (values.length > 4096) throw new RangeError('Joined heap value allowance exceeded.');
    return { property, values, unknown: reads.some(read => read.unknown), wildcardAfter: 0,
      presence: reads.every(read => read.presence === 'knownPresent') ? 'knownPresent' : 'unknown' };
  });
  // Keep the unnamed remainder even when known cells have already absorbed it.
  const wildcardSet = new Set();
  for (const version of versions) for (const write of version.wildcards) for (const value of write.values) {
    budget.value(value); diagnostics.valueVisits++; wildcardSet.add(value);
    if (wildcardSet.size > 4096) throw new RangeError('Joined wildcard allowance exceeded.');
  }
  const wildcardValues = [...wildcardSet].sort();
  if (wildcardValues.length > 4096) throw new RangeError('Joined wildcard allowance exceeded.');
  next.wildcards = wildcardValues.length ? [{ epoch: 1, values: wildcardValues, writeSite: 'branch-join' }] : [];
  next.epoch = next.wildcards.length ? 1 : 0;
  const frontier = new Set();
  for (const version of versions) for (const reason of version.frontier) {
    budget.step(); frontier.add(reason);
    if (frontier.size > 4096) throw new RangeError('Joined heap frontier allowance exceeded.');
  }
  next.frontier = [...frontier].sort();
  return seal(next, budget);
});
