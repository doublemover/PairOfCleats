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

const run = async () => {
  const ok = await initTreeSitterRuntime({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping preload limited test.');
    return;
  }

  resetCaches();

  await preloadTreeSitterLanguages(['javascript', 'python'], {
    skipDispose: true
  });

  const snapshot = getTreeSitterCacheSnapshot();
  assert.ok(snapshot.loadedLanguages.includes('javascript'), 'expected javascript preload entry');
  assert.ok(snapshot.loadedLanguages.includes('python'), 'expected python preload entry');
  assert.ok(snapshot.loadedLanguages.length >= 2, 'expected preload to activate all requested languages');

  console.log('tree-sitter preload limited ok');
};

await run();


