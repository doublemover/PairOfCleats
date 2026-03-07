#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  initTreeSitterRuntime,
  preloadTreeSitterLanguages,
  buildTreeSitterChunks
} from '../../../src/lang/tree-sitter.js';

const run = async () => {
  const ok = await initTreeSitterRuntime({ log: () => {} });
  if (!ok) {
    console.log('tree-sitter runtime unavailable; skipping streaming chunking test.');
    return;
  }

  await preloadTreeSitterLanguages(['javascript'], {
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


