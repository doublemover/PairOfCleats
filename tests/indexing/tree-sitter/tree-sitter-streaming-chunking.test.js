#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterWasm,
  preloadTreeSitterLanguages,
  buildTreeSitterChunks
} from '../../../src/lang/tree-sitter.js';

const run = async () => {
  const ok = await initTreeSitterWasm({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter wasm unavailable; skipping streaming chunking test.');
    return;
  }

  await preloadTreeSitterLanguages(['javascript'], {
    maxLoadedLanguages: 1,
    skipDispose: true
  });

  const bodies = [];
  for (let i = 0; i < 50; i += 1) {
    bodies.push(`function fn${i}() { return ${i}; }`);
  }
  const text = bodies.join('\n');

  const limited = buildTreeSitterChunks({
    text,
    languageId: 'javascript',
    options: {
      treeSitter: {
        enabled: true,
        maxLoadedLanguages: 1,
        maxChunkNodes: 3,
        useQueries: false
      },
      log: () => {}
    }
  });

  assert.equal(limited, null, 'expected chunking to bail out when maxChunkNodes is exceeded');

  const full = buildTreeSitterChunks({
    text,
    languageId: 'javascript',
    options: {
      treeSitter: {
        enabled: true,
        maxLoadedLanguages: 1,
        maxChunkNodes: 100,
        useQueries: false
      },
      log: () => {}
    }
  });

  assert.ok(Array.isArray(full) && full.length > 5, 'expected traversal chunking to succeed with higher limits');

  console.log('tree-sitter streaming chunking ok');
};

await run();
