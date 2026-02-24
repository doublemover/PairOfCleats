#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { loadOrComputeBenchAnalysis } from '../../../tools/reports/show-throughput/analysis.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-show-throughput-build-root-'));
const cacheRoot = path.join(tempRoot, 'cache');
const buildsRoot = path.join(cacheRoot, 'builds');
const build2 = path.join(buildsRoot, 'build-2');
const build10 = path.join(buildsRoot, 'build-10');

const buildStatePayload = {
  orderingLedger: { stages: {} },
  counts: {}
};

try {
  await fs.mkdir(build2, { recursive: true });
  await fs.mkdir(build10, { recursive: true });
  await fs.writeFile(path.join(build2, 'build_state.json'), JSON.stringify(buildStatePayload), 'utf8');
  await fs.writeFile(path.join(build10, 'build_state.json'), JSON.stringify(buildStatePayload), 'utf8');

  const older = new Date(Date.now() - 60_000);
  const newer = new Date(Date.now() - 1_000);
  await fs.utimes(build2, older, older);
  await fs.utimes(build10, newer, newer);

  const payload = {
    artifacts: {
      repo: {
        cacheRoot
      }
    }
  };

  const { analysis } = loadOrComputeBenchAnalysis({
    payload,
    featureMetrics: null,
    indexingSummary: null,
    refreshJson: true,
    deepAnalysis: false
  });

  assert.ok(analysis, 'expected analysis payload to be computed');
  assert.equal(
    path.basename(analysis.buildRoot),
    'build-10',
    'expected newest build directory by mtime to be selected'
  );

  console.log('show-throughput build-root mtime selection test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
