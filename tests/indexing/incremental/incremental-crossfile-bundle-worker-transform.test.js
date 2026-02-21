#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import {
  readBundleFile,
  resolveBundlePatchPath,
  writeBundleFile,
  writeBundlePatch
} from '../../../src/shared/bundle-io.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'incremental-crossfile-bundle-worker-transform');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const hugeStableText = 'A'.repeat(5 * 1024 * 1024);
const previousBundle = {
  file: 'src/huge-worker-transform.js',
  hash: 'hash:prev',
  mtimeMs: 1700000000000,
  size: hugeStableText.length,
  chunks: [
    { file: 'src/huge-worker-transform.js', chunkId: 'stable', text: hugeStableText },
    { file: 'src/huge-worker-transform.js', chunkId: 'tail', text: 'old-tail' }
  ],
  fileRelations: { imports: ['./dep-a.js'] }
};
const nextBundle = {
  ...previousBundle,
  hash: 'hash:next',
  chunks: [
    previousBundle.chunks[0],
    { file: 'src/huge-worker-transform.js', chunkId: 'tail', text: 'new-tail' }
  ],
  fileRelations: { imports: ['./dep-b.js'] }
};

const jsonBundlePath = path.join(tempRoot, 'huge-worker-transform.json');
await writeBundleFile({
  bundlePath: jsonBundlePath,
  bundle: previousBundle,
  format: 'json'
});
const patchResult = await writeBundlePatch({
  bundlePath: jsonBundlePath,
  previousBundle,
  nextBundle,
  format: 'json'
});
assert.equal(patchResult.applied, true, 'expected bundle patch write to succeed');
const patchPath = resolveBundlePatchPath(jsonBundlePath);
const patchStat = await fs.stat(patchPath);
assert.ok(patchStat.size > 0, 'expected non-empty patch sidecar after worker patch transform');
const patched = await readBundleFile(jsonBundlePath, { format: 'json' });
assert.equal(patched?.ok, true, 'expected patched JSON bundle to load');
assert.equal(patched.bundle?.chunks?.[1]?.text, 'new-tail', 'expected patched tail chunk');
assert.deepEqual(
  patched.bundle?.fileRelations || null,
  { imports: ['./dep-b.js'] },
  'expected patched relations payload'
);

const msgpackBundlePath = path.join(tempRoot, 'huge-worker-transform.mpk');
const writeMsgpack = await writeBundleFile({
  bundlePath: msgpackBundlePath,
  bundle: nextBundle,
  format: 'msgpack'
});
assert.equal(writeMsgpack.format, 'msgpack');
assert.equal(typeof writeMsgpack.checksum, 'string', 'expected msgpack checksum');
const loadedMsgpack = await readBundleFile(msgpackBundlePath, { format: 'msgpack' });
assert.equal(loadedMsgpack?.ok, true, 'expected msgpack bundle to load');
assert.equal(loadedMsgpack.bundle?.chunks?.[1]?.text, 'new-tail');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('incremental cross-file bundle worker transform test passed');
