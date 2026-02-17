#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  usages: ['value', 'value', 'if', 'if'],
  calls: [
    ['run', 'value'],
    ['run', 'value'],
    ['run', 'if'],
    ['run', 'if']
  ],
  callDetails: [
    { caller: 'run', callee: 'value', line: 1, col: 2 },
    { caller: 'run', callee: 'value', line: 1, col: 2 },
    { caller: 'run', callee: 'if', line: 3, col: 4 },
    { caller: 'run', callee: 'if', line: 3, col: 4 }
  ],
  callDetailsWithRange: [
    { caller: 'run', callee: 'value', range: { start: 0, end: 2 } },
    { caller: 'run', callee: 'value', range: { start: 0, end: 2 } },
    { caller: 'run', callee: 'if', range: { start: 3, end: 5 } },
    { caller: 'run', callee: 'if', range: { start: 3, end: 5 } }
  ]
};

const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      stableDedupe: true,
      drop: {
        keywords: false,
        literals: false,
        builtins: false,
        types: false
      }
    }
  }
});

assert.deepEqual(
  filtered.usages,
  ['value', 'if'],
  'expected dedupe-only mode to dedupe usages while preserving stopwords'
);
assert.deepEqual(
  filtered.calls,
  [
    ['run', 'value'],
    ['run', 'if']
  ],
  'expected dedupe-only mode to dedupe calls while preserving stopwords'
);
assert.deepEqual(
  filtered.callDetails,
  [
    { caller: 'run', callee: 'value', line: 1, col: 2 },
    { caller: 'run', callee: 'if', line: 3, col: 4 }
  ],
  'expected dedupe-only mode to dedupe callDetails while preserving stopwords'
);
assert.deepEqual(
  filtered.callDetailsWithRange,
  [
    { caller: 'run', callee: 'value', range: { start: 0, end: 2 } },
    { caller: 'run', callee: 'if', range: { start: 3, end: 5 } }
  ],
  'expected dedupe-only mode to dedupe callDetailsWithRange while preserving stopwords'
);

console.log('lexicon relations filter dedupe-only test passed');
