#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  usages: ['if', 'true', 'value'],
  calls: [
    ['run', 'if'],
    ['run', 'true'],
    ['run', 'value']
  ]
};

const filtered = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      drop: {
        keywords: false,
        literals: true
      }
    },
    languageOverrides: {
      python: {
        relations: {
          drop: {
            keywords: true,
            literals: false
          }
        }
      }
    }
  }
});

assert.deepEqual(
  filtered.usages,
  ['true', 'value'],
  'language override should take precedence over global drop flags for usages'
);
assert.deepEqual(
  filtered.calls,
  [
    ['run', 'true'],
    ['run', 'value']
  ],
  'language override should take precedence over global drop flags for calls'
);

console.log('lexicon relations language override precedence test passed');
