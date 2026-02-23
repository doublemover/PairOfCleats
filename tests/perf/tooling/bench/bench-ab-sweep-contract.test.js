#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../../helpers/test-env.js';

import { resolveTestCachePath } from '../../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'bench-ab-sweep-contract');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const fixtureScript = path.join(tempRoot, 'fixture.js');
await fs.writeFile(
  fixtureScript,
  [
    '#!/usr/bin/env node',
    "console.log('[bench] baseline duration=10.0ms throughput=100.0/s amount=1000');",
    "console.log('[bench] current duration=8.0ms throughput=125.0/s amount=1000');",
    "console.log('[bench] delta duration=-2.0ms (-20.0%) throughput=25.0/s (25.0%) amount=1000');",
    `console.log(JSON.stringify(${JSON.stringify({
      timings: {
        durationMs: 8,
        stages: {
          parse: { durationMs: 5 },
          infer: { durationMs: 4 },
          write: { durationMs: 3 }
        },
        artifacts: [
          { path: 'chunk_meta.json', durationMs: 4, queueDelayMs: 2 }
        ],
        scheduler: {
          trace: [
            { atMs: 1, utilization: { overall: 0.7 } },
            { atMs: 2, utilization: { overall: 0.8 } }
          ]
        }
      }
    })}));`,
    ''
  ].join('\n'),
  'utf8'
);

const scriptPath = path.join(root, 'tools', 'bench', 'ab-sweep.js');
const result = spawnSync(
  process.execPath,
  [
    scriptPath,
    '--scripts',
    fixtureScript,
    '--cpu-tokens',
    '4,6',
    '--worker-counts',
    '1,2',
    '--write-concurrency',
    '2,3'
  ],
  { cwd: root, env: process.env, encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error(result.stdout || '');
  console.error(result.stderr || '');
  process.exit(result.status ?? 1);
}

const report = JSON.parse(String(result.stdout || '{}'));
assert.equal(report.schemaVersion, 1);
assert.ok(report.matrix?.runCount >= 4, 'expected sweep matrix runs');
assert.ok(Array.isArray(report.runs) && report.runs.length === report.matrix.runCount, 'expected run rows');
assert.ok(report.recommendation?.bestRunId, 'expected recommendation output');
assert.ok(report.recommendation?.bestConfig, 'expected recommended config');
assert.equal(typeof report.recommendation.score, 'number');

console.log('bench ab sweep contract test passed');
