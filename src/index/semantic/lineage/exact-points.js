import { createHash } from 'node:crypto';
import { canonicalSemanticJson, semanticHash } from '../identity.js';
import { validateSemanticEnvelope } from '../../../contracts/validators/semantic-envelopes.js';

const owners = new WeakMap();
const fail = message => { throw new TypeError('Supplied lineage: ' + message); };
const text = value => typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= 4096;
const fields = (value, names) => value && Object.getPrototypeOf(value) === Object.prototype
  && !Object.getOwnPropertySymbols(value).length && Object.keys(value).length === names.length
  && names.every(name => Object.hasOwn(value, name)
    && Object.hasOwn(Object.getOwnPropertyDescriptor(value, name), 'value'));
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const key = point => canonicalSemanticJson(point);

/** Bound plain data before canonical serialization or cloning; never invoke metadata getters. */
const admitData = (value, maxBytes) => {
  let bytes = 0, nodes = 0;
  const active = new Set();
  const visit = (item, depth) => {
    if (++nodes > 200000 || depth > 24) fail('metadata structure allowance exceeded');
    if (typeof item === 'string') {
      if (Buffer.byteLength(item) > maxBytes) fail('metadata string allowance exceeded');
      bytes += Buffer.byteLength(JSON.stringify(item));
    }
    else if (item === null || typeof item === 'boolean') bytes += 5;
    else if (typeof item === 'number' && Number.isFinite(item) && !Object.is(item, -0)) bytes += 24;
    else if (item && typeof item === 'object') {
      if (active.has(item) || Object.getOwnPropertySymbols(item).length
        || !Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) fail('plain acyclic data required');
      if (Array.isArray(item) && Object.keys(item).length !== item.length) fail('dense plain arrays required');
      active.add(item); bytes += 2;
      for (const name of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, name);
        if (!Object.hasOwn(descriptor, 'value')) fail('accessor metadata rejected');
        bytes += Array.isArray(item) ? 1 : Buffer.byteLength(JSON.stringify(name)) + 2;
        if (bytes > maxBytes) fail('metadata byte allowance exceeded');
        visit(descriptor.value, depth + 1);
      }
      active.delete(item);
    } else fail('explicit JSON data required');
    if (bytes > maxBytes) fail('metadata byte allowance exceeded');
  };
  visit(value, 0);
  return JSON.parse(canonicalSemanticJson(value));
};

/** Data-only normalized point receipts. This is not a source-map/LLVM decoder. */
export const admitExactPointLineage = ({ world, artifacts, transformations, maxBytes = 8 * 1024 * 1024 }) => {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 64 * 1024 * 1024) fail('invalid byte allowance');
  if (!Array.isArray(artifacts) || artifacts.length > 256 || !Array.isArray(transformations)
    || transformations.length > 256) fail('bounded artifact/transformation inventories required');
  const data = admitData({ world, transformations }, maxBytes);
  if (!validateSemanticEnvelope('generation', data.world?.generation).ok) fail('qualified generation required');
  const inventory = new Map();
  let retainedBytes = 0;
  for (const artifact of artifacts) {
    if (!fields(artifact, ['id', 'bytes', 'coordinateProfile', 'buildId']) || !text(artifact.id)
      || inventory.has(artifact.id) || !(artifact.bytes instanceof Uint8Array)
      || !['utf16-offset-v1', 'binary-byte-offset-v1'].includes(artifact.coordinateProfile)
      || !text(artifact.buildId)) fail('invalid artifact descriptor');
    retainedBytes += artifact.bytes.byteLength;
    if (retainedBytes > maxBytes) fail('artifact byte allowance exceeded');
    const bytes = Buffer.from(artifact.bytes);
    const decoded = artifact.coordinateProfile === 'utf16-offset-v1'
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) : null;
    inventory.set(artifact.id, { id: artifact.id, bytes, decoded, coordinateProfile: artifact.coordinateProfile,
      buildId: artifact.buildId, byteHash: createHash('sha256').update(bytes).digest('hex'),
      length: decoded === null ? bytes.length : decoded.length });
  }
  const pointValid = point => {
    if (!fields(point, ['artifactId', 'byteHash', 'coordinateProfile', 'offset'])) return false;
    const artifact = inventory.get(point.artifactId);
    if (!artifact || artifact.byteHash !== point.byteHash || artifact.coordinateProfile !== point.coordinateProfile
      || !Number.isSafeInteger(point.offset) || point.offset < 0 || point.offset > artifact.length) return false;
    if (artifact.decoded !== null && point.offset > 0 && point.offset < artifact.length
      && /[\uD800-\uDBFF]/u.test(artifact.decoded[point.offset - 1])
      && /[\uDC00-\uDFFF]/u.test(artifact.decoded[point.offset])) return false;
    return true;
  };
  const forward = new Map(), reverse = new Map(), transformIds = new Set(), atomIds = new Set();
  const add = (index, point, edge) => { const id = key(point); if (!index.has(id)) index.set(id, []); index.get(id).push(edge); };
  let atomCount = 0;
  for (const transform of data.transformations) {
    if (!fields(transform, ['id', 'world', 'producerProfile', 'orderedTransformId', 'inputArtifacts', 'outputArtifacts', 'atoms', 'coverage'])
      || !text(transform.id) || transformIds.has(transform.id) || key(transform.world) !== key(data.world)
      || !text(transform.producerProfile) || !text(transform.orderedTransformId)
      || !Array.isArray(transform.atoms) || (atomCount += transform.atoms.length) > 16384
      || !['partial', 'complete-declared-points'].includes(transform.coverage)) fail('invalid transformation receipt');
    transformIds.add(transform.id);
    for (const name of ['inputArtifacts', 'outputArtifacts']) {
      if (!Array.isArray(transform[name]) || transform[name].length > 256 || !transform[name].length
        || new Set(transform[name]).size !== transform[name].length
        || transform[name].some(id => !inventory.has(id))) fail('exact supplied artifact inventory required');
    }
    for (const atom of transform.atoms) {
      if (!fields(atom, ['id', 'from', 'to', 'kind', 'inlineContext', 'provenanceRef'])
        || !text(atom.id) || atomIds.has(atom.id) || !pointValid(atom.from)
        || !transform.outputArtifacts.includes(atom.from.artifactId)
        || !['retained-anchor', 'declared-operation', 'heuristic-attribution', 'explicit-unmapped'].includes(atom.kind)
        || !Array.isArray(atom.inlineContext) || atom.inlineContext.length > 32
        || atom.inlineContext.some(frame => !text(frame)) || !text(atom.provenanceRef)
        || (atom.kind === 'explicit-unmapped' ? atom.to !== null : !pointValid(atom.to)
          || !transform.inputArtifacts.includes(atom.to.artifactId))) fail('invalid correlated mapping atom');
      atomIds.add(atom.id);
      const edge = freeze({ ...atom, transformationId: transform.id });
      add(forward, atom.from, edge);
      if (atom.to) add(reverse, atom.to, edge);
    }
  }
  const manifest = [...inventory.values()].map(({ bytes, decoded, ...descriptor }) => descriptor);
  const rootId = semanticHash('pairofcleats.exact-point-lineage.v1', { ...data, artifacts: manifest });
  const handle = Object.freeze({ rootId, world: freeze(data.world), artifactCount: inventory.size, atomCount, retainedBytes });
  owners.set(handle, { inventory, pointValid, forward, reverse });
  return handle;
};

