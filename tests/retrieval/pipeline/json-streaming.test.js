#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';

applyTestEnv();

const hits = [
  { id: 1, file: 'src/a.js', start: 0, end: 1, score: 1, scoreType: 'bm25' }
];

const outputChunks = [];
const originalWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk) => {
  outputChunks.push(String(chunk));
  return true;
};

try {
  renderSearchOutput({
    emitOutput: true,
    jsonOutput: true,
    jsonCompact: true,
    explain: false,
    color,
    rootDir: process.cwd(),
    backendLabel: 'memory',
    backendPolicyInfo: null,
    runCode: true,
    runProse: false,
    runExtractedProse: false,
    runRecords: false,
    topN: 1,
    queryTokens: ['alpha'],
    highlightRegex: /alpha/g,
    contextExpansionEnabled: false,
    expandedHits: {
      prose: { hits: [] },
      extractedProse: { hits: [] },
      code: { hits },
      records: { hits: [] }
    },
    baseHits: {
      proseHits: [],
      extractedProseHits: [],
      codeHits: hits,
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
    intentInfo: null,
    resolvedDenseVectorMode: 'merged',
    fieldWeights: null,
    contextExpansionStats: { enabled: false },
    idxProse: null,
    idxExtractedProse: null,
    idxCode: null,
    idxRecords: null,
    showStats: false,
    showMatched: false,
    verboseCache: false,
    elapsedMs: 1,
    streamJson: true
  });
} finally {
  process.stdout.write = originalWrite;
}

const output = outputChunks.join('');
const parsed = JSON.parse(output);
assert.equal(parsed.backend, 'memory');
assert.equal(parsed.code.length, 1);
assert.equal(parsed.code[0].file, 'src/a.js');

console.log('json streaming output test passed');
import { applyTestEnv } from '../../helpers/test-env.js';
