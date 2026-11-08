#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { readBundleFile, writeBundleFile, writeBundlePatch } from '../../../src/shared/bundle-io.js';
import { readBundlePatches } from '../../../src/shared/bundle-io/patch.js';
applyTestEnv({ testing: '1' });
const parent = path.resolve('.tmp/tasks/bundle-read-admission'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'bounded-')), filename = path.join(root, 'a.json');
try {
  const previous = { file: 'a.js', chunks: [{ start: 0, end: 1, tokens: ['before'] }] };
  const next = { file: 'a.js', chunks: [{ start: 0, end: 1, tokens: ['after'] }] };
  await writeBundleFile({ bundlePath: filename, bundle: previous });
  const bytes = (await fs.stat(filename)).size;
  assert.equal((await readBundleFile(filename, { expectedEncodedBytes: bytes })).ok, true);
  assert.equal((await readBundleFile(filename, { maxBytes: 1 })).reason, 'bundle too large');
  await assert.rejects(readBundleFile(filename, { expectedEncodedBytes: bytes + 1 }), { code: 'ERR_FILE_CHANGED' });
  await writeBundlePatch({ bundlePath: filename, previousBundle: previous, nextBundle: next });
  assert.equal((await readBundlePatches(filename, { expectedBytes: 0 })).ok, false, 'unadmitted patch bytes cannot appear during decode');
  const patched = await readBundleFile(filename);
  assert.equal(patched.ok, true); assert.deepEqual(patched.bundle.chunks[0].tokens, ['after']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readBundleFile(filename, { signal: controller.signal }), { code: 'ABORT_ERR' });
} finally { await fs.rm(root, { recursive: true, force: true }); }
