#!/usr/bin/env node
import assert from 'node:assert/strict';

import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';
import { normalizeRiskConfig } from '../../../src/index/risk.js';

const text = 'const token = "SECRET";\n';
const sc = [{
  start: 0,
  end: text.length,
  segment: { languageId: 'javascript', segmentUid: 'seg-fallback' },
  kind: 'code',
  name: 'example'
}];
const lineIndex = buildLineIndex(text);

const riskConfig = normalizeRiskConfig({
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

const tokenContext = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: { dpMaxTokenLength: 16 },
  postingsConfig: {}
});

const baseContext = {
  sc,
  text,
  ext: '.js',
  rel: 'src/fallback.js',
  relKey: 'src/fallback.js',
  fileStat: { size: Buffer.byteLength(text) },
  fileHash: null,
  fileHashAlgo: null,
  fileLineCount: 1,
  fileLanguageId: 'javascript',
  lang: {
    id: 'javascript',
    extractDocMeta: () => ({ paramTypes: { token: 'string' } }),
    buildRelations: () => ({ imports: ['./dep.js'], calls: [['example', 'dep']] })
  },
  languageContext: {},
  languageOptions: {},
  mode: 'code',
  relationsEnabled: true,
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
  workerPool: null,
  workerDictOverride: null,
  workerState: { tokenWorkerDisabled: true, workerTokenizeFailed: false },
  tokenizationStats: { chunks: 0, tokens: 0, seq: 0 },
  complexityEnabled: false,
  lintEnabled: false,
  complexityCache: new Map(),
  lintCache: new Map(),
  log: () => {},
  logLine: () => {},
  crashLogger: null,
  perfEventLogger: null,
  riskAnalysisEnabled: true,
  riskConfig,
  typeInferenceEnabled: true,
  astDataflowEnabled: false,
  controlFlowEnabled: false,
  toolInfo: { version: 'test' },
  lineIndex,
  lineAuthors: null,
  fileGitMeta: {},
  addLineSpan: () => {},
  addSettingMetric: () => {},
  addEnrichDuration: () => {},
  addTokenizeDuration: () => {},
  addComplexityDuration: () => {},
  addLintDuration: () => {},
  addEmbeddingDuration: () => {},
  showLineProgress: false,
  totalLines: 1,
  failFile: () => ({ chunks: [], fileRelations: null, skip: { reason: 'fail' } }),
  analysisPolicy: {
    metadata: { enabled: true },
    risk: { enabled: true },
    typeInference: { local: { enabled: true } }
  }
};

const astFull = await processChunks({
  ...baseContext,
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: false,
    fallbackSegmentCount: 0,
    schedulerMissingCount: 0
  }
});
assert.equal(astFull.chunks[0].metaV2?.parser?.mode, 'ast-full');
assert.ok(astFull.chunks[0].docmeta?.risk, 'ast-full should retain risk metadata');
assert.ok(astFull.chunks[0].docmeta?.inferredTypes, 'ast-full should retain type inference metadata');

const astFullWithNonCodeFallback = await processChunks({
  ...baseContext,
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: true,
    usedHeuristicCodeChunking: false,
    fallbackSegmentCount: 2,
    codeFallbackSegmentCount: 0,
    schedulerMissingCount: 0
  }
});
assert.equal(
  astFullWithNonCodeFallback.chunks[0].metaV2?.parser?.mode,
  'ast-full',
  'non-code fallback segments should not force syntax-lite parser mode'
);

const syntaxLite = await processChunks({
  ...baseContext,
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: true,
    fallbackSegmentCount: 1,
    schedulerMissingCount: 1
  }
});
assert.equal(syntaxLite.chunks[0].metaV2?.parser?.mode, 'syntax-lite');
assert.equal(syntaxLite.chunks[0].metaV2?.parser?.reasonCode, 'USR-R-PARSER-UNAVAILABLE');
assert.equal(syntaxLite.chunks[0].docmeta?.risk, undefined, 'syntax-lite should disable risk metadata');
assert.equal(syntaxLite.chunks[0].docmeta?.inferredTypes, undefined, 'syntax-lite should disable type inference metadata');

const syntaxLiteRepeat = await processChunks({
  ...baseContext,
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: true,
    fallbackSegmentCount: 1,
    schedulerMissingCount: 1
  }
});
assert.deepEqual(
  syntaxLiteRepeat.chunks[0].metaV2?.parser,
  syntaxLite.chunks[0].metaV2?.parser,
  'syntax-lite parser metadata should be deterministic across runs'
);

const syntaxLiteHeavyDownshift = await processChunks({
  ...baseContext,
  languageOptions: {
    heavyFile: {
      enabled: true,
      maxBytes: 1,
      maxLines: 10_000,
      maxChunks: 10_000,
      skipTokenization: true,
      skipTokenizationMaxBytes: 10_000_000,
      skipTokenizationMaxLines: 10_000_000,
      skipTokenizationMaxChunks: 10_000_000
    }
  },
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: false,
    fallbackSegmentCount: 0,
    schedulerMissingCount: 0
  }
});
assert.equal(syntaxLiteHeavyDownshift.chunks[0].metaV2?.parser?.mode, 'syntax-lite');
assert.equal(
  syntaxLiteHeavyDownshift.chunks[0].metaV2?.parser?.reasonCode,
  'USR-R-RESOURCE-BUDGET-EXCEEDED'
);
assert.equal(
  syntaxLiteHeavyDownshift.chunks[0].docmeta?.risk,
  undefined,
  'heavy-file syntax-lite should disable risk metadata'
);
assert.equal(
  syntaxLiteHeavyDownshift.chunks[0].docmeta?.inferredTypes,
  undefined,
  'heavy-file syntax-lite should disable type inference metadata'
);

const chunkOnly = await processChunks({
  ...baseContext,
  languageOptions: {
    heavyFile: {
      enabled: true,
      maxBytes: 1,
      maxLines: 1,
      maxChunks: 1,
      skipTokenization: true,
      skipTokenizationMaxBytes: 1,
      skipTokenizationMaxLines: 1,
      skipTokenizationMaxChunks: 1
    }
  },
  chunkingDiagnostics: {
    treeSitterEnabled: true,
    schedulerRequired: true,
    usedHeuristicChunking: false,
    fallbackSegmentCount: 0,
    schedulerMissingCount: 0
  }
});
assert.equal(chunkOnly.chunks[0].metaV2?.parser?.mode, 'chunk-only');
assert.equal(chunkOnly.chunks[0].metaV2?.parser?.reasonCode, 'USR-R-RESOURCE-BUDGET-EXCEEDED');
assert.equal(chunkOnly.chunks[0].metaV2?.relations?.calls || null, null, 'chunk-only should not emit call relations');

console.log('fallback mode contract test passed');
