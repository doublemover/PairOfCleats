import assert from 'node:assert/strict';
import { parseQueryInput, annotateQueryAst } from '../../../src/retrieval/query.js';
import { applyQueryMatchPolicy } from '../../../src/retrieval/cli/search-controls.js';
import { createQueryAstHelpers } from '../../../src/retrieval/pipeline/query-ast.js';
const matches = (query, text, policy = 'any') => {
  const ast = annotateQueryAst(parseQueryInput(query).ast, new Set(), {}, {});
  const chunk = { tokens: text.split(' '), phraseTokens: text.split(' '), phraseTokensComplete: true };
  return createQueryAstHelpers({ queryAst: applyQueryMatchPolicy(ast, policy) })
    .matchesQueryAst({ chunkMeta: [chunk] }, 0, chunk);
};
for (const negation of ['NOT beta', '-beta', '!beta']) {
  for (const query of [`alpha ${negation}`, `${negation} alpha`, `alpha gamma ${negation}`]) {
    assert.equal(matches(query, 'alpha beta'), false, query);
    assert.equal(matches(query, 'alpha delta'), true, query);
    assert.equal(matches(query, 'omega'), false, query);
  }
  assert.equal(matches(negation, 'alpha'), true);
  assert.equal(matches(negation, 'beta'), false);
}
assert.equal(matches('alpha "beta gamma"', 'alpha'), false);
assert.equal(matches('alpha "beta gamma"', 'beta gamma'), false);
assert.equal(matches('alpha "beta gamma"', 'alpha beta gamma'), true);
assert.equal(matches('alpha gamma "beta delta"', 'gamma beta delta'), true);
assert.equal(matches('alpha NOT "beta gamma"', 'alpha beta gamma'), false);
assert.equal(matches('alpha OR NOT beta', 'omega'), true, 'explicit OR complement remains branch-local');
assert.equal(matches('alpha AND beta', 'alpha'), false);
assert.equal(matches('alpha (beta)', 'alpha'), false);
assert.equal(matches('alpha (beta gamma)', 'alpha beta'), false);
assert.equal(matches('alpha beta', 'alpha', 'auto'), false);
assert.equal(matches('alpha beta', 'alpha', 'all'), false);
console.log('match any preserves authored phrase, negation, group and Boolean gates');
