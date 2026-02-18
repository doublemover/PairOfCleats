#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureTestingEnv } from '../../helpers/test-env.js';
import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

ensureTestingEnv(process.env);

const buildFixture = ({ lineCount, chunkCount }) => {
  const lines = Array.from({ length: lineCount }, (_, i) => `let swift_line_${i} = ${i}`);
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
      segment: { languageId: 'swift', segmentUid: `seg-${i}` },
      kind: 'code',
      name: `chunk_${i}`
    });
  }
  return { text, lineIndex, lineCount: resolvedLineCount, chunks };
};

const runCase = async ({ relKey, lineCount, chunkCount }) => {
  const fixture = buildFixture({ lineCount, chunkCount });
  const tokenContext = createTokenizationContext({
    dictWords: new Set(),
    dictConfig: { dpMaxTokenLength: 16 },
    postingsConfig: {}
  });
  const result = await processChunks({
    sc: fixture.chunks,
    text: fixture.text,
    ext: '.swift',
    rel: relKey,
    relKey,
    fileStat: { size: Buffer.byteLength(fixture.text, 'utf8') },
    fileHash: null,
    fileHashAlgo: null,
    fileLineCount: fixture.lineCount,
    fileLanguageId: 'swift',
    lang: { id: 'swift', extractDocMeta: () => ({}) },
    languageContext: {},
    languageOptions: {
      heavyFile: {
        maxChunks: 64,
        swiftHotPathTargetChunks: 24,
        swiftHotPathMinChunks: 48
      }
    },
    mode: 'code',
    relationsEnabled: false,
    fileRelations: null,
    callIndex: null,
    fileStructural: null,
    commentEntries: [],
    commentRanges: [],
    normalizedCommentsConfig: { extract: 'off', maxBytesPerChunk: 0, maxPerChunk: 0 },
    tokenDictWords: new Set(),
    dictConfig: { dpMaxTokenLength: 16 },
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
    tokenizeEnabled: false,
    complexityEnabled: false,
    lintEnabled: false,
    complexityCache: new Map(),
    lintCache: new Map(),
    log: () => {},
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
  return result;
};

const baseline = await runCase({
  relKey: 'src/FastPath.swift',
  lineCount: 900,
  chunkCount: 96
});
assert.equal(baseline.chunks.length, 48, 'expected non-hot-path Swift file to coalesce to default heavy chunk target');

const hotPath = await runCase({
  relKey: 'test/Sema/exhaustive_switch.swift',
  lineCount: 900,
  chunkCount: 96
});
assert.equal(hotPath.chunks.length, 24, 'expected Swift benchmark hot-path file to coalesce more aggressively');

console.log('heavy file swift hot-path coalescing test passed');
