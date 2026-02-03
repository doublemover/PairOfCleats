#!/usr/bin/env node
import assert from 'node:assert/strict';

import { pruneTreeSitterLanguages } from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { LANGUAGE_WASM_FILES } from '../../../src/lang/tree-sitter/config.js';

const seedCaches = () => {
  treeSitterState.TreeSitter = treeSitterState.TreeSitter || {};
  treeSitterState.wasmLanguageCache.clear();
  treeSitterState.languageCache.clear();

  const add = (lang) => {
    const wasmKey = LANGUAGE_WASM_FILES[lang];
    treeSitterState.wasmLanguageCache.set(wasmKey, { language: null, error: null });
    treeSitterState.languageCache.set(lang, { language: null, error: null });
  };

  add('javascript');
  add('python');
  add('go');
};

seedCaches();

const result = pruneTreeSitterLanguages(['python'], { skipDispose: true });
assert.equal(result.kept, 1, 'prune should keep only the requested language');

const remaining = Array.from(treeSitterState.wasmLanguageCache.keys());
assert.deepStrictEqual(
  remaining,
  [LANGUAGE_WASM_FILES.python],
  'prune should remove non-requested wasm entries'
);

console.log('tree-sitter worker prune bounds ok');
