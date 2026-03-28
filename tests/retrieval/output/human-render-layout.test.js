#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { stripAnsi } from '../../../src/shared/cli/ansi-utils.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';

applyTestEnv();

const codeHits = [
  {
    file: 'src/retrieval/cli/render.js',
    name: 'renderSearchOutput',
    kind: 'Function',
    start: 0,
    end: 1,
    startLine: 20,
    endLine: 60,
    score: 0.92,
    scoreType: 'rrf',
    docmeta: {
      signature: 'renderSearchOutput(options)',
      returnsValue: true
    }
  }
];

const proseHits = [
  {
    file: 'docs/guides/search.md',
    name: 'Search Pipeline',
    kind: 'Section',
    start: 0,
    end: 1,
    startLine: 12,
    endLine: 20,
    score: 0.81,
    scoreType: 'bm25',
    headline: 'Search Pipeline covers indexing, ranking, and result rendering.'
  }
];

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

const captured = await withTemporaryEnv({ COLUMNS: '72' }, async () => await captureStreams(async () => {
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
    runProse: true,
    runExtractedProse: true,
    runRecords: false,
    topN: 3,
    queryTokens: ['renderSearchOutput'],
    highlightRegex: /renderSearchOutput/g,
    contextExpansionEnabled: false,
    expandedHits: {
      prose: { hits: proseHits, contextHits: [] },
      extractedProse: { hits: [], contextHits: [] },
      code: { hits: codeHits, contextHits: [] },
      records: { hits: [], contextHits: [] }
    },
    baseHits: {
      proseHits,
      extractedProseHits: [],
      codeHits,
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
    idxProse: { chunkMeta: proseHits },
    idxExtractedProse: { chunkMeta: [] },
    idxCode: { chunkMeta: codeHits },
    idxRecords: { chunkMeta: [] },
    showStats: false,
    showMatched: false,
    verboseCache: false,
    elapsedMs: 17
  });
}));

const cleanStdout = stripAnsi(captured.stdout);

assert.match(cleanStdout, /Search Results/);
assert.match(cleanStdout, /^Search Results\s+elapsed 17ms$/m);
assert.match(cleanStdout, /^query renderSearchOutput$/m);
assert.match(cleanStdout, /Code Results \(1\)/);
assert.match(cleanStdout, /^Code Results \(1\) ─/m);
assert.match(cleanStdout, /Text Results \(1\)/);
assert.doesNotMatch(cleanStdout, /Code Comments Results/);
assert.match(cleanStdout, /backend sqlite/);
assert.match(cleanStdout, /hits 1 code/);
assert.equal(captured.stderr.trim(), '', 'expected diagnostics stderr to remain empty for normal human output');

console.log('human render layout test passed');
