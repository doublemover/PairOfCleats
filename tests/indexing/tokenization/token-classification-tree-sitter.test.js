#!/usr/bin/env node
import assert from 'node:assert/strict';
import { preloadTreeSitterLanguages } from '../../../src/lang/tree-sitter.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';

await preloadTreeSitterLanguages(['javascript'], { parallel: false, maxLoadedLanguages: 1 });

const context = createTokenizationContext({
  dictWords: new Set(['world']),
  dictConfig: {},
  postingsConfig: {
    tokenClassification: { enabled: true }
  },
  treeSitter: {
    enabled: true,
    languages: { javascript: true }
  }
});

const text = 'function greet(name) { if (name === "World") return 42; }';
const result = tokenizeChunkText({
  text,
  mode: 'code',
  ext: '.js',
  languageId: 'javascript',
  context
});

assert.ok(result.identifierTokens.includes('greet'), 'expected greet identifier');
assert.ok(result.identifierTokens.includes('name'), 'expected name identifier');
assert.ok(result.keywordTokens.includes('function'), 'expected function keyword');
assert.ok(result.keywordTokens.includes('if'), 'expected if keyword');
assert.ok(
  result.operatorTokens.some((tok) => tok === '===' || tok === '(' || tok === ')'),
  'expected operator tokens'
);
assert.ok(result.literalTokens.includes('42'), 'expected numeric literal');
assert.ok(result.literalTokens.includes('world'), 'expected string literal token');

console.log('token classification tree-sitter test passed');
