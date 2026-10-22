import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildContextIndex, expandContext, hydrateContextIndex, serializeContextIndex } from '../../../src/retrieval/context-expansion.js';
import { createModeExpander } from '../../../src/retrieval/cli/run-search-session/mode-expansion.js';
import { normalizeCaps } from '../../../src/graph/neighborhood/caps.js';

const chunks = [
  { id: 0, file: 'seed.js', name: 'seed', codeRelations: { calls: [['seed', '__proto__'], ['seed', 'other']] } },
  { id: 1, file: '__proto__', name: '__proto__' },
  { id: 2, file: 'other.js', name: 'other' }
];
const index = buildContextIndex({ chunkMeta: chunks, repoMap: [{ name: '__proto__', file: '__proto__' }] });
const encoded = JSON.parse(JSON.stringify(serializeContextIndex(index)));
const restored = hydrateContextIndex(encoded);
assert.deepEqual(restored.byName.get('__proto__'), [1]);
assert.deepEqual(restored.byFile.get('__proto__'), [1]);
assert.deepEqual(restored.repoMapByName.get('__proto__'), ['__proto__']);
const expand = options => expandContext({ hits: [{ id: 0 }], chunkMeta: chunks, contextIndex: index, options });
assert.equal(expand({ includeCalls: true }).contextHits.length, 2, 'omitted optional caps retain normal defaults');
assert.equal(expand({ includeCalls: true, maxTotal: null, maxPerHit: null }).contextHits.length, 2);
assert.equal(expand({ includeCalls: true, maxNameCandidates: 0 }).contextHits.length, 0);
const reasons = expand({ includeCalls: true, includeReasons: true, maxReasons: 0 });
assert.ok(reasons.contextHits.every(hit => hit.context.reasons.length === 0));
for (const cap of ['maxTotal', 'maxPerHit']) {
  const limited = expand({ includeCalls: true, [cap]: 1 });
  assert.equal(limited.contextHits.length, 1);
  assert.ok(JSON.stringify(limited.stats.truncation).includes(cap), 'an eligible omission has a cap witness');
}
assert.equal(normalizeCaps({ maxNodes: null }).maxNodes, null);
assert.equal(normalizeCaps({ maxNodes: 0 }).maxNodes, 0);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-context-cache-'));
try {
  const frozen = path.join(temp, 'frozen'), cache = path.join(temp, 'derived');
  await fs.mkdir(frozen);
  await fs.writeFile(path.join(frozen, 'chunk_meta.json'), JSON.stringify(chunks));
  const before = await fs.readdir(frozen);
  for (let pass = 0; pass < 2; pass++) {
    const expander = createModeExpander({ contextExpansionEnabled: true,
      contextExpansionOptions: { includeCalls: true }, contextCacheDir: cache });
    const result = await expander.expandModeHits('code', { indexDir: frozen, chunkMeta: chunks }, [{ id: 0 }]);
    assert.equal(result.contextHits.length, 2);
    assert.deepEqual(await fs.readdir(frozen), before, 'derived caches never modify selected index generations');
  }
  assert.ok((await fs.readdir(path.join(cache, 'context-index-v2'))).some(name => name.endsWith('.meta.json')));
} finally { await fs.rm(temp, { recursive: true, force: true }); }
console.log('context caps and cache identity passed');
