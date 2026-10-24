import assert from 'node:assert/strict';
import { createCacheIndex, normalizeCacheIndex } from '../../../tools/build/embeddings/cache/index-state.js';
const original = createCacheIndex('identity');
assert.equal(Object.getPrototypeOf(original.entries), null);
assert.equal(Object.getPrototypeOf(original.files), null);
original.entries['__proto__'] = { key: '__proto__', file: '__proto__', hash: 'a' };
original.entries.constructor = { key: 'constructor', file: 'constructor', hash: 'b' };
original.entries.toString = { key: 'toString', file: 'toString', hash: 'c' };
const normalized = normalizeCacheIndex(JSON.parse(JSON.stringify(original)), 'identity');
assert.equal(Object.getPrototypeOf(normalized.entries), null);
assert.equal(Object.getPrototypeOf(normalized.files), null);
for (const key of ['__proto__', 'constructor', 'toString']) {
  assert.equal(Object.hasOwn(normalized.entries, key), true);
  assert.equal(Object.hasOwn(normalized.files, key), true);
}
assert.equal({}.hash, undefined);
console.log('Embedding-cache file keys round-trip without inherited dictionary entries.');
