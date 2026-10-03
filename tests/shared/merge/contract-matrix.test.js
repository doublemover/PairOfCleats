#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { writeJsonLinesFile } from '../../../src/shared/json-stream/jsonl-write.js';
import { createRowSpillCollector } from '../../../src/index/build/artifacts/helpers.js';
import { createSpillSorter } from '../../../src/map/build-map/io.js';
import {
  createMergeRunManifest,
  mergeRunsWithPlanner,
  mergeSortedRuns,
  mergeSortedRunsToFile,
  readJsonlRows,
  writeJsonlRunFile,
  writeMergeRunManifest
} from '../../../src/shared/merge.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'merge-contract-matrix');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

{
  const caseRoot = path.join(tempRoot, 'stream-and-manifest');
  await fsPromises.mkdir(caseRoot, { recursive: true });
  const runA = path.join(caseRoot, 'run-a.jsonl');
  const runB = path.join(caseRoot, 'run-b.jsonl');
  const invalidRun = path.join(caseRoot, 'invalid.jsonl');
  const mergedPath = path.join(caseRoot, 'merged.jsonl');
  const manifestPath = path.join(caseRoot, 'merged.manifest.json');

  await writeJsonlRunFile(runA, [{ key: 'a', rank: 1 }, { key: 'c', rank: 3 }], { atomic: true });
  await writeJsonlRunFile(runB, [{ key: 'b', rank: 2 }, { key: 'd', rank: 4 }], { atomic: true });
  await fsPromises.writeFile(invalidRun, '{"ok":1}\n{"bad":\n', 'utf8');

  const loaded = [];
  for await (const row of readJsonlRows(runA)) {
    loaded.push(row);
  }
  assert.deepEqual(loaded, [{ key: 'a', rank: 1 }, { key: 'c', rank: 3 }]);

  await assert.rejects(
    async () => {
      for await (const _row of readJsonlRows(invalidRun)) {
        // no-op
      }
    },
    /Invalid JSONL at/
  );

  const mergedStats = await mergeSortedRunsToFile({
    runs: [runA, runB],
    outputPath: mergedPath,
    compare: (left, right) => left.rank - right.rank,
    validateComparator: true,
    atomic: true
  });
  assert.equal(mergedStats.rows, 4);

  const mergedRanks = [];
  for await (const row of readJsonlRows(mergedPath)) {
    mergedRanks.push(row.rank);
  }
  assert.deepEqual(mergedRanks, [1, 2, 3, 4]);

  const manifest = createMergeRunManifest({
    runPath: mergedPath,
    rows: mergedStats.rows,
    bytes: mergedStats.bytes,
    compareId: 'rank-asc'
  });
  await writeMergeRunManifest(manifestPath, manifest);
  const writtenManifest = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  assert.equal(writtenManifest.compareId, 'rank-asc');
  assert.equal(writtenManifest.rows, 4);
}

{
  const caseRoot = path.join(tempRoot, 'planner-and-cleanup');
  await fsPromises.mkdir(caseRoot, { recursive: true });
  const runsDir = path.join(caseRoot, 'runs');
  const mergeDir = path.join(caseRoot, 'merge');
  await fsPromises.mkdir(runsDir, { recursive: true });
  const runPaths = [];
  for (let i = 0; i < 3; i += 1) {
    const runPath = path.join(runsDir, `run-${i}.jsonl`);
    await writeJsonlRunFile(runPath, [{ token: `t${i}`, postings: [i] }], { atomic: true });
    runPaths.push(runPath);
  }

  const compareRows = (a, b) => {
    const left = String(a?.token || '');
    const right = String(b?.token || '');
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  };
  const outputPath = path.join(mergeDir, 'merged.jsonl');
  const checkpointPath = path.join(mergeDir, 'merge.checkpoint.json');
  const result = await mergeRunsWithPlanner({
    runs: runPaths,
    outputPath,
    compare: compareRows,
    tempDir: mergeDir,
    runPrefix: 'merge',
    checkpointPath,
    maxOpenRuns: 2
  });
  assert.ok(fs.existsSync(outputPath));
  assert.ok(fs.readdirSync(mergeDir).some((name) => name.includes('.run-')));
  await result.cleanup();
  const afterCleanup = fs.existsSync(mergeDir) ? fs.readdirSync(mergeDir) : [];
  assert.ok(!afterCleanup.some((name) => name.includes('.run-')));
  assert.ok(!fs.existsSync(checkpointPath));
}

