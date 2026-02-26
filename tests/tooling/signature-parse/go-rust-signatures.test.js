#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseGoSignature } from '../../../src/index/tooling/signature-parse/go.js';
import { parseLuaSignature } from '../../../src/index/tooling/signature-parse/lua.js';
import { parseRustSignature } from '../../../src/index/tooling/signature-parse/rust.js';
import { parseZigSignature } from '../../../src/index/tooling/signature-parse/zig.js';

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

console.log('signature parse go/rust/lua/zig test passed');
