#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseElixirSignature } from '../../../src/index/tooling/signature-parse/elixir.js';

const cases = [
  {
    detail: 'greet(name :: String.t()) :: String.t()',
    expectedReturn: 'String.t()',
    expectedParams: { name: 'String.t()' }
  },
  {
    detail: 'sum(a :: integer(), b :: integer()) :: integer()',
    expectedReturn: 'integer()',
    expectedParams: { a: 'integer()', b: 'integer()' }
  },
  {
    detail: 'run(name, opts \\\\ [])',
    expectedReturn: null,
    expectedParams: {}
  }
];

for (const testCase of cases) {
  const parsed = parseElixirSignature(testCase.detail);
  assert.ok(parsed, `expected parser output for: ${testCase.detail}`);
  assert.equal(parsed.returnType, testCase.expectedReturn, `unexpected return type for: ${testCase.detail}`);
  for (const [name, type] of Object.entries(testCase.expectedParams)) {
    assert.equal(parsed.paramTypes?.[name], type, `unexpected param type for ${name} in: ${testCase.detail}`);
  }
}

const invalid = parseElixirSignature('not an elixir signature');
assert.equal(invalid, null, 'expected null for non-signature detail');

console.log('elixir signature parse test passed');
