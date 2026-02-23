#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { applyTestEnv } from '../../helpers/test-env.js';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { loadPiecesManifest } from '../../../src/shared/artifact-io/manifest.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'artifact-write-concurrency-order');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(cacheRoot, { recursive: true });

await fs.writeFile(
  path.join(repoRoot, 'src', 'alpha.js'),
  'export function alpha(v) { return v + 1; }\n'
);
await fs.writeFile(
  path.join(repoRoot, 'src', 'beta.js'),
  'import { alpha } from "./alpha.js";\nexport function beta() { return alpha(2); }\n'
);
await fs.writeFile(
  path.join(repoRoot, 'src', 'gamma.js'),
  'export const gamma = [1, 2, 3].map((x) => x * 2);\n'
);

const buildIndexPath = path.join(root, 'build_index.js');

const runBuildAndReadManifest = (writeConcurrency) => {
  const env = applyTestEnv({
    cacheRoot,
    embeddings: 'stub',
    testConfig: {
      indexing: {
        scm: { provider: 'none' },
        artifacts: { writeConcurrency }
      }
    }
  });

  const result = spawnSync(
    process.execPath,
    [
      buildIndexPath,
      '--stub-embeddings',
      '--mode',
      'code',
      '--stage',
      'stage1',
      '--repo',
      repoRoot,
      '--scm-provider',
      'none'
    ],
    { cwd: repoRoot, env, stdio: 'inherit' }
  );
  if (result.status !== 0) {
    throw new Error(`build_index failed for writeConcurrency=${writeConcurrency}`);
  }

  const userConfig = loadUserConfig(repoRoot);
  const indexDir = getIndexDir(repoRoot, 'code', userConfig, {});
  const manifest = loadPiecesManifest(indexDir, { strict: true });
  assert.ok(Array.isArray(manifest?.pieces) && manifest.pieces.length > 0, 'expected pieces manifest entries');

  return manifest.pieces.map((entry) => ({
    path: entry.path,
    checksum: entry.checksum,
    bytes: entry.bytes
  }));
};

const NON_DETERMINISTIC_ARTIFACT_PATHS = new Set([
  '.filelists.json',
  'determinism_report.json',
  'graph_relations.meta.json',
  'index_state.json',
  'risk_interprocedural_stats.json',
  'vocab_order.json'
]);

const stableManifestSnapshot = (entries) => entries.map((entry) => (
  NON_DETERMINISTIC_ARTIFACT_PATHS.has(entry.path)
    ? { path: entry.path }
    : { path: entry.path, bytes: entry.bytes }
));

const NON_DETERMINISTIC_CHECKSUM_PATHS = NON_DETERMINISTIC_ARTIFACT_PATHS;
const stableChecksumByPath = (entries) => {
  const map = new Map();
  for (const entry of entries) {
    if (NON_DETERMINISTIC_CHECKSUM_PATHS.has(entry.path)) continue;
    map.set(entry.path, entry.checksum);
  }
  return map;
};

const singleWriterManifestFirst = runBuildAndReadManifest(1);
const parallelWriterManifestFirst = runBuildAndReadManifest(8);
const parallelWriterManifestSecond = runBuildAndReadManifest(8);

assert.deepEqual(
  stableManifestSnapshot(parallelWriterManifestFirst),
  stableManifestSnapshot(parallelWriterManifestSecond),
  'parallel-writer output ordering/size should be deterministic across identical runs'
);

assert.deepEqual(
  stableManifestSnapshot(singleWriterManifestFirst),
  stableManifestSnapshot(parallelWriterManifestFirst),
  'artifact ordering/size should remain stable across write concurrency settings'
);

assert.deepEqual(
  stableChecksumByPath(parallelWriterManifestFirst),
  stableChecksumByPath(parallelWriterManifestSecond),
  'parallel-writer checksums should be deterministic for stable artifact payloads'
);

console.log('dynamic write concurrency preserves ordering test passed');
