#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { retainSemanticSource } from '../../../src/index/semantic/source-storage.js';
import { withSemanticDiskWriter } from '../../../src/index/semantic/disk-writes.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
applyTestEnv();
const base = resolveTestCachePath(process.cwd(), 'semantic-source-retention-receipts');
const root = path.join(base, 'storage'); await fs.mkdir(root, { recursive: true });
const bytes = Buffer.from('export const value = 1;'), snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace: 'fixture:retention', path: 'source.js', language: 'javascript' });
const diskAccount = createSemanticDiskAccount(1024 * 1024), source = snapshot.manifest;
const filename = path.join(root, 'semantic-sources', source.byteHash + '.utf8');
// This fixture starts with a complete ordinary file; it exercises retained
// source authority and never creates a physical link for publication.
await fs.mkdir(path.dirname(filename), { recursive: true }); await fs.writeFile(filename, bytes); diskAccount.reserve(bytes.length);
const open = fs.open, lstat = fs.lstat, metrics = {}; let reads = 0;
try {
  fs.open = async (target, ...args) => {
    const handle = await open(target, ...args);
    if (path.resolve(String(target)) === path.resolve(filename)) {
      const read = handle.read.bind(handle); handle.read = async (...input) => { const result = await read(...input); reads += result.bytesRead; return result; };
    }
    return handle;
  };
  await Promise.all(Array.from({ length: 8 }, () => retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount, metrics })));
} finally { fs.open = open; }
assert.equal(reads, bytes.length, 'same-account immutable source requests share one complete durable verification');
assert.equal(metrics.semanticRetentionVerifications, 1); assert.equal(metrics.semanticSourceReceiptHits, 7);
assert.equal(metrics.semanticRetentionBytesRead, bytes.length); assert.equal(metrics.semanticSourceSnapshotBytes, undefined);
assert.equal(diskAccount.used, bytes.length);
const controller = new AbortController();
try {
  fs.lstat = async (target, ...args) => { const result = await lstat(target, ...args); if (path.resolve(String(target)) === filename) controller.abort(); return result; };
  await assert.rejects(retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount, metrics, signal: controller.signal }), { name: 'AbortError' });
} finally { fs.lstat = lstat; }
assert.equal(metrics.semanticSourceReceiptHits, 7, 'cancellation during the cached authority probe cannot publish a receipt hit');
const retired = path.join(base, 'retired-' + Date.now());
await fs.rename(root, retired); await fs.mkdir(root);
await fs.rename(path.join(retired, 'semantic-sources'), path.join(root, 'semantic-sources'));
await retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount, metrics });
assert.equal(metrics.semanticRetentionVerifications, 2, 'a new root authority cannot reuse the old build receipt even when the file object survives');
const rawAccount = createSemanticDiskAccount(1024 * 1024), rawMetrics = {}, raw = Buffer.from(bytes);
let release; const gate = new Promise(resolve => { release = resolve; });
const holding = withSemanticDiskWriter(rawAccount, filename, () => gate);
const waiting = retainSemanticSource({ root, source, bytes: raw, diskAccount: rawAccount, metrics: rawMetrics });
raw.fill(0); release(); await holding; await waiting;
assert.equal(rawMetrics.semanticSourceSnapshotBytes, bytes.length, 'one private raw capture precedes any writer wait');
assert.equal(rawMetrics.semanticRetentionBytesRead, bytes.length, 'the queued consumer compares the original captured bytes');
const mutable = Buffer.from(bytes); mutable[0] = 0;
await assert.rejects(retainSemanticSource({ root, source, bytes: mutable, diskAccount }), /do not match/);
const before = await fs.stat(filename);
const corrupt = Buffer.from(bytes); corrupt[0] = 0; await fs.writeFile(filename, corrupt); await fs.utimes(filename, before.atime, before.mtime);
await assert.rejects(retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount }), { code: 'ERR_SEMANTIC_INTEGRITY' });
await assert.rejects(retainSemanticSource({ root, source, sourceCapability: {}, diskAccount }), /Unrecognized/);
console.log('Retained source receipts bind one bounded verification to the build root, exact captured bytes and live request.');
