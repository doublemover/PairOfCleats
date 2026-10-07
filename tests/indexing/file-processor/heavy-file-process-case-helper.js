import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const createDefaultDictConfig = () => ({ dpMaxTokenLength: 16 });

const buildFixture = ({ languageId, lineCount, chunkCount, sourceLine }) => {
  const lines = Array.from({ length: lineCount }, (_, i) => sourceLine(i));
  const text = `${lines.join('\n')}\n`;
  const lineIndex = buildLineIndex(text);
  const resolvedLineCount = lineIndex.length || 1;
  const resolvedChunkCount = Math.max(1, Math.floor(Number(chunkCount) || 1));
  const chunkSpan = Math.max(1, Math.floor(resolvedLineCount / resolvedChunkCount));
  const chunks = [];
  for (let i = 0; i < resolvedChunkCount; i += 1) {
    const startLine = Math.min(resolvedLineCount, (i * chunkSpan) + 1);
    const endLine = i === resolvedChunkCount - 1
      ? resolvedLineCount
      : Math.min(resolvedLineCount, (i + 1) * chunkSpan);
    const start = lineIndex[startLine - 1];
    const end = Number.isFinite(lineIndex[endLine]) ? lineIndex[endLine] : text.length;
    chunks.push({
      start,
      end,
      segment: { languageId, segmentUid: `seg-${i}` },
      kind: 'code',
      name: `chunk_${i}`
    });
  }
  return { text, lineIndex, lineCount: resolvedLineCount, chunks };
};

export const runHeavyFileProcessCase = async ({
  languageId,
  extension,
  relKey,
  lineCount,
  chunkCount,
  sourceLine,
  languageOptions = {},
  tokenizeEnabled
}) => {
  const fixture = buildFixture({ languageId, lineCount, chunkCount, sourceLine });
  const tokenDictConfig = createDefaultDictConfig();
  const dictConfig = createDefaultDictConfig();
  const tokenContext = createTokenizationContext({
    dictWords: new Set(),
    dictConfig: tokenDictConfig,
    postingsConfig: {}
  });
  const logs = [];
  const result = await processChunks({
    sc: fixture.chunks,
    text: fixture.text,
    ext: extension,
    rel: relKey,
    relKey,
    fileStat: { size: Buffer.byteLength(fixture.text, 'utf8') },
    fileHash: null,
    fileHashAlgo: null,
    fileLineCount: fixture.lineCount,
    fileLanguageId: languageId,
    lang: { id: languageId, extractDocMeta: () => ({}) },
    languageContext: {},
    languageOptions,
    mode: 'code',
    relationsEnabled: false,
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
    runProc: async (fn) => fn(),
    workerPool: null,
    workerDictOverride: null,
    workerState: { tokenWorkerDisabled: true, workerTokenizeFailed: false },
    tokenizationStats: { chunks: 0, tokens: 0, seq: 0 },
    tokenizeEnabled,
    complexityEnabled: false,
    lintEnabled: false,
    complexityCache: new Map(),
    lintCache: new Map(),
    log: (msg) => logs.push(String(msg)),
    logLine: () => {},
    crashLogger: null,
    riskAnalysisEnabled: false,
    riskConfig: {},
    typeInferenceEnabled: false,
    analysisPolicy: {
      metadata: { enabled: false },
      risk: { enabled: false },
      typeInference: { local: { enabled: false } }
    },
    astDataflowEnabled: false,
    controlFlowEnabled: false,
    toolInfo: { version: 'test' },
    lineIndex: fixture.lineIndex,
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
    totalLines: fixture.lineCount,
    failFile: () => ({ chunks: [], fileRelations: null, skip: { reason: 'fail' } })
  });
  return { result, logs };
};
