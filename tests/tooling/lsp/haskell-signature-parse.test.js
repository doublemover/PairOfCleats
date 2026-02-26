#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseHaskellSignature } from '../../../src/index/tooling/signature-parse/haskell.js';

const cases = [
  {
    detail: 'greet :: Text -> Text',
    expectedReturn: 'Text',
    expectedParams: { arg1: 'Text' }
  },
  {
    detail: 'sumTwo :: Int -> Int -> Int',
    expectedReturn: 'Int',
    expectedParams: { arg1: 'Int', arg2: 'Int' }
  },
  {
    detail: 'mkPair :: a -> b -> (a, b)',
    expectedReturn: '(a, b)',
    expectedParams: { arg1: 'a', arg2: 'b' }
  }
];

for (const testCase of cases) {
  const parsed = parseHaskellSignature(testCase.detail);
  assert.ok(parsed, `expected parser output for: ${testCase.detail}`);
  assert.equal(parsed.returnType, testCase.expectedReturn, `unexpected return type for: ${testCase.detail}`);
  for (const [name, type] of Object.entries(testCase.expectedParams)) {
    assert.equal(parsed.paramTypes?.[name], type, `unexpected param type for ${name} in: ${testCase.detail}`);
  }
}

const invalid = parseHaskellSignature('not a haskell signature');
assert.equal(invalid, null, 'expected null for non-signature detail');

console.log('haskell signature parse test passed');
