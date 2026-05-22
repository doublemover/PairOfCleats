import fs from 'node:fs/promises';
import path from 'node:path';

import { normalizeCommentConfig } from '../../../src/index/comments.js';
import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { normalizeSegmentsConfig } from '../../../src/index/segments.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const noop = () => {};
const defaultFixtureParts = Object.freeze(['tests', 'fixtures', 'tree-sitter', 'javascript.js']);

const createTiming = () => ({
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
});

const createNullTreeSitterScheduler = () => ({
  index: new Map(),
  loadPlannedSegments() {
    return null;
  },
  async loadChunks() {
    return null;
  }
});

export async function createTreeSitterProcessFileCpuFixture({
  fileHash = 'tree-sitter-process-file-cpu-fixture',
  fixtureParts = defaultFixtureParts,
  treeSitterScheduler = createNullTreeSitterScheduler()
} = {}) {
  const root = process.cwd();
  const abs = path.join(root, ...fixtureParts);
  const rel = path.relative(root, abs);
  const relKey = rel.split(path.sep).join('/');
  const ext = path.extname(abs);
  const text = await fs.readFile(abs, 'utf8');
  const fileStat = await fs.stat(abs);
  const languageHint = getLanguageForFile(ext, relKey);
  const timing = createTiming();

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
    fileHash,
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
    buildStage: 'stage1',
    normalizedSegmentsConfig: normalizeSegmentsConfig(null),
    treeSitterScheduler
  };

  return {
    abs,
    root,
    ext,
    rel,
    relKey,
    text,
    fileStat,
    languageHint,
    createContext: (overrides = {}) => ({ ...baseContext, ...overrides })
  };
}
