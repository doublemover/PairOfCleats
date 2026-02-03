#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';

const setupStubParser = () => {
  treeSitterState.TreeSitter = treeSitterState.TreeSitter || {};
  treeSitterState.sharedParser = {
    setLanguage() {},
    reset() {},
    setTimeoutMicros() {},
    parse() {
      throw new Error('timeout');
    }
  };
  treeSitterState.sharedParserLanguageId = null;
  treeSitterState.languageCache.set('javascript', { language: {} });
  treeSitterState.timeoutCounts = new Map();
  treeSitterState.disabledLanguages = new Set();
  treeSitterState.loggedTimeoutDisable = new Set();
};

setupStubParser();

const options = {
  treeSitter: { enabled: true, useQueries: false },
  log: () => {}
};
const text = 'function demo() { return 1; }';

for (let i = 0; i < 3; i += 1) {
  const result = buildTreeSitterChunks({ text, languageId: 'javascript', options });
  assert.equal(result, null, 'expected timeout to force fallback');
}

assert.equal(treeSitterState.timeoutCounts.get('javascript'), 3, 'expected timeout count to reach 3');
assert.ok(treeSitterState.disabledLanguages.has('javascript'), 'expected language to be disabled after 3 timeouts');

console.log('tree-sitter timeout disable ok');
