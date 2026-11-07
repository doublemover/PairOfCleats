#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadFeatureMetricsForPayload } from '../../../tools/reports/show-throughput/load.js';
import { writeRecordedFeatureSnapshot } from '../../helpers/throughput-recorded-source.js';

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

  const reportA = await writeRecordedFeatureSnapshot(cacheRootA, { source: 'a', totals: { lines: 11 } });
  const reportB = await writeRecordedFeatureSnapshot(cacheRootB, { source: 'b', totals: { lines: 22 } });
  for (const [report, cacheRoot] of [[reportA, cacheRootA], [reportB, cacheRootB]]) {
    report.repo = { root: repoRoot }; report.artifacts.repo = { root: repoRoot, cacheRoot };
  }
  const metricsA = loadFeatureMetricsForPayload(reportA, { sourceRoot: cacheRootA });
  const metricsB = loadFeatureMetricsForPayload(reportB, { sourceRoot: cacheRootB });

  assert.equal(loadFeatureMetricsForPayload({ repo: { root: repoRoot }, artifacts: { repo: { cacheRoot: cacheRootA } } }), null, 'historical reports require an attempt-qualified source');
  assert.equal(metricsA?.source, 'a', 'expected cacheRoot A metrics payload');
  assert.equal(metricsB?.source, 'b', 'expected cacheRoot B metrics payload');
  assert.equal(loadFeatureMetricsForPayload(reportA, { sourceRoot: cacheRootB }), null, 'same relative name cannot cross the supplied source root and digest');

  console.log('show-throughput feature metrics cache-root key test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
