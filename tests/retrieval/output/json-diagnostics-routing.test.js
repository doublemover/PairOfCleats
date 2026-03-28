#!/usr/bin/env node
import assert from 'node:assert/strict';
import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';
import { color } from '../../../src/retrieval/cli/ansi.js';
import { applyTestEnv } from '../../helpers/test-env.js';

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

const sharedInput = {
  emitOutput: true,
  jsonOutput: true,
  jsonCompact: false,
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
    prose: { hits: [], contextHits: [] },
    extractedProse: { hits: [], contextHits: [] },
    code: {
      hits: [{ id: 1, file: 'src/a.js', start: 0, end: 1, score: 1, scoreType: 'bm25' }],
      contextHits: []
    },
    records: { hits: [], contextHits: [] }
  },
  baseHits: {
    proseHits: [],
    extractedProseHits: [],
    codeHits: [{ id: 1, file: 'src/a.js', start: 0, end: 1, score: 1, scoreType: 'bm25' }],
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
      '[ops-resource] code=op_resource_retrieval_memory_growth_abnormal component=retrieval metric=rss baselineMiB=64.0 currentMiB=160.0 deltaMiB=96.0 ratio=2.50 next="Inspect retrieval memory growth."'
    ]
  },
  intentInfo: null,
  resolvedDenseVectorMode: 'merged',
  fieldWeights: null,
  contextExpansionStats: { enabled: false },
  idxProse: null,
  idxExtractedProse: null,
  idxCode: null,
  idxRecords: null,
  showStats: true,
  showMatched: false,
  verboseCache: false,
  elapsedMs: 5
};

for (const streamJson of [false, true]) {
  const captured = await captureStreams(async () => {
    renderSearchOutput({
      ...sharedInput,
      streamJson
    });
  });
  assert.equal(captured.stderr.trim(), '', `expected stderr to stay empty for jsonOutput streamJson=${streamJson}`);
  assert.doesNotMatch(captured.stdout, /\[ops-resource\]/u, 'expected raw diagnostics to stay out of JSON stdout');
  const parsed = JSON.parse(captured.stdout);
  assert.equal(parsed.backend, 'memory');
  assert.equal(parsed.code.length, 1);
  assert.equal(Array.isArray(parsed.stats?.profile?.warnings), true, 'expected structured warnings to remain in JSON payload');
}

console.log('json diagnostics routing test passed');
