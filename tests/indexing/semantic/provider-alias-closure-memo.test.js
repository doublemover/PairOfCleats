import assert from 'node:assert/strict';
import { canonicalSemanticJson as key } from '../../../src/index/semantic/identity.js';
import { createProviderAliasClosureResolver } from '../../../src/index/semantic/provider-alias-closure.js';
const ref = localId => ({ partitionId: 'fixture', localId });
const aliases = new Map([[key(ref(0)), [ref(1), ref(2)]], [key(ref(1)), [ref(3)]], [key(ref(2)), [ref(3), ref(0)]]]);
const resolver = createProviderAliasClosureResolver({ aliases, known: new Set([key(ref(3))]) });
for (let site = 0; site < 500; site++) {
  const result = resolver.resolve(ref(0));
  assert.deepEqual(result.targets, [ref(3)]); assert.equal(result.truncated, false);
}
assert.equal(resolver.stats.queueAllocations, 1); assert.equal(resolver.stats.hits, 499);
assert.ok(resolver.stats.aliasVisits < 10); assert.ok(resolver.stats.cacheBytes <= 4 * 1024 * 1024);
const chain = new Map(Array.from({ length: 10 }, (_, id) => [key(ref(id)), [ref(id + 1)]]));
const partial = createProviderAliasClosureResolver({ aliases: chain, known: new Set([key(ref(10))]) });
assert.equal(partial.resolve(ref(0)).truncated, true);
assert.equal(partial.resolve(ref(0)).truncated, true, 'memo replay retains depth truncation');
const wide = createProviderAliasClosureResolver({ aliases: new Map([[key(ref(0)), Array.from({ length: 300 }, (_, id) => ref(id + 1))]]),
  known: new Set(Array.from({ length: 300 }, (_, id) => key(ref(id + 1)))) });
assert.equal(wide.resolve(ref(0)).targets.length, 32); assert.equal(wide.resolve(ref(0)).truncated, true);
const limited = createProviderAliasClosureResolver({ aliases, known: new Set([key(ref(3))]), maxWork: 1, maxCacheBytes: 0 });
assert.equal(limited.resolve(ref(0)).truncated, true); assert.equal(limited.stats.cacheBytes, 0);
const controller = new AbortController(); controller.abort(new Error('cancel construction'));
assert.throws(() => createProviderAliasClosureResolver({ aliases, known: new Set(), signal: controller.signal }).resolve(ref(0)), /cancel construction/);
console.log('bounded directional provider alias closures are reused without promoting partial evidence');
