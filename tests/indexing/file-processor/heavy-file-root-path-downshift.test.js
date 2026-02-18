#!/usr/bin/env node
import assert from 'node:assert/strict';
import { processChunks } from '../../../src/index/build/file-processor/process-chunks.js';
import { createTokenizationContext } from '../../../src/index/build/tokenization.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const runCase = async ({ relPath, text }) => {
  const sc = [{
    start: 0,
    end: text.length,
    segment: { languageId: 'clike', segmentUid: `seg-${relPath}` },
    kind: 'code',
    name: 'vendor_symbol'
  }];
  const lineIndex = buildLineIndex(text);
  const tokenContext = createTokenizationContext({
    dictWords: new Set(),
    dictConfig: { dpMaxTokenLength: 16 },
    postingsConfig: {}
  });
  const logs = [];
  const lineCount = lineIndex.length || 1;
  const result = await processChunks({
    sc,
    text,
    ext: '.cpp',
    rel: relPath,
    relKey: relPath,
    fileStat: { size: Buffer.byteLength(text) },
    fileHash: null,
    fileHashAlgo: null,
    fileLineCount: lineCount,
    fileLanguageId: 'clike',
    lang: { id: 'clike', extractDocMeta: () => ({}) },
    languageContext: {},
    languageOptions: {},
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
    totalLines: lineCount,
    failFile: () => ({ chunks: [], fileRelations: null, skip: { reason: 'fail' } })
  });
  return { result, logs };
};

const tinyVendor = await runCase({
  relPath: 'vendor/foo.cpp',
  text: 'int vendor_symbol() { return 42; }\n'
});
assert.equal(tinyVendor.result.chunks.length, 1, 'expected one chunk result for tiny vendor file');
assert.ok(
  !tinyVendor.logs.some((line) => line.includes('[perf] heavy-file downshift enabled for vendor/foo.cpp')),
  'expected tiny vendor file to avoid heavy-file downshift'
);

const nestedThirdparty = await runCase({
  relPath: 'tests/thirdparty/Fuzzer/test/TraceMallocTest.cpp',
  text: 'int nested_fixture_symbol() { return 7; }\n'
});
assert.equal(nestedThirdparty.result.chunks.length, 1, 'expected one chunk result for nested thirdparty fixture file');
assert.ok(
  !nestedThirdparty.logs.some((line) => line.includes('[perf] heavy-file downshift enabled for tests/thirdparty/Fuzzer/test/TraceMallocTest.cpp')),
  'expected nested tests/thirdparty fixture paths to avoid heavy-file downshift'
);

const largeVendorText = `${Array.from({ length: 1300 }, (_, i) => `int vendor_symbol_${i} = ${i};`).join('\n')}\n`;
const largeVendor = await runCase({
  relPath: 'vendor/large.cpp',
  text: largeVendorText
});
assert.equal(largeVendor.result.chunks.length, 1, 'expected one chunk result for large vendor file');
assert.ok(
  largeVendor.logs.some((line) => line.includes('[perf] heavy-file downshift enabled for vendor/large.cpp')),
  'expected heavy-file downshift to trigger for root-level vendor path once file size/line pressure is high'
);

const largeSwiftFixtureText = `${Array.from({ length: 1300 }, (_, i) => `public let swift_fixture_${i} = ${i}`).join('\n')}\n`;
const largeSwiftFixture = await runCase({
  relPath: 'test/api-digester/Inputs/SDK.swift',
  text: largeSwiftFixtureText
});
assert.equal(largeSwiftFixture.result.chunks.length, 1, 'expected one chunk result for large swift fixture path');
assert.ok(
  largeSwiftFixture.logs.some((line) => line.includes('[perf] heavy-file downshift enabled for test/api-digester/Inputs/SDK.swift')),
  'expected heavy-file downshift to trigger for known heavy swift fixture path'
);

console.log('heavy file root-path downshift test passed');
