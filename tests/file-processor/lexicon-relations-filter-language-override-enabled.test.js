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

const languageDisabled = filterRawRelationsWithLexicon(rawRelations, {
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
    },
    languageOverrides: {
      python: {
        relations: {
          enabled: false
        }
      }
    }
  }
});

assert.deepEqual(
  languageDisabled,
  rawRelations,
  'language override relations.enabled=false should bypass filtering and dedupe for that language'
);

const languageEnabledOverGlobalOff = filterRawRelationsWithLexicon(rawRelations, {
  languageId: 'python',
  config: {
    enabled: true,
    relations: {
      enabled: false,
      stableDedupe: false,
      drop: {
        keywords: true,
        literals: true,
        builtins: false,
        types: false
      }
    },
    languageOverrides: {
      python: {
        relations: {
          enabled: true,
          stableDedupe: true
        }
      }
    }
  }
});

assert.deepEqual(
  languageEnabledOverGlobalOff.usages,
  ['value'],
  'language override relations.enabled=true should re-enable filtering when global relations are disabled'
);
assert.deepEqual(
  languageEnabledOverGlobalOff.calls,
  [['run', 'value']],
  'language override relations.enabled=true should re-enable call filtering and dedupe when global relations are disabled'
);

console.log('lexicon relations language override enabled test passed');
