#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildTreeSitterChunks,
  getTreeSitterStats,
  resetTreeSitterStats
} from '../../../src/lang/tree-sitter.js';
import { treeSitterState } from '../../../src/lang/tree-sitter/state.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

resetTreeSitterStats();
treeSitterState.disabledLanguages = new Set(['javascript']);

const options = {
  treeSitter: { enabled: true, useQueries: false },
  log: () => {}
};
const text = 'function demo() { return 1; }';

const before = getTreeSitterStats();
const result = buildTreeSitterChunks({ text, languageId: 'javascript', options });
const after = getTreeSitterStats();
assert.equal(result, null, 'expected disabled language to fall back');
assert.equal(
  Number(after.fallbacks) - Number(before.fallbacks),
  1,
  'expected disabled-language path to increment fallback metric'
);

console.log('tree-sitter disabled-language fallback ok');

