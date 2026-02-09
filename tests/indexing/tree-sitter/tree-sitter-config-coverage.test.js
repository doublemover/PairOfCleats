#!/usr/bin/env node
import assert from 'node:assert/strict';

import { TREE_SITTER_LANGUAGE_IDS } from '../../../src/lang/tree-sitter.js';
import { LANG_CONFIG } from '../../../src/lang/tree-sitter/config.js';

for (const languageId of TREE_SITTER_LANGUAGE_IDS) {
  const config = LANG_CONFIG[languageId];
  assert.ok(config, `missing tree-sitter config for ${languageId}`);
  assert.ok(
    config.typeNodes instanceof Set,
    `tree-sitter config ${languageId} missing typeNodes Set`
  );
  assert.ok(
    config.memberNodes instanceof Set,
    `tree-sitter config ${languageId} missing memberNodes Set`
  );
  assert.ok(
    config.kindMap && typeof config.kindMap === 'object',
    `tree-sitter config ${languageId} missing kindMap`
  );
}

console.log('tree-sitter config coverage ok');


