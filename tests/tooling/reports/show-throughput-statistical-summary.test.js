#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-show-throughput-stats-'));

try {
  const runRoot = path.join(tempRoot, 'workspace');
  const resultsDir = path.join(runRoot, 'benchmarks', 'results', 'javascript');
  await fs.mkdir(resultsDir, { recursive: true });

  const writeFixture = async (name, {
    chunksPerSec,
    filesPerSec,
    buildIndexMs,
    buildSqliteMs,
    queryWallMsPerQuery,
    queryWallMsPerSearch,
    memoryMean,
    memoryP95,
    sqliteMean,
    sqliteP95
  }) => {
    await fs.writeFile(
      path.join(resultsDir, `${name}.json`),
      JSON.stringify({
        generatedAt: `2026-03-21T00:00:0${name === 'run1' ? 1 : name === 'run2' ? 2 : 3}.000Z`,
        repo: { root: `C:/repo/${name}` },
        summary: {
          buildMs: { index: buildIndexMs, sqlite: buildSqliteMs },
          queryWallMsPerQuery,
          queryWallMsPerSearch,
          latencyMs: {
            memory: { mean: memoryMean, p95: memoryP95 },
            sqlite: { mean: sqliteMean, p95: sqliteP95 }
          }
        },
        artifacts: {
          throughput: {
            code: {
              files: 10,
              chunks: chunksPerSec * 10,
              tokens: 1000,
              bytes: 10000,
              totalMs: 10000,
              filesPerSec,
              chunksPerSec,
              tokensPerSec: 100,
              bytesPerSec: 1000
            }
          }
        }
      }, null, 2),
      'utf8'
    );
  };

  await writeFixture('run1', {
    chunksPerSec: 10,
    filesPerSec: 2,
    buildIndexMs: 100,
    buildSqliteMs: 50,
    queryWallMsPerQuery: 10,
    queryWallMsPerSearch: 20,
    memoryMean: 2,
    memoryP95: 4,
    sqliteMean: 3,
    sqliteP95: 5
  });
  await writeFixture('run2', {
    chunksPerSec: 30,
    filesPerSec: 4,
    buildIndexMs: 300,
    buildSqliteMs: 70,
    queryWallMsPerQuery: 30,
    queryWallMsPerSearch: 40,
    memoryMean: 6,
    memoryP95: 12,
    sqliteMean: 7,
    sqliteP95: 14
  });
  await writeFixture('run3', {
    chunksPerSec: 50,
    filesPerSec: 6,
    buildIndexMs: 500,
    buildSqliteMs: 90,
    queryWallMsPerQuery: 50,
    queryWallMsPerSearch: 60,
    memoryMean: 10,
    memoryP95: 20,
    sqliteMean: 11,
    sqliteP95: 22
  });

  const result = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js')],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(String(result.stderr || '').trim(), '', 'expected overview text on stdout only');
  const output = String(result.stdout || '').replace(/\u001b\[[0-9;]*m/g, '');
  assert.equal(output.includes('Throughput'), true, output);
  assert.equal(output.includes('Mode     Chunks p50/p95'), true, output);
  assert.equal(output.includes('Code          30.0/48.0'), true, output);
  assert.equal(output.includes('Run Distributions'), true, output);
  assert.equal(output.includes('Code      Chunks/s          30.0/48.0'), true, output);
  assert.equal(output.includes('Build     Index           300ms/480ms'), true, output);
  assert.equal(output.includes('Latency   Mem mean           6ms/10ms'), true, output);
  assert.equal(output.includes('Latency   Mem run-p95       12ms/19ms'), true, output);
  assert.equal(output.includes('Top Variability'), true, output);

  console.log('show-throughput statistical summary test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
