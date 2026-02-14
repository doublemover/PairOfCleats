#!/usr/bin/env node
import assert from 'node:assert/strict';
import { filterRawRelationsWithLexicon } from '../../src/index/build/file-processor/lexicon-relations-filter.js';

const rawRelations = {
  usages: ['if', 'value', 'value'],
  calls: [
    ['run', 'if'],
    ['run', 'value'],
    ['run', 'value']
  ]
};

const dedupeEnabledByLanguageOverride = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      stableDedupe: false,
      drop: {
        keywords: true,
        literals: true
      }
    },
    languageOverrides: {
      python: {
        relations: {
          stableDedupe: true
        }
      }
    }
  }
});

assert.deepEqual(
  dedupeEnabledByLanguageOverride.usages,
  ['value'],
  'language override stableDedupe=true should dedupe usages even when global stableDedupe=false'
);
assert.deepEqual(
  dedupeEnabledByLanguageOverride.calls,
  [['run', 'value']],
  'language override stableDedupe=true should dedupe calls even when global stableDedupe=false'
);

const dedupeDisabledByLanguageOverride = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: true,
      stableDedupe: true,
      drop: {
        keywords: true,
        literals: true
      }
    },
    languageOverrides: {
      python: {
        relations: {
          stableDedupe: false
        }
      }
    }
  }
});

assert.deepEqual(
  dedupeDisabledByLanguageOverride.usages,
  ['value', 'value'],
  'language override stableDedupe=false should preserve duplicate usages'
);
assert.deepEqual(
  dedupeDisabledByLanguageOverride.calls,
  [
    ['run', 'value'],
    ['run', 'value']
  ],
  'language override stableDedupe=false should preserve duplicate calls'
);

console.log('lexicon relations language override stableDedupe test passed');
