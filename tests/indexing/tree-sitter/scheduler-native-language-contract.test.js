#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNativeLanguageContractSuite } from './native-language-contract-suite.js';

applyTestEnv({ testing: '1' });

const result = await runNativeLanguageContractSuite({
  suiteName: 'tree-sitter-scheduler-native-language-contract'
});
if (result?.skipped) {
  console.log(`tree-sitter scheduler native language contract skipped: unavailable grammars (${result.unavailable.join(', ')}).`);
  process.exit(0);
}

console.log(
  `tree-sitter scheduler native language contract ok (${result.fixturesCovered} fixtures, ${result.grammarKeysCovered} grammar keys)`
);
