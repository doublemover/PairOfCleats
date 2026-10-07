import assert from 'node:assert/strict';
import { rankBM25 } from '../../src/retrieval/rankers.js';
import { createCandidateSetBuilder } from '../../src/retrieval/pipeline/candidates.js';
import { createQueryAstHelpers } from '../../src/retrieval/pipeline/query-ast.js';

const vocab = Array.from({ length: 128 }, (_, i) => `term-${i}`);
const tokenIndex = () => ({
  vocab: [...vocab], postings: vocab.map((_, i) => i === 1 ? [[0, 1], [1, 2]] : []),
  docLengths: [2, 3], totalDocs: 2, avgDocLen: 2.5
});
const phrase = 'alpha\u0001beta';
const phraseIndex = () => ({ vocab: [phrase, ...vocab], postings: [[0], ...vocab.map(() => [])] });
const charIndex = () => ({ vocab: ['alp', ...vocab], postings: [[1], ...vocab.map(() => [])] });
const ready = (index) => ({ ...index, vocabIndex: new Map(index.vocab.map((term, i) => [term, i])) });
const chunkMeta = [{ tokens: ['alpha', 'beta'], weight: 1 }, { tokens: ['other'], weight: 1 }];

const baselineRank = rankBM25({ idx: { tokenIndex: ready(tokenIndex()), chunkMeta }, tokens: ['term-1'], topN: 2 });
const builder = createCandidateSetBuilder({
  useSqlite: false, postingsConfig: { phraseMinN: 2, phraseMaxN: 2, chargramMinN: 3, chargramMaxN: 3 },
  maxCandidates: null
});
const baselineCandidates = builder({ phraseNgrams: ready(phraseIndex()), chargrams: ready(charIndex()) }, ['alpha', 'beta'], 'code');
const phrases = new Set([phrase]);
const queryAst = { type: 'phrase', tokens: ['alpha', 'beta'], ngramSet: phrases };
const ast = createQueryAstHelpers({ queryAst, phraseNgramSet: phrases, phraseRange: { min: 2, max: 2 } });
const baselinePhrase = ast.getPhraseMatchInfo({ phraseNgrams: ready(phraseIndex()) }, 0, phrases, []);

const NativeMap = Map;
let suppliedPairRows = 0;
globalThis.Map = class ObservedMap extends NativeMap {
  constructor(entries) {
    if (Array.isArray(entries)) suppliedPairRows += entries.length;
    super(entries);
  }
};
try {
  const idx = { tokenIndex: tokenIndex(), chunkMeta };
  assert.deepEqual(rankBM25({ idx, tokens: ['term-1'], topN: 2 }), baselineRank);
  const tokenMap = idx.tokenIndex.vocabIndex;
  assert.equal(tokenMap.get('term-1'), 1);
  assert.deepEqual(rankBM25({ idx, tokens: ['term-1'], topN: 2 }), baselineRank);
  assert.equal(idx.tokenIndex.vocabIndex, tokenMap);

  const candidateIndex = { phraseNgrams: phraseIndex(), chargrams: charIndex() };
  assert.deepEqual([...builder(candidateIndex, ['alpha', 'beta'], 'code')], [...baselineCandidates]);
  assert.equal(candidateIndex.phraseNgrams.vocabIndex.get(phrase), 0);
  assert.equal(candidateIndex.chargrams.vocabIndex.get('alp'), 0);
  const phraseMap = candidateIndex.phraseNgrams.vocabIndex;
  builder(candidateIndex, ['alpha', 'beta'], 'code');
  assert.equal(candidateIndex.phraseNgrams.vocabIndex, phraseMap);

  const astIndex = { phraseNgrams: phraseIndex(), chunkMeta };
  assert.deepEqual(ast.getPhraseMatchInfo(astIndex, 0, phrases, []), baselinePhrase);
  assert.equal(ast.matchesQueryAst(astIndex, 0, chunkMeta[0]), true);
  assert.equal(ast.matchesQueryAst(astIndex, 1, chunkMeta[1]), false);
} finally { globalThis.Map = NativeMap; }
assert.equal(suppliedPairRows, 0, 'all lazy vocabulary owners omit mapped pair arrays');
console.log('lazy vocabulary owners passed: exact BM25 scores, ordered candidates and phrase constraints agree with prebuilt maps; four first-use pair arrays omitted');
