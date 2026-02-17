#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCasLeasesRoot, writeCasObject } from '../../../src/shared/cache-cas.js';

applyTestEnv();

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'index', 'cache-gc.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-cache-gc-manifest-'));
const cacheRoot = path.join(tempRoot, 'cache');
await fs.mkdir(cacheRoot, { recursive: true });

const keep = await writeCasObject({
  cacheRoot,
  content: Buffer.from('keep-object', 'utf8'),
  now: '2020-01-01T00:00:00.000Z'
});
const leased = await writeCasObject({
  cacheRoot,
  content: Buffer.from('leased-object', 'utf8'),
  now: '2020-01-01T00:00:00.000Z'
});
const prune = await writeCasObject({
  cacheRoot,
  content: Buffer.from('prune-object', 'utf8'),
  now: '2020-01-01T00:00:00.000Z'
});

const workspaceManifestPath = path.join(cacheRoot, 'federation', 'ws1-test', 'workspace_manifest.json');
await fs.mkdir(path.dirname(workspaceManifestPath), { recursive: true });
await fs.writeFile(workspaceManifestPath, JSON.stringify({
  schemaVersion: 1,
  casObjects: [keep.hash]
}, null, 2), 'utf8');

const leaseRoot = getCasLeasesRoot(cacheRoot);
await fs.mkdir(leaseRoot, { recursive: true });
await fs.writeFile(path.join(leaseRoot, `${leased.hash}.json`), JSON.stringify({
  holderId: 'test-worker',
  startedAt: new Date(Date.now() - 1000).toISOString(),
  ttlMs: 60_000
}, null, 2), 'utf8');

const run = spawnSync(
  process.execPath,
  [
    toolPath,
    '--dry-run',
    '--json',
    '--cache-root',
    cacheRoot,
    '--grace-days',
    '0'
  ],
  {
    encoding: 'utf8',
    env: { ...process.env }
  }
);

assert.equal(run.status, 0, run.stderr || run.stdout);
const payload = JSON.parse(run.stdout);
assert.equal(payload.mode, 'cas');
const candidateHashes = payload.candidates.map((entry) => entry.hash);
const leaseHashes = payload.skippedByLease.map((entry) => entry.hash);

assert.ok(candidateHashes.includes(prune.hash), 'unreferenced object should be a delete candidate');
assert.ok(!candidateHashes.includes(keep.hash), 'manifest-referenced object must not be deleted');
assert.ok(!candidateHashes.includes(leased.hash), 'leased object must not be deleted');
assert.ok(leaseHashes.includes(leased.hash), 'leased object should be reported as skipped by lease');

console.log('cache gc preserves manifest-referenced objects test passed');
