#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterWasm,
  preloadTreeSitterLanguages,
  buildTreeSitterChunks
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';

const resetCaches = () => {
  treeSitterState.queryCache?.clear?.();
  treeSitterState.loggedQueryFailures?.clear?.();
};

const run = async () => {
  const ok = await initTreeSitterWasm({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter wasm unavailable; skipping query cache test.');
    return;
  }

  resetCaches();

  await preloadTreeSitterLanguages(['javascript'], {
    maxLoadedLanguages: 1,
    skipDispose: true
  });

  const options = {
    treeSitter: {
      enabled: true,
      maxLoadedLanguages: 1,
      useQueries: true
    },
    log: () => {}
  };

  const text = 'export class Widget { greet() {} }';
  const first = buildTreeSitterChunks({ text, languageId: 'javascript', options });
  if (!Array.isArray(first) || !first.length) {
    console.log('tree-sitter chunking unavailable; skipping query cache test.');
    return;
  }

  const firstQuery = treeSitterState.queryCache.get('javascript');
  assert.ok(firstQuery, 'expected a cached query after first parse');

  const second = buildTreeSitterChunks({ text, languageId: 'javascript', options });
  assert.ok(second && second.length, 'expected query-based chunking to continue working');

  const secondQuery = treeSitterState.queryCache.get('javascript');
  assert.strictEqual(secondQuery, firstQuery, 'expected query to be reused from cache');

  console.log('tree-sitter query cache ok');
};

await run();
