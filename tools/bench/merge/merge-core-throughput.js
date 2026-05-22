import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { writeJsonLinesFileAsync } from '../../../src/shared/json-stream/jsonl-write.js';
import {
  mergeSortedRuns as legacyMergeSortedRuns,
  mergeSortedRunsToFile
} from '../../../src/shared/merge.js';
import {
  buildMergeBenchRuns,
  compareRows,
  logBenchComparison,
  parseMergeBenchArgs,
  prepareMergeBenchWorkspace,
  sumFileBytes
} from './shared.js';

const runBaseline = async ({ runs, outputPath }) => {
  let rows = 0;
  const iterator = (async function* () {
    for await (const row of legacyMergeSortedRuns(runs, { compare: compareRows })) {
      rows += 1;
      yield row;
    }
  })();
  const heapStart = process.memoryUsage().heapUsed;
  const startedAt = performance.now();
  await writeJsonLinesFileAsync(outputPath, iterator, { atomic: true });
  const elapsedMs = performance.now() - startedAt;
  const heapDelta = process.memoryUsage().heapUsed - heapStart;
  const bytes = (await fs.stat(outputPath)).size;
  return { rows, bytes, elapsedMs, heapDelta };
};

const runCurrent = async ({ runs, outputPath }) => {
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

const main = async () => {
  const { runs, runSize, seed } = parseMergeBenchArgs(process.argv.slice(2), {
    runs: 32,
    runSize: 2000,
    seed: 1337
  });
  const { benchRoot, runsDir } = await prepareMergeBenchWorkspace('merge-core-throughput');
  const runPaths = await buildMergeBenchRuns({ dir: runsDir, runCount: runs, runSize, seed });
  const spillBytes = await sumFileBytes(runPaths);

  const baselinePath = path.join(benchRoot, 'baseline.jsonl');
  const currentPath = path.join(benchRoot, 'current.jsonl');
  const baseline = await runBaseline({ runs: runPaths, outputPath: baselinePath });
  const current = await runCurrent({ runs: runPaths, outputPath: currentPath });
  logBenchComparison({ runs, runSize, spillBytes, baseline, current });
};

await main();
