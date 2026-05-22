import fs from 'node:fs/promises';
import path from 'node:path';

import { createFileProcessor } from '../../../src/index/build/file-processor.js';
import { reuseCachedBundle } from '../../../src/index/build/file-processor/cached-bundle.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const DEFAULT_SCAN = Object.freeze({
  checkedBinary: true,
  checkedMinified: true
});

const DISABLED_ANALYSIS_FLAGS = Object.freeze({
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  relationsEnabled: false,
  gitBlameEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  embeddingEnabled: false
});

const noopEmbedding = async () => null;

const createLanguageOptions = (overrides) => ({
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  ...overrides
});

const createIncrementalState = () => ({
  enabled: false,
  manifest: { files: {} },
  bundleDir: '',
  bundleFormat: 'json'
});

const createEmptyConfigs = () => ({
  dictConfig: {},
  postingsConfig: {},
  segmentsConfig: {},
  commentsConfig: {},
  riskConfig: {},
  cacheConfig: {}
});

const DEFAULT_CACHED_BUNDLE_CHUNK = Object.freeze({
  file: 'cached.js',
  ext: '.js',
  start: 0,
  end: 10,
  startLine: 1,
  endLine: 1,
  kind: 'code',
  name: 'demo',
  lang: 'javascript',
  chunkUid: 'ck:cached-demo',
  virtualPath: 'cached.js',
  docmeta: { signature: 'demo()' },
  tokens: ['demo'],
  seq: ['demo'],
  ngrams: [],
  chargrams: []
});

export const normalizeFixtureRel = (rel) => {
  const parts = Array.isArray(rel)
    ? rel
    : String(rel).split(/[\\/]+/).filter(Boolean);
  return parts.length ? path.join(...parts) : '';
};

export const createCheckedScan = (overrides = {}) => ({
  ...DEFAULT_SCAN,
  ...overrides
});

export const createScannedFileEntry = ({
  abs,
  rel,
  stat,
  lines = 1,
  scan = {},
  ...overrides
} = {}) => ({
  ...(abs ? { abs } : {}),
  ...(rel == null ? {} : { rel: normalizeFixtureRel(rel) }),
  ...(stat ? { stat } : {}),
  lines,
  scan: createCheckedScan(scan),
  ...overrides
});

export const createFileProcessorFixture = async (name, { repoSubdir = 'repo' } = {}) => {
  const root = process.cwd();
  const tempRoot = resolveTestCachePath(root, name);
  const repoRoot = repoSubdir ? path.join(tempRoot, repoSubdir) : tempRoot;

  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(repoRoot, { recursive: true });

  return { root, tempRoot, repoRoot };
};

export const writeFixtureFile = async ({ root, rel, contents }) => {
  const relPath = normalizeFixtureRel(rel);
  const targetPath = path.join(root, relPath);

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, contents);

  return {
    targetPath,
    rel: relPath,
    stat: await fs.stat(targetPath)
  };
};

export const createCachedBundleFixturePayload = ({
  chunk = {},
  fileRelations = { importLinks: [] }
} = {}) => {
  const payload = {
    chunks: [{
      ...DEFAULT_CACHED_BUNDLE_CHUNK,
      ...chunk
    }]
  };
  if (fileRelations !== undefined) {
    payload.fileRelations = fileRelations;
  }
  return payload;
};

export const createCachedBundleTestFixture = async (name, { cachedBundle = null } = {}) => {
  const fixture = await createFileProcessorFixture(name);
  const { targetPath, stat } = await writeFixtureFile({
    root: fixture.repoRoot,
    rel: 'cached.js',
    contents: 'export const demo = 1;\n'
  });

  return {
    ...fixture,
    targetPath,
    stat,
    relKey: 'cached.js',
    cachedBundle: cachedBundle || createCachedBundleFixturePayload()
  };
};

export const reuseCachedBundleForTest = ({
  targetPath,
  relKey = 'cached.js',
  stat,
  cachedBundle,
  fileHash = 'hash',
  fileHashAlgo = 'sha1',
  manifestFile = null,
  overrides = {}
}) => reuseCachedBundle({
  abs: targetPath,
  relKey,
  fileIndex: 0,
  fileStat: stat,
  fileHash,
  fileHashAlgo,
  ext: '.js',
  fileCaps: {},
  cachedBundle,
  incrementalState: {
    manifest: {
      files: {
        [relKey]: manifestFile || { bundle: 'cached.json', hash: fileHash }
      }
    }
  },
  fileStructural: null,
  toolInfo: null,
  fileStart: Date.now(),
  knownLines: 1,
  fileLanguageId: null,
  ...overrides
});

export const createFileProcessorForTest = ({
  root = process.cwd(),
  mode = 'code',
  skippedFiles = [],
  languageOptions = {},
  overrides = {}
} = {}) => createFileProcessor({
  root,
  mode,
  ...createEmptyConfigs(),
  dictWords: new Set(),
  languageOptions: createLanguageOptions(languageOptions),
  contextWin: 0,
  incrementalState: createIncrementalState(),
  getChunkEmbedding: noopEmbedding,
  getChunkEmbeddings: noopEmbedding,
  ...DISABLED_ANALYSIS_FLAGS,
  seenFiles: new Set(),
  structuralMatches: null,
  cacheReporter: null,
  queues: null,
  workerPool: null,
  crashLogger: null,
  skippedFiles,
  toolInfo: null,
  tokenizationStats: null,
  ...overrides
});
