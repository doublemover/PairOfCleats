#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  getTreeSitterStats,
  getTreeSitterCacheSnapshot
} from '../../../src/lang/tree-sitter.js';
import { warmupNativeTreeSitterParsers } from '../../../src/lang/tree-sitter/native-runtime.js';

const run = async () => {
  const ok = await initTreeSitterRuntime({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping runtime path cache test.');
    return;
  }

  await preloadTreeSitterLanguages(['javascript'], { log: () => {} });
  const warmup = warmupNativeTreeSitterParsers(['javascript', 'not-a-real-grammar'], {
    nativeParserCacheSize: 2,
    log: () => {}
  });
  const snapshot = getTreeSitterCacheSnapshot();
  const stats = getTreeSitterStats();
  assert.ok(Array.isArray(snapshot.loadedLanguages), 'expected loaded language snapshot');
  assert.ok(snapshot.loadedLanguages.includes('javascript'), 'expected javascript to be loaded');
  assert.ok(Number(stats.grammarLoads) >= 1, 'expected grammar load metric');
  assert.ok(Array.isArray(warmup.warmed), 'expected warmup result');
  assert.ok(Array.isArray(warmup.failed), 'expected warmup failures');
  assert.ok(warmup.failed.includes('not-a-real-grammar'), 'expected invalid grammar warmup to fail');

  console.log('tree-sitter runtime cache ok');
};

await run();


