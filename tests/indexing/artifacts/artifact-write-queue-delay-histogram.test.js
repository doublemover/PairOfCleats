#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { getMetricsDir } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'artifact-write-queue-delay-histogram');
const outDir = path.join(testRoot, 'out');

const createState = () => ({
  chunks: [],
  scannedFilesTimes: [],
  scannedFiles: [],
  skippedFiles: [],
  totalTokens: 0,
  fileRelations: new Map(),
  fileInfoByPath: new Map(),
  fileDetailsByPath: new Map(),
  chunkUidToFile: new Map(),
  docLengths: [],
  vfsManifestRows: [],
  vfsManifestCollector: null,
  fieldTokens: [],
  importResolutionGraph: null
});

const buildEmptyPostings = () => buildPostings({
  chunks: [],
  df: new Map(),
  tokenPostings: new Map(),
  docLengths: [],
  fieldPostings: {},
  fieldDocLengths: {},
  phrasePost: new Map(),
  triPost: new Map(),
  postingsConfig: {},
  embeddingsEnabled: false,
  modelId: 'stub',
  useStubEmbeddings: true,
  log: () => {}
});

const histogramEntries = (artifacts) => (
  (Array.isArray(artifacts) ? artifacts : [])
    .filter((entry) => entry && typeof entry === 'object' && entry.queueDelayHistogram)
);

const assertQueueDelayHistogram = (entry) => {
  const queueDelayMs = Number(entry?.queueDelayMs);
  const histogram = entry?.queueDelayHistogram || {};
  assert.ok(Number.isFinite(queueDelayMs) && queueDelayMs >= 0, 'expected numeric queueDelayMs');
  assert.equal(histogram.unit, 'ms');
  assert.ok(Number.isInteger(histogram.sampleCount) && histogram.sampleCount >= 1, 'expected sampleCount >= 1');
  assert.ok(Number.isFinite(histogram.minMs) && histogram.minMs >= 0, 'expected numeric minMs');
  assert.ok(Number.isFinite(histogram.maxMs) && histogram.maxMs >= histogram.minMs, 'expected maxMs >= minMs');
  assert.ok(Number.isFinite(histogram.p50Ms) && histogram.p50Ms >= histogram.minMs, 'expected numeric p50Ms');
  assert.ok(Number.isFinite(histogram.p95Ms) && histogram.p95Ms >= histogram.p50Ms, 'expected p95Ms >= p50Ms');
  assert.equal(entry.queueDelayP50Ms, histogram.p50Ms);
  assert.equal(entry.queueDelayP95Ms, histogram.p95Ms);
  const bucketCount = Array.isArray(histogram.buckets)
    ? histogram.buckets.reduce((sum, bucket) => {
      const count = Number(bucket?.count);
      return sum + (Number.isFinite(count) ? count : 0);
    }, 0)
    : 0;
  const overflowCount = Number(histogram.overflowCount);
  const totalCount = bucketCount + (Number.isFinite(overflowCount) ? overflowCount : 0);
  assert.equal(totalCount, histogram.sampleCount, 'expected histogram buckets + overflow to match sampleCount');
  if (histogram.sampleCount === 1) {
    assert.equal(histogram.p50Ms, queueDelayMs);
    assert.equal(histogram.p95Ms, queueDelayMs);
  }
};

applyTestEnv({ testing: '1' });

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const postings = await buildEmptyPostings();
const userConfig = {
  indexing: {
    scm: { provider: 'none' }
  }
};
const timing = { start: Date.now() };

await writeIndexArtifacts({
  outDir,
  mode: 'code',
  state: createState(),
  postings,
  postingsConfig: {},
  modelId: 'stub',
  useStubEmbeddings: true,
  dictSummary: null,
  timing,
  root: testRoot,
  userConfig,
  incrementalEnabled: false,
  fileCounts: { candidates: 0 },
  perfProfile: null,
  indexState: {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    counts: { files: 0, chunks: 0 },
    mode: 'code'
  },
  graphRelations: null,
  stageCheckpoints: null
});

const inMemoryHistogramEntries = histogramEntries(timing.artifacts);
assert.ok(inMemoryHistogramEntries.length > 0, 'expected in-memory queue delay histogram metrics');
inMemoryHistogramEntries.forEach(assertQueueDelayHistogram);

const metricsPath = path.join(getMetricsDir(testRoot, userConfig), 'index-code.json');
const metrics = JSON.parse(await fs.readFile(metricsPath, 'utf8'));
const persistedHistogramEntries = histogramEntries(metrics?.timings?.artifacts);
assert.ok(persistedHistogramEntries.length > 0, 'expected queue delay histogram metrics persisted to metrics output');
persistedHistogramEntries.forEach(assertQueueDelayHistogram);

await fs.rm(testRoot, { recursive: true, force: true });

console.log('artifact write queue delay histogram test passed');
