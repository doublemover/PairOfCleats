import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { processFileCpu } from '../../../src/index/build/file-processor/cpu.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

export { getLanguageForFile };

export const root = process.cwd();

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

export const toRelKey = (rel) => rel.split(path.sep).join('/');

export const absFromRelKey = (relKey) => path.join(root, ...relKey.split('/'));

export const readFixture = async (...parts) => {
  const abs = path.join(root, ...parts);
  const rel = path.relative(root, abs);
  const relKey = toRelKey(rel);
  const ext = path.extname(abs);
  const text = await fs.readFile(abs, 'utf8');
  const fileStat = await fs.stat(abs);

  return {
    abs,
    rel,
    relKey,
    ext,
    text,
    fileStat,
    languageHint: getLanguageForFile(ext, relKey)
  };
};

export const createScmFileProcessorContext = ({
  mode = 'code',
  abs,
  ext,
  rel,
  relKey,
  text,
  documentExtraction = null,
  fileStat,
  fileHash = `hash:${mode}`,
  languageHint = getLanguageForFile(ext, relKey),
  scmProviderImpl,
  scmConfig = { annotate: {} },
  scmFileMetaByPath = null,
  scmMetaCache,
  analysisPolicy = null,
  gitBlameEnabled = true,
  runIo = (fn) => fn(),
  runProc = (fn) => fn(),
  signal = null,
  onScmProcQueueWait = null,
  perfEventLogger = null,
  crashLogger = { enabled: false, updateFile: noop, updateStage: noop },
  ...overrides
}) => ({
  abs,
  root,
  mode,
  fileEntry: { abs, rel: relKey },
  fileIndex: 1,
  ext,
  rel,
  relKey,
  text,
  documentExtraction,
  fileStat,
  fileHash,
  fileHashAlgo: 'sha1',
  fileCaps: null,
  fileStructural: null,
  scmProvider: 'git',
  scmProviderImpl,
  scmRepoRoot: root,
  scmConfig,
  scmFileMetaByPath,
  scmMetaCache,
  languageOptions: { treeSitter: { enabled: false }, pythonAst: { enabled: false } },
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
  gitBlameEnabled,
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
  runProc,
  signal,
  onScmProcQueueWait,
  runTreeSitterSerial: (fn) => fn(),
  runIo,
  log: noop,
  logLine: noop,
  showLineProgress: false,
  toolInfo: null,
  treeSitterScheduler: null,
  perfEventLogger,
  timing,
  languageHint,
  crashLogger,
  vfsManifestConcurrency: 1,
  complexityCache: null,
  lintCache: null,
  buildStage: 'stage1',
  extractedProseExtrasCache: null,
  primeExtractedProseExtrasCache: false,
  ...overrides
});

export const processScmFile = (options) => processFileCpu(createScmFileProcessorContext(options));
