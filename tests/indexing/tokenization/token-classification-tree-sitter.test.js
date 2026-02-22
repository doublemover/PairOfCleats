#!/usr/bin/env node
import assert from 'node:assert/strict';
import { preflightTreeSitterLanguages, preloadTreeSitterLanguages } from '../../../src/lang/tree-sitter.js';
import { createTokenizationContext, tokenizeChunkText } from '../../../src/index/build/tokenization.js';

const preflight = await preflightTreeSitterLanguages(['javascript']);
if (!preflight.ok || preflight.missing.includes('javascript') || preflight.unavailable.includes('javascript')) {
  console.log('tree-sitter runtime unavailable; skipping token classification tree-sitter test.');
  process.exit(0);
}
const preload = await preloadTreeSitterLanguages(['javascript'], { parallel: false, maxLoadedLanguages: 1 });
if (!Array.isArray(preload.loaded) || !preload.loaded.includes('javascript')) {
  console.log('tree-sitter javascript grammar failed to load; skipping token classification tree-sitter test.');
  process.exit(0);
}

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
