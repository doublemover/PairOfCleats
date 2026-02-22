#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { runTreeSitterScheduler } from '../../../src/index/build/tree-sitter-scheduler/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'perl-scheduler-crash-recovery');
const outDir = path.join(tempRoot, 'index-code');
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const perlAbs = path.join(root, 'tests', 'fixtures', 'languages', 'src', 'perl_advanced.pl');
const jsAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(repoCacheRoot, { recursive: true });

const runtime = {
  root,
  repoCacheRoot,
  buildRoot: tempRoot,
  buildId: 'ub001-perl-crash-recovery',
  segmentsConfig: null,
  languageOptions: {
    treeSitter: {
      enabled: true,
      strict: true
    }
  }
};
const crashLogger = await createCrashLogger({
  repoCacheRoot,
  enabled: true
});

const previousCrashInjection = process.env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH;
process.env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH = 'perl';
let scheduler = null;
try {
  scheduler = await runTreeSitterScheduler({
    mode: 'code',
    runtime,
    entries: [perlAbs, jsAbs],
    outDir,
    abortSignal: null,
    log: () => {},
    crashLogger
  });
} finally {
  if (previousCrashInjection === undefined) {
    delete process.env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH;
  } else {
    process.env.PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH = previousCrashInjection;
  }
}

assert.ok(scheduler, 'expected scheduler object');
assert.ok(scheduler.index instanceof Map, 'expected scheduler index map');
assert.ok(
  scheduler.index.size > 0,
  'expected repo to continue indexing unaffected files after injected perl parser crash'
);
const stats = scheduler.stats();
assert.ok(
  Number(stats?.parserCrashSignatures) >= 1,
  'expected parser crash signature marker in scheduler stats'
);
assert.ok(
  Number(stats?.degradedVirtualPaths) >= 1,
  'expected degraded path count in scheduler stats'
);
const crashSummary = scheduler.getCrashSummary();
assert.ok(Array.isArray(crashSummary?.parserCrashEvents), 'expected parser crash events array');
assert.ok(crashSummary.parserCrashEvents.length >= 1, 'expected at least one parser crash event');

await fs.access(scheduler.crashForensicsBundlePath);
await fs.access(path.join(repoCacheRoot, 'logs', 'index-crash-forensics-index.json'));
const durableCrashPath = scheduler.durableCrashForensicsBundlePath;
if (durableCrashPath) {
  await fs.access(durableCrashPath);
}

console.log('perl scheduler crash recovery ok');
