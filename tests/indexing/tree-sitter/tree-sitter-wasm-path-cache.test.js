#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterWasm,
  preflightTreeSitterWasmLanguages,
  getTreeSitterStats
} from '../../../src/lang/tree-sitter.js';

const run = async () => {
  const ok = await initTreeSitterWasm({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter wasm unavailable; skipping wasm path cache test.');
    return;
  }

  await preflightTreeSitterWasmLanguages(['javascript'], { log: () => {} });
  const stats = getTreeSitterStats();
  assert.ok(stats.paths.wasmRoot, 'expected wasmRoot to be cached');
  assert.ok(stats.paths.wasmRuntimePath, 'expected wasmRuntimePath to be cached');

  console.log('tree-sitter wasm path cache ok');
};

await run();
