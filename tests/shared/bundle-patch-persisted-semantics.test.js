import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ARTIFACT_SURFACE_VERSION } from '../../src/contracts/versioning.js';
import { BUNDLE_PATCH_FORMAT_TAG, BUNDLE_PATCH_VERSION } from '../../src/shared/bundle-io-constants.js';
import { buildBundlePatchPayload } from '../../src/shared/bundle-patch.js';
import { applyBundlePatch, readBundlePatches } from '../../src/shared/bundle-io/patch.js';
import { shouldReuseExistingBundle } from '../../src/index/build/incremental/bundle-compare.js';
import { readBundleFile, writeBundleFile, writeBundlePatch } from '../../src/shared/bundle-io.js';
import { prepareIsolatedTestCacheDir } from '../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('bundle-patch-persisted-semantics');
const previous = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, file: 'a.js', hash: 'same', size: 20, mtimeMs: 1,
  chunks: [{ chunkUid: 'same', text: 'aaaa', metaV2: { risk: { severity: 1 } }, docmeta: { risk: { source: 'old' } } }],
  lexiconFilterStats: { tokens: 9 }, encodingFallbackClass: null, dependencySignatures: { a: 'v1' } };
const next = { ...previous, chunks: [{ ...previous.chunks[0], text: 'bbbb',
  metaV2: { risk: { severity: 2 } }, docmeta: { risk: { source: 'new' } } }],
lexiconFilterStats: { tokens: 10 }, parseCheckpoint: { complete: false }, dependencySignatures: { a: 'v2' } };
delete next.encodingFallbackClass;
assert.equal(shouldReuseExistingBundle(previous, next), false);
for (const edit of [row => { row.chunks[0].docmeta.risk.source = 'new'; },
  row => { row.chunks[0].metaV2.risk.severity = 2; }, row => { row.chunks[0].text = 'bbbb'; },
  row => { row.lexiconFilterStats.tokens = 10; }]) {
  const candidate = structuredClone(previous); edit(candidate);
  assert.equal(shouldReuseExistingBundle(previous, candidate), false);
}
const payload = buildBundlePatchPayload({ previousBundle: previous, nextBundle: next });
const patch = JSON.parse(JSON.stringify({ format: BUNDLE_PATCH_FORMAT_TAG, version: BUNDLE_PATCH_VERSION, ...payload }));
assert.deepEqual(applyBundlePatch({ bundle: previous, patch }), next);
assert.ok(patch.unset.includes('encodingFallbackClass'));
assert.equal(buildBundlePatchPayload({ previousBundle: previous, nextBundle: { ...next, newUnsupportedField: 1 } }).requiresFullRewrite, true);
for (const format of ['json', 'msgpack']) {
  const bundlePath = path.join(dir, `bundle-${format}.${format === 'json' ? 'json' : 'mpk'}`);
  await writeBundleFile({ bundlePath, format, bundle: previous });
  const result = await writeBundlePatch({ bundlePath, format, previousBundle: previous, nextBundle: next });
  if (format === 'json') assert.equal(result.applied, true);
  else await writeBundleFile({ bundlePath, format, bundle: next });
  const read = await readBundleFile(bundlePath, { format });
  assert.equal(read.ok, true);
  assert.deepEqual(read.bundle.chunks, next.chunks);
  assert.deepEqual(read.bundle.lexiconFilterStats, next.lexiconFilterStats);
  assert.equal(Object.hasOwn(read.bundle, 'encodingFallbackClass'), false);
}
const legacyPath = path.join(dir, 'legacy.json');
await fs.writeFile(`${legacyPath}.patch.jsonl`, JSON.stringify({ format: BUNDLE_PATCH_FORMAT_TAG,
  version: 1, chunks: null, set: { hash: 'legacy' } }) + '\n');
assert.equal((await readBundlePatches(legacyPath)).patches[0].version, 1);
console.log('bundle comparison and serialized patches preserve finalized payload meaning');
