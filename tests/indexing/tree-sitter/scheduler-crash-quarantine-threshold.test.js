#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createSchedulerCrashTracker } from '../../../src/index/build/tree-sitter-scheduler/runner/crash-tracker.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `tree-sitter-scheduler-crash-quarantine-threshold-${process.pid}-${Date.now()}`);
const outDir = path.join(tempRoot, 'index-code');
const paths = { baseDir: outDir };
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const job = {
  grammarKey: 'native:json',
  languageId: 'json',
  containerPath: 'src/config.json',
  virtualPath: '.poc-vfs/src/config.json#seg:test.txt',
  fileVersionSignature: {
    hash: 'json-crash-shape',
    size: 128,
    mtimeMs: 1234
  }
};

const tracker = createSchedulerCrashTracker({
  runtime: {
    root,
    repoCacheRoot: path.join(tempRoot, 'repo-cache'),
    buildRoot: tempRoot,
    buildId: 'tree-sitter-quarantine-threshold'
  },
  outDir,
  paths,
  groupByGrammarKey: new Map([[
    'native:json',
    {
      grammarKey: 'native:json',
      languages: ['json'],
      jobs: [job]
    }
  ]]),
  log: () => {}
});

const error = new Error('synthetic parser crash');
error.result = {
  exitCode: 0xC0000005,
  signal: null,
  stdout: '',
  stderr: ''
};

await tracker.recordFailure({
  grammarKey: 'native:json',
  stage: 'scheduler-subprocess',
  error,
  taskId: 'native:json#pool1',
  markFailed: true,
  taskGrammarKeys: ['native:json'],
  inferredFailedGrammarKeys: ['native:json'],
  failureClass: 'parser_crash',
  fallbackConsequence: 'degrade_virtual_paths'
});
await tracker.recordFailure({
  grammarKey: 'native:json',
  stage: 'scheduler-subprocess',
  error,
  taskId: 'native:json#pool1',
  markFailed: true,
  taskGrammarKeys: ['native:json'],
  inferredFailedGrammarKeys: ['native:json'],
  failureClass: 'parser_crash',
  fallbackConsequence: 'degrade_virtual_paths'
});
await tracker.waitForPersistence();

const summary = tracker.summarize();
assert.equal(summary.parserCrashSignatures, 1, 'expected one repeated crash signature');
assert.equal(summary.quarantineDecisions.length, 1, 'expected one quarantine decision');
assert.equal(summary.quarantineDecisions[0].scope, 'signature', 'expected repeated crash to escalate to signature quarantine');
assert.equal(summary.quarantineDecisions[0].occurrences, 2, 'expected repeated crash count on quarantine decision');
assert.deepEqual(summary.quarantineDecisions[0].grammarKeys, ['native:json'], 'expected grammar scope on quarantine decision');

await fs.rm(tempRoot, { recursive: true, force: true });

console.log('tree-sitter scheduler crash quarantine threshold test passed');
