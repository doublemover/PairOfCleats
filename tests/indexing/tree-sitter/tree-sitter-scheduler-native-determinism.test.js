#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runTreeSitterScheduler } from '../../../src/index/build/tree-sitter-scheduler/runner.js';
import { resolveTreeSitterSchedulerPaths } from '../../../src/index/build/tree-sitter-scheduler/paths.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const baseOutDir = path.join(root, '.testCache', 'tree-sitter-scheduler-native-determinism');

const fixtureRelPaths = [
  'tests/fixtures/tree-sitter/javascript.js',
  'tests/fixtures/baseline/src/index.ts',
  'tests/fixtures/sample/src/sample.py',
  'tests/fixtures/formats/src/config.yaml',
  'tests/fixtures/tree-sitter/rust.rs'
];

const entries = fixtureRelPaths.map((relPath) => path.join(root, ...relPath.split('/')));
for (const absPath of entries) {
  await fs.access(absPath);
}

const runtime = {
  root,
  segmentsConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: true
    }
  }
};

const normalizePlan = (plan) => ({
  schemaVersion: plan.schemaVersion,
  mode: plan.mode,
  repoRoot: path.normalize(plan.repoRoot || ''),
  jobs: plan.jobs,
  grammarKeys: plan.grammarKeys,
  requiredNativeLanguages: plan.requiredNativeLanguages,
  treeSitterConfig: plan.treeSitterConfig
});

const snapshotRun = async (tag) => {
  const outDir = path.join(baseOutDir, tag, 'index-code');
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const scheduler = await runTreeSitterScheduler({
    mode: 'code',
    runtime,
    entries,
    outDir,
    abortSignal: null,
    log: () => {}
  });

  assert.ok(scheduler?.plan, 'expected scheduler plan');
  const paths = resolveTreeSitterSchedulerPaths(outDir);
  const artifacts = {};
  for (const grammarKey of scheduler.plan.grammarKeys || []) {
    artifacts[grammarKey] = {
      jobs: await fs.readFile(paths.jobPathForGrammarKey(grammarKey), 'utf8'),
      results: await fs.readFile(paths.resultsPathForGrammarKey(grammarKey), 'utf8'),
      index: await fs.readFile(paths.resultsIndexPathForGrammarKey(grammarKey), 'utf8')
    };
  }
  const sortedIndexRows = Array.from(scheduler.index.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([virtualPath, row]) => ({
      virtualPath,
      grammarKey: row.grammarKey,
      offset: row.offset,
      bytes: row.bytes
    }));

  return {
    plan: normalizePlan(scheduler.plan),
    artifacts,
    sortedIndexRows
  };
};

const runA = await snapshotRun('run-a');
const runB = await snapshotRun('run-b');

assert.deepEqual(runB.plan, runA.plan, 'expected deterministic scheduler plan');
assert.deepEqual(runB.sortedIndexRows, runA.sortedIndexRows, 'expected deterministic scheduler index rows');
assert.deepEqual(runB.artifacts, runA.artifacts, 'expected deterministic scheduler artifacts');

console.log('tree-sitter scheduler native determinism ok');