{
  const caseRoot = path.join(tempRoot, 'core-and-determinism');
  await fsPromises.mkdir(caseRoot, { recursive: true });
  const runA = path.join(caseRoot, 'run-a.jsonl');
  const runB = path.join(caseRoot, 'run-b.jsonl');
  const runC = path.join(caseRoot, 'run-c.jsonl');
  await writeJsonLinesFile(runA, [{ v: 1 }, { v: 3 }, { v: 5 }], { atomic: true });
  await writeJsonLinesFile(runB, [{ v: 1 }, { v: 2 }, { v: 4 }], { atomic: true });
  await writeJsonLinesFile(runC, [{ v: 0 }, { v: 6 }], { atomic: true });

  const compare = (a, b) => a.v - b.v;
  const merged = [];
  for await (const row of mergeSortedRuns([runA, runB], { compare })) {
    merged.push(row.v);
  }
  assert.deepEqual(merged, [1, 1, 2, 3, 4, 5]);

  await assert.rejects(
    async () => {
      for await (const _row of mergeSortedRuns([runA, runB], {
        compare: () => 1,
        validateComparator: true
      })) {
        // force comparator execution
      }
    },
    /antisymmetric/i
  );

  const plannerOutputPath = path.join(caseRoot, 'planner-merged.jsonl');
  const plannerResult = await mergeRunsWithPlanner({
    runs: [runA, runB, runC],
    outputPath: plannerOutputPath,
    compare,
    tempDir: path.join(caseRoot, 'planner-runs'),
    maxOpenRuns: 2,
    runPrefix: 'core'
  });

  const outputRows = [];
  const outputText = await fsPromises.readFile(plannerOutputPath, 'utf8');
  for (const line of outputText.split('\n')) {
    if (!line.trim()) continue;
    outputRows.push(JSON.parse(line).v);
  }
  assert.deepEqual(outputRows, [0, 1, 1, 2, 3, 4, 5, 6]);
  await plannerResult.cleanup();

  const deterministicRuns = [
    path.join(caseRoot, 'det-0.jsonl'),
    path.join(caseRoot, 'det-1.jsonl'),
    path.join(caseRoot, 'det-2.jsonl')
  ];
  await writeJsonlRunFile(deterministicRuns[0], [{ token: 'a', src: 'r0-0' }, { token: 'c', src: 'r0-1' }], { atomic: true });
  await writeJsonlRunFile(deterministicRuns[1], [{ token: 'a', src: 'r1-0' }, { token: 'b', src: 'r1-1' }], { atomic: true });
  await writeJsonlRunFile(deterministicRuns[2], [{ token: 'a', src: 'r2-0' }, { token: 'd', src: 'r2-1' }], { atomic: true });

  const collect = async () => {
    const out = [];
    for await (const row of mergeSortedRuns(deterministicRuns, {
      compare: (left, right) => String(left.token).localeCompare(String(right.token))
    })) {
      out.push(row.src);
    }
    return out;
  };
  const first = await collect();
  const second = await collect();
  assert.deepEqual(first, second);
  assert.deepEqual(first, ['r0-0', 'r1-0', 'r2-0', 'r1-1', 'r0-1', 'r2-1']);
}

{
  const caseRoot = path.join(tempRoot, 'adopters');
  await fsPromises.mkdir(caseRoot, { recursive: true });
  const badCompare = () => 1;

  const collector = createRowSpillCollector({
    outDir: caseRoot,
    runPrefix: 'collector',
    compare: badCompare,
    maxBufferRows: 2,
    maxBufferBytes: 0
  });
  await collector.append({ token: 'a', postings: [0] });
  await assert.rejects(() => collector.append({ token: 'b', postings: [1] }), /Comparator is not antisymmetric/);

  const sorter = createSpillSorter({
    label: 'map-sorter',
    compare: badCompare,
    maxInMemory: 2,
    tempDir: caseRoot
  });
  await sorter.push({ id: 1 });
  await assert.rejects(() => sorter.push({ id: 2 }), /Comparator is not antisymmetric/);

  const adopterChecks = [
    'src/index/build/postings/spill.js',
    'src/index/build/artifacts/graph-relations.js',
    'src/index/build/artifacts/writers/chunk-meta/writer.js',
    'src/index/build/artifacts/writers/symbol-edges.js',
    'src/index/build/artifacts/writers/symbol-occurrences.js',
    'src/index/build/artifacts/writers/vfs-manifest.js',
    'src/map/build-map/io.js'
  ];
  for (const relPath of adopterChecks) {
    const text = await fsPromises.readFile(path.join(root, relPath), 'utf8');
    assert.ok(
      text.includes('validateComparator: true') || text.includes('compareWithAntisymmetryInvariant'),
      `${relPath} should enforce comparator contract checks`
    );
  }
}

console.log('merge contract matrix test passed');
