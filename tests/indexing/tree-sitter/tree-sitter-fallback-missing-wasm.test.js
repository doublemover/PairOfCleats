#!/usr/bin/env node
import assert from 'node:assert/strict';

import { buildTreeSitterChunks } from '../../../src/lang/tree-sitter.js';

const missing = new Set();
const result = buildTreeSitterChunks({
  text: 'function demo() {}',
  languageId: 'javascript',
  options: {
    treeSitter: { enabled: true },
    treeSitterMissingLanguages: missing,
    log: () => {}
  }
});

assert.equal(result, null, 'expected missing grammar to fall back to heuristic chunking');
assert.ok(missing.has('javascript'), 'expected missing grammar to be recorded');

console.log('tree-sitter missing wasm fallback ok');
