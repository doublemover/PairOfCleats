#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseRubySignature } from '../../../src/index/tooling/signature-parse/ruby.js';

const cases = [
  {
    detail: 'greet(name, title = nil) -> String',
    expectedReturn: 'String',
    expectedParams: {}
  },
  {
    detail: 'User#greet(name : String, title : String = nil) -> String',
    expectedReturn: 'String',
    expectedParams: { name: 'String', title: 'String' }
  },
  {
    detail: 'self.build(attrs: Hash, &block) => User',
    expectedReturn: 'User',
    expectedParams: { attrs: 'Hash' }
  }
];

for (const testCase of cases) {
  const parsed = parseRubySignature(testCase.detail);
  assert.ok(parsed, `expected parser output for: ${testCase.detail}`);
  assert.equal(parsed.returnType, testCase.expectedReturn, `unexpected return type for: ${testCase.detail}`);
  for (const [name, type] of Object.entries(testCase.expectedParams)) {
    assert.equal(parsed.paramTypes?.[name], type, `unexpected param type for ${name} in: ${testCase.detail}`);
  }
}

const invalid = parseRubySignature('not a ruby signature');
assert.equal(invalid, null, 'expected null for non-signature detail');

console.log('ruby signature parse test passed');
