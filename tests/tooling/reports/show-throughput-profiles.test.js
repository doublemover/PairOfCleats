#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-show-throughput-profiles-'));

const writePayload = async (resultsRoot, folder, file, repoRoot, { chunksPerSec, filesPerSec, buildIndexMs, queryMs }) => {
  const dir = path.join(resultsRoot, folder);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, `${file}.json`),
    JSON.stringify({
      generatedAt: '2026-03-21T00:00:00.000Z',
      repo: { root: repoRoot },
      summary: {
        buildMs: { index: buildIndexMs, sqlite: 40 },
        queryWallMsPerQuery: queryMs,
        queryWallMsPerSearch: queryMs + 10,
        latencyMs: {
          memory: { mean: queryMs, p95: queryMs + 5 }
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

try {
  const runRoot = path.join(tempRoot, 'workspace');
  const resultsRoot = path.join(runRoot, 'benchmarks', 'results');
  await writePayload(resultsRoot, 'javascript', 'owner__fast', 'C:/repo/fast', {
    chunksPerSec: 50,
    filesPerSec: 5,
    buildIndexMs: 100,
    queryMs: 12
  });
  await writePayload(resultsRoot, 'python', 'owner__slow', 'C:/repo/slow', {
    chunksPerSec: 10,
    filesPerSec: 1,
    buildIndexMs: 500,
    queryMs: 45
  });

  const overview = spawnSync(
    process.execPath,
    [path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js')],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );
  assert.equal(overview.status, 0, overview.stderr || overview.stdout);
  const overviewText = String(overview.stderr || '').replace(/\u001b\[[0-9;]*m/g, '');
  assert.equal(overviewText.includes('Throughput Totals'), true, overviewText);
  assert.equal(overviewText.includes('Scan Outcome Totals'), true, overviewText);

  const family = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js'),
      '--profile', 'family',
      '--sort', 'build',
      '--top', '1'
    ],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );
  assert.equal(family.status, 0, family.stderr || family.stdout);
  assert.equal(String(family.stdout).includes('Family Overview'), true, family.stdout);
  assert.equal(String(family.stdout).includes('python:'), true, family.stdout);

  const repo = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js'),
      '--profile', 'repo',
      '--repo', 'fast'
    ],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );
  assert.equal(repo.status, 0, repo.stderr || repo.stdout);
  assert.equal(String(repo.stdout).includes('Repo Overview'), true, repo.stdout);
  assert.equal(String(repo.stdout).includes('javascript/fast'), true, repo.stdout);

  const raw = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js'),
      '--profile', 'raw',
      '--json',
      '--folder', 'javascript'
    ],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );
  assert.equal(raw.status, 0, raw.stderr || raw.stdout);
  const rawPayload = JSON.parse(String(raw.stdout || '{}'));
  assert.equal(rawPayload.profile, 'raw');
  assert.equal(rawPayload.folders.length, 1);
  assert.equal(rawPayload.folders[0].folder, 'javascript');

  const csv = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js'),
      '--profile', 'family',
      '--csv',
      '--top', '1'
    ],
    { cwd: runRoot, encoding: 'utf8', env: process.env }
  );
  assert.equal(csv.status, 0, csv.stderr || csv.stdout);
  assert.equal(String(csv.stdout).split(/\r?\n/)[0].includes('folder,label,runs'), true, csv.stdout);

  console.log('show-throughput profiles test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
