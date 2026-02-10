#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  findTopLevelIndex,
  splitTopLevel,
  stripTopLevelAssignment
} from '../../../src/index/tooling/signature-parse/shared.js';
import { parseClikeSignature } from '../../../src/index/tooling/signature-parse/clike.js';
import { parsePythonSignature } from '../../../src/index/tooling/signature-parse/python.js';
import { parseSwiftSignature } from '../../../src/index/tooling/signature-parse/swift.js';

const split = splitTopLevel('Map<string, List<int>>, "x,y", fn(a, b), value', ',');
assert.deepEqual(split, ['Map<string, List<int>>', '"x,y"', 'fn(a, b)', 'value']);

assert.equal(findTopLevelIndex('param: Dictionary<String, [Int]> = [:]', '='), 33);
assert.equal(stripTopLevelAssignment('value: String = "a,b"'), 'value: String ');

const clike = parseClikeSignature('const std::vector<int>& build(const std::string& name, int count)', 'build');
assert.equal(clike?.returnType, 'const std::vector<int>&');
assert.deepEqual(clike?.paramNames, ['name', 'count']);

const python = parsePythonSignature('def run(name: str, options: dict[str, str] = {"a": "b"}) -> list[str]:');
assert.equal(python?.returnType, 'list[str]');
assert.deepEqual(python?.paramNames, ['name', 'options']);

const swift = parseSwiftSignature('func run(name: String, payload: [String: String] = ["a": "b"]) -> Result<Void, Error>');
assert.equal(swift?.returnType, 'Result<Void, Error>');
assert.deepEqual(swift?.paramNames, ['name', 'payload']);

console.log('signature parse shared splitter test passed');
