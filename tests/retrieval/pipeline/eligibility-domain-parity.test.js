import assert from 'node:assert/strict';
import { createEligibilityPlan } from '../../../src/retrieval/pipeline/eligibility-plan.js';
import { createQueryAstHelpers } from '../../../src/retrieval/pipeline/query-ast.js';
import { admitSortedPostings } from '../../../src/shared/posting-order.js';
import { SCORING_ANALYZER_VERSION } from '../../../src/shared/tokenize-identifiers.js';
const term = value => ({ type: 'term', tokens: [value] });
const negative = child => ({ type: 'not', child });
const binary = (type, left, right, extra = {}) => ({ type, left, right, ...extra });
const meta = Array.from({ length: 2048 }, (_, id) => ({ id, tokens: id % 3 ? ['common'] : ['common', 'rare'],
  phraseTokens: id % 3 ? ['common'] : ['common', 'rare'] }));
const index = admitSortedPostings({ vocab: ['common', 'rare'], postings: [meta.map(row => [row.id, 1]),
  meta.filter(row => row.id % 3 === 0).map(row => [row.id, 1])] }, { completeVocabulary: true });
const idx = { chunkMeta: meta, tokenIndex: index, state: { features: { scoringAnalyzer: SCORING_ANALYZER_VERSION } } };
for (const ast of [term('rare'), binary('and', term('rare'), term('common')), binary('or', term('rare'), negative(term('common'))),
  negative(term('rare')), binary('or', negative(term('rare')), term('rare')),
  binary('and', term('rare'), { type: 'phrase', tokens: ['common', 'rare'] }, { implicit: true })]) {
  const { matchesQueryAst } = createQueryAstHelpers({ queryAst: ast });
  for (const allowedIdx of [null, new Set([0]), new Set([1, 2, 3])]) {
    const plan = createEligibilityPlan({ idx, mode: 'code', queryAst: ast, allowedIdx, matchesQueryAst });
    for (const semantic of [false, true]) {
      const expected = meta.filter(row => (!allowedIdx || allowedIdx.has(row.id)) && matchesQueryAst(idx, row.id, row, semantic)).map(row => row.id);
      assert.deepEqual([...plan.evaluate({ semantic })].sort((a, b) => a - b), expected);
    }
  }
}
const ast = term('common'), { matchesQueryAst } = createQueryAstHelpers({ queryAst: ast });
const selective = createEligibilityPlan({ idx, mode: 'code', queryAst: ast, allowedIdx: new Set([2047]), matchesQueryAst });
assert.deepEqual([...selective.evaluate()], [2047]);
assert.equal(selective.statistics.metadataVisited, 1);
assert.ok(selective.statistics.postingRows < 32);
const rare = createEligibilityPlan({ idx, mode: 'code', queryAst: term('rare'), matchesQueryAst: createQueryAstHelpers({ queryAst: term('rare') }).matchesQueryAst });
rare.evaluate();
assert.equal(rare.statistics.metadataVisited, index.postings[1].length);
const fallback = createEligibilityPlan({ idx: { ...idx, state: null }, queryAst: ast,
  allowedIdx: new Set([2047]), matchesQueryAst });
assert.deepEqual([...fallback.evaluate()], [2047]);
assert.equal(fallback.statistics.metadataVisited, 1, 'unknown posting authority still applies an admitted filter before metadata');
console.log('Eligibility planning preserves exhaustive Boolean and semantic predicates over narrowed domains.');
