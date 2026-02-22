#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'reports', 'show-throughput.js');
const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'show-throughput-filter-'));
const runRoot = path.join(tmpRoot, 'workspace');
const resultsRoot = path.join(runRoot, 'benchmarks', 'results');
await fsPromises.mkdir(path.join(resultsRoot, 'javascript'), { recursive: true });
await fsPromises.mkdir(path.join(resultsRoot, 'usr'), { recursive: true });
await fsPromises.mkdir(path.join(resultsRoot, 'logs'), { recursive: true });

const throughputFixture = {
  summary: {
    buildMs: { index: 100, sqlite: 200 },
    queryWallMsPerQuery: 10,
    queryWallMsPerSearch: 20,
    latencyMs: {
      memory: { mean: 2, p95: 4 },
      sqlite: { mean: 3, p95: 5 }
    }
  },
  artifacts: {
    throughput: {
      code: {
        files: 2,
        chunks: 12,
        tokens: 120,
        bytes: 2048,
        totalMs: 1000,
        filesPerSec: 2,
        chunksPerSec: 12,
        tokensPerSec: 120,
        bytesPerSec: 2048
      }
    }
  }
};

await fsPromises.writeFile(
  path.join(resultsRoot, 'javascript', 'fixture.json'),
  JSON.stringify(throughputFixture, null, 2)
);
await fsPromises.writeFile(
  path.join(resultsRoot, 'usr', 'fixture.json'),
  JSON.stringify(throughputFixture, null, 2)
);

const stripAnsi = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '');

const runReport = (args = []) => spawnSync(
  process.execPath,
  [scriptPath, ...args],
  { cwd: runRoot, encoding: 'utf8' }
);

const hiddenUsr = runReport();
assert.equal(hiddenUsr.status, 0, hiddenUsr.stderr || hiddenUsr.stdout);
const hiddenOutput = stripAnsi(hiddenUsr.stderr);
const hiddenLines = hiddenOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
assert.equal(hiddenLines.includes('javascript'), true, 'expected javascript folder in report output');
assert.equal(hiddenLines.includes('usr'), false, 'USR guardrail folder should be excluded by default');

const shownUsr = runReport(['--include-usr']);
assert.equal(shownUsr.status, 0, shownUsr.stderr || shownUsr.stdout);
const shownOutput = stripAnsi(shownUsr.stderr);
const shownLines = shownOutput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
assert.equal(shownLines.includes('usr'), true, 'USR guardrail folder should be included when explicitly requested');

await fsPromises.rm(tmpRoot, { recursive: true, force: true });

console.log('show-throughput ignore usr test passed');
