#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { createCrashLogger } from '../../../src/index/build/crash-log.js';
import { runTreeSitterScheduler } from '../../../src/index/build/tree-sitter-scheduler/runner.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { createTreeSitterProcessFileCpuFixture } from '../file-processor/tree-sitter-process-file-cpu-fixture.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'tree-sitter-scheduler-crash-fallback');
const outDir = path.join(tempRoot, 'index-code');
const repoCacheRoot = path.join(tempRoot, 'repo-cache');
const perlAbs = path.join(root, 'tests', 'fixtures', 'languages', 'src', 'perl_advanced.pl');
const perlSiblingAbs = path.join(tempRoot, 'perl_sibling.pl');
const jsAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await fs.mkdir(repoCacheRoot, { recursive: true });
await fs.copyFile(perlAbs, perlSiblingAbs);

const runtime = {
  root,
  repoCacheRoot,
  buildRoot: tempRoot,
  buildId: 'ub001-tree-sitter-crash',
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

try {
  let scheduler = null;
  let schedulerError = null;
  let skippedForMissingGrammar = false;
  await withTemporaryEnv({ PAIROFCLEATS_TEST_TREE_SITTER_SCHEDULER_CRASH: 'perl' }, async () => {
    try {
      scheduler = await runTreeSitterScheduler({
        mode: 'code',
        runtime,
        entries: [perlAbs, perlSiblingAbs, jsAbs],
        outDir,
        abortSignal: null,
        log: () => {},
        crashLogger
      });
    } catch (err) {
      schedulerError = err;
    }
  });
  if (schedulerError) {
    const message = schedulerError?.message || String(schedulerError);
    if (/\bgrammar preflight failed unavailable=/.test(message)) {
      skippedForMissingGrammar = true;
    } else {
      throw schedulerError;
    }
  }
  if (skippedForMissingGrammar) {
    console.log('tree-sitter scheduler crash fallback skipped (native grammars unavailable)');
  } else {
    assert.ok(scheduler, 'expected scheduler result');
    assert.ok(scheduler.index instanceof Map, 'expected scheduler index map');
    assert.ok(
      scheduler.index.size > 0,
      'expected scheduler to continue processing unaffected files after injected parser crash'
    );
    const schedulerStats = scheduler.stats();
    assert.ok(
      Number(schedulerStats?.parserCrashSignatures) >= 1,
      'expected parser crash signature to be recorded'
    );
    assert.ok(
      Number(schedulerStats?.degradedVirtualPaths) >= 1,
      'expected degraded virtual paths to be tracked'
    );
    assert.ok(
      typeof scheduler?.isDegradedVirtualPath === 'function',
      'expected degraded virtual path checker'
    );
    const crashSummary = scheduler.getCrashSummary();
    assert.equal(
      crashSummary.failureClasses?.parser_crash,
      1,
      'expected parser crash classification count in crash summary'
    );
    const degradedPerlVirtualPaths = crashSummary.degradedVirtualPaths.filter((virtualPath) => (
      virtualPath.includes('perl_advanced.pl') || virtualPath.includes('perl_sibling.pl')
    ));
    assert.ok(degradedPerlVirtualPaths.length >= 1, 'expected a failed perl virtual path to be marked degraded');
    assert.ok(
      degradedPerlVirtualPaths.length <= 1,
      `expected per-file degradation containment; got ${degradedPerlVirtualPaths.length} perl paths`
    );
    assert.ok(Array.isArray(crashSummary.quarantineDecisions), 'expected quarantine decisions in crash summary');
    assert.ok(crashSummary.quarantineDecisions.length >= 1, 'expected at least one quarantine decision');
    assert.equal(
      crashSummary.quarantineDecisions[0].scope,
      'virtual_path',
      'expected first isolated crash to quarantine exact virtual paths'
    );
    await fs.access(scheduler.crashForensicsBundlePath);
    await fs.access(scheduler.plannerFailureSnapshotPath);
    await fs.access(path.join(repoCacheRoot, 'logs', 'index-crash-forensics-index.json'));
    const plannerSnapshot = JSON.parse(await fs.readFile(scheduler.plannerFailureSnapshotPath, 'utf8'));
    assert.ok(
      Array.isArray(plannerSnapshot?.scheduledJobs) && plannerSnapshot.scheduledJobs.length > 0,
      'expected planner snapshot to capture scheduled jobs for degraded run'
    );
    assert.equal(
      plannerSnapshot?.failureSummary?.failureClasses?.parser_crash,
      1,
      'expected planner snapshot failure classes'
    );
    assert.ok(
      Array.isArray(plannerSnapshot?.failureSummary?.quarantineDecisions)
      && plannerSnapshot.failureSummary.quarantineDecisions.length >= 1,
      'expected planner snapshot quarantine decisions'
    );

    const schedulerNoLoad = {
      ...scheduler,
      loadChunks: async () => {
        throw new Error('scheduler loadChunks should not run for degraded virtual paths');
      },
      loadChunksBatch: async () => {
        throw new Error('scheduler loadChunksBatch should not run for degraded virtual paths');
      }
    };
    const { createContext } = await createTreeSitterProcessFileCpuFixture({
      fileHash: 'tree-sitter-crash-fallback',
      fixtureParts: ['tests', 'fixtures', 'languages', 'src', 'perl_advanced.pl']
    });

    const cpuResult = await processFileCpu(createContext({
      languageOptions: {
        treeSitter: {
          enabled: true,
          strict: true
        }
      },
      treeSitterScheduler: schedulerNoLoad,
      crashLogger
    }));

    assert.ok(Array.isArray(cpuResult?.chunks) && cpuResult.chunks.length > 0, 'expected fallback chunks');
    assert.equal(cpuResult?.skip, null, 'expected no skip despite injected parser crash');
  }
} finally {
  await crashLogger.close?.();
}

console.log('tree-sitter scheduler crash fallback ok');
