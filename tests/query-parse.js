#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseQueryInput } from '../src/retrieval/query.js';

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

console.log('query parse tests passed');
