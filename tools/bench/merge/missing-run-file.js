import fs from 'node:fs/promises';
import path from 'node:path';
import { mergeSortedRunsToFile, writeJsonlRunFile } from '../../../src/shared/merge.js';

const compareRows = (a, b) => {
  const left = String(a?.token || '');
  const right = String(b?.token || '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
};

const main = async () => {
  const benchRoot = path.join(process.cwd(), '.benchCache', 'missing-run-file');
  await fs.rm(benchRoot, { recursive: true, force: true });
  await fs.mkdir(benchRoot, { recursive: true });
  const runA = path.join(benchRoot, 'run-a.jsonl');
  const runB = path.join(benchRoot, 'run-b.jsonl');
  await writeJsonlRunFile(runA, [{ token: 'a', postings: [1] }], { atomic: true });
  await writeJsonlRunFile(runB, [{ token: 'b', postings: [2] }], { atomic: true });
  await fs.rm(runB, { force: true });
  const outputPath = path.join(benchRoot, 'merged.jsonl');
  let threw = false;
  try {
    await mergeSortedRunsToFile({
      runs: [runA, runB],
      outputPath,
      compare: compareRows
    });
  } catch (err) {
    threw = true;
    console.log(`[bench] missing-run error=${err?.message || err}`);
  }
  if (!threw) {
    console.error('[bench] missing-run expected failure but merge succeeded');
    process.exit(1);
  }
};

await main();
