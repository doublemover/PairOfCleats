#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const root = process.cwd();
const noop = () => {};
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

const createContext = ({
  abs,
  ext,
  rel,
  relKey,
  text,
  fileStat,
  languageHint,
  scmProviderImpl,
  fileHash,
  scmConfig = { annotate: {} },
  analysisPolicy = null
}) => ({
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
  fileHash,
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: 'git',
  scmProviderImpl,
  scmRepoRoot: root,
  scmConfig,
  languageOptions: { treeSitter: { enabled: false } },
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  normalizedSegmentsConfig: normalizeSegmentsConfig(null),
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
  gitBlameEnabled: true,
  analysisPolicy,
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
  treeSitterScheduler: null,
  timing,
  languageHint,
  crashLogger: { enabled: false, updateFile: noop },
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1'
});

const yamlAbs = path.join(root, 'tests', 'fixtures', 'mixed', 'src', 'config.yml');
const yamlRel = path.relative(root, yamlAbs);
const yamlRelKey = yamlRel.split(path.sep).join('/');
const yamlText = await fs.readFile(yamlAbs, 'utf8');
const yamlStat = await fs.stat(yamlAbs);
const yamlLanguageHint = getLanguageForFile('.yml', yamlRelKey);
let yamlAnnotateCalls = 0;
let yamlTimeoutMs = null;
let yamlMetaTimeoutMs = null;
let yamlIncludeChurn = null;
const yamlScmProvider = {
  async getFileMeta(args) {
    yamlMetaTimeoutMs = args?.timeoutMs ?? null;
    yamlIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate(args) {
    yamlAnnotateCalls += 1;
    yamlTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};

await processFileCpu(createContext({
  abs: yamlAbs,
  ext: '.yml',
  rel: yamlRel,
  relKey: yamlRelKey,
  text: yamlText,
  fileStat: yamlStat,
  languageHint: yamlLanguageHint,
  scmProviderImpl: yamlScmProvider,
  fileHash: 'scm-annotate-fast-timeout-yml'
}));
assert.equal(yamlAnnotateCalls, 1, 'expected annotate to run for .yml files');
assert.equal(yamlTimeoutMs, 750, 'expected .yml annotate timeout to clamp to 750ms by default');
assert.equal(yamlMetaTimeoutMs, 250, 'expected .yml meta timeout to clamp to 250ms by default');
assert.equal(yamlIncludeChurn, false, 'expected fast-path .yml churn metadata to be disabled');

const jsAbs = path.join(root, 'tests', 'fixtures', 'tree-sitter', 'javascript.js');
const jsRel = path.relative(root, jsAbs);
const jsRelKey = jsRel.split(path.sep).join('/');
const jsText = await fs.readFile(jsAbs, 'utf8');
const jsStat = await fs.stat(jsAbs);
const jsLanguageHint = getLanguageForFile('.js', jsRelKey);
let jsAnnotateCalls = 0;
let jsTimeoutMs = null;
let jsMetaTimeoutMs = null;
const jsScmProvider = {
  async getFileMeta(args) {
    jsMetaTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false };
  },
  async annotate(args) {
    jsAnnotateCalls += 1;
    jsTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};

await processFileCpu(createContext({
  abs: jsAbs,
  ext: '.js',
  rel: jsRel,
  relKey: jsRelKey,
  text: jsText,
  fileStat: jsStat,
  languageHint: jsLanguageHint,
  scmProviderImpl: jsScmProvider,
  fileHash: 'scm-annotate-fast-timeout-js'
}));
assert.equal(jsAnnotateCalls, 1, 'expected annotate to run for .js files');
assert.equal(jsTimeoutMs, 2000, 'expected non-metadata annotate timeout to clamp to 2000ms');
assert.equal(jsMetaTimeoutMs, 750, 'expected non-metadata meta timeout to clamp to 750ms');

let explicitTimeoutMs = null;
let explicitMetaTimeoutMs = null;
let explicitIncludeChurn = null;
const explicitScmProvider = {
  async getFileMeta(args) {
    explicitMetaTimeoutMs = args?.timeoutMs ?? null;
    explicitIncludeChurn = args?.includeChurn ?? null;
    return { ok: false };
  },
  async annotate(args) {
    explicitTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processFileCpu(createContext({
  abs: yamlAbs,
  ext: '.yml',
  rel: yamlRel,
  relKey: yamlRelKey,
  text: yamlText,
  fileStat: yamlStat,
  languageHint: yamlLanguageHint,
  scmProviderImpl: explicitScmProvider,
  fileHash: 'scm-annotate-fast-timeout-explicit',
  scmConfig: { timeoutMs: 333, annotate: { timeoutMs: 4321 } },
  analysisPolicy: { git: { churn: false } }
}));
assert.equal(explicitTimeoutMs, 750, 'expected explicit annotate timeout to still respect fast-path clamp');
assert.equal(explicitMetaTimeoutMs, 250, 'expected explicit meta timeout to still respect fast-path clamp');
assert.equal(explicitIncludeChurn, false, 'expected churn flag to respect analysis policy');

let allowSlowTimeoutMs = null;
let allowSlowMetaTimeoutMs = null;
const allowSlowScmProvider = {
  async getFileMeta(args) {
    allowSlowMetaTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false };
  },
  async annotate(args) {
    allowSlowTimeoutMs = args?.timeoutMs ?? null;
    return { ok: false, reason: 'timeout' };
  }
};
await processFileCpu(createContext({
  abs: yamlAbs,
  ext: '.yml',
  rel: yamlRel,
  relKey: yamlRelKey,
  text: yamlText,
  fileStat: yamlStat,
  languageHint: yamlLanguageHint,
  scmProviderImpl: allowSlowScmProvider,
  fileHash: 'scm-annotate-fast-timeout-allow-slow',
  scmConfig: {
    allowSlowTimeouts: true,
    timeoutMs: 333,
    annotate: { timeoutMs: 4321 }
  }
}));
assert.equal(allowSlowTimeoutMs, 4321, 'expected allowSlowTimeouts to permit explicit annotate timeout');
assert.equal(allowSlowMetaTimeoutMs, 333, 'expected allowSlowTimeouts to permit explicit meta timeout');

console.log('scm annotate fast timeout test passed');
