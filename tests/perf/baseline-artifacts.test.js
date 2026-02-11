#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../tools/shared/dict-utils.js';
import { repoRoot } from '../helpers/root.js';
import { makeTempDir, rmDirRecursive } from '../helpers/temp.js';

const root = repoRoot();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'baseline');
const buildPath = path.join(root, 'build_index.js');
const cacheRoot = await makeTempDir('pairofcleats-baseline-');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub',
  PAIROFCLEATS_THREADS: '1',
  PAIROFCLEATS_BUNDLE_THREADS: '1'
};

const runBuild = () => spawnSync(
  process.execPath,
  [buildPath, '--stub-embeddings', '--repo', fixtureRoot, '--mode', 'both', '--quiet'],
  { env, encoding: 'utf8' }
);

const normalizeManifest = (raw) => {
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const pieces = Array.isArray(parsed.pieces) ? parsed.pieces : [];
  const normalizedPieces = pieces.map((piece) => ({
    type: piece.type ?? null,
    name: piece.name ?? null,
    format: piece.format ?? null,
    path: piece.path ?? null,
    count: Number.isFinite(Number(piece.count)) ? Number(piece.count) : null,
    compression: piece.compression ?? null,
    dims: Number.isFinite(Number(piece.dims)) ? Number(piece.dims) : null
  })).sort((a, b) => String(a.path).localeCompare(String(b.path)));
  return {
    schemaVersion: parsed.schemaVersion ?? null,
    pieces: normalizedPieces
  };
};

const normalizeJsonValue = (value) => {
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item));
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort((a, b) => a.localeCompare(b));
    const out = {};
    for (const key of keys) {
      out[key] = normalizeJsonValue(value[key]);
    }
    return out;
  }
  return value;
};

const normalizeChunkMeta = (raw, chunkMetaPath) => {
  if (!raw) return null;
  try {
    if (chunkMetaPath.endsWith('.jsonl')) {
      const rows = raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      return normalizeJsonValue(rows);
    }
    return normalizeJsonValue(JSON.parse(raw));
  } catch {
    return raw;
  }
};

const readArtifacts = (indexDir) => {
  const manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
  const chunkMetaJsonl = path.join(indexDir, 'chunk_meta.jsonl');
  const chunkMetaJson = path.join(indexDir, 'chunk_meta.json');
  const chunkMetaPath = fs.existsSync(chunkMetaJsonl) ? chunkMetaJsonl : chunkMetaJson;
  const manifestRaw = fs.existsSync(manifestPath) ? fs.readFileSync(manifestPath, 'utf8') : null;
  const chunkMetaRaw = fs.existsSync(chunkMetaPath) ? fs.readFileSync(chunkMetaPath, 'utf8') : null;
  return {
    manifest: normalizeManifest(manifestRaw),
    chunkMeta: normalizeChunkMeta(chunkMetaRaw, chunkMetaPath)
  };
};

const prevCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_TESTING = '1';
const userConfig = loadUserConfig(fixtureRoot);

const buildResult1 = runBuild();
if (buildResult1.status !== 0) {
  console.error('baseline determinism test failed: first build failed');
  if (buildResult1.stderr) console.error(buildResult1.stderr.trim());
  process.exit(buildResult1.status ?? 1);
}
const firstBuildRoots = {
  code: getIndexDir(fixtureRoot, 'code', userConfig),
  prose: getIndexDir(fixtureRoot, 'prose', userConfig)
};

const buildResult2 = runBuild();
if (buildResult2.status !== 0) {
  console.error('baseline determinism test failed: second build failed');
  if (buildResult2.stderr) console.error(buildResult2.stderr.trim());
  process.exit(buildResult2.status ?? 1);
}
const secondBuildRoots = {
  code: getIndexDir(fixtureRoot, 'code', userConfig),
  prose: getIndexDir(fixtureRoot, 'prose', userConfig)
};

if (prevCacheRoot === undefined) {
  delete process.env.PAIROFCLEATS_CACHE_ROOT;
} else {
  process.env.PAIROFCLEATS_CACHE_ROOT = prevCacheRoot;
}

const firstArtifacts = {
  code: readArtifacts(firstBuildRoots.code),
  prose: readArtifacts(firstBuildRoots.prose)
};
const secondArtifacts = {
  code: readArtifacts(secondBuildRoots.code),
  prose: readArtifacts(secondBuildRoots.prose)
};

const compareArtifacts = (label, first, second) => {
  for (const [name, content] of Object.entries(first)) {
    const next = second[name];
    if (content === null || next === null) {
      console.error(`baseline determinism test missing artifact: ${label}/${name}`);
      process.exit(1);
    }
    const left = typeof content === 'string' ? content : JSON.stringify(content);
    const right = typeof next === 'string' ? next : JSON.stringify(next);
    if (left !== right) {
      console.error(`baseline determinism test mismatch in ${label}: ${name}`);
      process.exit(1);
    }
  }
};

compareArtifacts('code', firstArtifacts.code, secondArtifacts.code);
compareArtifacts('prose', firstArtifacts.prose, secondArtifacts.prose);

await rmDirRecursive(cacheRoot);
console.log('baseline determinism test passed');
