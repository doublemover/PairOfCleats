#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { getCasLeasesRoot } from '../../../src/shared/cache-cas/paths.js';
import { touchCasObject, writeCasObject } from '../../../src/shared/cache-cas/objects.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { cacheGc } from '../../../tools/mcp/tools/handlers/artifacts.js';
import { assertSafeCacheDeletion, CACHE_OWNER_FILE } from '../../../src/shared/cache-deletion.js';
import { resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { withGeneratedCacheMetadata } from '../../../src/shared/generated-artifact-cache.js';

applyTestEnv();

const root = process.cwd();
const toolPath = path.join(root, 'tools', 'index', 'cache-gc.js');
// Keep the lexical temp path: macOS may supply /var rather than /private/var.
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-cache-gc-contract-'));
const cacheRoot = path.join(tempRoot, 'cache');
await fs.mkdir(cacheRoot, { recursive: true });
await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
const seedDisposable = async repoCacheRoot => {
  const file = path.join(repoCacheRoot, 'tree-sitter-chunk-cache', `tree-sitter-chunk_lk1_${'a'.repeat(40)}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(withGeneratedCacheMetadata({ chunks: [] }, 'tree-sitter-chunks')));
  return file;
};

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
  if (process.platform === 'darwin') {
    // Cover both system aliases even if TMPDIR already has a canonical spelling.
    for (const aliasBase of ['/tmp', '/var/tmp']) {
      const aliasRoot = await fs.mkdtemp(path.join(aliasBase, 'pairofcleats-gc-alias-'));
      try {
        const aliasCache = path.join(aliasRoot, 'cache');
        await fs.mkdir(aliasCache);
        const missingTarget = path.join(aliasCache, 'missing', 'nested');
        assert.throws(() => assertSafeCacheDeletion(missingTarget, [aliasCache]),
          'system aliases do not waive cache ownership');
        const canonicalCache = await fs.realpath(aliasCache);
        const canonicalTarget = path.join(canonicalCache, 'missing', 'nested');
        assert.equal(assertSafeCacheDeletion(missingTarget, [aliasCache], { allowUnmarked: true }), canonicalTarget);
        await fs.writeFile(path.join(aliasCache, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
        assert.equal(assertSafeCacheDeletion(missingTarget, [aliasCache]), canonicalTarget);
        assert.equal(assertSafeCacheDeletion(missingTarget, [canonicalCache]), canonicalTarget);
        assert.equal(assertSafeCacheDeletion(canonicalTarget, [aliasCache]), canonicalTarget);
        const linkedRoot = path.join(aliasRoot, 'linked-cache');
        await fs.symlink(aliasCache, linkedRoot, 'dir');
        assert.throws(() => assertSafeCacheDeletion(path.join(linkedRoot, 'missing'), [linkedRoot]),
          'a trusted system prefix must not canonicalize a linked cache root');
      } finally {
        await fs.rm(aliasRoot, { recursive: true, force: true });
      }
    }
  }
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
  assert.equal(manifestPayload.bytes.protectedByLease, Buffer.byteLength('leased-object'));
  assert.ok(manifestPayload.bytes.planned >= Buffer.byteLength('prune-object'));
  assert.equal(manifestPayload.bytes.deleted, 0, 'preview never reports planned bytes as deleted');
  assert.ok(manifestPayload.bytes.scanned >= manifestPayload.bytes.planned + manifestPayload.bytes.protectedByLease);

  const legacyRepo = path.join(cacheRoot, 'repos', 'legacy-preview');
  await fs.mkdir(legacyRepo, { recursive: true });
  await fs.writeFile(path.join(legacyRepo, 'data'), 'preserved');
  const disposableRepo = path.join(tempRoot, 'disposable-preview-repo');
  await fs.mkdir(disposableRepo);
  const disposableCache = resolveRepoCacheRootPath(disposableRepo, { cache: { root: cacheRoot } });
  const disposableFile = await seedDisposable(disposableCache);
  await fs.utimes(disposableCache, new Date(oldCreatedAt), new Date(oldCreatedAt));
  const preview = runNode([toolPath, '--json', '--cache-root', cacheRoot, '--max-bytes', '1'],
    'legacy preview requires apply', root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe', allowFailure: true });
  assert.equal(preview.status, 0, preview.stderr);
  const legacyPayload = JSON.parse(preview.stdout);
  assert.equal(legacyPayload.dryRun, true);
  assert.equal(legacyPayload.freedBytes, 0);
  assert.equal(legacyPayload.plannedBytes, 0, 'unknown protected bytes prevent size-budget eviction accounting');
  assert.ok(legacyPayload.protectedRepos.some(entry => entry.id === 'legacy-preview'),
    'unknown noncanonical bytes are protected even in a marked cache');
  await fs.access(disposableFile);
  assert.equal(await fs.readFile(path.join(legacyRepo, 'data'), 'utf8'), 'preserved');
  const agePreview = runNode([toolPath, '--json', '--cache-root', cacheRoot, '--max-bytes', '1', '--max-age-days', '1'],
    'age admits only the proven old generated cache', root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe' });
  assert.ok(JSON.parse(agePreview.stdout).plannedBytes > 0, 'the qualified stale candidate remains eligible independently of unknown size accounting');
  const sizeRoot = path.join(tempRoot, 'complete-size-cache');
  await fs.mkdir(sizeRoot);
  await fs.writeFile(path.join(sizeRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  const sizeFile = await seedDisposable(resolveRepoCacheRootPath(disposableRepo, { cache: { root: sizeRoot } }));
  const sizePreview = runNode([toolPath, '--json', '--cache-root', sizeRoot, '--max-bytes', '1'],
    'complete inventory preserves the original positive size-budget control', root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe' });
  assert.ok(JSON.parse(sizePreview.stdout).plannedBytes > 0);
  await fs.access(sizeFile);
  await fs.mkdir(path.join(disposableCache, 'locks'), { recursive: true });
  await fs.writeFile(path.join(disposableCache, 'locks/index.lock'), JSON.stringify({ pid: process.pid }));
  const protectedPreview = runNode([toolPath, '--json', '--cache-root', cacheRoot, '--max-bytes', '1', '--max-age-days', '1'],
    'legacy active ownership is protected', root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe', allowFailure: true });
  assert.equal(protectedPreview.status, 0, protectedPreview.stderr);
  assert.ok(JSON.parse(protectedPreview.stdout).protectedRepos.some(entry => entry.id === path.basename(disposableCache)),
    'a live builder blocks the previously eligible generated-file candidate');
  assert.equal(JSON.parse(protectedPreview.stdout).removals.length, 0);

  applyTestEnv({ cacheRoot, testConfig: { cache: { root: cacheRoot } } });
  const scopedCache = resolveRepoCacheRootPath(tempRoot, { cache: { root: cacheRoot } });
  const scopedFile = await seedDisposable(scopedCache);
  await fs.utimes(scopedCache, new Date(oldCreatedAt), new Date(oldCreatedAt));
  const mcpPreview = await cacheGc({ repoPath: tempRoot, maxBytes: 1 });
  assert.equal(path.resolve(mcpPreview.cacheRoot), path.resolve(cacheRoot));
  assert.equal(mcpPreview.dryRun, true, 'omitted MCP dryRun must preview');
  await fs.writeFile(path.join(cacheRoot, CACHE_OWNER_FILE), JSON.stringify({ owner: 'pairofcleats', layoutVersion: 1 }));
  const mcpApplied = await cacheGc({ repoPath: tempRoot, maxBytes: 1, dryRun: false });
  assert.equal(mcpApplied.dryRun, false, 'explicit MCP dryRun=false applies');
  assert.deepEqual(mcpApplied.removals.map(entry => entry.id), [path.basename(scopedCache)]);
  await assert.rejects(fs.access(scopedFile), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(legacyRepo, 'data'), 'utf8'), 'preserved');
  await fs.access(prune.objectPath);
  const globalApply = runNode([toolPath, '--apply', '--json', '--cache-root', cacheRoot, '--grace-days', '0'],
    'explicit user-owned whole-cache CAS apply', root, applyTestEnv({ syncProcess: false }), { stdio: 'pipe' });
  assert.ok(JSON.parse(globalApply.stdout).deleted.includes(prune.hash), 'whole-cache CAS cleanup remains covered through its explicit CLI owner');
  await fs.access(leased.objectPath);

  console.log('tooling cache gc contract matrix test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
