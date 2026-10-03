#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getCasLeasesRoot } from '../../../src/shared/cache-cas/paths.js';
import { touchCasObject, writeCasObject } from '../../../src/shared/cache-cas/objects.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

applyTestEnv();

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'index', 'cache-gc.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-cache-gc-contract-'));
const cacheRoot = path.join(tempRoot, 'cache');
await fs.mkdir(cacheRoot, { recursive: true });

const runGc = (graceDays) => {
  const run = runNode(
    [toolPath, '--dry-run', '--json', '--cache-root', cacheRoot, '--grace-days', String(graceDays)],
    `cache gc grace-days ${graceDays}`,
    root,
    applyTestEnv({ syncProcess: false }),
    { stdio: 'pipe', allowFailure: true }
  );
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return JSON.parse(run.stdout);
};

try {
  const oldCreatedAt = '2020-01-01T00:00:00.000Z';
  const recentlyTouchedAt = Date.now();

  const recentlyAccessed = await writeCasObject({
    cacheRoot,
    content: Buffer.from('recently-accessed-object', 'utf8'),
    now: oldCreatedAt
  });
  await touchCasObject(cacheRoot, recentlyAccessed.hash, recentlyTouchedAt);
  const stale = await writeCasObject({
    cacheRoot,
    content: Buffer.from('stale-object', 'utf8'),
    now: oldCreatedAt
  });

  const accessPayload = runGc(30);
  const accessCandidates = accessPayload.candidates.map((entry) => entry.hash);
  assert.ok(accessCandidates.includes(stale.hash));
  assert.ok(!accessCandidates.includes(recentlyAccessed.hash));

  const keep = await writeCasObject({
    cacheRoot,
    content: Buffer.from('keep-object', 'utf8'),
    now: oldCreatedAt
  });
  const leased = await writeCasObject({
    cacheRoot,
    content: Buffer.from('leased-object', 'utf8'),
    now: oldCreatedAt
  });
  const prune = await writeCasObject({
    cacheRoot,
    content: Buffer.from('prune-object', 'utf8'),
    now: oldCreatedAt
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

  const manifestPayload = runGc(0);
  assert.equal(manifestPayload.mode, 'cas');
  const manifestCandidates = manifestPayload.candidates.map((entry) => entry.hash);
  const leaseHashes = manifestPayload.skippedByLease.map((entry) => entry.hash);
  assert.ok(manifestCandidates.includes(prune.hash));
  assert.ok(!manifestCandidates.includes(keep.hash));
  assert.ok(!manifestCandidates.includes(leased.hash));
  assert.ok(leaseHashes.includes(leased.hash));

  console.log('tooling cache gc contract matrix test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
