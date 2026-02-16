#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  usages: ['if', 'run', 'true', 'run'],
  calls: [
    ['run', 'if'],
    ['run', 'execute'],
    ['run', 'true'],
    ['run', 'execute']
  ],
  callDetails: [
    { caller: 'run', callee: 'if', line: 1, col: 1 },
    { caller: 'run', callee: 'execute', line: 2, col: 1 }
  ]
};

const config = {
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
};

const first = filterRawRelationsWithLexicon(rawRelations, { languageId: 'python', config });
const second = filterRawRelationsWithLexicon(rawRelations, { languageId: 'python', config });
assert.deepEqual(first, second, 'expected deterministic filtering output for identical input');

console.log('lexicon relations filter determinism test passed');
