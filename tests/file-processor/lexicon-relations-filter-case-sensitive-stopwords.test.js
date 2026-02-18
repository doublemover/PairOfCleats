#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  usages: ['If', 'if', 'True', 'true', 'value'],
  calls: [
    ['run', 'If'],
    ['run', 'if'],
    ['run', 'obj.True'],
    ['run', 'obj.true'],
    ['run', 'value']
  ],
  callDetails: [
    { caller: 'run', callee: 'If', line: 1, col: 1 },
    { caller: 'run', callee: 'if', line: 2, col: 1 },
    { caller: 'run', callee: 'obj.True', line: 3, col: 1 },
    { caller: 'run', callee: 'obj.true', line: 4, col: 1 },
    { caller: 'run', callee: 'value', line: 5, col: 1 }
  ],
  callDetailsWithRange: [
    { caller: 'run', callee: 'If', range: { start: 0, end: 1 } },
    { caller: 'run', callee: 'if', range: { start: 2, end: 3 } },
    { caller: 'run', callee: 'obj.True', range: { start: 4, end: 5 } },
    { caller: 'run', callee: 'obj.true', range: { start: 6, end: 7 } },
    { caller: 'run', callee: 'value', range: { start: 8, end: 9 } }
  ]
};

const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      drop: {
        keywords: true,
        literals: true,
        builtins: false,
        types: false
      }
    }
  }
});

assert.deepEqual(
  filtered.usages,
  ['If', 'True', 'value'],
  'expected case-sensitive usages to avoid lowercase stopword coercion'
);
assert.deepEqual(
  filtered.calls,
  [
    ['run', 'If'],
    ['run', 'obj.True'],
    ['run', 'value']
  ],
  'expected case-sensitive calls to keep uppercase identifier variants'
);
assert.deepEqual(
  filtered.callDetails?.map((entry) => entry.callee),
  ['If', 'obj.True', 'value'],
  'expected case-sensitive callDetails to keep uppercase identifier variants'
);
assert.deepEqual(
  filtered.callDetailsWithRange?.map((entry) => entry.callee),
  ['If', 'obj.True', 'value'],
  'expected case-sensitive callDetailsWithRange to keep uppercase identifier variants'
);

console.log('lexicon relations filter case-sensitive stopwords test passed');
