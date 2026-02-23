#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { setProgressHandlers } from '../../../src/shared/progress.js';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'artifact-write-progress-total-regression');
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

const progressEvents = [];
let restoreProgressHandlers = () => {};

try {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });

  const postings = await buildEmptyPostings();
  restoreProgressHandlers = setProgressHandlers({
    showProgress: (step, current, total, meta) => {
      if (step !== 'Artifacts') return;
      progressEvents.push({
        current,
        total,
        message: meta?.message || null
      });
    }
  });

  await writeIndexArtifacts({
    outDir,
    mode: 'code',
    state: createState(),
    postings,
    postingsConfig: {},
    modelId: 'stub',
    useStubEmbeddings: true,
    dictSummary: null,
    timing: { start: Date.now() },
    root: testRoot,
    userConfig: {
      indexing: {
        scm: { provider: 'none' }
      }
    },
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

  assert.ok(progressEvents.length > 0, 'expected artifact write progress events to be emitted');
  assert.equal(
    progressEvents.every((event) => Number.isFinite(event.total) && event.total > 0),
    true,
    `expected all artifact progress totals to be positive: ${JSON.stringify(progressEvents.slice(0, 5))}`
  );
  const totals = Array.from(new Set(progressEvents.map((event) => event.total)));
  assert.equal(totals.length, 1, 'expected write progress total to remain stable during dispatch');
  assert.equal(
    progressEvents.at(-1)?.current,
    progressEvents.at(-1)?.total,
    'expected final progress event to complete all queued writes'
  );
} finally {
  restoreProgressHandlers();
  await fs.rm(testRoot, { recursive: true, force: true });
}

console.log('artifact write progress total regression test passed');
