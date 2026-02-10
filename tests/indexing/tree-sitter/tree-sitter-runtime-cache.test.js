#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  getTreeSitterStats,
  getTreeSitterCacheSnapshot
} from '../../../src/lang/tree-sitter.js';

const run = async () => {
  const ok = await initTreeSitterRuntime({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping runtime path cache test.');
    return;
  }

  await preloadTreeSitterLanguages(['javascript'], { log: () => {} });
  const snapshot = getTreeSitterCacheSnapshot();
  const stats = getTreeSitterStats();
  assert.ok(Array.isArray(snapshot.loadedLanguages), 'expected loaded language snapshot');
  assert.ok(snapshot.loadedLanguages.includes('javascript'), 'expected javascript to be loaded');
  assert.ok(Number(stats.grammarLoads) >= 1, 'expected grammar load metric');

  console.log('tree-sitter runtime cache ok');
};

await run();


