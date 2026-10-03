#!/usr/bin/env node
import assert from 'node:assert/strict';

import { classifyQuery, resolveIntentFieldWeights, resolveIntentVectorMode } from '../../../src/retrieval/query-intent.js';
import { parseQueryInput, parseQueryWithFallback } from '../../../src/retrieval/query.js';

const cases = [
  {
    name: 'query parsing covers phrases, negation, nesting, and syntax errors',
    run() {
      const basic = parseQueryInput('alpha "beta gamma"');
      assert.deepEqual(basic.includeTerms, ['alpha']);
      assert.deepEqual(basic.phrases, ['beta gamma']);

      const implicit = parseQueryInput('alpha beta');
      assert.deepEqual(implicit.includeTerms, ['alpha', 'beta']);

      const negated = parseQueryInput('alpha NOT "beta"');
      assert.deepEqual(negated.excludePhrases, ['beta']);

      const unary = parseQueryInput('-alpha');
      assert.deepEqual(unary.excludeTerms, ['alpha']);

      const nestedQuote = parseQueryInput('"alpha \'beta\'"');
      assert.deepEqual(nestedQuote.phrases, ["alpha 'beta'"]);

      const nested = parseQueryInput('alpha OR (beta AND gamma)');
      assert.equal(nested.ast.type, 'or');
      assert.equal(nested.ast.right.type, 'and');

      assert.throws(() => parseQueryInput('alpha "beta'), /Unbalanced quote/i);
      assert.throws(() => parseQueryInput('(alpha'), /Missing closing/i);
      assert.throws(() => parseQueryInput('AND alpha'), /Unexpected token/i);
    }
  },
  {
    name: 'intent classification drives field weights, vector mode, and miss taxonomy',
    run() {
      const intentCases = [
        { query: 'src/utils/file.ts', tokens: ['src/utils/file.ts'], phrases: [], expect: 'path' },
        { query: 'renderToString', tokens: ['renderToString'], phrases: [], expect: 'code' },
        { query: 'how to configure proxy headers', tokens: ['how', 'to', 'configure', 'proxy', 'headers'], phrases: [], expect: 'prose' },
        { query: 'parse json', tokens: ['parse', 'json'], phrases: ['parse json'], expect: 'mixed' }
      ];
      for (const sample of intentCases) {
        const info = classifyQuery({
          query: sample.query,
          tokens: sample.tokens,
          phrases: sample.phrases
        });
        assert.equal(info.type, sample.expect, `intent mismatch for ${sample.query}`);
      }

      const proseIntent = classifyQuery({
        query: 'how to configure proxy headers',
        tokens: ['how', 'to', 'configure', 'proxy', 'headers'],
        phrases: []
      });
      const weights = resolveIntentFieldWeights(null, proseIntent);
      assert.ok(weights && weights.doc > weights.name);
      assert.equal(resolveIntentVectorMode('auto', proseIntent), 'doc');

      const cjkIntent = classifyQuery({
        query: '検索 機能',
        tokens: ['検索', '機能'],
        phrases: []
      });
      assert.equal(cjkIntent?.missTaxonomy?.labels?.includes('lexical_language_segmentation'), true);

      const symbolHeavyIntent = classifyQuery({
        query: 'foo::bar && baz',
        tokens: ['foo', '::', 'bar', '&&', 'baz'],
        phrases: []
      });
      assert.equal(symbolHeavyIntent?.missTaxonomy?.labels?.includes('rank_symbol_heavy_query'), true);
    }
  },
  {
    name: 'compound negation stays a hard error across parser paths',
    run() {
      const simple = parseQueryInput('NOT alpha');
      assert.deepEqual(simple.excludeTerms, ['alpha']);
      assert.throws(
        () => parseQueryInput('NOT (alpha AND beta)'),
        /Compound negation is not supported/i
      );
      assert.throws(
        () => parseQueryInput('NOT (alpha OR "beta gamma")'),
        /Compound negation is not supported/i
      );
      assert.throws(
        () => parseQueryWithFallback('NOT (alpha AND beta)'),
        /Compound negation is not supported/i
      );
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('query contract matrix test passed');
