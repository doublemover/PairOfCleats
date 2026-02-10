#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveTreeSitterRuntime } from '../../../src/index/build/runtime/tree-sitter.js';

const invalidConfig = resolveTreeSitterRuntime({ treeSitter: { deferMissingMax: 'not-a-number' } });
assert.equal(
  invalidConfig.treeSitterDeferMissingMax,
  2,
  'invalid deferMissingMax should fall back to the default'
);

const disabledConfig = resolveTreeSitterRuntime({ treeSitter: { deferMissingMax: 0 } });
assert.equal(
  disabledConfig.treeSitterDeferMissingMax,
  null,
  'explicit 0 should disable deferMissingMax'
);

console.log('tree-sitter runtime test passed');

