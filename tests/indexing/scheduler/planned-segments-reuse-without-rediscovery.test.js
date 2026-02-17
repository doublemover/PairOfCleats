#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { assignSegmentUids, discoverSegments, normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const noop = () => {};
const root = process.cwd();
const abs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');
const rel = path.relative(root, abs);
const relKey = rel.split(path.sep).join('/');
const ext = '.js';
const text = await fs.readFile(abs, 'utf8');
const fileStat = await fs.stat(abs);
const languageHint = getLanguageForFile(ext, relKey);

const timing = {
  metricsCollector: null,
  addSettingMetric: noop,
  addLineSpan: noop,
  addParseDuration: noop,
  addTokenizeDuration: noop,
  addEnrichDuration: noop,
  addEmbeddingDuration: noop,
  addLintDuration: noop,
  addComplexityDuration: noop,
  setGitDuration: noop,
  setPythonAstDuration: noop
};

const baseContext = {
  abs,
  root,
  mode: 'code',
  fileEntry: { abs, rel: relKey },
  fileIndex: 1,
  ext,
  rel,
  relKey,
  text,
  fileStat,
  fileHash: 'scheduler-planned-segments-test',
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: null,
  scmProviderImpl: null,
  scmRepoRoot: null,
  scmConfig: null,
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  normalizedCommentsConfig: normalizeCommentConfig(null),
  tokenDictWords: new Set(),
  dictConfig: {},
  tokenContext: {
    dictWords: new Set(),
    dictConfig: {},
    codeDictCache: new Map(),
    tokenClassification: { enabled: false },
    phraseEnabled: false,
    chargramEnabled: false
  },
  postingsConfig: {},
  contextWin: {},
  relationsEnabled: false,
  lintEnabled: false,
  complexityEnabled: false,
  typeInferenceEnabled: false,
  riskAnalysisEnabled: false,
  riskConfig: {},
  gitBlameEnabled: false,
  analysisPolicy: null,
  workerPool: null,
  workerDictOverride: null,
  workerState: {},
  tokenizationStats: null,
  tokenizeEnabled: true,
  embeddingEnabled: false,
  embeddingNormalize: false,
  embeddingBatchSize: 0,
  getChunkEmbedding: null,
  getChunkEmbeddings: null,
  runEmbedding: (fn) => fn(),
  runProc: (fn) => fn(),
  runTreeSitterSerial: (fn) => fn(),
  runIo: (fn) => fn(),
  log: noop,
  logLine: noop,
  showLineProgress: false,
  toolInfo: null,
  timing,
  languageHint,
  crashLogger: { enabled: false, updateFile: noop },
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1'
};

const createContext = (overrides = {}) => ({ ...baseContext, ...overrides });

const chunkFingerprint = (chunk) => ({
  chunkUid: chunk.chunkUid,
  chunkId: chunk.metaV2?.chunkId || null,
  virtualPath: chunk.virtualPath,
  lang: chunk.lang,
  kind: chunk.kind,
  name: chunk.name,
  start: chunk.start,
  end: chunk.end,
  startLine: chunk.startLine,
  endLine: chunk.endLine,
  signature: chunk.docmeta?.signature || null
});

const baselineResult = await processFileCpu(createContext({
  languageOptions: { treeSitter: { enabled: false } },
  normalizedSegmentsConfig: normalizeSegmentsConfig(null),
  treeSitterScheduler: null
}));
assert.ok(Array.isArray(baselineResult.chunks) && baselineResult.chunks.length > 0, 'expected baseline chunks');

const plannedSegments = discoverSegments({
  text,
  ext,
  relPath: relKey,
  mode: 'code',
  languageId: languageHint?.id || null,
  context: null,
  segmentsConfig: normalizeSegmentsConfig(null),
  extraSegments: []
});
await assignSegmentUids({ text, segments: plannedSegments, ext, mode: 'code' });

const throwingSegmentsConfig = {};
Object.defineProperty(throwingSegmentsConfig, 'cdc', {
  enumerable: true,
  configurable: true,
  get() {
    throw new Error('discover-segments-should-not-run');
  }
});

let loadPlannedSegmentsCalls = 0;
let loadChunksCalls = 0;
const scheduler = {
  index: new Map(),
  loadPlannedSegments(containerPath) {
    loadPlannedSegmentsCalls += 1;
    assert.equal(containerPath, relKey, 'expected per-file planned segment lookup');
    return plannedSegments.map((segment) => ({ ...segment }));
  },
  async loadChunks() {
    loadChunksCalls += 1;
    return null;
  }
};

const plannedResult = await processFileCpu(createContext({
  languageOptions: { treeSitter: { enabled: true, strict: false } },
  normalizedSegmentsConfig: throwingSegmentsConfig,
  treeSitterScheduler: scheduler
}));
assert.equal(plannedResult.skip, null, 'expected planned-segment path to complete without skip');
assert.ok(loadPlannedSegmentsCalls > 0, 'expected scheduler planned segment lookup');
assert.ok(loadChunksCalls > 0, 'expected scheduler chunk lookup attempts');
assert.deepEqual(
  plannedResult.chunks.map(chunkFingerprint),
  baselineResult.chunks.map(chunkFingerprint),
  'expected planned-segment reuse path to preserve chunk boundaries/IDs/metadata'
);

console.log('scheduler planned-segment reuse without rediscovery test passed');
