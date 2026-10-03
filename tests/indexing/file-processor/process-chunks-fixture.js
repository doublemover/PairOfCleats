import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { normalizeRiskConfig } from '../../../src/index/risk.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const DEFAULT_TEXT = 'const token = "SECRET";\n';
const DEFAULT_DICT_CONFIG = Object.freeze({ dpMaxTokenLength: 16 });

const createDefaultRiskConfig = () => normalizeRiskConfig({
  enabled: true,
  rules: {
    includeDefaults: false,
    rules: {
      sources: [{ name: 'secret', patterns: ['SECRET'] }],
      sinks: [],
      sanitizers: []
    }
  }
}, { rootDir: process.cwd() });

const createDefaultAnalysisPolicy = () => ({
  metadata: { enabled: true },
  risk: { enabled: true },
  typeInference: { local: { enabled: true } }
});

export const createDisabledAnalysisPolicy = () => ({
  metadata: { enabled: false },
  risk: { enabled: false },
  typeInference: { local: { enabled: false } }
});

const createDefaultLang = (languageId) => ({
  id: languageId,
  extractDocMeta: () => ({ paramTypes: { token: 'string' } })
});

export function createProcessChunksFixtureContext({
  text = DEFAULT_TEXT,
  rel = 'src/example.js',
  relKey = rel,
  ext = '.js',
  languageId = 'javascript',
  segmentUid = 'seg-test',
  segmentName = 'example',
  lang = createDefaultLang(languageId),
  relationsEnabled = false,
  languageContext = {},
  languageOptions = {},
  analysisPolicy = createDefaultAnalysisPolicy(),
  riskConfig = createDefaultRiskConfig(),
  riskAnalysisEnabled = true,
  typeInferenceEnabled = true,
  tokenizeEnabled = undefined,
  perfEventLogger = undefined,
  runProc = undefined,
  logs = [],
  overrides = {}
} = {}) {
  const sc = [{
    start: 0,
    end: text.length,
    segment: { languageId, segmentUid },
    kind: 'code',
    name: segmentName
  }];
  const lineIndex = buildLineIndex(text);
  const dictConfig = { ...DEFAULT_DICT_CONFIG };
  const tokenContext = createTokenizationContext({
    dictWords: new Set(),
    dictConfig,
    postingsConfig: {}
  });
  const context = {
    sc,
    text,
    ext,
    rel,
    relKey,
    fileStat: { size: Buffer.byteLength(text) },
    fileHash: null,
    fileHashAlgo: null,
    fileLineCount: lineIndex.length || 1,
    fileLanguageId: languageId,
    lang,
    languageContext,
    languageOptions,
    mode: 'code',
    relationsEnabled,
    fileRelations: null,
    callIndex: null,
    fileStructural: null,
    commentEntries: [],
    commentRanges: [],
    normalizedCommentsConfig: { extract: 'off', maxBytesPerChunk: 0, maxPerChunk: 0 },
    tokenDictWords: new Set(),
    dictConfig,
    tokenContext,
    postingsConfig: {},
    contextWin: 0,
    tokenMode: 'code',
    embeddingEnabled: false,
    embeddingBatchSize: 0,
    getChunkEmbedding: null,
    getChunkEmbeddings: null,
    runEmbedding: async () => null,
    runProc: runProc || (async (fn) => fn()),
    workerPool: null,
    workerDictOverride: null,
    workerState: { tokenWorkerDisabled: true, workerTokenizeFailed: false },
    tokenizationStats: { chunks: 0, tokens: 0, seq: 0 },
    ...(tokenizeEnabled === undefined ? {} : { tokenizeEnabled }),
    complexityEnabled: false,
    lintEnabled: false,
    complexityCache: new Map(),
    lintCache: new Map(),
    log: (line) => logs.push(String(line)),
    logLine: () => {},
    crashLogger: null,
    perfEventLogger: perfEventLogger ?? null,
    riskAnalysisEnabled,
    riskConfig,
    typeInferenceEnabled,
    astDataflowEnabled: false,
    controlFlowEnabled: false,
    toolInfo: { version: 'test' },
    lineIndex,
    lineAuthors: null,
    fileGitMeta: {},
    vfsManifestConcurrency: 1,
    addLineSpan: () => {},
    addSettingMetric: () => {},
    addEnrichDuration: () => {},
    addTokenizeDuration: () => {},
    addComplexityDuration: () => {},
    addLintDuration: () => {},
    addEmbeddingDuration: () => {},
    showLineProgress: false,
    totalLines: lineIndex.length || 1,
    failFile: () => ({ chunks: [], fileRelations: null, skip: { reason: 'fail' } }),
    analysisPolicy,
    ...overrides
  };
  return { context, logs, lineIndex };
}

export function processFixtureChunks(context, overrides = {}) {
  return processChunks({ ...context, ...overrides });
}
