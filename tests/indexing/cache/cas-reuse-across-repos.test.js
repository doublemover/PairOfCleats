#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  listCasObjectHashes,
  readCasMetadata,
  writeCasObject
} from '../../../src/shared/cache-cas.js';

applyTestEnv();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-cas-reuse-'));
const cacheRoot = path.join(tempRoot, 'cache');
await fs.mkdir(cacheRoot, { recursive: true });

const sharedPayload = Buffer.from('cas-object-shared-content', 'utf8');
const first = await writeCasObject({
  cacheRoot,
  content: sharedPayload,
  now: '2026-02-12T00:00:00.000Z'
});
const second = await writeCasObject({
  cacheRoot,
  content: sharedPayload,
  now: '2026-02-12T00:00:10.000Z'
});

assert.equal(first.hash, second.hash, 'same bytes should map to one CAS object');
assert.equal(first.objectPath, second.objectPath, 'CAS path should be content-addressed');
assert.equal(first.created, true, 'first write should create the object');
assert.equal(second.created, false, 'second write should reuse existing object');

const hashes = await listCasObjectHashes(cacheRoot);
assert.deepEqual(hashes, [first.hash], 'CAS should contain exactly one object for shared content');

const metadata = await readCasMetadata(cacheRoot, first.hash);
assert.equal(metadata?.hash, first.hash);
assert.equal(metadata?.size, sharedPayload.length);
assert.equal(metadata?.createdAt, '2026-02-12T00:00:00.000Z');
assert.equal(metadata?.lastAccessedAt, '2026-02-12T00:00:10.000Z');

console.log('cas reuse across repos test passed');
