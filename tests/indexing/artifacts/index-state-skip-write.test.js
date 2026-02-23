import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildPostings } from '../../../src/index/build/postings.js';
import { writeIndexArtifacts } from '../../../src/index/build/artifacts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'index-state-skip-write');
const outDir = path.join(testRoot, 'out');

await fsPromises.rm(testRoot, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });
applyTestEnv({ testing: '1' });

const state = {
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

const userConfig = {
  indexing: {
    scm: { provider: 'none' }
  }
};

const indexState = {
  generatedAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  counts: { files: 0, chunks: 0 },
  mode: 'code'
};

const runWrite = async () => {
  const timing = { start: Date.now() };
  await writeIndexArtifacts({
    outDir,
    mode: 'code',
    state,
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
    indexState,
    graphRelations: null,
    stageCheckpoints: null
  });
};

await runWrite();
const indexStatePath = path.join(outDir, 'index_state.json');
if (!fs.existsSync(indexStatePath)) {
  fail('Expected index_state.json to be written.');
}
const statBefore = fs.statSync(indexStatePath);
await new Promise((resolve) => setTimeout(resolve, 25));
indexState.updatedAt = new Date().toISOString();
await runWrite();
const statAfter = fs.statSync(indexStatePath);

if (statAfter.mtimeMs !== statBefore.mtimeMs) {
  fail('Expected index_state.json to be skipped when only volatile fields change.');
}

console.log('index state skip write test passed');
