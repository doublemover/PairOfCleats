#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  getTreeSitterCacheSnapshot
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';

const resetCaches = () => {
  treeSitterState.languageCache?.clear?.();
  treeSitterState.grammarCache?.clear?.();
  treeSitterState.languageLoadPromises?.clear?.();
  treeSitterState.sharedParser = null;
  treeSitterState.sharedParserLanguageId = null;
};

const loadSequence = async () => {
  resetCaches();
  await preloadTreeSitterLanguages(['javascript', 'python', 'go'], {
    skipDispose: true
  });
  return getTreeSitterCacheSnapshot().loadedLanguages.slice();
};

const run = async () => {
  const ok = await initTreeSitterRuntime({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping eviction determinism test.');
    return;
  }

  const first = await loadSequence();
  const second = await loadSequence();

  assert.deepStrictEqual(
    first,
    second,
    'preload activation order should be deterministic for the same preload sequence'
  );

  console.log('tree-sitter preload determinism ok');
};

await run();


