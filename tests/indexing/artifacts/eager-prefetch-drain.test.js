#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'artifact-eager-prefetch-drain');
const outDir = path.join(testRoot, 'out');

await fsPromises.rm(testRoot, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });
applyTestEnv({ testing: '1' });

const state = {
  chunks: [],
  discoveredFiles: [],
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
};

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

let stage2WriteCalls = 0;
let stage2WriteRunning = 0;
let releaseFirstWrite = null;
const firstWriteGate = new Promise((resolve) => {
  releaseFirstWrite = resolve;
});

const scheduler = {
  schedule(queueName, tokens, fn) {
    if (typeof tokens === 'function') {
      fn = tokens;
    }
    if (queueName !== SCHEDULER_QUEUE_NAMES.stage2Write) {
      return Promise.resolve().then(() => fn());
    }
    const callNumber = ++stage2WriteCalls;
    stage2WriteRunning += 1;
    return Promise.resolve()
      .then(async () => {
        if (callNumber === 1) {
          await firstWriteGate;
        }
        return await fn();
      })
      .finally(() => {
        stage2WriteRunning = Math.max(0, stage2WriteRunning - 1);
      });
  },
  stats() {
    return {
      queues: {
        [SCHEDULER_QUEUE_NAMES.stage2Write]: {
          pending: 0,
          running: stage2WriteRunning,
          oldestWaitMs: 0,
          waitP95Ms: 0
        }
      }
    };
  }
};

const writePromise = writeIndexArtifacts({
  scheduler,
  outDir,
  mode: 'code',
  state,
  postings,
  postingsConfig: {},
  modelId: 'stub',
  useStubEmbeddings: true,
  dictSummary: null,
  timing: { start: Date.now() },
  root: testRoot,
  userConfig: { indexing: { scm: { provider: 'none' } } },
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

let settled = false;
writePromise.finally(() => {
  settled = true;
});

await new Promise((resolve) => setTimeout(resolve, 100));
assert.equal(
  settled,
  false,
  'expected writeIndexArtifacts to remain pending while an eager-started stage2 write is still running in the scheduler'
);

releaseFirstWrite();
await writePromise;

console.log('artifact eager prefetch drain test passed');
