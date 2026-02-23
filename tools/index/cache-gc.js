#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { runWithConcurrency } from '../../src/shared/concurrency.js';
import { formatBytes, sizeOfPath } from '../../src/shared/disk-space.js';
import {
  DEFAULT_CACHE_GC_POLICY,
  DEFAULT_CAS_DESIGN_GATE,
  describeCacheLayers
} from '../../src/shared/cache.js';
import { removePathWithRetry } from '../../src/shared/io/remove-path-with-retry.js';
import {
  getCasMetaPath,
  getCasObjectPath,
  getCasObjectsRoot,
  getCasRoot,
  listCasObjectHashes,
  normalizeCasHash,
  readActiveCasLeases,
  readCasMetadata
} from '../../src/shared/cache-cas.js';
import { getEnvConfig } from '../../src/shared/env.js';
import { getCacheRoot, resolveRepoConfig } from '../shared/dict-utils.js';
import { isRootPath } from '../shared/path-utils.js';

const argv = createCli({
  scriptName: 'cache-gc',
  options: {
    apply: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    'cache-root': { type: 'string' },
    'grace-days': { type: 'number' },
    'max-deletes': { type: 'number' },
    concurrency: { type: 'number' },
    'max-bytes': { type: 'number' },
    'max-gb': { type: 'number' },
    'max-age-days': { type: 'number' },
    repo: { type: 'string' }
  }
}).parse();

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const fileExists = (targetPath) => {
  try {
    return fsSync.existsSync(targetPath);
  } catch {
    return false;
  }
};

const resolveCacheRoot = () => {
  const { userConfig } = resolveRepoConfig(argv.repo);
  const envConfig = getEnvConfig();
  return path.resolve(
    argv['cache-root']
    || userConfig.cache?.root
    || envConfig.cacheRoot
    || getCacheRoot()
  );
};

const resolveMs = (value, fallbackMs = 0) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallbackMs;
};

