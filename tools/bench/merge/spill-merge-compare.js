import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { mergeRunsWithPlanner, mergeSortedRunsToFile } from '../../../src/shared/merge.js';
import {
  buildMergeBenchRuns,
  compareRows,
  logBenchComparison,
  parseMergeBenchArgs,
  prepareMergeBenchWorkspace,
  sumFileBytes
} from './shared.js';

const runBaseline = async ({ runs, outputPath }) => {
  const heapStart = process.memoryUsage().heapUsed;
  const stats = await mergeSortedRunsToFile({
    runs,
    outputPath,
    compare: compareRows
  });
  const heapDelta = process.memoryUsage().heapUsed - heapStart;
  return {
    rows: stats.rows,
    bytes: stats.bytes,
    elapsedMs: stats.elapsedMs,
    heapDelta
  };
};

const runPlanner = async ({ runs, outputPath, maxOpenRuns, tempDir }) => {
  const heapStart = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  const result = await mergeRunsWithPlanner({
    runs,
    outputPath,
    compare: compareRows,
    tempDir,
    runPrefix: 'spill',
    maxOpenRuns
  });
  const elapsedMs = performance.now() - startedAt;
  const heapDelta = process.memoryUsage().heapUsed - heapStart;
  return {
    rows: result.stats?.rows || 0,
    bytes: result.stats?.bytes || 0,
    elapsedMs,
    heapDelta,
    cleanup: result.cleanup
  };
};

const main = async () => {
  const { runs, runSize, seed, maxOpenRuns } = parseMergeBenchArgs(process.argv.slice(2), {
    runs: 64,
    runSize: 2000,
    seed: 1337,
    maxOpenRuns: 8
  });
  const { benchRoot, runsDir } = await prepareMergeBenchWorkspace('spill-merge-compare');
  const runPaths = await buildMergeBenchRuns({ dir: runsDir, runCount: runs, runSize, seed });
  const spillBytes = await sumFileBytes(runPaths);

  const baselinePath = path.join(benchRoot, 'baseline.jsonl');
  const currentPath = path.join(benchRoot, 'current.jsonl');
  const baseline = await runBaseline({ runs: runPaths, outputPath: baselinePath });
  const current = await runPlanner({
    runs: runPaths,
    outputPath: currentPath,
    maxOpenRuns,
    tempDir: path.join(benchRoot, 'planner')
  });
  if (current.cleanup) await current.cleanup();
  logBenchComparison({ runs, runSize, spillBytes, baseline, current });
};

await main();
