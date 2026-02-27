#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  isIncompleteTypePayload,
  scoreSignatureInfo
} from '../../../src/integrations/tooling/providers/lsp/hover-types.js';

const weak = {
  signature: 'add',
  returnType: 'int',
  paramNames: ['a', 'b'],
  paramTypes: {}
};

const strong = {
  signature: 'int add(int a, int b)',
  returnType: 'int',
  paramNames: ['a', 'b'],
  paramTypes: { a: 'int', b: 'int' }
};

const weakCompleteness = isIncompleteTypePayload(weak, { symbolKind: 12 });
assert.equal(weakCompleteness.incomplete, true, 'expected weak payload to be incomplete');
assert.equal(weakCompleteness.missingParamTypes, true, 'expected weak payload to miss typed params');

const strongCompleteness = isIncompleteTypePayload(strong, { symbolKind: 12 });
assert.equal(strongCompleteness.incomplete, false, 'expected strong payload to be complete');

const weakScore = scoreSignatureInfo(weak, { symbolKind: 12 });
const strongScore = scoreSignatureInfo(strong, { symbolKind: 12 });
assert.equal(strongScore.total > weakScore.total, true, 'expected strong payload score to exceed weak score');

const ambiguous = {
  signature: 'fn add(a, b) -> any',
  returnType: 'any',
  paramNames: ['a', 'b'],
  paramTypes: { a: 'int', b: 'int' }
};
const ambiguousCompleteness = isIncompleteTypePayload(ambiguous, { symbolKind: 12 });
assert.equal(ambiguousCompleteness.missingReturn, true, 'expected ambiguous return to be treated as incomplete');

console.log('LSP signature quality score test passed');
