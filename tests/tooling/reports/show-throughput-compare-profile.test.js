#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createShowThroughputTempRoot,
  runShowThroughputReport,
  writeShowThroughputPayload
} from './show-throughput-report-fixture.js';

const tempRoot = await createShowThroughputTempRoot('poc-show-throughput-compare-');

try {
  const absoluteCurrentResults = await writeShowThroughputPayload(path.join(tempRoot, 'absolute-current', 'benchmarks', 'results'), {
    folder: 'javascript',
    repoName: 'owner__repo',
    repoRoot: 'C:/repo/compare',
    chunksPerSec: 50,
    buildIndexMs: 100
  });
  const absoluteBaselineResults = await writeShowThroughputPayload(path.join(tempRoot, 'absolute-baseline', 'benchmarks', 'results'), {
    folder: 'javascript',
    repoName: 'owner__repo',
    repoRoot: 'C:/repo/compare',
    chunksPerSec: 25,
    buildIndexMs: 200
  });

  const result = runShowThroughputReport([
    '--root', absoluteCurrentResults,
    '--profile', 'compare',
    '--compare', absoluteBaselineResults
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = String(result.stdout || '');
  assert.equal(output.includes('Compare Overview'), true, output);
  assert.equal(output.includes('javascript:'), true, output);
  assert.equal(output.includes('50.0 vs 25.0'), true, output);

  const compareFamilyRoot = path.join(tempRoot, 'family');
  const siblingCurrentResults = await writeShowThroughputPayload(path.join(compareFamilyRoot, 'current'), {
    folder: 'javascript',
    repoName: 'owner__repo',
    repoRoot: 'C:/repo/compare',
    chunksPerSec: 60,
    buildIndexMs: 90
  });
  await writeShowThroughputPayload(path.join(compareFamilyRoot, 'baseline'), {
    folder: 'javascript',
    repoName: 'owner__repo',
    repoRoot: 'C:/repo/compare',
    chunksPerSec: 30,
    buildIndexMs: 180
  });

  const siblingResult = runShowThroughputReport([
    '--root', siblingCurrentResults,
    '--profile', 'compare',
    '--compare', 'baseline'
  ]);
  assert.equal(siblingResult.status, 0, siblingResult.stderr || siblingResult.stdout);
  const siblingOutput = String(siblingResult.stdout || '');
  assert.equal(siblingOutput.includes('Compare Overview'), true, siblingOutput);
  assert.equal(siblingOutput.includes('60.0 vs 30.0'), true, siblingOutput);

  console.log('show-throughput compare profile test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
