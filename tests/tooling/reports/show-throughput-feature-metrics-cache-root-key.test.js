#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadFeatureMetricsForPayload } from '../../../tools/reports/show-throughput/load.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-show-throughput-metrics-cache-root-'));
const repoRoot = path.join(tempRoot, 'repo');
const cacheRootA = path.join(tempRoot, 'cache-a');
const cacheRootB = path.join(tempRoot, 'cache-b');

try {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.mkdir(path.join(cacheRootA, 'metrics'), { recursive: true });
  await fs.mkdir(path.join(cacheRootB, 'metrics'), { recursive: true });

  await fs.writeFile(
    path.join(cacheRootA, 'metrics', 'feature-metrics-run.json'),
    JSON.stringify({ source: 'a', totals: { lines: 11 } }),
    'utf8'
  );
  await fs.writeFile(
    path.join(cacheRootB, 'metrics', 'feature-metrics-run.json'),
    JSON.stringify({ source: 'b', totals: { lines: 22 } }),
    'utf8'
  );

  const metricsA = loadFeatureMetricsForPayload({
    repo: { root: repoRoot },
    artifacts: { repo: { root: repoRoot, cacheRoot: cacheRootA } }
  });
  const metricsB = loadFeatureMetricsForPayload({
    repo: { root: repoRoot },
    artifacts: { repo: { root: repoRoot, cacheRoot: cacheRootB } }
  });

  assert.equal(metricsA?.source, 'a', 'expected cacheRoot A metrics payload');
  assert.equal(metricsB?.source, 'b', 'expected cacheRoot B metrics payload');

  console.log('show-throughput feature metrics cache-root key test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
