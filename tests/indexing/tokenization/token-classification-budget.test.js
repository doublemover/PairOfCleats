#!/usr/bin/env node
import assert from 'node:assert/strict';

import { preloadTreeSitterLanguages } from '../../../src/lang/tree-sitter.js';
import {
  createTokenClassificationRuntime,
  createTokenizationContext,
  tokenizeChunkText
} from '../../../src/index/build/tokenization.js';

await preloadTreeSitterLanguages(['javascript'], { parallel: false, maxLoadedLanguages: 1 });

const context = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: {},
  postingsConfig: {
    tokenClassification: {
      enabled: true,
      treeSitterMaxChunkBytes: 4096,
      treeSitterMaxFileBytes: 8192,
      treeSitterMaxChunksPerFile: 1,
      treeSitterMaxBytesPerFile: 4096
    }
  },
  treeSitter: {
    enabled: true,
    languages: { javascript: true }
  }
});

context.tokenClassificationRuntime = createTokenClassificationRuntime({
  context,
  fileBytes: 2048
});

const first = tokenizeChunkText({
  text: 'function one(v) { return v + 1; }',
  mode: 'code',
  ext: '.js',
  languageId: 'javascript',
  context
});
assert.ok(first.keywordTokens.includes('function'), 'expected first chunk classification');
assert.equal(context.tokenClassificationRuntime.remainingChunks, 0, 'expected chunk budget to be consumed');

const second = tokenizeChunkText({
  text: 'function two(v) { return v + 2; }',
  mode: 'code',
  ext: '.js',
  languageId: 'javascript',
  context
});
assert.ok(second.identifierTokens.includes('two'), 'expected fallback token classification');
assert.equal(context.tokenClassificationRuntime.treeSitterEnabled, false, 'expected runtime to disable tree-sitter after budget');
assert.equal(context.tokenClassificationRuntime.treeSitterDisabledReason, 'chunk-budget', 'expected chunk-budget disable reason');

const fileCapContext = createTokenizationContext({
  dictWords: new Set(),
  dictConfig: {},
  postingsConfig: {
    tokenClassification: {
      enabled: true,
      treeSitterMaxChunkBytes: 4096,
      treeSitterMaxFileBytes: 64
    }
  },
  treeSitter: {
    enabled: true,
    languages: { javascript: true }
  }
});
fileCapContext.tokenClassificationRuntime = createTokenClassificationRuntime({
  context: fileCapContext,
  fileBytes: 1024
});
assert.equal(fileCapContext.tokenClassificationRuntime.treeSitterEnabled, false, 'expected file-size cap to disable tree-sitter');
assert.equal(fileCapContext.tokenClassificationRuntime.treeSitterDisabledReason, 'file-size', 'expected file-size disable reason');

const capped = tokenizeChunkText({
  text: 'function capped(v) { return v; }',
  mode: 'code',
  ext: '.js',
  languageId: 'javascript',
  context: fileCapContext
});
assert.ok(capped.keywordTokens.includes('function'), 'expected fallback keyword classification with file-size cap');

console.log('token classification budget test passed');
