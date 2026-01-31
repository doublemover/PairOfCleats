#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createIndexState, appendChunk } from '../../src/index/build/state.js';
import { buildPostings } from '../../src/index/build/postings.js';
import { normalizePostingsConfig } from '../../src/shared/postings-config.js';
import { rankBM25Fields } from '../../src/retrieval/rankers.js';

const postingsConfig = normalizePostingsConfig({
  enablePhraseNgrams: false,
  enableChargrams: false,
  fielded: true,
  tokenClassification: { enabled: true }
});

const state = createIndexState();

const chunkA = {
  file: 'a.js',
  tokens: ['if', 'return', 'if', 'return'],
  seq: ['if', 'return', 'if', 'return'],
  fieldTokens: {
    name: [],
    signature: [],
    doc: [],
    comment: [],
    body: [],
    keyword: ['if', 'return', 'if', 'return'],
    operator: [],
    literal: []
  },
  weight: 1
};

const chunkB = {
  file: 'b.js',
  tokens: ['if', 'widget', 'widget'],
  seq: ['if', 'widget', 'widget'],
  fieldTokens: {
    name: [],
    signature: [],
    doc: [],
    comment: [],
    body: ['widget', 'widget'],
    keyword: ['if'],
    operator: [],
    literal: []
  },
  weight: 1
};

appendChunk(state, chunkA, postingsConfig, null);
appendChunk(state, chunkB, postingsConfig, null);

const postings = await buildPostings({
  chunks: state.chunks,
  df: state.df,
  tokenPostings: state.tokenPostings,
  docLengths: state.docLengths,
  fieldPostings: state.fieldPostings,
  fieldDocLengths: state.fieldDocLengths,
  phrasePost: state.phrasePost,
  triPost: state.triPost,
  postingsConfig,
  modelId: 'stub',
  useStubEmbeddings: true,
  embeddingsEnabled: false,
  log: () => {}
});

const idx = {
  chunkMeta: state.chunks.map((chunk) => ({ weight: chunk.weight || 1 })),
  tokenIndex: {
    vocab: postings.tokenVocab,
    postings: postings.tokenPostingsList,
    docLengths: state.docLengths,
    avgDocLen: postings.avgDocLen,
    totalDocs: state.docLengths.length
  },
  fieldPostings: postings.fieldPostings
};

const hits = rankBM25Fields({
  idx,
  tokens: ['if', 'widget'],
  topN: 2,
  fieldWeights: { body: 1, keyword: 0.25, operator: 0.05 }
});

assert.equal(hits[0]?.idx, 1, 'expected identifier-heavy chunk to rank first');

console.log('keyword downweighting test passed');
