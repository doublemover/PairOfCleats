import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHnswBuilder } from '../../../tools/build/embeddings/hnsw.js';
import { loadHnswIndex, normalizeHnswConfig, resolveHnswPaths } from '../../../src/shared/hnsw.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: root } = await prepareIsolatedTestCacheDir('hnsw-fixed-backup-recovery');
try {
  const paths = resolveHnswPaths(root);
  const config = normalizeHnswConfig({ enabled: true, space: 'l2', randomSeed: 42 });
  const write = async rows => {
    const builder = createHnswBuilder({ enabled: true, config, totalChunks: 4, mode: 'fixture',
      logger: { log() {}, warn(message) { assert.fail(message); } } });
    for (const [id, vector] of rows) builder.addVector(id, vector);
    assert.equal(builder.getStats().ready, true, 'the installed real HNSW module must execute');
    await builder.writeIndex({ ...paths, modelId: 'fixture', dims: 2 });
  };
  await write([[0, [1, 0]]]);
  const original = await fs.readFile(paths.indexPath);
  await write([[0, [0, 1]], [1, [1, 0]]]);
  assert.deepEqual(await fs.readFile(`${paths.indexPath}.bak`), original);
  assert.notDeepEqual(await fs.readFile(paths.indexPath), original);
  assert.deepEqual((await fs.readdir(root)).filter(name => name.includes('.bak-')), [], 'no unreachable hidden backups');
  await fs.rm(paths.indexPath);
  const recovered = loadHnswIndex({ indexPath: paths.indexPath, dims: 2, config,
    meta: { dims: 2, count: 1, model: 'fixture', space: 'l2' }, expectedModel: 'fixture' });
  assert.ok(recovered, 'the production loader discovers the retained fixed backup');
  assert.deepEqual(recovered.searchKnn([1, 0], 1).neighbors, [0]);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Real HNSW replacement retains a backup discoverable by the production loader.');
