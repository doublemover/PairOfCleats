#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTreeSitterRuntime } from '../../../src/index/build/runtime/tree-sitter.js';
import { TREE_SITTER_CAPS_BASELINES } from '../../../src/index/build/runtime/caps-calibration.js';

const resolved = resolveTreeSitterRuntime({ treeSitter: {} });

for (const [languageId, baseline] of Object.entries(TREE_SITTER_CAPS_BASELINES)) {
  const configured = resolved.treeSitterByLanguage[languageId];
  assert.ok(configured, `missing calibrated tree-sitter baseline for ${languageId}`);
  assert.equal(configured.maxBytes, baseline.maxBytes, `tree-sitter maxBytes mismatch for ${languageId}`);
  assert.equal(configured.maxLines, baseline.maxLines, `tree-sitter maxLines mismatch for ${languageId}`);
  assert.equal(configured.maxParseMs, baseline.maxParseMs, `tree-sitter maxParseMs mismatch for ${languageId}`);
}

console.log('tree-sitter calibration baseline test passed');