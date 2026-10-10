import { checksumFile } from '../shared/hash.js';
import { assertSemanticQueryIndex } from '../contracts/validators/semantic-query-index.js';
import fs from 'node:fs/promises';
import { validateArtifact } from '../contracts/artifact-schemas.js';
import path from 'node:path';
import { loadPiecesManifest } from '../shared/artifact-io/manifest-read.js';
import { assertCurrentIndexFormat } from '../contracts/index-format.js';
import { assertSemanticEnvelope } from '../contracts/validators/semantic-envelopes.js';
import { createArtifactSemanticStore, resolveSemanticPartPath } from './artifact-store.js';

/** Open only a complete family already registered in the pinned build manifest. */
export const openPublishedSemanticStore = async ({ indexDir, repoRoot, generation = null, requireQueryIndex = false }) => {
  const pieces = loadPiecesManifest(indexDir, { repoRoot });
  if (!pieces.pieces?.some((piece) => piece.name === 'semantic_manifest' && piece.path === 'semantic_manifest.json')) {
    throw Object.assign(new Error('Semantic family is unavailable in this generation.'), { code: 'ERR_SEMANTIC_UNAVAILABLE' });
  }
  const filePath = path.join(indexDir, 'semantic_manifest.json');
  if ((await fs.stat(filePath)).size > 32 * 1024 * 1024) throw new Error('Semantic manifest exceeds metadata allowance.');
  const manifest = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assertCurrentIndexFormat({ operation: 'semantic_detail', component: 'semantic manifest',
    foundVersion: manifest.artifactSurfaceVersion, repoRoot, indexPath: filePath });
  assertCurrentIndexFormat({ operation: 'semantic_detail', component: 'semantic schema', expectedVersion: 1,
    foundVersion: manifest.semanticSchemaVersion, repoRoot, indexPath: filePath });
  const validation = validateArtifact('semantic_manifest', manifest);
  if (!validation.ok) throw new Error('Invalid semantic manifest: ' + validation.errors.join('; '));
  if (pieces.buildId !== manifest.generation.baseBuildId) throw new Error('Mixed semantic/build manifest generations.');
  assertSemanticEnvelope('generation', manifest.generation);
  if (generation && (generation.baseBuildId !== manifest.generation.baseBuildId || generation.semanticRevision !== 0)) {
    throw Object.assign(new Error('Semantic generation no longer matches the requested build.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
  }
  let queryIndex = null;
  const queryPiece = pieces.pieces?.find((piece) => piece.name === 'semantic_query_index' && piece.path === 'semantic_query_index.json');
  if (queryPiece) {
    const queryPath = await resolveSemanticPartPath(indexDir, 'semantic_query_index.json');
    if ((await fs.stat(queryPath)).size > 32 * 1024 * 1024) throw new Error('Semantic query index exceeds metadata allowance.');
    const checksum = await checksumFile(queryPath);
    if (queryPiece.checksum !== checksum.algo + ':' + checksum.value) throw Object.assign(new Error('Semantic query manifest checksum mismatch.'), { code: 'ERR_SEMANTIC_INTEGRITY' });
    queryIndex = assertSemanticQueryIndex(JSON.parse(await fs.readFile(queryPath, 'utf8')));
    if (queryIndex.generation.baseBuildId !== manifest.generation.baseBuildId || queryIndex.generation.semanticRevision !== manifest.generation.semanticRevision) throw Object.assign(new Error('Mixed semantic query index generation.'), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
    const registered = new Set(pieces.pieces.map((piece) => piece.path));
    for (const piece of queryIndex.pieces) {
      if (!registered.has('semantic/' + piece.path) || !registered.has('semantic/' + piece.offsetsPath)) throw new Error('Semantic query index part is not registered.');
    }
  } else if (requireQueryIndex) throw Object.assign(new Error('Semantic query lookup index is unavailable in this generation.'), { code: 'ERR_SEMANTIC_QUERY_INDEX_UNAVAILABLE' });
  const store = createArtifactSemanticStore({ root: path.join(indexDir, 'semantic'), repoRoot,
    artifactSurfaceVersion: manifest.artifactSurfaceVersion, generation: manifest.generation, partitions: manifest.partitions, queryIndex });
  return { store, manifest };
};
