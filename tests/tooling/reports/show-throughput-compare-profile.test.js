#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-show-throughput-compare-'));

const writePayload = async (resultsRoot, { chunksPerSec, buildIndexMs }) => {
  const languageRoot = path.join(resultsRoot, 'javascript');
  await fs.mkdir(languageRoot, { recursive: true });
  await fs.writeFile(
    path.join(languageRoot, 'owner__repo.json'),
    JSON.stringify({
      generatedAt: '2026-03-21T00:00:00.000Z',
      repo: { root: 'C:/repo/compare' },
      summary: {
        buildMs: { index: buildIndexMs, sqlite: 40 },
        queryWallMsPerQuery: 10,
        queryWallMsPerSearch: 20,
        latencyMs: { memory: { mean: 2, p95: 4 } }
      },
      artifacts: {
        throughput: {
          code: {
            files: 10,
            chunks: chunksPerSec * 10,
            tokens: 1000,
            bytes: 10000,
            totalMs: 10000,
            filesPerSec: 5,
            chunksPerSec,
            tokensPerSec: 100,
            bytesPerSec: 1000
          }
        }
      }
    }, null, 2),
    'utf8'
  );
  return resultsRoot;
};

try {
  const absoluteCurrentResults = await writePayload(path.join(tempRoot, 'absolute-current', 'benchmarks', 'results'), {
    chunksPerSec: 50,
    buildIndexMs: 100
  });
  const absoluteBaselineResults = await writePayload(path.join(tempRoot, 'absolute-baseline', 'benchmarks', 'results'), {
    chunksPerSec: 25,
    buildIndexMs: 200
  });

  const result = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js'),
      '--root', absoluteCurrentResults,
      '--profile', 'compare',
      '--compare', absoluteBaselineResults
    ],
    { cwd: process.cwd(), encoding: 'utf8', env: process.env }
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = String(result.stdout || '');
  assert.equal(output.includes('Compare Overview'), true, output);
  assert.equal(output.includes('javascript:'), true, output);
  assert.equal(output.includes('50.0 vs 25.0'), true, output);

  const compareFamilyRoot = path.join(tempRoot, 'family');
  const siblingCurrentResults = await writePayload(path.join(compareFamilyRoot, 'current'), {
    chunksPerSec: 60,
    buildIndexMs: 90
  });
  await writePayload(path.join(compareFamilyRoot, 'baseline'), {
    chunksPerSec: 30,
    buildIndexMs: 180
  });

  const siblingResult = spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), 'tools', 'reports', 'show-throughput.js'),
      '--root', siblingCurrentResults,
      '--profile', 'compare',
      '--compare', 'baseline'
    ],
    { cwd: process.cwd(), encoding: 'utf8', env: process.env }
  );
  assert.equal(siblingResult.status, 0, siblingResult.stderr || siblingResult.stdout);
  const siblingOutput = String(siblingResult.stdout || '');
  assert.equal(siblingOutput.includes('Compare Overview'), true, siblingOutput);
  assert.equal(siblingOutput.includes('60.0 vs 30.0'), true, siblingOutput);

  console.log('show-throughput compare profile test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
