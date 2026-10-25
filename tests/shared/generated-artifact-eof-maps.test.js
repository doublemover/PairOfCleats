import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyGeneratedArtifactPrefix, classifyGeneratedArtifactContentPrefix, createMapCacheEnvelope,
  generatedMapCacheIdentity, inspectGeneratedArtifact, readGeneratedArtifactPrefix } from '../../src/shared/generated-artifact.js';
import { createGeneratedArtifactPrefixObservation } from '../../src/shared/generated-artifact-observation.js';
import { withGeneratedArtifactMetadata } from '../../src/shared/generated-artifact-core.js';
import { withGeneratedCacheMetadata } from '../../src/shared/generated-artifact-cache.js';
import { discoverEntries } from '../../src/index/build/discover.js';

const repoRoot = process.cwd(), identity = generatedMapCacheIdentity('eof-map-fixture');
const model = payload => ({ version: '1.0.0', generatedAt: '2026-10-25T00:00:00.000Z', root: { path: repoRoot, id: 'fixture' },
  mode: 'code', options: { include: ['imports'] }, legend: {}, nodes: [], edges: [], payload });
const families = [
  { name: 'map', relativePath: identity.fileName, make: payload => createMapCacheEnvelope(model(payload), identity.key), depth: 2 },
  { name: 'legacy-map', relativePath: '.pairofcleats/maps/cache/code-map:lk1:' + 'b'.repeat(40) + '.json', make: model, depth: 1 },
  { name: 'core', relativePath: 'index_state.json', make: payload => withGeneratedArtifactMetadata({ payload }, 'index-state'), depth: 1 },
  { name: 'cache', relativePath: 'lsp/request-cache-v1.json', make: payload => withGeneratedCacheMetadata({ payload }, 'lsp-requests'), depth: 1 }
];
const observe = bytes => createGeneratedArtifactPrefixObservation({ bytes, sourceBytes: bytes.length });
const classify = (family, prefix) => classifyGeneratedArtifactPrefix({ relativePath: family.relativePath, prefix, repoRoot });
const completeAt = (family, size) => {
  const empty = Buffer.byteLength(JSON.stringify(family.make('')));
  const bytes = Buffer.from(JSON.stringify(family.make('x'.repeat(size - empty))));
  assert.equal(bytes.length, size); JSON.parse(bytes); return bytes;
};
for (const family of families) {
  const valid = Buffer.from(JSON.stringify(family.make('small')));
  assert.equal(classify(family, valid)?.action, 'omit', family.name);
  assert.equal(classify(family, Buffer.from(JSON.stringify({ documentation: valid.toString() }))), null);
  for (const size of [8191, 8192, 8193]) {
    const bytes = completeAt(family, size), observation = observe(bytes);
    assert.equal(observation.bytes.length, Math.min(size, 8192));
    assert.equal(observation.sourceBytes, BigInt(size)); assert.equal(observation.complete, size <= 8192);
    assert.equal(classify(family, observation)?.action, 'omit', family.name + '/valid/' + size);
    assert.equal(classify(family, bytes)?.action, 'omit', 'complete existing buffers preserve extent before slicing');
    const bad = Buffer.from(JSON.stringify(family.make(null)).replace(':null', ':oops') + ' '.repeat(size));
    assert.equal(classify(family, observe(bad)), null, 'visible malformed syntax cannot be excused by capping');
  }
  for (const size of [8191, 8192]) {
    const missingEnd = completeAt(family, size + 1).subarray(0, size);
    assert.equal(classify(family, observe(missingEnd)), null, family.name + '/actual-eof/' + size);
    const closing = '"' + '}'.repeat(family.depth);
    const start = JSON.stringify(family.make('')).slice(0, -closing.length);
    const unclosed = Buffer.from(start + 'x'.repeat(size - Buffer.byteLength(start)));
    assert.equal(unclosed.length, size); assert.equal(classify(family, observe(unclosed)), null, 'EOF cannot explain an unfinished string');
  }
  const missingAtCap = completeAt(family, 8193).subarray(0, 8192);
  assert.equal(classify(family, observe(missingAtCap)), null, 'exact-cap EOF is complete, not presumed truncated');
  const continued = createGeneratedArtifactPrefixObservation({ bytes: missingAtCap, sourceBytes: 8193 });
  assert.equal(classify(family, continued)?.action, 'omit', 'same visible bytes with observed continuation remain a valid prefix');
  const raw = valid.toString(), reserved = family.name === 'core' ? 'extensions' : family.name === 'legacy-map' ? 'version' : '__poc_generated';
  assert.equal(classify(family, Buffer.from(raw.slice(0, -1) + ',"' + reserved + '":{}}')), null, 'duplicate outer authority field');
  if (family.name.includes('map')) {
    assert.equal(classify(family, Buffer.from(raw.replace('"nodes":[]', '"nodes":[{oops}]'))), null, 'map payload grammar is inspected');
    if (family.name === 'map') {
      assert.equal(classify(family, Buffer.from(raw.slice(0, -1) + ',"data":{}}')), null, 'duplicate outer data is rejected');
      assert.equal(classifyGeneratedArtifactContentPrefix({ prefix: Buffer.from(raw.replace('"nodes":[]', '"nodes":[oops]')) }), null);
    }
  }
  if (family.name !== 'legacy-map') {
    assert.equal(classify(family, Buffer.from(raw.replace('poc.generated@1', 'poc.generated@99'))), null);
    const closing = '"' + '}'.repeat(family.depth), start = JSON.stringify(family.make('')).slice(0, -closing.length);
    const padding = 'x'.repeat(8192 - Buffer.byteLength(start) - 2);
    const bytes = Buffer.from(start + padding + '💡tail' + closing);
    assert.equal(classify(family, observe(bytes))?.action, 'omit', 'capped UTF-8 scalar remains a lexical string character');
    assert.equal(classify(family, observe(bytes.subarray(0, 8192))), null, 'unfinished UTF-8 at actual EOF is not owned JSON');
    const escaped = Buffer.from(start + padding.slice(0, -1) + '\\💡tail' + closing);
    assert.equal(classify(family, observe(escaped)), null, 'a partial non-ASCII scalar cannot hide an invalid JSON escape');
  }
}
assert.throws(() => createGeneratedArtifactPrefixObservation({ bytes: Buffer.alloc(4), sourceBytes: 3 }), /extent/);
assert.throws(() => createGeneratedArtifactPrefixObservation({ bytes: Buffer.alloc(4), sourceBytes: 8193 }), /cover/);
assert.throws(() => createGeneratedArtifactPrefixObservation({ bytes: Buffer.alloc(0), sourceBytes: NaN }), /extent/);

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-map-prefix-'));
const originalOpen = fs.open;
let reads = 0, opens = 0;
try {
  const filename = path.join(root, identity.fileName), mapFamily = families[0];
  fs.open = async function (...args) {
    opens++;
    const handle = await originalOpen.apply(this, args), read = handle.read.bind(handle);
    handle.read = async (buffer, offset, length, position) => {
      assert.ok(position >= 0 && position + length <= 8192, 'no unconditional byte 8193 probe'); reads++;
      return read(buffer, offset, length, position);
    };
    return handle;
  };
  const invalid = completeAt(mapFamily, 8193).subarray(0, 8192);
  await fs.writeFile(filename, invalid);
  const controller = new AbortController(); controller.abort();
  const beforeAbort = opens;
  await assert.rejects(async () => readGeneratedArtifactPrefix(root, filename, undefined, { signal: controller.signal }), { code: 'ABORT_ERR' });
  assert.equal(opens, beforeAbort, 'pre-abort cannot open a prefix descriptor');
  assert.equal(await inspectGeneratedArtifact({ repoRoot: root, filePath: filename, relativePath: identity.fileName }), null);
  const exact = await readGeneratedArtifactPrefix(root, filename);
  assert.equal(exact.sourceBytes, 8192n); assert.equal(exact.complete, true);
  await fs.writeFile(filename, completeAt(mapFamily, 8193));
  assert.equal((await inspectGeneratedArtifact({ repoRoot: root, filePath: filename, relativePath: identity.fileName }))?.action, 'omit');
  const capped = await readGeneratedArtifactPrefix(root, filename);
  assert.equal(capped.sourceBytes, 8193n); assert.equal(capped.complete, false); assert.equal(capped.bytes.length, 8192);
  assert.ok(reads >= 4);
  assert.equal(await inspectGeneratedArtifact({ repoRoot: root, filePath: filename, relativePath: identity.fileName,
    readPrefix: async () => Buffer.from(JSON.stringify(mapFamily.make('unknown extent'))) }), null, 'unknown reader extent cannot authorize omission');
  const malformed = generatedMapCacheIdentity('malformed-map-fixture');
  await fs.writeFile(path.join(root, malformed.fileName), JSON.stringify(createMapCacheEnvelope(model('bad'), malformed.key)).replace('"nodes":[]', '"nodes":[oops]'));
  await fs.writeFile(path.join(root, 'authored.js'), 'export const authored = 1;\n');
  const found = await discoverEntries({ root, modes: ['code', 'prose'] });
  assert.ok(found.entries.some(row => row.rel === malformed.fileName), 'malformed marker-shaped input remains searchable source');
  assert.ok(found.entries.some(row => row.rel === 'authored.js'));
  assert.equal(found.entries.some(row => row.rel === identity.fileName), false, 'valid owned cache is omitted');
  console.log('map/core/cache visible grammar, descriptor EOF, UTF-8 boundaries and source-retaining discovery passed');
} finally { fs.open = originalOpen; await fs.rm(root, { recursive: true, force: true }); }
