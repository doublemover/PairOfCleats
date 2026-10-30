#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildCoveragePolicyReport, renderCoveragePolicyMarkdown, parseGitPathList } from '../../../tools/testing/coverage/policy.js';
import { validateTestCoveragePolicyReportArtifact } from '../../../src/contracts/validators/test-artifacts.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-coverage-unobserved-'));
try {
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  await fs.mkdir(path.join(root, 'src', 'retrieval'), { recursive: true });
  for (const name of ['covered.js', 'unobserved.js', 'deleted.js', 'excluded.js', 'info.json']) await fs.writeFile(path.join(root, 'src', 'retrieval', name), '{}');
  git(['init']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.invalid']);
  git(['add', '.']); git(['commit', '-m', 'base']); const baseRef = git(['rev-parse', 'HEAD']);
  for (const name of ['covered.js', 'unobserved.js', 'excluded.js', 'info.json']) await fs.writeFile(path.join(root, 'src', 'retrieval', name), '{"changed":true}');
  await fs.unlink(path.join(root, 'src', 'retrieval', 'deleted.js'));
  git(['add', '.']); git(['commit', '-m', 'change']); const headRef = git(['rev-parse', 'HEAD']);
  const observed = { path: 'src/retrieval/covered.js', coveredRanges: 10, totalRanges: 10 };
  const make = entries => buildCoveragePolicyReport({ root, baseRef, headRef,
    coverageArtifact: { sourceIdentityVersion: 1, sourcePlatform: process.platform,
      entries, exclusions: [{ path: 'src/retrieval/excluded.js', reason: 'fixture-declared-exclusion' }] } });
  const partial = make([observed]);
  assert.equal(partial.changedFiles.summary.coverageFraction, 1);
  assert.equal(partial.changedFiles.measurement.status, 'partial');
  const inventory = new Map(partial.changedFiles.inventory.map(row => [row.path, row]));
  assert.equal(inventory.get('src/retrieval/unobserved.js').totalRanges, null);
  assert.equal(inventory.get('src/retrieval/unobserved.js').status, 'unobserved');
  assert.equal(inventory.get('src/retrieval/deleted.js').status, 'deleted');
  assert.equal(inventory.get('src/retrieval/excluded.js').status, 'excluded');
  assert.equal(inventory.get('src/retrieval/info.json').status, 'unsupported');
  assert.match(renderCoveragePolicyMarkdown(partial), /unobserved\.js/);
  assert.equal(validateTestCoveragePolicyReportArtifact(partial).ok, true);
  const empty = make([]); assert.equal(empty.changedFiles.summary.coverageFraction, null);
  assert.equal(empty.changedFiles.measurement.measuredFiles, 0);
  const zero = make([observed, { path: 'src/retrieval/unobserved.js', coveredRanges: 0, totalRanges: 10 }]);
  assert.equal(zero.changedFiles.summary.coverageFraction, .5);
  assert.equal(zero.changedFiles.measurement.status, 'complete');
  const all = make([observed, { path: 'src/retrieval/unobserved.js', coveredRanges: 10, totalRanges: 10 }]);
  assert.equal(all.changedFiles.summary.coverageFraction, 1);
  const invalid = structuredClone(partial); invalid.changedFiles.inventory.find(row => row.status === 'unobserved').totalRanges = 0;
  assert.equal(validateTestCoveragePolicyReportArtifact(invalid).ok, false, 'unknown cannot be encoded as observed zero');
  assert.deepEqual([...parseGitPathList(' leading.js\0quote".js\0line\nname.js\0Éclair.js\0')], [' leading.js', 'quote".js', 'line\nname.js', 'Éclair.js']);
} finally { await fs.rm(root, { recursive: true, force: true }); }
