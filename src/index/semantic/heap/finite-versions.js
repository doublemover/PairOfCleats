import { canonicalSemanticJson, semanticHash } from '../identity.js';

const key = canonicalSemanticJson;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096;
const unique = values => [...new Set(values)].sort();
const freeze = value => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const seal = value => freeze({ ...value, versionId: semanticHash('pairofcleats.finite-heap-version.v1', value) });
const assertValues = values => {
  if (!Array.isArray(values) || values.length > 4096 || values.some(value => !text(value))) throw new TypeError('Bounded abstract values required.');
};
const assertVersion = version => {
  if (version?.profile !== 'finite-plain-object-v1' || !version.versionId) throw new TypeError('Unsupported heap version.');
  const { versionId, ...payload } = version;
  if (semanticHash('pairofcleats.finite-heap-version.v1', payload) !== versionId) throw new TypeError('Heap version identity mismatch.');
};

/** Query-only finite plain-object model; its inputs require upstream model admission. */
export const createFiniteHeapVersion = ({ worldId, regionId, contextId, allocationId,
  cardinality = 'many', closedProperties = false, properties = [] }) => {
  if (![worldId, regionId, contextId, allocationId].every(text) || !['one', 'many'].includes(cardinality)
    || typeof closedProperties !== 'boolean' || !Array.isArray(properties) || properties.length > 4096) {
    throw new TypeError('Invalid finite heap region.');
  }
  const names = new Set();
  const cells = properties.map(cell => {
    if (!text(cell.property) || names.has(cell.property) || !['knownPresent', 'explicitUnset', 'freed', 'unknown'].includes(cell.presence)) {
      throw new TypeError('Unique named heap cells with explicit presence required.');
    }
    names.add(cell.property); assertValues(cell.values);
    if (['explicitUnset', 'freed'].includes(cell.presence) && cell.values.length) throw new TypeError('Unset/freed cells cannot carry current values.');
    return { property: cell.property, values: unique(cell.values), presence: cell.presence,
      unknown: cell.presence === 'unknown', wildcardAfter: 0 };
  }).sort((a, b) => a.property < b.property ? -1 : a.property > b.property ? 1 : 0);
  return seal({ profile: 'finite-plain-object-v1', worldId, regionId, contextId, allocationId,
    cardinality, closedProperties, cells, wildcards: [], predecessors: [], epoch: 0, frontier: [] });
};

export const writeFiniteHeapVersion = ({ version, property, values, writeSite, receiverProof = null,
  unconditional = false, plainDataProperty = false, noConcurrentWriters = false }) => {
  assertVersion(version); assertValues(values);
  if (!(property === null || text(property)) || !text(writeSite)) throw new TypeError('Qualified heap write required.');
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
    cell.values = strong ? unique(values) : unique([...cell.values, ...values]);
    if (cell.values.length > 4096) throw new RangeError('Heap value retention requires owner continuation.');
    if (strong) { cell.presence = 'knownPresent'; cell.unknown = false; cell.wildcardAfter = next.epoch; }
    else if (cell.presence !== 'knownPresent') cell.unknown = true;
    next.cells.sort((a, b) => a.property < b.property ? -1 : a.property > b.property ? 1 : 0);
  }
  next.lastWrite = { writeSite, property, update: strong ? 'strong' : 'weak',
    uniquenessReceiptId: strong ? receiverProof.receiptId : null };
  return seal(next);
};

/** Reads retain wildcard and physically-missing-cell uncertainty, never invent undefined. */
export const readFiniteHeapCell = ({ version, property }) => {
  assertVersion(version);
  if (!(property === null || text(property))) throw new TypeError('Invalid heap property demand.');
  const cells = property === null ? version.cells : version.cells.filter(cell => cell.property === property);
  const wildcardAfter = property !== null && cells.length ? cells[0].wildcardAfter : 0;
  const wildcards = version.wildcards.filter(write => write.epoch > wildcardAfter);
  return { versionId: version.versionId, regionId: version.regionId, property,
    values: unique([...cells.flatMap(cell => cell.values), ...wildcards.flatMap(write => write.values)]),
    unknown: cells.some(cell => cell.unknown || cell.presence === 'freed')
      || !cells.length || property === null && !version.closedProperties,
    presence: property !== null && cells.length ? cells[0].presence : 'unknown',
    claim: 'may-values-in-model', closure: version.frontier.length ? 'partial' : 'complete-in-model',
    dependencies: { versionId: version.versionId, wildcardEpochs: wildcards.map(row => row.epoch),
      negativeProperty: !cells.length ? property : null } };
};

/** Branch join materializes may values, retaining the zero-iteration/other-branch alternatives. */
export const joinFiniteHeapVersions = versions => {
  if (!Array.isArray(versions) || versions.length < 1 || versions.length > 128) throw new TypeError('Bounded heap predecessor set required.');
  versions.forEach(assertVersion);
  const first = versions[0];
  const identity = version => [version.worldId, version.regionId, version.contextId, version.allocationId, version.profile];
  if (versions.some(version => key(identity(version)) !== key(identity(first)))) throw new TypeError('Cannot join different heap worlds or regions.');
  const names = unique(versions.flatMap(version => version.cells.map(cell => cell.property)));
  if (names.length > 4096) throw new RangeError('Joined heap property allowance exceeded.');
  const next = structuredClone(first); delete next.versionId; delete next.lastWrite;
  next.predecessors = unique(versions.map(version => version.versionId)); next.epoch = 0;
  next.cardinality = versions.every(version => version.cardinality === 'one') ? 'one' : 'many';
  next.closedProperties = versions.every(version => version.closedProperties);
  next.cells = names.map(property => {
    const reads = versions.map(version => readFiniteHeapCell({ version, property }));
    const values = unique(reads.flatMap(read => read.values));
    if (values.length > 4096) throw new RangeError('Joined heap value allowance exceeded.');
    return { property, values, unknown: reads.some(read => read.unknown), wildcardAfter: 0,
      presence: reads.every(read => read.presence === 'knownPresent') ? 'knownPresent' : 'unknown' };
  });
  // Keep the unnamed remainder even when known cells have already absorbed it.
  const wildcardValues = unique(versions.flatMap(version => version.wildcards.flatMap(write => write.values)));
  if (wildcardValues.length > 4096) throw new RangeError('Joined wildcard allowance exceeded.');
  next.wildcards = wildcardValues.length ? [{ epoch: 1, values: wildcardValues, writeSite: 'branch-join' }] : [];
  next.epoch = next.wildcards.length ? 1 : 0;
  next.frontier = unique(versions.flatMap(version => version.frontier));
  return seal(next);
};
