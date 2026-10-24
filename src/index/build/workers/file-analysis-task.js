import { processFileCpu } from '../file-processor/cpu.js';
import { createTokenizationContext } from '../tokenization.js';
import { getLanguageForFile } from '../../language-registry.js';
import { createTokenizationEvidence } from '../file-processor/tokenization-evidence.js';
import { restoreFileAnalysisRisk, restoreFileAnalysisComments } from './file-analysis-risk.js';
import { decodeFileAnalysisInput, encodeFileAnalysisResult, FILE_ANALYSIS_MAX_EVENTS,
  FILE_ANALYSIS_TIMING_METHODS, fileAnalysisBudgetError } from './file-analysis-contract.js';

/** Runs on the existing single-task indexer isolate/process. ASTs, parse
 * contexts, relation passes and per-file caches stay here until this call ends. */
export const executeFileAnalysis = async (payload, resources) => {
  const input = decodeFileAnalysisInput(payload);
  const events = [];
  const record = (kind, args) => {
    if (events.length >= FILE_ANALYSIS_MAX_EVENTS) throw fileAnalysisBudgetError('observer-events');
    events.push({ kind, args });
  };
  const timing = Object.fromEntries(FILE_ANALYSIS_TIMING_METHODS.map(name => [name, (...args) => record(name, args)]));
  timing.metricsCollector = input.observers.metrics ? { add: (...args) => record('addSettingMetric', args) } : null;
  const tokenizationStats = { chunks: 0, tokens: 0, seq: 0, routeObservations: createTokenizationEvidence() };
  const tokenContext = createTokenizationContext({ ...resources, dictConfig: input.dictConfig || {},
    postingsConfig: input.postingsConfig || {}, treeSitter: { enabled: false } });
  const localTokens = row => resources.tokenize(row, tokenContext);
  try {
    const result = await processFileCpu({ ...input,
      riskConfig: restoreFileAnalysisRisk(input.riskConfig),
      normalizedCommentsConfig: restoreFileAnalysisComments(input.normalizedCommentsConfig),
      semantic: null, sourceBytes: null, scmProvider: null, scmProviderImpl: null, scmRepoRoot: null,
      embeddingEnabled: false, embeddingBatchSize: 0, getChunkEmbedding: null, getChunkEmbeddings: null,
      tokenDictWords: resources.dictWords, tokenContext, timing, tokenizationStats,
      workerState: { tokenWorkerDisabled: false, workerTokenizeFailed: false },
      // Tokenization is part of this already-admitted coarse worker task. No
      // nested worker submission or second CPU permit is invented for chunks.
      workerPool: { shouldUseForFile: () => true, getRoutingReason: () => 'eligible',
        getExecutionBackend: () => resources.backend, tokenizeChunk: async row => localTokens(row) },
      complexityCache: new Map(), lintCache: new Map(),
      languageHint: getLanguageForFile(input.ext, input.relKey),
      runProc: operation => operation(), runIo: operation => operation(),
      runEmbedding: operation => operation(), runTreeSitterSerial: operation => operation(),
      log: (...args) => record('log', args), logLine: (...args) => record('logLine', args),
      showLineProgress: false, onStage: null,
      crashLogger: input.observers.crash ? { enabled: true, updateFile: entry => record('crash', [entry]),
        traceFileStage: () => {}, logError: entry => record('crashError', [entry]) } : null,
      perfEventLogger: input.observers.perf ? { emit: (...args) => record('perf', args) } : null
    });
    return encodeFileAnalysisResult(payload, { status: 'completed', result, events, tokenizationStats });
  } catch (error) {
    // No sinks or publication owners were transferred. A completed projection
    // refusal can safely return control to the original inline implementation.
    // Parser/runtime/worker failures retain their normal error authority.
    if (error?.code !== 'ERR_FILE_ANALYSIS_BUDGET' && error?.code !== 'ERR_FILE_ANALYSIS_PROTOCOL') throw error;
    return encodeFileAnalysisResult(payload, { status: 'unsupported', reason: error.reason });
  }
};
