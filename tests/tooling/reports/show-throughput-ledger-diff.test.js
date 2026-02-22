#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { THROUGHPUT_LEDGER_SCHEMA_VERSION } from '../../../tools/bench/language/metrics.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const scriptPath = path.join(root, 'tools', 'reports', 'show-throughput.js');
const tmpRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'show-throughput-ledger-diff-'));
const runRoot = path.join(tmpRoot, 'workspace');
const resultsRoot = path.join(runRoot, 'benchmarks', 'results');
const languageDir = path.join(resultsRoot, 'javascript');
await fsPromises.mkdir(languageDir, { recursive: true });

const repoRoot = 'C:/repo/ub095-sample';
const writeFixture = async (fileName, { generatedAt, chunks, tokens, bytes }) => {
  await fsPromises.writeFile(
    path.join(languageDir, fileName),
    JSON.stringify({
      generatedAt,
      repo: { root: repoRoot },
      summary: {
        buildMs: { index: 100, sqlite: 120 },
        queryWallMsPerQuery: 5,
        queryWallMsPerSearch: 8,
        latencyMs: {
          memory: { mean: 1, p95: 2 },
          sqlite: { mean: 2, p95: 3 }
        }
      },
      artifacts: {
        throughput: {
          code: {
            files: 3,
            chunks,
            tokens,
            bytes,
            totalMs: 1000,
            filesPerSec: 3,
            chunksPerSec: chunks,
            tokensPerSec: tokens,
            bytesPerSec: bytes
          }
        }
      }
    }, null, 2),
    'utf8'
  );
};

await writeFixture('owner__repo-baseline.json', {
  generatedAt: '2026-02-22T00:00:00.000Z',
  chunks: 220,
  tokens: 2200,
  bytes: 22000
});
await writeFixture('owner__repo-current.json', {
  generatedAt: '2026-02-22T00:05:00.000Z',
  chunks: 110,
  tokens: 1100,
  bytes: 11000
});

const stripAnsi = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '');

const first = spawnSync(
  process.execPath,
  [scriptPath],
  { cwd: runRoot, encoding: 'utf8' }
);
assert.equal(first.status, 0, first.stderr || first.stdout);
const firstOutput = stripAnsi(first.stderr);
assert.equal(
  firstOutput.toLowerCase().includes('ledger regression'),
  true,
  'expected compact ledger regression summary in show-throughput output'
);
assert.equal(
  firstOutput.toLowerCase().includes('top throughput regressions'),
  true,
  'expected global throughput regression section'
);

const refreshed = spawnSync(
  process.execPath,
  [scriptPath, '--refresh-json'],
  { cwd: runRoot, encoding: 'utf8' }
);
assert.equal(refreshed.status, 0, refreshed.stderr || refreshed.stdout);

const refreshedPayload = JSON.parse(
  await fsPromises.readFile(path.join(languageDir, 'owner__repo-current.json'), 'utf8')
);
assert.equal(
  refreshedPayload?.artifacts?.throughputLedger?.schemaVersion,
  THROUGHPUT_LEDGER_SCHEMA_VERSION,
  'expected throughput ledger to persist into benchmark JSON during refresh mode'
);
assert.equal(
  typeof refreshedPayload?.artifacts?.throughputLedger?.runSignature,
  'string',
  'expected persisted throughput ledger run signature'
);

await fsPromises.rm(tmpRoot, { recursive: true, force: true });

console.log('show-throughput ledger diff test passed');
