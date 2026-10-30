import { assertSemanticOperationIndex } from '../contracts/validators/semantic-operation-index.js';
import { assertSemanticQueryIndex } from '../contracts/validators/semantic-query-index.js';
import { validateArtifact } from '../contracts/artifact-schemas.js';
import path from 'node:path';
import { readFreshPiecesManifest } from '../shared/artifact-io/manifest-read.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { SEMANTIC_MEMBER_NAMES } from '../contracts/schemas/semantic-envelopes.js';
import { canonicalSemanticJson } from '../index/semantic/identity.js';
import { throwIfAborted } from '../shared/abort.js';
import { createArtifactSemanticStore } from './artifact-store.js';
import { readSemanticManifest } from './manifest-reader.js';
import { compareQueryIndexRows } from './query-index.js';
import { compareOperationIndexRows } from './operation-index.js';

const integrity = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_INTEGRITY' });
const generationMismatch = message => Object.assign(new Error(message), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });

/** Open only a complete family already registered in the pinned build manifest.
 * Metadata buffers live only during admission; stores own parsed inventories.
 */
export const openPublishedSemanticStore = async ({ indexDir, repoRoot, generation = null,
  requireQueryIndex = false, signal = null }) => {
  throwIfAborted(signal);
  if (generation) { generation = structuredClone(generation); assertSemanticEnvelope('generation', generation); }
  const pieces = readFreshPiecesManifest(indexDir, { repoRoot });
  // Capture fresh registration authority before any await without retaining or
  // changing the ordinary mutable parsed cache.
  const registrations = structuredClone(pieces.pieces);
  const buildId = pieces.buildId;
  const byPath = new Map();
  for (const piece of registrations) {
    if (!piece || typeof piece.path !== 'string' || byPath.has(piece.path)) throw integrity('Duplicate or invalid registered semantic path.');
    byPath.set(piece.path, piece);
  }
  const metadata = (name, filename) => {
    const matches = registrations.filter(piece => piece.name === name);
    if (!matches.length) {
      if (byPath.has(filename)) throw integrity('Semantic metadata has the wrong registered member name.');
      return null;
    }
    if (matches.length !== 1 || matches[0].path !== filename) throw integrity('Conflicting registered semantic metadata identity.');
    return matches[0];
  };
  const registeredPart = (name, relativePath, hash, bytes = null) => {
    const piece = byPath.get('semantic/' + relativePath);
    if (!piece || piece.name !== name || piece.checksum !== 'sha256:' + hash
      || (bytes !== null && piece.bytes !== bytes)) throw integrity('Semantic part identity is not registered: ' + relativePath);
  };
  const registeredRows = (name, entries) => {
    for (const piece of entries) {
      registeredPart(name, piece.path, piece.hash, piece.bytes);
      registeredPart(name + '_offsets', piece.offsetsPath, piece.offsetsHash, piece.count * 8);
    }
  };
  const manifestPiece = metadata('semantic_manifest', 'semantic_manifest.json');
  if (!manifestPiece) throw Object.assign(new Error('Semantic family is unavailable in this generation.'), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
  const manifest = await readSemanticManifest(indexDir, manifestPiece, signal);
  throwIfAborted(signal);
  const filePath = path.join(indexDir, manifestPiece.path);
  assertCurrentIndexFormat({ operation: 'semantic_detail', component: 'semantic manifest',
    foundVersion: manifest.artifactSurfaceVersion, repoRoot, indexPath: filePath });
  assertCurrentIndexFormat({ operation: 'semantic_detail', component: 'semantic schema', expectedVersion: 1,
    foundVersion: manifest.semanticSchemaVersion, repoRoot, indexPath: filePath });
  const validation = validateArtifact('semantic_manifest', manifest);
  if (!validation.ok) throw new Error('Invalid semantic manifest: ' + validation.errors.join('; '));
  if (buildId !== manifest.generation.baseBuildId) throw new Error('Mixed semantic/build manifest generations.');
  assertSemanticEnvelope('generation', manifest.generation);
  if (generation && canonicalSemanticJson(generation) !== canonicalSemanticJson(manifest.generation)) {
    throw generationMismatch('Semantic generation no longer matches the requested build.');
  }
  const partitionIds = new Set();
  for (const partition of manifest.partitions) {
    throwIfAborted(signal);
    if (partitionIds.has(partition.partitionId)) throw integrity('Duplicate semantic partition identity.');
    partitionIds.add(partition.partitionId);
    for (const member of SEMANTIC_MEMBER_NAMES) registeredRows(member, partition.members[member]);
  }
  for (const artifact of manifest.evidenceArtifacts || []) registeredPart('semantic_evidence', artifact.path, artifact.hash, artifact.bytes);
  for (const artifact of manifest.frontierTargets || []) registeredPart('semantic_frontier_targets', artifact.path, artifact.hash, artifact.bytes);
  const expectedHashes = manifest.partitions.map(({ partitionId, canonicalHash }) => ({ partitionId, canonicalHash }))
    .sort((a, b) => a.partitionId < b.partitionId ? -1 : a.partitionId > b.partitionId ? 1 : 0);
  const validateIndex = (index, compare, name) => {
    if (canonicalSemanticJson(index.generation) !== canonicalSemanticJson(manifest.generation)) throw generationMismatch('Mixed semantic ' + name + ' generation.');
    if (canonicalSemanticJson(index.partitionHashes) !== canonicalSemanticJson(expectedHashes)) throw integrity('Semantic ' + name + ' partition inventory mismatch.');
    let previous = null;
    for (const piece of index.pieces) {
      throwIfAborted(signal);
      if (compare(piece.firstKey, piece.lastKey) > 0 || (previous && compare(previous, piece.firstKey) >= 0)) throw integrity('Invalid semantic ' + name + ' ordering.');
      previous = piece.lastKey;
    }
  };
  let queryIndex = null;
  const queryPiece = metadata('semantic_query_index', 'semantic_query_index.json');
  if (queryPiece) {
    queryIndex = assertSemanticQueryIndex(await readSemanticManifest(indexDir, queryPiece, signal));
    throwIfAborted(signal);
    validateIndex(queryIndex, compareQueryIndexRows, 'query index');
    for (const piece of queryIndex.pieces) {
      registeredPart('semantic_query_index_rows', piece.path, piece.hash, piece.bytes);
      registeredPart('semantic_query_index_offsets', piece.offsetsPath, piece.offsetsHash, piece.count * 8);
    }
  } else if (requireQueryIndex) throw Object.assign(new Error('Semantic query lookup index is unavailable in this generation.'), { code: 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE' });
  let operationIndex = null;
  const operationPiece = metadata('semantic_operation_index', 'semantic_operation_index.json');
  if (operationPiece) {
    const operationManifest = await readSemanticManifest(indexDir, operationPiece, signal);
    throwIfAborted(signal);
    assertCurrentIndexFormat({ operation: 'semantic_find', component: 'semantic operation index', expectedVersion: 2,
      foundVersion: operationManifest.schemaVersion, repoRoot, indexPath: path.join(indexDir, operationPiece.path) });
    operationIndex = assertSemanticOperationIndex(operationManifest);
    validateIndex(operationIndex, compareOperationIndexRows, 'operation index');
    for (const piece of operationIndex.pieces) {
      registeredPart('semantic_operation_index_rows', piece.path, piece.hash, piece.bytes);
      registeredPart('semantic_operation_index_offsets', piece.offsetsPath, piece.offsetsHash, piece.count * 8);
    }
  }
  throwIfAborted(signal);
  const store = createArtifactSemanticStore({ root: path.join(indexDir, 'semantic'), repoRoot,
    artifactSurfaceVersion: manifest.artifactSurfaceVersion, generation: manifest.generation, partitions: manifest.partitions, completedTasks: manifest.completedTasks, operationIndex, queryIndex });
  throwIfAborted(signal);
  return { store, manifest };
};
