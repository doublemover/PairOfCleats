import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveHnswPaths } from '../../../src/shared/hnsw.js';
import { resolveLanceDbPaths } from '../../../src/shared/lancedb.js';
import { writeJsonObjectFile } from '../../../src/shared/json-stream/json-writers.js';

const variants = ['merged', 'doc', 'code'];
const prefix = variant => variant === 'merged' ? 'dense_vectors' : `dense_vectors_${variant}`;

/** Only completed writer receipts and complete output pairs enter an immutable
 * generation. The caller publishes its manifest after this rename succeeds.
 * Old generations remain untouched, including on interrupted promotion. */
export const publishBackendGeneration = async ({
  stageDir, indexDir, embeddingIdentity, embeddingGeneration, results, enabled, warn
}) => {
  if (!/^[a-f0-9]{64}$/.test(embeddingGeneration)) throw new Error('Invalid embedding generation.');
  const relativeDir = `.embeddings-backends/${embeddingGeneration}-${randomUUID()}`;
  const pieces = [];
  const backends = { hnsw: {}, lancedb: {} };
  for (const backend of ['hnsw', 'lancedb']) {
    for (const variant of variants) {
      const receipt = results?.[backend]?.[variant];
      const paths = backend === 'hnsw'
        ? resolveHnswPaths(stageDir, variant) : resolveLanceDbPaths(stageDir)[variant];
      const dataPath = paths.indexPath || paths.dir;
      const state = { enabled: enabled[backend] === true, available: false, target: variant };
      backends[backend][variant] = state;
      let admitted = false;
      if (state.enabled && receipt?.skipped === false && Number(receipt.count) > 0) {
        try {
          const [stat, raw] = await Promise.all([fs.lstat(dataPath), fs.readFile(paths.metaPath, 'utf8')]);
          const meta = JSON.parse(raw);
          if (stat.isSymbolicLink() || (backend === 'hnsw' ? !stat.isFile() || stat.size === 0 : !stat.isDirectory())) {
            throw new Error('backend output has an invalid type');
          }
          if (Number(meta.count) !== Number(receipt.count) || Number(meta.dims) !== embeddingIdentity.dims
            || meta.model !== embeddingIdentity.modelId) throw new Error('backend output does not match its writer receipt');
          await writeJsonObjectFile(paths.metaPath, { fields: { ...meta, embeddingIdentity,
            embeddingGeneration, backendGeneration: relativeDir, variant }, atomic: true });
          Object.assign(state, { available: true, dims: meta.dims, count: meta.count,
            embeddingGeneration, backendGeneration: relativeDir });
          const name = `${prefix(variant)}_${backend}`;
          pieces.push({ type: 'embeddings', name, format: backend === 'hnsw' ? 'bin' : 'dir',
            path: `${relativeDir}/${path.basename(dataPath)}`, count: meta.count, dims: meta.dims });
          pieces.push({ type: 'embeddings', name: `${name}_meta`, format: 'json',
            path: `${relativeDir}/${path.basename(paths.metaPath)}`, count: meta.count, dims: meta.dims });
          admitted = true;
        } catch (error) {
          warn(`[embeddings] ${backend}/${variant}: replacement unavailable: ${error.message}`);
        }
      }
      if (!admitted) {
        // Remove only this invocation's rejected staging output, never an active generation.
        await fs.rm(dataPath, { recursive: backend === 'lancedb', force: true });
        await fs.rm(paths.metaPath, { force: true });
      }
    }
  }
  if (pieces.length) {
    const target = path.join(indexDir, relativeDir);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Same-volume rename: no partially copied generation becomes manifest-visible.
    await fs.rename(stageDir, target);
  }
  return { pieces, backends };
};
