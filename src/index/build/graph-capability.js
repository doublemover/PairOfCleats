import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../contracts/versioning.js';
import { validateArtifact } from '../../contracts/artifact-schemas.js';
import { loadChunkMeta, loadGraphRelations, loadJsonArrayArtifact } from '../../shared/artifact-io/loaders.js';
import { reconcileIndexIdentity } from '../identity/reconcile.js';
import { openPublishedSemanticStore } from '../../semantic/published-store.js';
import { validateSemanticPartitions } from '../semantic/reconcile.js';
import { buildMapMembers } from '../../map/build-map/members.js';
import { hydrateChunkMeta } from '../../map/build-map/io.js';
import { buildEdgesFromGraph } from '../../map/build-map/edges.js';
import { acquireRepoCacheAccessLease } from '../../shared/cache/repo-access.js';
import { getRepoCacheRoot } from '../../shared/dict-utils.js';
import { atomicWriteJson } from '../../shared/io/atomic-write.js';
import { throwIfAborted } from '../../shared/abort.js';
import { addStorageFailureContext, readStorageFailureContext } from '../../shared/storage/operation-error.js';
import { combineCacheWriterErrors } from './cache-writer-drain.js';
import { readBuildMetadata, stageIdentityHash, sameStagePath } from './stage-output.js';

export const GRAPH_CAPABILITY_POLICY_VERSION = 1;
export const GRAPH_CAPABILITY_REQUIRED_FAMILIES = Object.freeze(['chunk_meta', 'file_meta', 'file_relations',
  'repo_map', 'graph_relations', 'symbols', 'symbol_occurrences', 'symbol_edges', 'chunk_uid_map']);
const invalid = message => Object.assign(new Error(message), { code: 'ERR_GRAPH_CAPABILITY_VALIDATION' });

/** The canonical artifact readers, schemas, identity reconciliation and actual
 * map member join define this capability. Vectors and SQLite grant no authority.
 */
export const validateGraphCapabilityInputs = async ({ root, indexRoot, manifest, signal }) => {
  throwIfAborted(signal);
  const indexDir = path.join(indexRoot, 'index-code');
  const names = new Set(manifest.pieces.map(piece => piece.name));
  const missing = GRAPH_CAPABILITY_REQUIRED_FAMILIES.filter(name => !names.has(name));
  if (missing.length) throw invalid('Graph capability required families are missing: ' + missing.join(', '));
  const arrays = {};
  for (const name of GRAPH_CAPABILITY_REQUIRED_FAMILIES) {
    throwIfAborted(signal);
    const value = name === 'chunk_meta' ? await loadChunkMeta(indexDir, { manifest, strict: true })
      : name === 'graph_relations' ? await loadGraphRelations(indexDir, { manifest, strict: true })
        : await loadJsonArrayArtifact(indexDir, name, { manifest, strict: true });
    const validation = validateArtifact(name, value);
    if (!validation.ok) throw invalid(`Graph capability ${name} schema validation failed: ${validation.errors.slice(0, 3).join('; ')}`);
    arrays[name] = value;
  }
  const identity = await reconcileIndexIdentity({ indexDir, strict: true });
  if (!identity.ok) throw invalid('Graph capability artifact identities disagree.');
  const warnings = [];
  const joined = buildMapMembers({ repoMap: arrays.repo_map, chunkMeta: hydrateChunkMeta(arrays.chunk_meta, arrays.file_meta),
    fileMeta: arrays.file_meta, fileRelations: arrays.file_relations, intern: value => value, strict: true, warnings });
  if (!joined.identitySummary.complete) throw invalid('Graph capability map identities are unresolved or ambiguous.');
  const graphCoverage = {};
  for (const name of ['callGraph', 'usageGraph', 'importGraph']) {
    const graph = arrays.graph_relations[name], ids = new Map();
    for (const node of graph.nodes) {
      if (ids.has(node.id)) throw invalid('Graph capability contains duplicate relation node identities.');
      const incoming = new Set(node.in), outgoing = new Set(node.out);
      if (incoming.size !== node.in.length || outgoing.size !== node.out.length) throw invalid('Graph capability contains duplicate relation endpoints.');
      ids.set(node.id, { incoming, outgoing });
    }
    let edges = 0;
    for (const node of graph.nodes) for (const target of node.out) {
      if (!ids.has(target) || !ids.get(target).incoming.has(node.id)) throw invalid('Graph capability relation endpoints disagree.');
      edges++;
    }
    for (const node of graph.nodes) for (const source of node.in) {
      if (!ids.has(source) || !ids.get(source).outgoing.has(node.id)) throw invalid('Graph capability incoming relation endpoints disagree.');
    }
    if (graph.nodeCount !== ids.size || graph.edgeCount !== edges) throw invalid('Graph capability relation counts disagree.');
    let mapEdges = 0;
    for (const _edge of buildEdgesFromGraph({ graph, type: name, ...joined })) mapEdges++;
    graphCoverage[name] = { nodes: ids.size, edges, mapEdges, unmappedEdges: edges - mapEdges };
  }
  let semantic = { state: 'unavailable', generation: null, partitions: 0 };
  if (names.has('semantic_manifest')) {
    const opened = await openPublishedSemanticStore({ indexDir, repoRoot: root, signal });
    await opened.store.withReadScope(() => validateSemanticPartitions({ store: opened.store,
      partitions: opened.manifest.partitions, signal }));
    semantic = { state: opened.manifest.status, generation: opened.manifest.generation, partitions: opened.manifest.partitions.length };
  }
  return { files: arrays.file_meta.length, chunks: arrays.chunk_meta.length, identities: identity.summary,
    mapIdentity: joined.identitySummary || null, graphCoverage, dataflow: joined.hasDataflow ? 'available' : 'unavailable',
    controlFlow: joined.hasControlFlow ? 'available' : 'unavailable', semantic,
    upstreamCoverage: arrays.graph_relations.upstreamCoverage || null,
    graphCaps: arrays.graph_relations.caps || null, warningCount: warnings.length, warnings: warnings.slice(0, 16) };
};

