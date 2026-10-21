import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildTreeSitterChunks, buildTreeSitterChunksAsync, initTreeSitterRuntime,
  preloadTreeSitterLanguages, getTreeSitterStats, resetTreeSitterParser,
  shutdownTreeSitterWorkerPool } from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { resolveChunkCacheKey, resolvePersistentChunkCacheRoot, storeCachedChunks } from '../../../src/lang/tree-sitter/chunking/cache.js';

const id = process.env.PAIROFCLEATS_TEST_ID?.split('indexing/tree-sitter/js-ts-export-bindings/')[1];
assert.ok(['javascript', 'typescript'].includes(id));
const { dir } = await prepareIsolatedTestCacheDir(`module-export-native-${id}`);
applyTestEnv({ cacheRoot: path.join(dir, 'cache') });
const text = `export function original() { const nested = () => 0; return nested(); }
const arrow = (a,b) => a+b;
const expression = function(a,b) { return a+b; };
const scalar = 1;
const mapped = [1].map(value => value+1);
export { arrow as api, expression };
`;
const options = { treeSitter: { enabled: true, useQueries: true, chunkCache: true,
  cacheKey: 'js-ts-module-export-bindings', cachePersistent: true, chunkCacheMaxEntries: 8,
  cachePersistentDir: path.join(dir, 'native-cache') } };
// Captured from the actual cache owner at 86ee61e0f, before producer identity was included.
const legacyKey = id === 'javascript' ? 'tree-sitter-chunk:lk1:de1992fe2773a189b2251d27da12ef20935c92e7'
  : 'tree-sitter-chunk:lk1:03d1bfb753c9d1c1d625de514439bbed9b39bebc';
const assertBindings = chunks => {
  assert.deepEqual(chunks.map(chunk => chunk.name).sort(), ['arrow', 'expression', 'original']);
  assert.equal(chunks.find(chunk => chunk.name === 'arrow').kind, 'VariableDeclaration');
  assert.equal(chunks.find(chunk => chunk.name === 'expression').kind, 'VariableDeclaration');
};
try {
  assert.equal(await initTreeSitterRuntime(), true);
  await preloadTreeSitterLanguages([id], { parallel: false });
  const key = resolveChunkCacheKey(options, id); assert.notEqual(key, legacyKey);
  const cacheRoot = resolvePersistentChunkCacheRoot(options);
  storeCachedChunks({ cache: treeSitterState.chunkCache, key: legacyKey,
    chunks: [{ name: 'stale-without-bindings' }], maxEntries: 8, cacheRoot });
  const cold = buildTreeSitterChunks({ text, languageId: id, options }); assertBindings(cold);
  const warm = buildTreeSitterChunks({ text, languageId: id, options }); assert.deepEqual(warm, cold);
  treeSitterState.chunkCache.clear(); treeSitterState.persistentChunkCacheMemo.clear();
  const disk = buildTreeSitterChunks({ text, languageId: id, options }); assert.deepEqual(disk, cold);
  assert.ok(getTreeSitterStats().chunkCachePersistentHits >= 1, 'actual persistent warm-cache reuse');
  const walked = buildTreeSitterChunks({ text, languageId: id,
    options: { treeSitter: { enabled: true, useQueries: false, chunkCache: false } } });
  assert.deepEqual(walked, cold, 'query and bounded traversal retain the same named bindings');
  const fallbacks = getTreeSitterStats().workerFallbacks || 0;
  const worker = await buildTreeSitterChunksAsync({ text, languageId: id,
    options: { treeSitter: { enabled: true, chunkCache: false,
      worker: { enabled: true, maxWorkers: 1, taskTimeoutMs: 5000 } } } });
  assert.deepEqual(worker, cold, 'normal worker production retains the same named bindings');
  assert.ok(treeSitterState.treeSitterWorkerPool?.completed > 0, 'an actual worker task completed');
  assert.equal(getTreeSitterStats().workerFallbacks || 0, fallbacks, 'a synchronous fallback cannot qualify workers');
  for (const [text, names] of [
    ['export default function(a,b) { return a+b; }', ['default']],
    ['export default (a,b) => a+b;', ['default']],
    ['export default class { method() {} }', ['default', 'default.method']]
  ]) {
    for (const useQueries of [true, false]) {
      const chunks = buildTreeSitterChunks({ text, languageId: id,
        options: { treeSitter: { enabled: true, useQueries, chunkCache: false } } });
      assert.deepEqual(chunks.map(chunk => chunk.name), names, 'anonymous default module APIs survive native chunking');
    }
  }
} finally {
  await shutdownTreeSitterWorkerPool(); resetTreeSitterParser({ hard: true });
}
console.log(`${id} native named-function binding and cold/warm/cache-version checks passed`);
