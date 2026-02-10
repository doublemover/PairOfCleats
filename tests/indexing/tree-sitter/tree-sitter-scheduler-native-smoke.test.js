#!/usr/bin/env node
import assert from 'node:assert/strict';

import { applyTestEnv } from '../../helpers/test-env.js';
import { runNativeLanguageContractSuite } from './native-language-contract-suite.js';

applyTestEnv({ testing: '1' });

const result = await runNativeLanguageContractSuite({
  suiteName: 'tree-sitter-scheduler-native-smoke'
});

assert.ok(result.fixturesCovered >= 20, `expected at least 20 fixtures, got ${result.fixturesCovered}`);
assert.ok(result.grammarKeysCovered >= 18, `expected at least 18 grammar keys, got ${result.grammarKeysCovered}`);

console.log(
  `tree-sitter scheduler native smoke contract ok (${result.fixturesCovered} fixtures, ${result.grammarKeysCovered} grammar keys)`
);