/** Demand composition retains a shared edge graph and all alternatives; sparse points are never interpolated. */
export const mapExactLineagePoint = (handle, { point, targetArtifacts, direction = 'forward',
  maxWork = 32768, maxNodes = 4096, signal = null }) => {
  const owner = owners.get(handle);
  if (!owner || !owner.pointValid(point) || !Array.isArray(targetArtifacts) || targetArtifacts.length > 256
    || targetArtifacts.some(id => !owner.inventory.has(id)) || !['forward', 'reverse'].includes(direction)
    || !Number.isSafeInteger(maxWork) || maxWork < 0 || !Number.isSafeInteger(maxNodes)
    || maxNodes < 1 || maxNodes > 16384) fail('invalid pinned point query');
  const targets = new Set(targetArtifacts), index = direction === 'forward' ? owner.forward : owner.reverse;
  const nodes = [{ id: 0, point: structuredClone(point) }], ids = new Map([[key(point), 0]]);
  const edges = [], endpoints = [], residuals = [];
  let work = 0, stopped = false;
  for (let cursor = 0; cursor < nodes.length && !stopped; cursor++) {
    const node = nodes[cursor];
    if (signal?.aborted) { residuals.push({ nodeId: node.id, reason: 'cancelled' }); break; }
    if (targets.has(node.point.artifactId)) { endpoints.push(node.id); continue; }
    const candidates = index.get(key(node.point)) || [];
    if (!candidates.length) residuals.push({ nodeId: node.id, reason: 'no-exact-anchor' });
    for (const atom of candidates) {
      if (work >= maxWork) { residuals.push({ nodeId: node.id, reason: 'work-budget' }); stopped = true; break; }
      work++;
      const next = direction === 'forward' ? atom.to : atom.from;
      if (!next) { residuals.push({ nodeId: node.id, reason: 'explicit-unmapped', atomId: atom.id }); continue; }
      const nextKey = key(next);
      let nextId = ids.get(nextKey);
      if (nextId === undefined) {
        if (nodes.length >= maxNodes) { residuals.push({ nodeId: node.id, reason: 'node-budget' }); stopped = true; break; }
        nextId = nodes.length; ids.set(nextKey, nextId); nodes.push({ id: nextId, point: next });
      }
      edges.push({ from: node.id, to: nextId, atomId: atom.id, transformationId: atom.transformationId,
        kind: atom.kind, inlineContext: atom.inlineContext, provenanceRef: atom.provenanceRef });
    }
  }
  // Kahn's elimination distinguishes genuine cycles from reconverging alternative paths.
  const indegree = nodes.map(() => 0), outgoing = nodes.map(() => []);
  for (const edge of edges) { indegree[edge.to]++; outgoing[edge.from].push(edge.to); }
  const queue = nodes.filter(node => indegree[node.id] === 0).map(node => node.id);
  for (let at = 0; at < queue.length; at++) for (const next of outgoing[queue[at]]) if (--indegree[next] === 0) queue.push(next);
  if (queue.length !== nodes.length) residuals.push({ nodeId: 0, reason: 'mapping-cycle' });
  return freeze({ rootId: handle.rootId, world: handle.world, direction, nodes, edges, endpoints, residuals, work,
    status: residuals.length ? 'partial' : 'complete-declared-point-traversal',
    ambiguity: endpoints.length > 1 ? 'multiple-endpoints' : edges.length > nodes.length - 1 ? 'multiple-paths' : 'none-observed',
    sourceAuthority: 'not-qualified', operationEquivalence: 'not-established', interpolation: 'none' });
};
