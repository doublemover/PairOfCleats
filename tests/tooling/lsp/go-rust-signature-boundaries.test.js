import assert from 'node:assert/strict';
import { parseGoSignature } from '../../../src/index/tooling/signature-parse/go.js';
import { parseRustSignature } from '../../../src/index/tooling/signature-parse/rust.js';
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);

if (selected !== 'rust') for (const [signature, paramTypes, returnType] of [
  ['func Add(a, b int) int', { a: 'int', b: 'int' }, 'int'],
  ['func Read(input <-chan string, timeout int) error', { input: '<-chan string', timeout: 'int' }, 'error'],
  ['func Read(input chan<- string, timeout int) error', { input: 'chan<- string', timeout: 'int' }, 'error'],
  ['func Read(a, b chan string, count int) error', { a: 'chan string', b: 'chan string', count: 'int' }, 'error'],
  ['func (s *Server) Map[T any](a, b <-chan T, fn func(T, T) T, values [2]map[string]T) (T, error)',
    { a: '<-chan T', b: '<-chan T', fn: 'func(T, T) T', values: '[2]map[string]T' }, '(T, error)']
]) {
  const result = parseGoSignature(signature);
  assert.deepEqual(result?.paramNames, Object.keys(paramTypes), signature);
  assert.deepEqual(result.paramTypes, paramTypes, signature);
  assert.equal(result.returnType, returnType, signature);
}
if (selected !== 'go') for (const [signature, paramTypes, returnType] of [
  ["fn run<'a>(x: &'a str, count: u32) -> usize", { x: "&'a str", count: 'u32' }, 'usize'],
  ["fn run<'a, 'b>(x: &'a str, y: &'b str, count: usize) -> &'static str",
    { x: "&'a str", y: "&'b str", count: 'usize' }, "&'static str"],
  ['fn pair(x: i32) -> (i32, i32)', { x: 'i32' }, '(i32, i32)'],
  ['fn nested(cb: impl Fn(i32, i32) -> (i32, i32), count: u32) -> fn(i32) -> (i32, i32)',
    { cb: 'impl Fn(i32, i32) -> (i32, i32)', count: 'u32' }, 'fn(i32) -> (i32, i32)'],
  ["fn quoted(x: Marker<'a', 2>, y: Marker<'\\n', 3>, z: &'static str) -> ()",
    { x: "Marker<'a', 2>", y: "Marker<'\\n', 3>", z: "&'static str" }, '()'],
  ["fn generic<F: Fn(i32) -> (i32, i32)>(f: F, x: Vec<(i32, i32)>) -> usize",
    { f: 'F', x: 'Vec<(i32, i32)>' }, 'usize']
]) {
  const result = parseRustSignature(signature);
  assert.deepEqual(result?.paramNames, Object.keys(paramTypes), signature);
  assert.deepEqual(result.paramTypes, paramTypes, signature);
  assert.equal(result.returnType, returnType, signature);
}
console.log('Go grouped/channel parameters and Rust lifetime/character/tuple/function boundaries preserve every parameter');
