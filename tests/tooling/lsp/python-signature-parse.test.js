#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parsePythonSignature } from '../../../src/index/tooling/signature-parse/python.js';

const cases = [
  {
    detail: 'def greet(name: str) -> str:',
    returnType: 'str',
    params: { name: 'str' }
  },
  {
    detail: [
      '```python',
      'def greet(name: str, count: int = 1) -> str',
      '```'
    ].join('\n'),
    returnType: 'str',
    params: { name: 'str', count: 'int' }
  },
  {
    detail: '(function) greet(name: str, count: int = 1) -> str',
    returnType: 'str',
    params: { name: 'str', count: 'int' }
  },
  {
    detail: [
      'def greet(',
      '  name: str,',
      '  count: int,',
      ') -> str:'
    ].join('\n'),
    returnType: 'str',
    params: { name: 'str', count: 'int' }
  },
  {
    detail: [
      '@overload',
      'def load(name: str) -> str: ...'
    ].join('\n'),
    returnType: 'str',
    params: { name: 'str' }
  },
  {
    detail: 'async def fetch(url: str, *, timeout: float | None = None) -> bytes:',
    returnType: 'bytes',
    params: { url: 'str', timeout: 'float | None' }
  },
  {
    detail: 'def parse(items: builtins.list[str]) -> typing.Optional[builtins.int]:',
    returnType: 'Optional[int]',
    params: { items: 'list[str]' }
  },
  {
    detail: 'def run(*args: str, **kwargs: int) -> None:',
    returnType: 'None',
    params: { args: 'str', kwargs: 'int' }
  },
  {
    detail: 'def reorder(a: int, /, b: str, *, c: bool) -> None:',
    returnType: 'None',
    params: { a: 'int', b: 'str', c: 'bool' }
  }
];

for (const testCase of cases) {
  const parsed = parsePythonSignature(testCase.detail);
  assert.ok(parsed, `expected parsed signature for: ${testCase.detail}`);
  assert.equal(parsed.returnType, testCase.returnType, `unexpected return type for: ${testCase.detail}`);
  for (const [name, expectedType] of Object.entries(testCase.params)) {
    assert.equal(parsed.paramTypes?.[name], expectedType, `unexpected type for ${name} in: ${testCase.detail}`);
  }
}

const invalid = parsePythonSignature('python hover details without signature');
assert.equal(invalid, null, 'expected invalid python hover payload to return null');

console.log('python signature parse test passed');
