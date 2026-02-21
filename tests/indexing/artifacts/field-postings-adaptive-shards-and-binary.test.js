#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'field-postings-adaptive-shards-and-binary');
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

const fields = {};
for (let index = 0; index < 128; index += 1) {
  fields[`field_${String(index).padStart(3, '0')}`] = {
    vocab: ['alpha', 'beta', 'gamma'],
    postings: [
      [0, 1],
      [0, 1],
      [0, 1]
    ],
    docLengths: [3],
    avgDocLen: 3,
    totalDocs: 1
  };
}
postings.fieldPostings = { fields };

const userConfig = {
  indexing: {
    scm: { provider: 'none' },
    artifacts: {
      fieldPostingsShards: true,
      fieldPostingsShardThresholdBytes: 1,
      fieldPostingsShardCount: 4,
      fieldPostingsShardMinCount: 8,
      fieldPostingsShardMaxCount: 16,
      fieldPostingsShardTargetBytes: 8 * 1024,
      fieldPostingsShardTargetSeconds: 1,
      fieldPostingsBinaryColumnar: true,
      fieldPostingsBinaryColumnarThresholdBytes: 1
    }
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

const shardsMetaPath = path.join(outDir, 'field_postings.shards.meta.json');
const shardsMeta = JSON.parse(await fs.readFile(shardsMetaPath, 'utf8'));
assert.ok(Number.isInteger(shardsMeta.shardCount), 'expected shardCount in field_postings shards meta');
assert.ok(shardsMeta.shardCount >= 8 && shardsMeta.shardCount <= 16, 'expected adaptive shardCount bounded to 8-16');
assert.equal(shardsMeta.parts.length, shardsMeta.shardCount, 'expected shard parts length to match shardCount');

const legacyPath = path.join(outDir, 'field_postings.json');
await fs.access(legacyPath);

await fs.access(path.join(outDir, 'field_postings.binary-columnar.bin'));
await fs.access(path.join(outDir, 'field_postings.binary-columnar.offsets.bin'));
await fs.access(path.join(outDir, 'field_postings.binary-columnar.lengths.varint'));
await fs.access(path.join(outDir, 'field_postings.binary-columnar.meta.json'));

const fieldMetric = Array.isArray(timing.artifacts)
  ? timing.artifacts.find((entry) => entry?.path === 'field_postings.json')
  : null;
assert.ok(fieldMetric, 'expected field_postings.json metric entry');
assert.ok(Number.isFinite(fieldMetric.serializationMs), 'expected serializationMs metric');
assert.ok(Number.isFinite(fieldMetric.diskMs), 'expected diskMs metric');

await fs.rm(testRoot, { recursive: true, force: true });

console.log('field_postings adaptive shards and binary test passed');
