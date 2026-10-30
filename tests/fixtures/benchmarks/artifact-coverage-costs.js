import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { collectV8CoverageEntries, buildCoverageArtifact, mergeCoverageEntries } from '../../../tools/testing/coverage/index.js';
import { observeHeapAllocations } from '../../helpers/heap-sampling.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sampleCosts = async (operation, verify) => {
  const samples = [];
  for (let iteration = 0; iteration < 4; iteration++) {
    const cpu = process.cpuUsage(), start = performance.now();
    const result = await operation();
    const wallMs = performance.now() - start, used = process.cpuUsage(cpu);
    verify(result);
    samples.push({ wallMs, cpuUserMicros: used.user, cpuSystemMicros: used.system });
  }
  return { iterations: 4, samples, scope: 'same-process CPU;wall includes awaited IO;assertions excluded;uninstrumented' };
};

export const runScenario = async ({ destination }) => {
  const fixture = path.join(destination, 'coverage-input'); await fs.mkdir(fixture);
  const observations = [];
  try {
    for (const [shape, sources, rangesPerSource] of [['small', 8, 4], ['many', 256, 8]]) {
      const root = path.join(fixture, shape), coverageDir = path.join(root, 'saved-coverage');
      await fs.mkdir(coverageDir, { recursive: true }); await fs.mkdir(path.join(root, 'src'));
      const result = [], expected = [];
      for (let id = 0; id < sources; id++) {
        // These physical names and file URLs are valid on the actual host.
        const label = `src/source-${String(id).padStart(4, '0')} é #.js`;
        await fs.writeFile(path.join(root, label), 'export const value = 1;\n');
        const ranges = Array.from({ length: rangesPerSource }, (_, index) =>
          ({ startOffset: index * 2, endOffset: index * 2 + 1, count: id % 2 === 0 ? 1 : 0 }));
        const url = pathToFileURL(path.join(root, label)).href;
        result.push({ url, functions: [{ ranges }] });
        result.push({ url, functions: [{ ranges: ranges.map(range => ({ ...range, count: 0 })) }] });
        expected.push({ path: label, coveredRanges: id % 2 === 0 ? rangesPerSource : 0, totalRanges: rangesPerSource });
      }
      const bytes = Buffer.from(JSON.stringify({ result })), filename = path.join(coverageDir, 'saved-v8.json');
      await fs.writeFile(filename, bytes);
      const entries = await collectV8CoverageEntries({ root, coverageDir });
      assert.deepEqual(entries, expected, 'independent exact labels, zero hits and raw OR cardinality');
      const artifact = buildCoverageArtifact({ runId: shape, entries });
      const roundTrip = JSON.parse(JSON.stringify(artifact));
      const merged = mergeCoverageEntries([artifact, roundTrip]);
      const expectedMerged = expected.map(row => ({ ...row, coveredRanges: row.coveredRanges * 2, totalRanges: row.totalRanges * 2 }));
      assert.deepEqual(merged, expectedMerged);
      const collect = () => collectV8CoverageEntries({ root, coverageDir });
      const merge = () => mergeCoverageEntries([artifact, roundTrip]);
      const runPipeline = async () => {
        const current = buildCoverageArtifact({ runId: 'measured', entries: await collect() });
        return mergeCoverageEntries([current, current]);
      };
      const cleanCosts = {
        collector: await sampleCosts(collect, rows => assert.deepEqual(rows, expected)),
        summaryMerge: await sampleCosts(merge, rows => assert.deepEqual(rows, expectedMerged)),
        pipeline: await sampleCosts(runPipeline, rows => assert.deepEqual(rows, expectedMerged))
      };
      const collector = await observeHeapAllocations({ destination, name: `coverage-${shape}-collector`, iterations: 4,
        operation: collect });
      const summaryMerge = await observeHeapAllocations({ destination, name: `coverage-${shape}-merge`, iterations: 16,
        operation: merge });
      const pipeline = await observeHeapAllocations({ destination, name: `coverage-${shape}-pipeline`, iterations: 4,
        operation: runPipeline });
      assert.equal(sha256(await fs.readFile(filename)), sha256(bytes), 'all collector trials use identical saved bytes');
      observations.push({ shape, inputIdentity: { sha256: sha256(bytes), bytes: bytes.length },
        raw: { scriptRows: result.length, functionRows: result.length, rangeRows: sources * rangesPerSource * 2 },
        collected: { sources, totalRanges: sources * rangesPerSource, coveredRanges: sources * rangesPerSource / 2 },
        additiveSummaryRuns: 2, cleanCosts, collector, summaryMerge, pipeline });
    }
    return { issue: 1767, platform: process.platform,
      physicalLiteralBackslashQualification: process.platform === 'win32' ? 'external-POSIX-required' : 'separate-physical-consumer-fixture',
      claim: 'identical saved V8-shaped bytes through original collector/merge;local costs only', observations };
  } finally { await fs.rm(fixture, { recursive: true, force: true }); }
};
