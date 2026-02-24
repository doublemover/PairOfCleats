#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadFeatureMetricsForPayload } from '../../../tools/reports/show-throughput/load.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-show-throughput-metrics-resilience-'));
const repoRoot = path.join(tempRoot, 'repo');

try {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), '{invalid json', 'utf8');

  let threw = false;
  let metrics = null;
  try {
    metrics = loadFeatureMetricsForPayload({
      repo: { root: repoRoot },
      artifacts: { repo: { root: repoRoot } }
    });
  } catch {
    threw = true;
  }

  assert.equal(threw, false, 'expected malformed repo config to not crash feature-metrics loading');
  assert.equal(metrics, null, 'expected malformed config path to fall back to null metrics');

  console.log('show-throughput load feature metrics resilience test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