const runLegacyRepoGc = async ({ cacheRoot, maxBytes, maxAgeDays }) => {
  const dryRun = argv['dry-run'] === true;
  const repoRoot = path.join(cacheRoot, 'repos');

  if (!maxBytes && !maxAgeDays) {
    const message = 'No cache GC limits provided. Use --max-bytes/--max-gb or --max-age-days.';
    if (argv.json) {
      console.log(JSON.stringify({ ok: false, message }, null, 2));
    } else {
      console.error(message);
    }
    process.exit(0);
  }

  if (!fileExists(repoRoot)) {
    const message = `Repo cache root not found: ${repoRoot}`;
    if (argv.json) {
      console.log(JSON.stringify({ ok: false, message }, null, 2));
    } else {
      console.error(message);
    }
    process.exit(0);
  }

  const entries = await fs.readdir(repoRoot, { withFileTypes: true });
  const repos = [];
  const needsSizeScan = maxBytes != null;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const repoPath = path.join(repoRoot, entry.name);
    const stat = await fs.stat(repoPath);
    const repo = {
      id: entry.name,
      path: repoPath,
      bytes: null,
      mtimeMs: stat.mtimeMs
    };
    if (needsSizeScan) {
      repo.bytes = await sizeOfPath(repoPath);
    }
    repos.push(repo);
  }

  const removals = [];
  const keep = new Map(repos.map((repo) => [repo.path, repo]));

  if (maxAgeDays != null) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    for (const repo of repos) {
      if (repo.mtimeMs < cutoff) {
        removals.push({ ...repo, reason: 'age' });
        keep.delete(repo.path);
      }
    }
  }

  if (maxBytes != null) {
    let total = Array.from(keep.values()).reduce((sum, repo) => sum + repo.bytes, 0);
    if (total > maxBytes) {
      const sorted = Array.from(keep.values()).sort((a, b) => a.mtimeMs - b.mtimeMs);
      for (const repo of sorted) {
        if (total <= maxBytes) break;
        removals.push({ ...repo, reason: 'quota' });
        total -= repo.bytes;
        keep.delete(repo.path);
      }
    }
  }

  if (!needsSizeScan && removals.length) {
    for (const repo of removals) {
      if (!Number.isFinite(repo.bytes)) {
        repo.bytes = await sizeOfPath(repo.path);
      }
    }
  }

  const failedRemovals = [];
  for (const repo of removals) {
    if (isRootPath(repo.path)) {
      console.error(`refusing to delete root path: ${repo.path}`);
      process.exit(1);
    }
    if (dryRun) continue;
    const deleteResult = await removePathWithRetry(repo.path, {
      recursive: true,
      force: true,
      attempts: 20,
      baseDelayMs: 40,
      maxDelayMs: 1200
    });
    if (!deleteResult.ok) {
      failedRemovals.push({
        id: repo.id,
        path: path.resolve(repo.path),
        reason: repo.reason,
        code: deleteResult.error?.code || null,
        message: deleteResult.error?.message || 'unknown error',
        attempts: deleteResult.attempts
      });
    }
  }

  const hasSizeData = repos.some((repo) => Number.isFinite(repo.bytes));
  const totalBytes = hasSizeData
    ? repos.reduce((sum, repo) => sum + (Number.isFinite(repo.bytes) ? repo.bytes : 0), 0)
    : null;
  const freedBytes = removals.reduce((sum, repo) => sum + (Number.isFinite(repo.bytes) ? repo.bytes : 0), 0);
  const payload = {
    ok: failedRemovals.length === 0,
    mode: 'repo',
    dryRun,
    cacheRoot: path.resolve(cacheRoot),
    repoRoot: path.resolve(repoRoot),
    limits: {
      maxBytes: maxBytes ?? null,
      maxAgeDays: maxAgeDays ?? null
    },
    totals: {
      repos: repos.length,
      bytes: totalBytes
    },
    removals: removals.map((repo) => ({
      id: repo.id,
      path: path.resolve(repo.path),
      bytes: repo.bytes,
      reason: repo.reason
    })),
    failedRemovals,
    freedBytes
  };

  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.error(`Cache GC: ${removals.length} repo(s) removed, freed ${formatBytes(freedBytes)}.`);
    for (const repo of removals) {
      console.error(`- ${repo.id}: ${formatBytes(repo.bytes)} (${repo.reason})`);
    }
    if (failedRemovals.length) {
      console.error(`- failed removals: ${failedRemovals.length}`);
      for (const failure of failedRemovals) {
        const codeSuffix = failure.code ? ` (${failure.code})` : '';
        console.error(`  - ${failure.id}: ${failure.message}${codeSuffix}`);
      }
    }
  }
};

const extractHashesFromManifestValue = (value, hashes, active = new WeakSet()) => {
  if (typeof value === 'string') {
    const direct = normalizeCasHash(value);
    if (direct) hashes.add(direct);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      extractHashesFromManifestValue(entry, hashes, active);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (active.has(value)) return;
  active.add(value);
  for (const entry of Object.values(value)) {
    extractHashesFromManifestValue(entry, hashes, active);
  }
  active.delete(value);
};

const collectManifestFiles = async (cacheRoot) => {
  const manifestNames = new Set(['workspace_manifest.json', 'manifest.json', 'snapshot.json', 'diff.json']);
  const roots = [path.join(cacheRoot, 'federation'), path.join(cacheRoot, 'repos')];
  const out = [];
  for (const startRoot of roots) {
    if (!fileExists(startRoot)) continue;
    const stack = [startRoot];
    while (stack.length) {
      const current = stack.pop();
      let entries = [];
      try {
        entries = await fs.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'cas') continue;
          stack.push(fullPath);
          continue;
        }
        if (!entry.isFile()) continue;
        if (!manifestNames.has(entry.name)) continue;
        out.push(path.resolve(fullPath));
      }
    }
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
};

const collectReachableCasHashes = async (manifestPaths) => {
  const reachable = new Set();
  for (const manifestPath of manifestPaths) {
    try {
      const raw = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(raw);
      extractHashesFromManifestValue(parsed, reachable);
    } catch {}
  }
  return reachable;
};

