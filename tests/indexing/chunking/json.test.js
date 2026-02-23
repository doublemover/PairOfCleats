#!/usr/bin/env node
import { chunkJson } from '../../../src/index/chunking.js';

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const jsonText = JSON.stringify({
  name: 'alpha',
  config: { enabled: true },
  text: 'escaped \"quote\"'
});

const chunks = chunkJson(jsonText, {}) || [];
const names = new Set(chunks.map((chunk) => chunk.name));
expect(names.has('name'), 'Missing chunk for name key.');
expect(names.has('config'), 'Missing chunk for config key.');
expect(names.has('text'), 'Missing chunk for text key.');

const arrayChunk = chunkJson('["a","b"]', {}) || [];
expect(arrayChunk.length === 1, 'Expected array JSON to return a single chunk.');
expect(arrayChunk[0].name === 'root', 'Expected root chunk for array JSON.');

const invalid = chunkJson('{', {});
expect(invalid === null, 'Expected invalid JSON to return null.');
const invalidTrailingComma = chunkJson('{"alpha":1,}', {});
expect(invalidTrailingComma === null, 'Expected trailing-comma JSON to return null.');
const escapedKey = chunkJson('{"key\\u0020name":1,"beta":2}', {}) || [];
expect(escapedKey[0]?.name === 'key name', 'Expected unicode-escaped key names to decode deterministically.');

const nestedText = JSON.stringify({
  alpha: { path: './a.json' },
  beta: { value: 2 },
  gamma: { value: 3 }
});
const first = chunkJson(nestedText, {}) || [];
const second = chunkJson(nestedText, {}) || [];
expect(JSON.stringify(first) === JSON.stringify(second), 'Expected deterministic JSON chunk ordering across runs.');

console.log('Chunking JSON test passed.');
