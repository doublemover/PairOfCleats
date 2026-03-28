#!/usr/bin/env node
import assert from 'node:assert/strict';

import { parseElixirSignature } from '../../../src/index/tooling/signature-parse/elixir.js';
import { parseHaskellSignature } from '../../../src/index/tooling/signature-parse/haskell.js';
import { parsePythonSignature } from '../../../src/index/tooling/signature-parse/python.js';
import { parseRubySignature } from '../../../src/index/tooling/signature-parse/ruby.js';
import { parseSwiftSignature } from '../../../src/index/tooling/signature-parse/swift.js';
import { parseZigSignature } from '../../../src/index/tooling/signature-parse/zig.js';

const suites = [
  {
    name: 'python',
    parse: parsePythonSignature,
    invalid: 'python hover details without signature',
    cases: [
      ['def greet(name: str) -> str:', 'str', { name: 'str' }],
      [['```python', 'def greet(name: str, count: int = 1) -> str', '```'].join('\n'), 'str', { name: 'str', count: 'int' }],
      ['(function) greet(name: str, count: int = 1) -> str', 'str', { name: 'str', count: 'int' }],
      [['def greet(', '  name: str,', '  count: int,', ') -> str:'].join('\n'), 'str', { name: 'str', count: 'int' }],
      [['@overload', 'def load(name: str) -> str: ...'].join('\n'), 'str', { name: 'str' }],
      ['async def fetch(url: str, *, timeout: float | None = None) -> bytes:', 'bytes', { url: 'str', timeout: 'float | None' }],
      ['def parse(items: builtins.list[str]) -> typing.Optional[builtins.int]:', 'Optional[int]', { items: 'list[str]' }],
      ['def run(*args: str, **kwargs: int) -> None:', 'None', { args: 'str', kwargs: 'int' }],
      ['def reorder(a: int, /, b: str, *, c: bool) -> None:', 'None', { a: 'int', b: 'str', c: 'bool' }],
      ['> `def greet(name: str) -> str:`', 'str', { name: 'str' }],
      [[ '> ```python', '> @cache(maxsize=128)', '> @traced', '> def greet(name: str) -> str:', '> ```' ].join('\n'), 'str', { name: 'str' }]
    ]
  },
  {
    name: 'ruby',
    parse: parseRubySignature,
    invalid: 'not a ruby signature',
    cases: [
      ['greet(name, title = nil) -> String', 'String', {}],
      ['User#greet(name : String, title : String = nil) -> String', 'String', { name: 'String', title: 'String' }],
      ['self.build(attrs: Hash, &block) => User', 'User', { attrs: 'Hash' }]
    ]
  },
  {
    name: 'swift',
    parse: parseSwiftSignature,
    invalid: 'not a signature',
    cases: [
      ['func greet(name: String) -> String', 'String', { name: 'String' }],
      ['func process<T>(_ value: T, using block: @escaping (T) -> Void) -> Result<T, Error>', 'Result<T, Error>', { value: 'T', block: '(T) -> Void' }],
      ['func load() async throws -> [String: Int]', '[String: Int]', {}],
      ['init?(rawValue: Int)', 'Self', { rawValue: 'Int' }],
      ['var title: Swift.String { get }', 'String', {}],
      ['render(view:)\nfunc render(view: View) -> Swift.Int', 'Int', { view: 'View' }]
    ]
  },
  {
    name: 'haskell',
    parse: parseHaskellSignature,
    invalid: 'not a haskell signature',
    cases: [
      ['greet :: Text -> Text', 'Text', { arg1: 'Text' }],
      ['sumTwo :: Int -> Int -> Int', 'Int', { arg1: 'Int', arg2: 'Int' }],
      ['mkPair :: a -> b -> (a, b)', '(a, b)', { arg1: 'a', arg2: 'b' }],
      ['mapMaybe :: (a -> Maybe b) -> [a] -> [b]', '[b]', { arg1: '(a -> Maybe b)', arg2: '[a]' }],
      ['liftM :: Monad m => (a -> b) -> m a -> m b', 'm b', { arg1: '(a -> b)', arg2: 'm a' }]
    ]
  },
  {
    name: 'elixir',
    parse: parseElixirSignature,
    invalid: 'not an elixir signature',
    cases: [
      ['greet(name :: String.t()) :: String.t()', 'String.t()', { name: 'String.t()' }],
      ['sum(a :: integer(), b :: integer()) :: integer()', 'integer()', { a: 'integer()', b: 'integer()' }],
      ['run(name, opts \\\\ [])', null, {}]
    ]
  },
  {
    name: 'zig',
    parse: parseZigSignature,
    invalid: 'not a zig signature',
    cases: [
      ['fn add(a: i32, b: i32) i32', 'i32', { a: 'i32', b: 'i32' }],
      ['pub fn run(self: *Self, input: []const u8) !void', '!void', { self: '*Self', input: '[]const u8' }],
      ['fn map(comptime T: type, values: []const T) []T', '[]T', { T: 'type', values: '[]const T' }]
    ]
  }
];

for (const suite of suites) {
  for (const [detail, returnType, params] of suite.cases) {
    const parsed = suite.parse(detail);
    assert.ok(parsed, `expected ${suite.name} parser output for: ${detail}`);
    assert.equal(parsed.returnType, returnType, `unexpected ${suite.name} return type for: ${detail}`);
    for (const [name, expectedType] of Object.entries(params)) {
      assert.equal(parsed.paramTypes?.[name], expectedType, `unexpected ${suite.name} param type for ${name} in: ${detail}`);
    }
  }

  const invalid = suite.parse(suite.invalid);
  assert.equal(invalid, null, `expected invalid ${suite.name} detail to return null`);
}

console.log('LSP signature parse matrix test passed');
