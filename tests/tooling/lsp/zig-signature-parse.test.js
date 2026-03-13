#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseZigSignature } from '../../../src/index/tooling/signature-parse/zig.js';

const cases = [
  {
    detail: 'fn add(a: i32, b: i32) i32',
    expectedReturn: 'i32',
    expectedParams: { a: 'i32', b: 'i32' }
  },
  {
    detail: 'pub fn run(self: *Self, input: []const u8) !void',
    expectedReturn: '!void',
    expectedParams: { self: '*Self', input: '[]const u8' }
  },
  {
    detail: 'fn map(comptime T: type, values: []const T) []T',
    expectedReturn: '[]T',
    expectedParams: { T: 'type', values: '[]const T' }
  }
];

for (const testCase of cases) {
  const parsed = parseZigSignature(testCase.detail);
  assert.ok(parsed, `expected parser output for: ${testCase.detail}`);
  assert.equal(parsed.returnType, testCase.expectedReturn, `unexpected return type for: ${testCase.detail}`);
  for (const [name, type] of Object.entries(testCase.expectedParams)) {
    assert.equal(parsed.paramTypes?.[name], type, `unexpected param type for ${name} in: ${testCase.detail}`);
  }
}

const invalid = parseZigSignature('not a zig signature');
assert.equal(invalid, null, 'expected null for non-signature detail');

console.log('zig signature parse test passed');
