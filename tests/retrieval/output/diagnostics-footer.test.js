#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv();

const captureStreams = async (callback) => {
  const stdoutChunks = [];
  const stderrChunks = [];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => {
    stdoutChunks.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk) => {
    stderrChunks.push(String(chunk));
    return true;
  };
  try {
    await callback();
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
  return {
    stdout: stdoutChunks.join(''),
    stderr: stderrChunks.join('')
  };
};

const captured = await withTemporaryEnv({ COLUMNS: '104' }, async () => await captureStreams(async () => {
  renderSearchOutput({
    emitOutput: true,
    jsonOutput: false,
    jsonCompact: false,
    explain: false,
    color,
    rootDir: process.cwd(),
    backendLabel: 'sqlite',
    backendPolicyInfo: null,
    runCode: true,
    runProse: false,
    runExtractedProse: false,
    runRecords: false,
    topN: 3,
    queryTokens: ['alpha'],
    highlightRegex: /alpha/g,
    contextExpansionEnabled: false,
    expandedHits: {
      prose: { hits: [], contextHits: [] },
      extractedProse: { hits: [], contextHits: [] },
      code: { hits: [], contextHits: [] },
      records: { hits: [], contextHits: [] }
    },
    baseHits: {
      proseHits: [],
      extractedProseHits: [],
      codeHits: [],
      recordHits: []
    },
    annEnabled: false,
    annActive: false,
    annBackend: 'js',
    vectorExtension: { annMode: 'dense', provider: null, table: null },
    vectorAnnEnabled: false,
    vectorAnnState: {
      code: { available: false },
      prose: { available: false },
      records: { available: false },
      'extracted-prose': { available: false }
    },
    vectorAnnUsed: {
      code: false,
      prose: false,
      records: false,
      'extracted-prose': false
    },
    hnswConfig: { enabled: false },
    hnswAnnState: {
      code: { available: false },
      prose: { available: false },
      records: { available: false },
      'extracted-prose': { available: false }
    },
    lanceAnnState: {
      code: { available: false },
      prose: { available: false },
      records: { available: false },
      'extracted-prose': { available: false }
    },
    modelIds: { code: null, prose: null, extractedProse: null, records: null },
    embeddingProvider: null,
    embeddingOnnx: { modelPath: null, tokenizerId: null },
    cacheInfo: { enabled: false, hit: false, key: null },
    profileInfo: {
      warnings: [
        'Sparse-only request overridden for vector_only mode(s): code. ANN fallback was used.',
        '[ops-resource] code=op_resource_retrieval_memory_growth_abnormal component=retrieval metric=rss baselineMiB=64.0 currentMiB=160.0 deltaMiB=96.0 ratio=2.50 next=\"Inspect retrieval memory growth.\"'
      ]
    },
    intentInfo: null,
    resolvedDenseVectorMode: 'merged',
    fieldWeights: null,
    contextExpansionStats: { enabled: false },
    idxProse: { chunkMeta: [] },
    idxExtractedProse: { chunkMeta: [] },
    idxCode: { chunkMeta: [] },
    idxRecords: { chunkMeta: [] },
    showStats: false,
    showMatched: false,
    verboseCache: false,
    elapsedMs: 12
  });
}));

const cleanStdout = stripAnsi(captured.stdout);
assert.match(cleanStdout, /Diagnostics \(2\) ─/);
assert.match(cleanStdout, /! Sparse-only request overridden/);
assert.match(cleanStdout, /! Resource: component retrieval • metric rss • growth 2.50x • delta \+96.0 MiB/);
assert.match(cleanStdout, /64.0 MiB -> 160.0 MiB/);
assert.match(cleanStdout, /next Inspect retrieval memory growth\./);
assert.doesNotMatch(cleanStdout, /\[ops-resource\]/);
assert.equal(captured.stderr.trim(), '', 'expected diagnostics footer to stay on stdout in human mode');

console.log('diagnostics footer test passed');
