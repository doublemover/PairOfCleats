#!/usr/bin/env node
import assert from 'node:assert/strict';

import { pruneTreeSitterLanguages } from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { LANGUAGE_GRAMMAR_KEYS } from '../../../src/lang/tree-sitter/config.js';

const seedCaches = () => {
  treeSitterState.TreeSitter = treeSitterState.TreeSitter || {};
  treeSitterState.grammarCache.clear();
  treeSitterState.languageCache.clear();

  const add = (lang) => {
    const runtimeKey = LANGUAGE_GRAMMAR_KEYS[lang];
    treeSitterState.grammarCache.set(runtimeKey, { language: null, error: null });
    treeSitterState.languageCache.set(lang, { language: null, error: null });
  };

  add('javascript');
  add('python');
  add('go');
};

seedCaches();

const result = pruneTreeSitterLanguages(['python'], { skipDispose: true });
assert.equal(result.removed, 0, 'prune should not evict native runtime entries');

const remaining = Array.from(treeSitterState.grammarCache.keys());
assert.ok(remaining.includes(LANGUAGE_GRAMMAR_KEYS.javascript), 'expected javascript grammar entry to remain');
assert.ok(remaining.includes(LANGUAGE_GRAMMAR_KEYS.python), 'expected python grammar entry to remain');
assert.ok(remaining.includes(LANGUAGE_GRAMMAR_KEYS.go), 'expected go grammar entry to remain');

console.log('tree-sitter worker prune bounds ok');

