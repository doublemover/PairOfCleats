#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTreeSitterBatching } from '../../../src/index/build/indexer/steps/process-files/tree-sitter.js';

const entries = [
  { rel: 'b.py', ext: '.py' },
  { rel: 'a.js', ext: '.js' },
  { rel: 'c.js', ext: '.js' }
];

applyTreeSitterBatching(entries, { enabled: true }, { verbose: false }, { allowReorder: true });

assert.equal(entries[0].treeSitterBatchKey, 'javascript');
assert.equal(entries[1].treeSitterBatchKey, 'javascript');
assert.equal(entries[2].treeSitterBatchKey, 'python');

assert.equal(entries[0].rel, 'a.js');
assert.equal(entries[1].rel, 'c.js');
assert.equal(entries[2].rel, 'b.py');

console.log('tree-sitter batch-by-language ok');
