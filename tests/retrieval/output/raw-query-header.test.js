#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv();

const captureStdout = async (callback) => {
  const chunks = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    await callback();
  } finally {
    process.stdout.write = originalWrite;
  }
  return chunks.join('');
};

const output = await withTemporaryEnv({ COLUMNS: '88' }, async () => await captureStdout(async () => {
  renderSearchOutput({
    emitOutput: true,
    jsonOutput: false,
    jsonCompact: false,
    explain: false,
    color,
    rootDir: process.cwd(),
    backendLabel: 'sqlite-fts',
    backendPolicyInfo: null,
    runCode: false,
    runProse: true,
    runExtractedProse: false,
    runRecords: false,
    topN: 1,
    rawQuery: '"Search Pipeline"',
    queryTokens: ['search', 'pipeline'],
    highlightRegex: /Search Pipeline/giu,
    contextExpansionEnabled: false,
    expandedHits: {
      prose: {
        hits: [{
          file: 'docs/guides/search.md',
          start: 0,
          end: 1,
          startLine: 10,
          endLine: 18,
          name: 'Search Pipeline',
          kind: 'Section',
          score: 1
        }],
        contextHits: []
      },
      extractedProse: { hits: [], contextHits: [] },
      code: { hits: [], contextHits: [] },
      records: { hits: [], contextHits: [] }
    },
    baseHits: {
      proseHits: [{
        file: 'docs/guides/search.md',
        start: 0,
        end: 1,
        startLine: 10,
        endLine: 18,
        name: 'Search Pipeline',
        kind: 'Section',
        score: 1
      }],
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
    profileInfo: null,
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
    elapsedMs: 11
  });
}));

assert.match(stripAnsi(output), /^query "Search Pipeline"$/m, 'expected header to preserve the raw query text');

console.log('raw query header test passed');
