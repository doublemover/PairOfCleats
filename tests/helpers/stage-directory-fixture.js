import fs from 'node:fs/promises';
import path from 'node:path';
import { publishBackendGeneration } from '../../tools/build/embeddings/backend-publication.js';
import { updatePieceManifest } from '../../tools/build/embeddings/manifest.js';
import { inventoryBackendPayload } from '../../src/shared/artifact-io/backend-payload-inventory.js';
import { buildEmbeddingIdentity } from '../../src/shared/embedding-identity.js';

/** Named closed-writer fixture: production publication/manifest paths, synthetic
 * physical table bytes. It does not claim native database decoding. */
export const publishStageDirectoryFixture = async ({ outDir, count = 1, dims = 2, embeddingIdentity: requestedEmbeddingIdentity = null }) => {
  const stageDir = await fs.mkdtemp(path.join(outDir, '.fixture-backend-'));
  const dir = path.join(stageDir, 'dense_vectors.lancedb'), metadataPath = dir + '.meta.json';
  await fs.mkdir(path.join(dir, 'vectors.lance', '_versions'), { recursive: true });
  await fs.mkdir(path.join(dir, 'vectors.lance', 'data'));
  await fs.writeFile(path.join(dir, 'vectors.lance', '_versions', '1.manifest'), 'closed-writer-version');
  await fs.writeFile(path.join(dir, 'vectors.lance', 'data', '1.lance'), 'closed-writer-data');
  const payload = await inventoryBackendPayload({ dir });
  const embeddingIdentity = requestedEmbeddingIdentity || buildEmbeddingIdentity({ stub: true, provider: 'stub', modelId: 'fixture', dims });
  await fs.writeFile(metadataPath, JSON.stringify({ version: 1, model: embeddingIdentity.modelId || 'fixture', dims, count, expectedCount: count,
    table: 'vectors', rowCount: count, metric: 'cosine', embeddingColumn: 'vector', idColumn: 'id', quantizationVersion: 1, extensions: { nativePayloadInventory: payload } }));
  const published = await publishBackendGeneration({ stageDir, indexDir: outDir, embeddingIdentity,
    embeddingGeneration: 'a'.repeat(64), enabled: { hnsw: false, lancedb: true },
    results: { lancedb: { merged: { skipped: false, count } } }, warn: message => { throw new Error(message); } });
  await updatePieceManifest({ indexDir: outDir, mode: 'code', totalChunks: count, dims, backendPieces: published.pieces, embeddingGeneration: 'a'.repeat(64) });
  const piece = published.pieces.find(value => value.format === 'dir');
  return { piece, pieces: published.pieces, dir: path.join(outDir, piece.path), metadataPath: path.join(outDir, piece.path + '.meta.json'), payload };
};
