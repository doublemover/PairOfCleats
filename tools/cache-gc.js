#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { getCacheRoot, loadUserConfig, resolveRepoRoot } from './dict-utils.js';
import { isRootPath } from './path-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['dry-run', 'json'],
  string: ['max-bytes', 'max-gb', 'max-age-days', 'repo'],
  default: { 'dry-run': false, json: false }
});

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const cacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || getCacheRoot();
const gcConfig = userConfig.cache?.gc || {};

const parseNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const maxBytes = parseNumber(argv['max-bytes'])
  ?? (parseNumber(argv['max-gb']) != null ? parseNumber(argv['max-gb']) * 1024 ** 3 : null)
  ?? parseNumber(gcConfig.maxBytes)
  ?? (parseNumber(gcConfig.maxGb) != null ? parseNumber(gcConfig.maxGb) * 1024 ** 3 : null);
const maxAgeDays = parseNumber(argv['max-age-days']) ?? parseNumber(gcConfig.maxAgeDays);
const dryRun = argv['dry-run'] === true;

const repoRoot = path.join(cacheRoot, 'repos');

const sizeOfPath = async (targetPath) => {
  try {
    const stat = await fs.lstat(targetPath);
    if (stat.isSymbolicLink()) return 0;
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;
    const entries = await fs.readdir(targetPath);
    let total = 0;
    for (const entry of entries) {
      total += await sizeOfPath(path.join(targetPath, entry));
    }
    return total;
  } catch {
    return 0;
  }
};

const formatBytes = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2);
  return `${rounded} ${units[unit]}`;
};

if (!maxBytes && !maxAgeDays) {
  const message = 'No cache GC limits provided. Use --max-bytes/--max-gb or --max-age-days.';
  if (argv.json) {
    console.log(JSON.stringify({ ok: false, message }, null, 2));
  } else {
    console.log(message);
  }
  process.exit(0);
}

if (!fsSync.existsSync(repoRoot)) {
  const message = `Repo cache root not found: ${repoRoot}`;
  if (argv.json) {
    console.log(JSON.stringify({ ok: false, message }, null, 2));
  } else {
    console.log(message);
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

for (const repo of removals) {
  if (isRootPath(repo.path)) {
    console.error(`refusing to delete root path: ${repo.path}`);
    process.exit(1);
  }
  if (dryRun) continue;
  await fs.rm(repo.path, { recursive: true, force: true });
}

const hasSizeData = repos.some((repo) => Number.isFinite(repo.bytes));
const totalBytes = hasSizeData
  ? repos.reduce((sum, repo) => sum + (Number.isFinite(repo.bytes) ? repo.bytes : 0), 0)
  : null;
const freedBytes = removals.reduce((sum, repo) => sum + (Number.isFinite(repo.bytes) ? repo.bytes : 0), 0);
const payload = {
  ok: true,
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
  freedBytes
};

if (argv.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`Cache GC: ${removals.length} repo(s) removed, freed ${formatBytes(freedBytes)}.`);
  for (const repo of removals) {
    console.log(`- ${repo.id}: ${formatBytes(repo.bytes)} (${repo.reason})`);
  }
}
