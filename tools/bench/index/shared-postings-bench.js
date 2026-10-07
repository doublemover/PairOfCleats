import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildPostings } from '../../../src/index/build/postings.js';
import { normalizePostingsConfig } from '../../../src/shared/postings-config.js';
export { parseBenchArgs, resolveCompareMode } from '../shared.js';

export const prepareBenchRoot = async (name, cwd = process.cwd()) => {
  const benchRoot = path.join(cwd, '.benchCache', name);
  await fs.mkdir(benchRoot, { recursive: true });
  return benchRoot;
};

export const buildTriPostFixture = ({
  vocabSize,
  docs,
  postingsPerToken,
  tokenForIndex
}) => {
  const map = new Map();
  const safeDocs = Math.max(docs, 1);
  for (let i = 0; i < vocabSize; i += 1) {
    const token = tokenForIndex(i);
    const postings = new Array(postingsPerToken);
    const base = (i * 131) % safeDocs;
    for (let j = 0; j < postingsPerToken; j += 1) {
      postings[j] = base + j;
    }
    map.set(token, postings);
  }
  return map;
};

export const buildChunkMetaFixture = (docs) => (
  Array.from({ length: docs }, () => ({ tokenCount: 0 }))
);

export const runPostingsBenchOnce = async ({
  benchRoot,
  label,
  spillMaxUnique,
  vocabSize,
  docs,
  postingsPerToken,
  tokenForIndex,
  postingsConfigOverrides = {},
  resultExtra = null
}) => {
  const buildRoot = path.join(benchRoot, label);
  await fs.rm(buildRoot, { recursive: true, force: true });
  await fs.mkdir(buildRoot, { recursive: true });
  const triPost = buildTriPostFixture({
    vocabSize,
    docs,
    postingsPerToken,
    tokenForIndex
  });
  const postingsConfig = normalizePostingsConfig({
    enableChargrams: true,
    enablePhraseNgrams: false,
    chargramSpillMaxUnique: spillMaxUnique,
    ...postingsConfigOverrides
  });
  const chunks = buildChunkMetaFixture(docs);
  const docLengths = new Array(docs).fill(0);
  const heapBefore = process.memoryUsage().heapUsed;
  const start = performance.now();
  const result = await buildPostings({
    chunks,
    df: new Map(),
    tokenPostings: new Map(),
    docLengths,
    fieldPostings: {},
    fieldDocLengths: {},
    phrasePost: new Map(),
    triPost,
    postingsConfig,
    postingsGuard: null,
    buildRoot,
    modelId: 'bench',
    useStubEmbeddings: true,
    log: () => {},
    workerPool: null,
    quantizePool: null,
    embeddingsEnabled: false
  });
  const durationMs = performance.now() - start;
  const heapAfter = process.memoryUsage().heapUsed;
  const extra = typeof resultExtra === 'function'
    ? resultExtra({ result, label, spillMaxUnique })
    : {};
  return {
    label,
    ...extra,
    durationMs,
    heapDelta: heapAfter - heapBefore,
    vocab: result.chargramVocab.length,
    stats: result.chargramStats || null
  };
};

export const calculateThroughput = (vocabSize, durationMs) => (
  durationMs > 0 ? vocabSize / (durationMs / 1000) : 0
);

export const formatHeapDeltaMb = (bytes) => (
  (bytes / (1024 * 1024)).toFixed(1)
);
