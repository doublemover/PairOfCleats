import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readBundleFile, writeBundleFile, writeBundlePatch } from '../../../src/shared/bundle-io.js';
import { BUNDLE_PATCH_FIELD_KEYS } from '../../../src/shared/bundle-io-constants.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('bundle-patch-persisted-equivalence');
const base = { file: 'a.js', hash: 'v1', chunks: [{ text: 'one' }] };
let sequence = 0;
const persisted = async (filename, bundle) => {
  await writeBundleFile({ bundlePath: filename, bundle, format: 'json' });
  const result = await readBundleFile(filename, { format: 'json' });
  assert.equal(result.ok, true, result.reason);
  return result.bundle;
};
const snapshot = async filename => {
  const entries = await fs.readdir(dir);
  return Object.fromEntries(await Promise.all(entries.filter(name => name.startsWith(path.basename(filename)))
    .map(async name => [name, (await fs.readFile(path.join(dir, name))).toString('base64')])));
};
const check = async (before, after, expectation = 'applied') => {
  const filename = path.join(dir, `case-${sequence++}.json`);
  await persisted(filename, before);
  const priorArtifacts = await snapshot(filename);
  const result = await writeBundlePatch({ bundlePath: filename, previousBundle: before, nextBundle: after, format: 'json' });
  if (expectation !== 'applied') {
    assert.equal(result.applied, false);
    assert.equal(result.reason, expectation);
    assert.deepEqual(await snapshot(filename), priorArtifacts, 'declined patch must not mutate publication artifacts');
    return;
  }
  assert.equal(result.applied, true, JSON.stringify(result));
  const actual = await readBundleFile(filename, { format: 'json' });
  assert.equal(actual.ok, true, actual.reason);
  const expected = await persisted(path.join(dir, `expected-${sequence}.json`), after);
  assert.deepEqual(actual.bundle, expected, 'a patch must equal an ordinary persisted full rewrite');
};
try {
  await check(base, { ...base, chunks: [{ text: 'two' }] });
  await check(base, { ...base, hash: 'v2' });
  await check(base, { ...base, file: 'b.js' });
  await check(base, { ...base }, 'no-changes');
  await check({ ...base, encoding: null }, base);
  await check({ ...base, chunks: [{ text: 'one', optional: null }] }, base);
  await check(base, { ...base, chunks: [{ text: 'one', items: [undefined, null] }] });
  await check({ ...base, encoding: 'utf8' }, { ...base, encoding: undefined });
  await check(base, { ...base, encoding: undefined }, 'no-changes');
  await check({ ...base, chunks: [{ text: 'one', absent: undefined }] }, base, 'no-changes');
  await check(base, { ...base, chunks: [{ text: 'one', vector: Uint8Array.from([1, 2, 255]) }] });
  await check({ ...base, chunks: [{ vector: Uint8Array.from([1, 2]) }] },
    { ...base, chunks: [{ vector: Uint8Array.from([3, 4]) }] });
  await check(base, { ...base, lintOutcome: { status: 'clean' } }, 'full-rewrite-required');
  await check({ ...base, lintOutcome: null }, base, 'full-rewrite-required');
  await check(base, { ...base, chunks: undefined }, 'full-rewrite-required');
  for (const key of BUNDLE_PATCH_FIELD_KEYS.filter(key => !['file', 'artifactSurfaceVersion'].includes(key))) {
    await check({ ...base, [key]: null }, { ...base, [key]: { changed: true } });
    const before = { ...base, [key]: null }, after = { ...before };
    delete after[key];
    await check(before, after);
  }
  const filename = path.join(dir, 'sequential.json');
  await persisted(filename, base);
  let previous = base;
  for (const next of [{ ...base, hash: 'v2', encoding: null },
    { ...base, hash: 'v3', chunks: [{ text: 'one' }, { text: 'two', vector: Uint16Array.from([256, 1]) }] },
    { ...base, hash: 'v4', fileRelations: { calls: [] } }]) {
    const result = await writeBundlePatch({ bundlePath: filename, previousBundle: previous, nextBundle: next, format: 'json' });
    assert.equal(result.applied, true, result.reason);
    const actual = await readBundleFile(filename, { format: 'json' });
    assert.equal(actual.ok, true, actual.reason);
    assert.deepEqual(actual.bundle, await persisted(path.join(dir, 'sequential-expected.json'), next));
    previous = next;
  }
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Persisted bundle patches equal full rewrites through removals, omission, typed arrays and sequential updates.');