const runCasManifestGc = async ({ cacheRoot, gcConfig }) => {
  const graceDays = parseNumber(argv['grace-days'])
    ?? parseNumber(gcConfig.graceDays)
    ?? DEFAULT_CACHE_GC_POLICY.graceDays;
  const maxDeletes = Math.max(
    1,
    Math.floor(
      parseNumber(argv['max-deletes'])
      ?? parseNumber(gcConfig.maxDeletesPerRun)
      ?? DEFAULT_CACHE_GC_POLICY.maxDeletesPerRun
    )
  );
  const deleteConcurrency = Math.max(
    1,
    Math.floor(
      parseNumber(argv.concurrency)
      ?? parseNumber(gcConfig.concurrentDeletes)
      ?? DEFAULT_CACHE_GC_POLICY.concurrentDeletes
    )
  );
  const apply = argv.apply === true && argv['dry-run'] !== true;
  const dryRun = !apply;

  const casRoot = getCasRoot(cacheRoot);
  const objectsRoot = path.resolve(getCasObjectsRoot(cacheRoot));
  const objectsRootPrefix = `${objectsRoot}${path.sep}`;
  const manifestPaths = await collectManifestFiles(cacheRoot);
  const reachableHashes = await collectReachableCasHashes(manifestPaths);
  const objectHashes = await listCasObjectHashes(cacheRoot);
  const activeLeases = await readActiveCasLeases(cacheRoot);

  const nowMs = Date.now();
  const cutoffMs = nowMs - Math.max(0, Number(graceDays)) * 24 * 60 * 60 * 1000;
  const skippedByLease = [];
  const candidates = [];
  for (const hash of objectHashes) {
    const objectPath = getCasObjectPath(cacheRoot, hash);
    let stat = null;
    try {
      stat = await fs.stat(objectPath);
    } catch {
      stat = null;
    }
    if (!stat) continue;
    const metadata = await readCasMetadata(cacheRoot, hash);
    const createdMs = resolveMs(metadata?.createdAt, stat.birthtimeMs || stat.mtimeMs || 0);
    const lastAccessedMs = resolveMs(metadata?.lastAccessedAt, stat.mtimeMs || createdMs);
    const size = Number.isFinite(Number(metadata?.size)) ? Number(metadata.size) : stat.size;
    const candidateBase = {
      hash,
      objectPath: path.resolve(objectPath),
      metadataPath: path.resolve(getCasMetaPath(cacheRoot, hash)),
      size,
      createdAt: new Date(createdMs || nowMs).toISOString(),
      lastAccessedAt: new Date(lastAccessedMs || nowMs).toISOString(),
      createdMs,
      lastAccessedMs
    };
    if (reachableHashes.has(hash)) {
      continue;
    }
    if (activeLeases.has(hash)) {
      skippedByLease.push(candidateBase);
      continue;
    }
    const newestActivityMs = Math.max(createdMs || 0, lastAccessedMs || 0);
    if (newestActivityMs > cutoffMs) {
      continue;
    }
    candidates.push(candidateBase);
  }

  candidates.sort((a, b) => (
    a.lastAccessedMs - b.lastAccessedMs
    || a.createdMs - b.createdMs
    || a.hash.localeCompare(b.hash)
  ));
  skippedByLease.sort((a, b) => a.hash.localeCompare(b.hash));

  const deletionPlan = candidates.slice(0, maxDeletes);
  const deleted = [];
  const deleteFailures = [];
  if (!dryRun && deletionPlan.length) {
    await runWithConcurrency(deletionPlan, deleteConcurrency, async (entry) => {
      const objectPathResolved = path.resolve(entry.objectPath);
      const metadataPathResolved = path.resolve(entry.metadataPath);
      if (!objectPathResolved.startsWith(objectsRootPrefix)) {
        throw new Error(`Refusing to delete object outside CAS root: ${objectPathResolved}`);
      }
      if (isRootPath(objectPathResolved) || isRootPath(metadataPathResolved)) {
        throw new Error(`Refusing to delete root path during CAS GC: ${objectPathResolved}`);
      }
      const objectDelete = await removePathWithRetry(objectPathResolved, {
        recursive: false,
        force: true,
        attempts: 20,
        baseDelayMs: 30,
        maxDelayMs: 800
      });
      if (!objectDelete.ok) {
        deleteFailures.push({
          hash: entry.hash,
          path: objectPathResolved,
          code: objectDelete.error?.code || null,
          message: objectDelete.error?.message || 'unknown error',
          attempts: objectDelete.attempts
        });
        return;
      }
      const metadataDelete = await removePathWithRetry(metadataPathResolved, {
        recursive: false,
        force: true,
        attempts: 20,
        baseDelayMs: 30,
        maxDelayMs: 800
      });
      if (!metadataDelete.ok) {
        deleteFailures.push({
          hash: entry.hash,
          path: metadataPathResolved,
          code: metadataDelete.error?.code || null,
          message: metadataDelete.error?.message || 'unknown error',
          attempts: metadataDelete.attempts
        });
        return;
      }
      deleted.push(entry.hash);
    });
    deleted.sort((a, b) => a.localeCompare(b));
    deleteFailures.sort((a, b) => (
      a.hash.localeCompare(b.hash)
      || a.path.localeCompare(b.path)
    ));
  }

  const layers = describeCacheLayers({
    cacheRoot,
    federationCacheRoot: path.join(cacheRoot, 'federation')
  });
  const payload = {
    ok: deleteFailures.length === 0,
    mode: 'cas',
    dryRun,
    cacheRoot: path.resolve(cacheRoot),
    casRoot: path.resolve(casRoot),
    designGate: DEFAULT_CAS_DESIGN_GATE,
    layers,
    limits: {
      graceDays,
      maxDeletesPerRun: maxDeletes,
      concurrentDeletes: deleteConcurrency
    },
    scans: {
      manifests: manifestPaths.length,
      objects: objectHashes.length
    },
    counts: {
      reachable: reachableHashes.size,
      candidateDeletes: candidates.length,
      skippedByLease: skippedByLease.length,
      plannedDeletes: deletionPlan.length,
      deleted: deleted.length,
      failedDeletes: deleteFailures.length
    },
    reachableSample: Array.from(reachableHashes).sort((a, b) => a.localeCompare(b)).slice(0, 20),
    candidates: deletionPlan.map((entry) => ({
      hash: entry.hash,
      path: entry.objectPath,
      size: entry.size,
      createdAt: entry.createdAt,
      lastAccessedAt: entry.lastAccessedAt
    })),
    skippedByLease: skippedByLease.map((entry) => ({
      hash: entry.hash,
      path: entry.objectPath,
      size: entry.size
    })),
    deleteFailures,
    manifests: manifestPaths
  };
  if (!dryRun) {
    payload.deleted = deleted;
  }

  if (argv.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.error(`Cache GC (${payload.mode}): ${payload.counts.plannedDeletes} object(s) planned.`);
  console.error(`- dryRun: ${String(payload.dryRun)}`);
  console.error(`- manifests scanned: ${payload.scans.manifests}`);
  console.error(`- objects scanned: ${payload.scans.objects}`);
  console.error(`- reachable: ${payload.counts.reachable}`);
  console.error(`- skipped by lease: ${payload.counts.skippedByLease}`);
  if (!payload.dryRun) {
    console.error(`- deleted: ${payload.counts.deleted}`);
    if (payload.counts.failedDeletes) {
      console.error(`- failed deletes: ${payload.counts.failedDeletes}`);
      for (const failure of payload.deleteFailures) {
        const codeSuffix = failure.code ? ` (${failure.code})` : '';
        console.error(`  - ${failure.hash}: ${failure.message}${codeSuffix}`);
      }
    }
  }
  for (const entry of payload.candidates) {
    console.error(`- candidate ${entry.hash} (${formatBytes(entry.size)})`);
  }
};

const main = async () => {
  const cacheRoot = resolveCacheRoot();
  const { userConfig } = resolveRepoConfig(argv.repo);
  const gcConfig = userConfig.cache?.gc || {};

  const maxBytes = parseNumber(argv['max-bytes'])
    ?? (parseNumber(argv['max-gb']) != null ? parseNumber(argv['max-gb']) * 1024 ** 3 : null)
    ?? parseNumber(gcConfig.maxBytes)
    ?? (parseNumber(gcConfig.maxGb) != null ? parseNumber(gcConfig.maxGb) * 1024 ** 3 : null);
  const maxAgeDays = parseNumber(argv['max-age-days']) ?? parseNumber(gcConfig.maxAgeDays);
  const useLegacyMode = maxBytes != null || maxAgeDays != null;
  if (useLegacyMode) {
    await runLegacyRepoGc({ cacheRoot, maxBytes, maxAgeDays });
    return;
  }
  await runCasManifestGc({ cacheRoot, gcConfig });
};

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
