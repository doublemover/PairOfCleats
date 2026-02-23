#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildLexiconConfig } from '../../../src/index/build/runtime/policy.js';

const policyDriven = buildLexiconConfig({
  indexingConfig: { lexicon: {} },
  autoPolicy: { quality: { value: 'max' } }
});

assert.equal(policyDriven.enabled, true, 'expected lexicon enabled by default');
assert.equal(policyDriven.relations.enabled, true, 'expected policy-driven relation enablement');
assert.equal(policyDriven.relations.drop.keywords, true, 'expected default keyword retention');
assert.equal(policyDriven.relations.drop.literals, true, 'expected default literal retention');
assert.equal(policyDriven.relations.drop.builtins, false, 'expected default builtin drop disabled');
assert.equal(policyDriven.relations.drop.types, false, 'expected default type drop disabled');

const explicit = buildLexiconConfig({
  indexingConfig: {
    lexicon: {
      enabled: false,
      languageOverrides: { javascript: { relations: { enabled: false } } },
      relations: {
        enabled: false,
        stableDedupe: true,
        drop: {
          keywords: false,
          literals: true,
          builtins: true,
          types: true
        }
      }
    }
  },
  autoPolicy: { quality: { value: 'max' } }
});

assert.equal(explicit.enabled, false, 'expected explicit lexicon disable override');
assert.equal(explicit.relations.enabled, false, 'expected explicit relations disable override');
assert.equal(explicit.relations.stableDedupe, true, 'expected stable dedupe passthrough');
assert.equal(explicit.relations.drop.keywords, false, 'expected explicit keyword drop toggle');
assert.equal(explicit.relations.drop.literals, true, 'expected explicit literal drop toggle');
assert.equal(explicit.relations.drop.builtins, true, 'expected explicit builtin drop toggle');
assert.equal(explicit.relations.drop.types, true, 'expected explicit type drop toggle');
assert.deepEqual(
  explicit.languageOverrides,
  { javascript: { relations: { enabled: false } } },
  'expected language override passthrough'
);

console.log('lexicon policy config test passed');
