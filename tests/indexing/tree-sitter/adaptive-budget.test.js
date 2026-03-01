#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  buildTreeSitterChunks,
  resetTreeSitterStats
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';

const run = async () => {
  const ok = await initTreeSitterRuntime({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping adaptive budget test.');
    return;
  }

  await preloadTreeSitterLanguages(['javascript'], { skipDispose: true });
  resetTreeSitterStats();

  treeSitterState.nodeDensity.set('javascript', { density: 1000, samples: 1 });

  const before = treeSitterState.metrics.adaptiveBudgetCuts;
  const text = 'export function demo() { return 1; }';
  const chunks = buildTreeSitterChunks({
    text,
    languageId: 'javascript',
    options: {
      treeSitter: {
        enabled: true,
        useQueries: false
      },
      log: () => {}
    }
  });

  assert.ok(Array.isArray(chunks) && chunks.length, 'expected tree-sitter chunking to work');
  assert.ok(
    treeSitterState.metrics.adaptiveBudgetCuts > before,
    'expected adaptive budget scaling to be applied'
  );

  console.log('tree-sitter adaptive budget ok');
};

await run();


