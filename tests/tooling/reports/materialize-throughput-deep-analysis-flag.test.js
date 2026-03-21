#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-materialize-throughput-deep-analysis-'));

try {
  const runRoot = path.join(tempRoot, 'workspace');
  const resultsDir = path.join(runRoot, 'benchmarks', 'results', 'javascript');
  await fs.mkdir(resultsDir, { recursive: true });
  await fs.writeFile(
    path.join(resultsDir, 'fixture.json'),
    JSON.stringify({
      generatedAt: '2026-03-21T00:00:00.000Z',
      repo: { root: 'C:/repo/materialize-flag' },
      summary: {
        buildMs: { index: 10, sqlite: 5 },
        queryWallMsPerQuery: 1,
        queryWallMsPerSearch: 1
      },
      artifacts: {
        throughput: {
          code: {
            files: 1,
            chunks: 1,
            tokens: 1,
            bytes: 1,
            totalMs: 1000
          }
        }
      }
    }, null, 2),
    'utf8'
  );

  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'tools', 'reports', 'materialize-throughput.js'),
      '--deep-analysis'
    ],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = String(result.stderr || '').replace(/\u001b\[[0-9;]*m/g, '');
  assert.equal(output.includes('Deep analysis: enabled'), true, output);

  console.log('materialize throughput deep analysis flag test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
