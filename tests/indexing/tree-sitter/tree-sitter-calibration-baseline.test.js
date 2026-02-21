#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTreeSitterRuntime } from '../../../src/index/build/runtime/tree-sitter.js';
import { TREE_SITTER_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';

applyTestEnv();

const resolved = resolveTreeSitterRuntime({ treeSitter: {} });

for (const [languageId, baseline] of Object.entries(TREE_SITTER_CAPS_BASELINES)) {
  const configured = resolved.treeSitterByLanguage[languageId];
  assert.ok(configured, `missing calibrated tree-sitter baseline for ${languageId}`);
  assert.equal(configured.maxBytes, baseline.maxBytes, `tree-sitter maxBytes mismatch for ${languageId}`);
  assert.equal(configured.maxLines, baseline.maxLines, `tree-sitter maxLines mismatch for ${languageId}`);
  assert.equal(configured.maxParseMs, baseline.maxParseMs, `tree-sitter maxParseMs mismatch for ${languageId}`);
}

const partialOverride = resolveTreeSitterRuntime({
  treeSitter: {
    byLanguage: {
      javascript: { maxBytes: 64 * 1024 }
    }
  }
});
assert.equal(partialOverride.treeSitterByLanguage.javascript.maxBytes, 64 * 1024, 'expected tree-sitter maxBytes override to apply');
assert.equal(
  partialOverride.treeSitterByLanguage.javascript.maxLines,
  TREE_SITTER_CAPS_BASELINES.javascript.maxLines,
  'expected tree-sitter maxLines baseline to be preserved for partial overrides'
);
assert.equal(
  partialOverride.treeSitterByLanguage.javascript.maxParseMs,
  TREE_SITTER_CAPS_BASELINES.javascript.maxParseMs,
  'expected tree-sitter maxParseMs baseline to be preserved for partial overrides'
);

console.log('tree-sitter calibration baseline test passed');
