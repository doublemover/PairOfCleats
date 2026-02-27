#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  buildTreeSitterChunks
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const resetCaches = () => {
  treeSitterState.queryCache?.clear?.();
  treeSitterState.loggedQueryFailures?.clear?.();
};

const run = async () => {
  const ok = await initTreeSitterRuntime({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping query cache test.');
    return;
  }

  resetCaches();

  await preloadTreeSitterLanguages(['javascript'], {
    skipDispose: true
  });

  const options = {
    treeSitter: {
      enabled: true,
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

  assert.ok(treeSitterState.queryCache.has('javascript'), 'expected query probe result to be cached after first parse');
  const firstQuery = treeSitterState.queryCache.get('javascript');

  const second = buildTreeSitterChunks({ text, languageId: 'javascript', options });
  assert.ok(second && second.length, 'expected query-based chunking to continue working');

  const secondQuery = treeSitterState.queryCache.get('javascript');
  assert.strictEqual(secondQuery, firstQuery, 'expected query to be reused from cache');

  console.log('tree-sitter query cache ok');
};

await run();


