#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterWasm,
  preloadTreeSitterLanguages,
  getTreeSitterCacheSnapshot
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';

const resetCaches = () => {
  treeSitterState.languageCache?.clear?.();
  treeSitterState.wasmLanguageCache?.clear?.();
  treeSitterState.languageLoadPromises?.clear?.();
  treeSitterState.sharedParser = null;
  treeSitterState.sharedParserLanguageId = null;
};

const loadSequence = async () => {
  resetCaches();
  await preloadTreeSitterLanguages(['javascript', 'python', 'go'], {
    maxLoadedLanguages: 2,
    skipDispose: true
  });
  return getTreeSitterCacheSnapshot().wasmKeys.slice();
};

const run = async () => {
  const ok = await initTreeSitterWasm({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter wasm unavailable; skipping eviction determinism test.');
    return;
  }

  const first = await loadSequence();
  const second = await loadSequence();

  assert.deepStrictEqual(
    first,
    second,
    'eviction order should be deterministic for the same preload sequence'
  );

  console.log('tree-sitter eviction determinism ok');
};

await run();
