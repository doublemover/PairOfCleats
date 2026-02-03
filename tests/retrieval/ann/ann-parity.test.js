#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireHnswLib, requireLanceDb } from '../../helpers/optional-deps.js';

await requireLanceDb({ reason: 'lancedb not available; skipping ann parity test.' });
requireHnswLib({ reason: 'hnswlib-node not available; skipping ann parity test.' });

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'ann-parity');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

function runNode(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

runNode([path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot], 'build index');
runNode(
  [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot],
  'build embeddings (code)'
);
runNode(
  [path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'prose', '--repo', repoRoot],
  'build embeddings (prose)'
);

function runSearch(backend) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'search.js'),
      'index',
      '--backend',
      'memory',
      '--ann',
      '--ann-backend',
      backend,
      '--dense-vector-mode',
      'merged',
      '--json',
      '--stats',
      '-n',
      '5',
      '--repo',
      repoRoot
    ],
    { cwd: repoRoot, env, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(`Search failed for ANN backend=${backend}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return JSON.parse(result.stdout || '{}');
}

const densePayload = runSearch('dense');
const hnswPayload = runSearch('hnsw');
const lancePayload = runSearch('lancedb');

const expectedBackend = {
  dense: 'js',
  hnsw: 'hnsw',
  lancedb: 'lancedb'
};
const ensureBackend = (payload, backend, label) => {
  const actual = payload?.stats?.annBackend;
  if (actual !== backend) {
    console.error(`Expected annBackend=${backend} for ${label}, got ${actual || 'unset'}`);
    process.exit(1);
  }
};
ensureBackend(densePayload, expectedBackend.dense, 'dense');
ensureBackend(hnswPayload, expectedBackend.hnsw, 'hnsw');
ensureBackend(lancePayload, expectedBackend.lancedb, 'lancedb');

const hitKey = (hit, index) => {
  if (hit && (hit.id || hit.id === 0)) return String(hit.id);
  if (hit && hit.file) {
    const start = hit.startLine ?? hit.start ?? 0;
    const end = hit.endLine ?? hit.end ?? 0;
    return `${hit.file}:${start}:${end}:${hit.kind || ''}:${hit.name || ''}`;
  }
  return String(index);
};

const topKeys = (payload, mode) => {
  const hits = Array.isArray(payload?.[mode]) ? payload[mode] : [];
  return hits.slice(0, 5).map((hit, index) => hitKey(hit, index));
};

const compareHits = (baseKeys, otherKeys, label) => {
  if (!baseKeys.length && !otherKeys.length) return;
  if (!baseKeys.length || !otherKeys.length) {
    console.error(`ANN parity failed for ${label}: one backend returned no hits.`);
    process.exit(1);
  }
  const otherSet = new Set(otherKeys);
  const overlap = baseKeys.filter((key) => otherSet.has(key));
  const overlapRatio = overlap.length / Math.min(baseKeys.length, otherKeys.length);
  if (baseKeys[0] !== otherKeys[0]) {
    console.error(`ANN parity failed for ${label}: top hit mismatch.`);
    process.exit(1);
  }
  if (overlapRatio < 0.6) {
    console.error(`ANN parity failed for ${label}: overlap ${overlapRatio.toFixed(2)} < 0.6.`);
    process.exit(1);
  }
};

for (const mode of ['code', 'prose']) {
  const baseKeys = topKeys(densePayload, mode);
  compareHits(baseKeys, topKeys(hnswPayload, mode), `${mode} (dense vs hnsw)`);
  compareHits(baseKeys, topKeys(lancePayload, mode), `${mode} (dense vs lancedb)`);
}

console.log('ANN parity test passed');