export const writeGraphCapabilityReceipt = async ({ root, sourceBuildRoot, indexRoot, buildId, manifest,
  descriptorHash, producerIdentity = null, signal, assertOwned }) => {
  const coverage = await validateGraphCapabilityInputs({ root, indexRoot, manifest, signal });
  const identity = { schemaVersion: 1, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    validationPolicyVersion: GRAPH_CAPABILITY_POLICY_VERSION, capability: 'graph', mode: 'code',
    repoRoot: path.resolve(root), sourceBuildRoot: path.resolve(sourceBuildRoot), buildId,
    indexRoot: path.resolve(indexRoot), descriptorHash, semanticGeneration: coverage.semantic.generation,
    producerIdentity: producerIdentity || { identity: null, reason: 'historical-producer-not-established' },
    coverageHash: stageIdentityHash(coverage) };
  const receipt = { ...identity, capabilityId: stageIdentityHash(identity), status: 'ready', coverage };
  await atomicWriteJson(path.join(indexRoot, 'graph-capability.json'), receipt, { signal, createOnly: true,
    beforeCommit: assertOwned });
  return receipt;
};

/** Read one pinned immutable snapshot under the existing reader/collector
 * protocol. Callers release only after all of their graph reads have settled.
 */
export const withGraphCapability = async ({ root, userConfig, indexRoot, capabilityId = null, signal = null,
  verifySnapshot }, consume) => {
  if (typeof consume !== 'function' || typeof verifySnapshot !== 'function') throw new TypeError('Graph capability requires its consumer and exact snapshot validator.');
  const lease = acquireRepoCacheAccessLease(getRepoCacheRoot(root, userConfig), { scope: 'graph-capability-reader',
    requireSettlement: true, resourceId: `graph:${capabilityId || indexRoot}` });
  let operationError = null, operationObservation = null, released = false;
  const release = () => {
    if (operationObservation && (!operationObservation.call(operationError)
      || !readStorageFailureContext(operationError)?.complete)) throw operationError;
    if (!released) released = lease.release() === true;
    if (!released) throw Object.assign(new Error('Graph capability reader lease release remains unconfirmed.'),
      { code: 'ERR_GRAPH_CAPABILITY_READER_RELEASE', cacheOwnershipPending: true, cacheOwnershipReleased: () => released });
    return true;
  };
  try {
    const { value: receipt } = await readBuildMetadata(indexRoot, path.join(indexRoot, 'graph-capability.json'), 1024 * 1024, signal);
    const { status: _status, coverage: _coverage, capabilityId: storedId, ...identity } = receipt;
    if (receipt.status !== 'ready' || receipt.validationPolicyVersion !== GRAPH_CAPABILITY_POLICY_VERSION
      || receipt.artifactSurfaceVersion !== ARTIFACT_SURFACE_VERSION || receipt.capability !== 'graph'
      || receipt.coverageHash !== stageIdentityHash(receipt.coverage)
      || storedId !== stageIdentityHash(identity) || (capabilityId && storedId !== capabilityId)
      || !sameStagePath(receipt.repoRoot, root) || !sameStagePath(receipt.indexRoot, indexRoot)) throw invalid('Graph capability belongs to another snapshot or validation policy.');
    await verifySnapshot(receipt);
    throwIfAborted(signal);
    return await consume(Object.freeze({ ...receipt, indexDir: path.join(indexRoot, 'index-code') }));
  } catch (error) {
    operationError = addStorageFailureContext(error, { graphCapabilityPhase: 'consumer' }, null, { forceAggregate: true });
    operationObservation = Object.getOwnPropertyDescriptor(operationError, 'cacheOwnershipReleased').value;
    throw operationError;
  } finally {
    try { release(); }
    catch (error) {
      const failure = combineCacheWriterErrors(operationError, error);
      Object.defineProperty(failure, 'releaseGraphReader', { value: release });
      throw failure;
    }
  }
};
