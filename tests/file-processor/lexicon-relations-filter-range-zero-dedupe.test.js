#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  callDetailsWithRange: [
    { caller: 'run', callee: 'value', range: { start: 0, end: 5 } },
    { caller: 'run', callee: 'value', range: { end: 5 } },
    { caller: 'run', callee: 'value', range: { start: 0, end: 5 } }
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
        keywords: true,
        literals: true,
        builtins: false,
        types: false
      }
    }
  }
});

assert.equal(
  filtered.callDetailsWithRange?.length,
  2,
  'stable dedupe should keep start=0 range distinct from missing-start range'
);
assert.deepEqual(
  filtered.callDetailsWithRange?.map((entry) => entry.range || null),
  [
    { start: 0, end: 5 },
    { end: 5 }
  ],
  'unexpected callDetailsWithRange entries after stable dedupe'
);

console.log('lexicon relations filter range-zero dedupe test passed');
