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

const skippedEntries = [
  { rel: '.github/workflows/ci.yml', ext: '.yml' },
  { rel: 'docs/mkdocs/docs/api/basic_json/dump.md', ext: '.md' },
  { rel: 'src/core/main.cpp', ext: '.cpp' }
];
applyTreeSitterBatching(skippedEntries, { enabled: true }, { verbose: false }, { allowReorder: false });
assert.equal(skippedEntries[0].treeSitterBatchKey, 'yaml');
assert.equal(skippedEntries[1].treeSitterBatchKey, 'none');
assert.equal(skippedEntries[2].treeSitterBatchKey, 'cpp');

console.log('tree-sitter batch-by-language ok');

