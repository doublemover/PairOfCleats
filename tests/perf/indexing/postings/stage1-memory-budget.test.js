#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../../../helpers/test-env.js';
import { getRepoId } from '../../../../tools/shared/dict-utils.js';
import { resolveVersionedCacheRoot } from '../../../../src/shared/cache-roots.js';

const fail = (message) => {
  console.error(`stage1 memory budget test failed: ${message}`);
  process.exit(1);
};

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'stage1-memory-budget');
const repoRoot = path.join(tempRoot, 'repo');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });

const fileCount = 50;
for (let i = 0; i < fileCount; i += 1) {
  await fsPromises.writeFile(
    path.join(repoRoot, 'src', `file-${i}.js`),
    `export const value_${i} = ${i};\n`,
    'utf8'
  );
}

const bigLines = new Array(2000).fill(null).map((_, i) => `export const big_${i} = ${i};`).join('\n');
await fsPromises.writeFile(path.join(repoRoot, 'src', 'big.js'), `${bigLines}\n`, 'utf8');

const maxHeapFraction = 0.0001;

applyTestEnv({
  cacheRoot: tempRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' },
      scheduler: { enabled: false },
      embeddings: {
        enabled: false,
        mode: 'off',
        hnsw: { enabled: false },
        lancedb: { enabled: false }
      },
      treeSitter: { enabled: false },
      typeInference: false,
      typeInferenceCrossFile: false,
      riskAnalysis: false,
      riskAnalysisCrossFile: false,
      stage1: {
        postings: {
          maxPending: 16,
          maxPendingRows: 2000,
          maxPendingBytes: 1024 * 1024,
          maxHeapFraction
        }
      }
    }
  }
});

const buildIndexPath = path.join(root, 'build_index.js');
const result = spawnSync(
  process.execPath,
  [
    buildIndexPath,
    '--mode',
    'code',
    '--stage',
    'stage1',
    '--threads',
    '4',
    '--stub-embeddings',
    '--scm-provider',
    'none',
    '--repo',
    repoRoot,
    '--quiet',
    '--progress',
    'off'
  ],
  { cwd: repoRoot, env: process.env, encoding: 'utf8' }
);

if (result.status !== 0) {
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  fail('build_index failed');
}

const versioned = resolveVersionedCacheRoot(tempRoot);
const repoId = getRepoId(repoRoot);
const repoCacheRoot = path.join(versioned, 'repos', repoId);
const metricsPath = path.join(repoCacheRoot, 'metrics', 'index-code.json');
if (!fs.existsSync(metricsPath)) {
  fail(`missing metrics at ${metricsPath}`);
}

let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
} catch (err) {
  fail(`failed to parse metrics: ${err?.message || err}`);
}
const fields = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  ? (parsed.fields || parsed)
  : null;
const queueStats = fields?.queues?.postings || null;
if (!queueStats || typeof queueStats !== 'object') {
  fail('missing queues.postings metrics');
}

const actualFraction = Number(queueStats?.limits?.maxHeapFraction);
if (!Number.isFinite(actualFraction) || actualFraction <= 0) {
  fail('missing queues.postings.limits.maxHeapFraction');
}
if (Math.abs(actualFraction - maxHeapFraction) > 1e-9) {
  fail(`expected maxHeapFraction=${maxHeapFraction}, got ${actualFraction}`);
}

const heapLimit = Number(queueStats?.memory?.heapLimitBytes);
if (!Number.isFinite(heapLimit) || heapLimit <= 0) {
  fail('missing queues.postings.memory.heapLimitBytes');
}

const pressureEvents = Number(queueStats?.memory?.pressureEvents);
if (!Number.isFinite(pressureEvents) || pressureEvents <= 0) {
  fail('expected queues.postings.memory.pressureEvents to be > 0');
}

console.log('stage1 memory budget test passed');

