#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { createSemanticSourceSnapshot } from '../../../src/index/semantic/source.js';
import { retainSemanticSource } from '../../../src/index/semantic/source-storage.js';
import { createSemanticDiskAccount } from '../../../src/index/build/artifacts/writers/semantic/partition.js';
applyTestEnv();
const root = resolveTestCachePath(process.cwd(), 'semantic-source-retention-receipts'); await fs.mkdir(root, { recursive: true });
const bytes = Buffer.from('export const value = 1;'), snapshot = createSemanticSourceSnapshot({ bytes, repositoryNamespace: 'fixture:retention', path: 'source.js', language: 'javascript' });
const diskAccount = createSemanticDiskAccount(1024 * 1024), source = snapshot.manifest;
const filename = path.join(root, 'semantic-sources', source.byteHash + '.utf8');
const open = fs.open; let reads = 0;
try {
  fs.open = async (target, ...args) => {
    const handle = await open(target, ...args);
    if (path.resolve(String(target)) === path.resolve(filename)) {
      const read = handle.readFile.bind(handle); handle.readFile = async (...input) => { reads += 1; return read(...input); };
    }
    return handle;
  };
  await Promise.all(Array.from({ length: 8 }, () => retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount })));
} finally { fs.open = open; }
assert.equal(reads, 1, 'same-account immutable source requests share one complete durable verification');
assert.equal(diskAccount.used, bytes.length);
const mutable = Buffer.from(bytes); mutable[0] = 0;
await assert.rejects(retainSemanticSource({ root, source, bytes: mutable, diskAccount }), /do not match/);
const before = await fs.stat(filename);
const corrupt = Buffer.from(bytes); corrupt[0] = 0; await fs.writeFile(filename, corrupt); await fs.utimes(filename, before.atime, before.mtime);
await assert.rejects(retainSemanticSource({ root, source, sourceCapability: snapshot.sourceCapability, diskAccount }), { code: 'ERR_SEMANTIC_INTEGRITY' });
await assert.rejects(retainSemanticSource({ root, source, sourceCapability: {}, diskAccount }), /Unrecognized/);
