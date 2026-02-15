#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  callDetails: [
    { caller: 'run', callee: 'obj.execute', start: 0, startLine: 1, startCol: 0 },
    { caller: 'run', callee: 'obj.execute', start: 10, startLine: 2, startCol: 2 },
    { caller: 'run', callee: 'obj.execute', start: 0, startLine: 1, startCol: 0 },
    { caller: 'run', callee: 'obj.execute', line: 9, col: 7 },
    { caller: 'run', callee: 'obj.execute', line: 9, col: 7 }
  ]
};

const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'javascript',
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
  filtered.callDetails,
  [
    { caller: 'run', callee: 'obj.execute', start: 0, startLine: 1, startCol: 0 },
    { caller: 'run', callee: 'obj.execute', start: 10, startLine: 2, startCol: 2 },
    { caller: 'run', callee: 'obj.execute', line: 9, col: 7 }
  ],
  'stable dedupe should retain distinct JS/TS callsites and dedupe true duplicates'
);

console.log('lexicon relations filter callDetails offset dedupe test passed');
