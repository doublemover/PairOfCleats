import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildCacheIdentity, resolveCacheDir, resolveLegacyCacheDir, readCacheIndex,
  writeCacheEntries, readCacheEntries, encodeCacheEntryPayload, readCacheMeta } from '../../../tools/build/embeddings/cache.js';
import { createCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
import { resolveEmbeddingCacheProfile } from '../../../src/shared/embeddings-cache/layout.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('cache-complete-profile-isolation');
const profile = (normalize, modelId = 'audit/model') => buildCacheIdentity({ provider: 'onnx', modelId, dims: 2,
  normalize, stub: true, inputFormatting: { queryPrefix: normalize ? 'query: ' : '' } });
const a = profile(true), b = profile(false), collision = profile(true, 'audit_model');
assert.notEqual(a.key, b.key);
const directories = [a, b, collision].map(value => resolveCacheDir(dir, value.identity, 'code'));
assert.equal(new Set(directories).size, 3);
for (const [index, value] of [a, b].entries()) {
  const cacheDir = directories[index]; await fs.mkdir(cacheDir, { recursive: true });
  const payload = { key: 'fixture', hash: 'source', chunkSignature: 'signature',
    cacheMeta: { identityKey: value.key }, codeVectors: [[index + 1, 2]], docVectors: [[]], mergedVectors: [[2, index + 1]] };
  await writeCacheEntries(cacheDir, createCacheIndex(value.key), [{ cacheKey: payload.key, payload, encodedPayload: await encodeCacheEntryPayload(payload) }]);
}
for (const value of [a, b, a]) {
  const cacheDir = resolveCacheDir(dir, value.identity, 'code'), index = await readCacheIndex(cacheDir, value.key);
  const [row] = await readCacheEntries(cacheDir, ['fixture'], index);
  assert.equal(row.entry.cacheMeta.identityKey, value.key);
  assert.equal(row.entry.codeVectors[0][0], value === b ? 2 : 1);
}
const legacy = resolveLegacyCacheDir(dir, a.identity, 'code'); await fs.mkdir(legacy, { recursive: true });
const legacyPayload = { key: 'legacy', hash: 'source', chunkSignature: 'signature', cacheMeta: { identityKey: a.key }, codeVectors: [[7, 8]] };
await writeCacheEntries(legacy, createCacheIndex(a.key), [{ cacheKey: 'legacy', payload: legacyPayload, encodedPayload: await encodeCacheEntryPayload(legacyPayload) }]);
const primary = await readCacheIndex(directories[0], a.key), legacyIndex = await readCacheIndex(legacy, a.key);
const [fallback] = await readCacheEntries(directories[0], ['legacy'], primary, { fallbacks: [{ cacheDir: legacy, cacheIndex: legacyIndex }] });
assert.deepEqual(Array.from(fallback.entry.codeVectors[0]), [7, 8]);
const descriptor = resolveEmbeddingCacheProfile({ cacheRoot: dir, identity: a.identity });
assert.equal(descriptor.layoutVersion, 2); assert.equal(descriptor.identityKey, a.key);
await fs.writeFile(path.join(path.dirname(legacy), 'cache.meta.json'), JSON.stringify({ identityKey: a.key }));
assert.equal(readCacheMeta(dir, b.identity, 'code'), null, 'foreign legacy metadata does not grant profile compatibility');
console.log('complete embedding identities retain independent warm namespaces and a read-only legacy tier');
