#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'field-postings-legacy-merge-reuses-shards');
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

await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const postings = await buildPostings({
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

let toJsonCount = 0;
const makeFieldPayload = (index) => ({
  toJSON() {
    toJsonCount += 1;
    return {
      vocab: [`term_${index}`, `term_${index + 1}`],
      postings: [
        [0, 1],
        [1, 2]
      ],
      docLengths: [2, 3],
      avgDocLen: 2.5,
      totalDocs: 2
    };
  }
});

const fields = {};
for (let index = 0; index < 12; index += 1) {
  fields[`field_${String(index).padStart(2, '0')}`] = makeFieldPayload(index);
}
postings.fieldPostings = { fields };

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
  userConfig: {
    indexing: {
      scm: { provider: 'none' },
      artifacts: {
        fieldPostingsShards: true,
        fieldPostingsShardThresholdBytes: 1,
        fieldPostingsShardCount: 4,
        fieldPostingsShardMinCount: 4,
        fieldPostingsShardMaxCount: 4,
        fieldPostingsKeepLegacyJson: true,
        fieldPostingsBinaryColumnar: false
      }
    }
  },
  incrementalEnabled: false,
  fileCounts: { candidates: 0 },
  perfProfile: {
    artifactWriteThroughputBytesPerSec: 64 * 1024
  },
  indexState: {
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    counts: { files: 0, chunks: 0 },
    mode: 'code'
  },
  graphRelations: null,
  stageCheckpoints: null
});

assert.equal(toJsonCount, Object.keys(fields).length, 'expected shard mode to serialize each field payload exactly once');

const legacyPath = path.join(outDir, 'field_postings.json');
const legacyPayload = JSON.parse(await fs.readFile(legacyPath, 'utf8'));
assert.deepEqual(Object.keys(legacyPayload.fields).sort(), Object.keys(fields).sort(), 'expected legacy merged file to retain all field entries');

const legacyMetric = Array.isArray(timing.artifacts)
  ? timing.artifacts.find((entry) => entry?.path === 'field_postings.json')
  : null;
assert.ok(legacyMetric, 'expected field_postings.json timing metric');
assert.equal(legacyMetric.serializationMs, 0, 'expected legacy merge path to avoid second-pass serialization');
assert.ok(Number.isFinite(legacyMetric.phaseTimings?.computeMs), 'expected computeMs timing for shard merge');

await fs.rm(testRoot, { recursive: true, force: true });

console.log('field_postings legacy merge reuses shards test passed');
