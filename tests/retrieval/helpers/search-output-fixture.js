import { renderSearchOutput } from '../../../src/retrieval/cli/render.js';

const createAnnState = () => ({
  code: { available: false },
  prose: { available: false },
  records: { available: false },
  'extracted-prose': { available: false }
});

const createAnnUsed = () => ({
  code: false,
  prose: false,
  records: false,
  'extracted-prose': false
});

const createLanceAnnState = () => ({
  code: { available: false, metric: null },
  prose: { available: false, metric: null },
  records: { available: false, metric: null },
  'extracted-prose': { available: false, metric: null }
});

const createModelIds = () => ({
  code: 'test-model',
  prose: 'test-model',
  extractedProse: 'test-model',
  records: 'test-model'
});

const createContextExpansionStats = () => ({
  enabled: false,
  code: { added: 0, workUnitsUsed: 0, truncation: null },
  prose: { added: 0, workUnitsUsed: 0, truncation: null },
  'extracted-prose': { added: 0, workUnitsUsed: 0, truncation: null },
  records: { added: 0, workUnitsUsed: 0, truncation: null }
});

export const createSearchOutputHitState = ({
  proseHits = [],
  extractedProseHits = [],
  codeHits = [],
  recordHits = []
} = {}) => ({
  expandedHits: {
    prose: { hits: proseHits, contextHits: [] },
    extractedProse: { hits: extractedProseHits, contextHits: [] },
    code: { hits: codeHits, contextHits: [] },
    records: { hits: recordHits, contextHits: [] }
  },
  baseHits: {
    proseHits,
    extractedProseHits,
    codeHits,
    recordHits
  },
  idxProse: { chunkMeta: proseHits },
  idxExtractedProse: { chunkMeta: extractedProseHits },
  idxCode: { chunkMeta: codeHits },
  idxRecords: { chunkMeta: recordHits }
});

export const createSearchOutputOptions = (overrides = {}) => ({
  emitOutput: false,
  jsonOutput: true,
  jsonCompact: true,
  explain: true,
  color: {},
  rootDir: process.cwd(),
  backendLabel: 'memory',
  backendPolicyInfo: { backendLabel: 'memory', reason: 'test' },
  routingPolicy: { byMode: { code: { desired: 'sparse', route: 'sparse' } } },
  runCode: true,
  runProse: false,
  runExtractedProse: false,
  runRecords: false,
  topN: 5,
  queryTokens: ['alpha'],
  highlightRegex: null,
  contextExpansionEnabled: false,
  ...createSearchOutputHitState(),
  annEnabled: false,
  annActive: false,
  annBackend: 'none',
  vectorExtension: { annMode: 'none', provider: 'none', table: null },
  vectorAnnEnabled: false,
  vectorAnnState: createAnnState(),
  vectorAnnUsed: createAnnUsed(),
  hnswConfig: { enabled: false },
  hnswAnnState: createAnnState(),
  lanceAnnState: createLanceAnnState(),
  modelIds: createModelIds(),
  embeddingProvider: 'stub',
  embeddingOnnx: {},
  cacheInfo: { enabled: false, hit: false, key: null },
  profileInfo: null,
  intentInfo: { type: 'keyword' },
  resolvedDenseVectorMode: 'auto',
  fieldWeights: null,
  contextExpansionStats: createContextExpansionStats(),
  showStats: false,
  showMatched: false,
  verboseCache: false,
  elapsedMs: 5,
  stageTracker: null,
  ...overrides
});

export const renderSearchOutputForTest = (overrides = {}) => (
  renderSearchOutput(createSearchOutputOptions(overrides))
);

export const captureSearchOutputStreams = async (callback) => {
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

export const captureSearchOutputStdout = async (callback) => (
  (await captureSearchOutputStreams(callback)).stdout
);
