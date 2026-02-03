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

const run = async () => {
  const ok = await initTreeSitterWasm({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter wasm unavailable; skipping preload limited test.');
    return;
  }

  resetCaches();

  await preloadTreeSitterLanguages(['javascript', 'python'], {
    maxLoadedLanguages: 1,
    skipDispose: true
  });

  const snapshot = getTreeSitterCacheSnapshot();
  assert.equal(
    snapshot.wasmKeys.length,
    1,
    'preload should respect maxLoadedLanguages'
  );

  console.log('tree-sitter preload limited ok');
};

await run();
