#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseSwiftSignature } from '../../../src/index/tooling/signature-parse/swift.js';

const cases = [
  {
    detail: 'func greet(name: String) -> String',
    expectedReturn: 'String',
    expectedParams: { name: 'String' }
  },
  {
    detail: 'func process<T>(_ value: T, using block: @escaping (T) -> Void) -> Result<T, Error>',
    expectedReturn: 'Result<T, Error>',
    expectedParams: { value: 'T', block: '(T) -> Void' }
  },
  {
    detail: 'func load() async throws -> [String: Int]',
    expectedReturn: '[String: Int]',
    expectedParams: {}
  },
  {
    detail: 'init?(rawValue: Int)',
    expectedReturn: 'Self',
    expectedParams: { rawValue: 'Int' }
  },
  {
    detail: 'var title: Swift.String { get }',
    expectedReturn: 'String',
    expectedParams: {}
  },
  {
    detail: `render(view:)
func render(view: View) -> Swift.Int`,
    expectedReturn: 'Int',
    expectedParams: { view: 'View' }
  }
];

for (const testCase of cases) {
  const parsed = parseSwiftSignature(testCase.detail);
  assert.ok(parsed, `expected parser output for: ${testCase.detail}`);
  assert.equal(parsed.returnType, testCase.expectedReturn, `unexpected return type for: ${testCase.detail}`);
  for (const [name, type] of Object.entries(testCase.expectedParams)) {
    assert.equal(parsed.paramTypes?.[name], type, `unexpected param type for ${name} in: ${testCase.detail}`);
  }
}

const invalid = parseSwiftSignature('not a signature');
assert.equal(invalid, null, 'expected null for non-signature detail');

console.log('swift signature parse test passed');
