#!/usr/bin/env node
import assert from 'node:assert/strict';

import { parseClikeSignature } from '../../../src/index/tooling/signature-parse/clike.js';
import { parseJavaSignature } from '../../../src/index/tooling/signature-parse/java.js';
import { parseGenericSignature } from '../../../src/index/tooling/lsp-provider/runtime.js';
import { parseGoSignature } from '../../../src/index/tooling/signature-parse/go.js';
import { parseLuaSignature } from '../../../src/index/tooling/signature-parse/lua.js';
import { parsePythonSignature } from '../../../src/index/tooling/signature-parse/python.js';
import { parseRustSignature } from '../../../src/index/tooling/signature-parse/rust.js';
import {
  findTopLevelIndex,
  splitTopLevel,
  stripTopLevelAssignment
} from '../../../src/index/tooling/signature-parse/shared.js';
import { parseSwiftSignature } from '../../../src/index/tooling/signature-parse/swift.js';
import { parseZigSignature } from '../../../src/index/tooling/signature-parse/zig.js';

assert.deepEqual(
  splitTopLevel('Map<string, List<int>>, "x,y", fn(a, b), value', ','),
  ['Map<string, List<int>>', '"x,y"', 'fn(a, b)', 'value']
);
assert.equal(findTopLevelIndex('param: Dictionary<String, [Int]> = [:]', '='), 33);
assert.equal(stripTopLevelAssignment('value: String = "a,b"'), 'value: String ');

const clike = parseClikeSignature('const std::vector<int>& build(const std::string& name, int count)', 'build');
const java = parseJavaSignature('static int add(int a, int b)', 'App.add(int, int)');
assert.equal(java?.returnType, 'int');
assert.deepEqual(java?.paramTypes, { a: 'int', b: 'int' });
assert.equal(parseGenericSignature('int App.add(int a, int b)', 'java', 'App.add(int, int)')?.returnType, 'int');
const qualifiedJava = parseJavaSignature('public static java.util.List<String> sample.App.names(final String name)',
  'sample.App.names(String)');
assert.equal(qualifiedJava?.returnType, 'java.util.List<String>');
assert.deepEqual(qualifiedJava?.paramTypes, { name: 'String' });
assert.equal(parseJavaSignature('App(java.lang.String name)', 'App(String)')?.returnType, null);
assert.equal(parseJavaSignature(' : int', 'App.add(int, int)'), null, 'return-type-only detail does not invent a full signature');
assert.equal(clike?.returnType, 'const std::vector<int>&');
assert.deepEqual(clike?.paramNames, ['name', 'count']);

const qualifiedClike = parseClikeSignature('std::string ns::Widget::render(int value)', 'render');
assert.equal(qualifiedClike?.returnType, 'std::string');
assert.deepEqual(qualifiedClike?.paramTypes, { value: 'int' });
const constrainedClike = parseClikeSignature(
  'void run(std::enable_if_t<(N == 1), int> value = 0, void (*callback)(int))', 'run'
);
assert.equal(constrainedClike?.paramTypes?.value, 'std::enable_if_t<(N == 1), int>');
assert.equal(constrainedClike?.paramTypes?.callback, 'void (*)(int)');

const python = parsePythonSignature('def run(name: str, options: dict[str, str] = {"a": "b"}) -> list[str]:');
assert.equal(python?.returnType, 'list[str]');
assert.deepEqual(python?.paramNames, ['name', 'options']);

const swift = parseSwiftSignature('func run(name: String, payload: [String: String] = ["a": "b"]) -> Result<Void, Error>');
assert.equal(swift?.returnType, 'Result<Void, Error>');
assert.deepEqual(swift?.paramNames, ['name', 'payload']);

const goSimple = parseGoSignature('func Add(a int, b int) int');
assert.equal(goSimple?.returnType, 'int');
assert.deepEqual(goSimple?.paramNames, ['a', 'b']);
assert.equal(goSimple?.paramTypes?.a, 'int');
assert.equal(goSimple?.paramTypes?.b, 'int');

const goReceiver = parseGoSignature('func (s *Server) Run(ctx context.Context, args ...string) error');
assert.equal(goReceiver?.returnType, 'error');
assert.deepEqual(goReceiver?.paramNames, ['ctx', 'args']);
assert.equal(goReceiver?.paramTypes?.ctx, 'context.Context');
assert.equal(goReceiver?.paramTypes?.args, '...string');

const goGeneric = parseGoSignature('func Map[T any](in []T, fn func(T) T) []T');
assert.equal(goGeneric?.returnType, '[]T');
assert.deepEqual(goGeneric?.paramNames, ['in', 'fn']);
assert.equal(goGeneric?.paramTypes?.in, '[]T');
assert.equal(goGeneric?.paramTypes?.fn, 'func(T) T');

const rustSimple = parseRustSignature('fn add(a: i32, b: i32) -> i32');
assert.equal(rustSimple?.returnType, 'i32');
assert.deepEqual(rustSimple?.paramNames, ['a', 'b']);
assert.equal(rustSimple?.paramTypes?.a, 'i32');
assert.equal(rustSimple?.paramTypes?.b, 'i32');

const rustSelf = parseRustSignature("pub fn run(&self, ctx: Context<'_>) -> Result<(), Error>");
assert.equal(rustSelf?.returnType, 'Result<(), Error>');
assert.deepEqual(rustSelf?.paramNames, ['ctx']);
assert.equal(rustSelf?.paramTypes?.ctx, "Context<'_>");

const rustWhere = parseRustSignature('fn map<T>(input: Vec<T>) -> Vec<T> where T: Clone');
assert.equal(rustWhere?.returnType, 'Vec<T>');
assert.deepEqual(rustWhere?.paramNames, ['input']);

const luaSimple = parseLuaSignature('function greet(name: string): string');
assert.equal(luaSimple?.returnType, 'string');
assert.deepEqual(luaSimple?.paramNames, ['name']);
assert.equal(luaSimple?.paramTypes?.name, 'string');

const luaLocal = parseLuaSignature('local function module.run(path: string, opts: table): boolean');
assert.equal(luaLocal?.returnType, 'boolean');
assert.deepEqual(luaLocal?.paramNames, ['path', 'opts']);

const zigSimple = parseZigSignature('fn add(a: i32, b: i32) i32');
assert.equal(zigSimple?.returnType, 'i32');
assert.deepEqual(zigSimple?.paramNames, ['a', 'b']);
assert.equal(zigSimple?.paramTypes?.a, 'i32');
assert.equal(zigSimple?.paramTypes?.b, 'i32');

const zigErrorUnion = parseZigSignature('pub fn run(self: *Self, input: []const u8) !void');
assert.equal(zigErrorUnion?.returnType, '!void');
assert.deepEqual(zigErrorUnion?.paramNames, ['self', 'input']);

console.log('tooling signature parse contract matrix test passed');
