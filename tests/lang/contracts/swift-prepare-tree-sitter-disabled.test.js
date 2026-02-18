#!/usr/bin/env node
import assert from 'node:assert/strict';

import { getLanguageForFile } from '../../../src/index/language-registry.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();

const lang = getLanguageForFile('.swift', 'src/sample.swift');
assert.ok(lang && typeof lang.prepare === 'function', 'expected swift language adapter');

const text = [
  '/// Greets a user.',
  '@available(iOS 13.0, *)',
  'func greet(name: String) -> String {',
  '  return "hello \\(name)"',
  '}'
].join('\n');

const context = await lang.prepare({
  ext: '.swift',
  relPath: 'src/sample.swift',
  mode: 'code',
  text,
  options: {
    treeSitter: { enabled: false }
  }
});

const chunks = Array.isArray(context?.swiftChunks) ? context.swiftChunks : [];
assert.ok(chunks.length > 0, 'expected swift chunks in prepare context');

const structChunk = chunks.find((chunk) => chunk?.name === 'greet' || chunk?.name === 'Greeter');
assert.ok(structChunk, 'expected swift declaration chunk');
assert.equal(
  chunks[0].start,
  text.indexOf('func greet(name: String) -> String {'),
  'expected heuristic chunk start when tree-sitter is disabled'
);
assert.equal(chunks[0].kind, 'FunctionDeclaration');
assert.ok(
  String(chunks[0]?.meta?.signature || '').includes('func greet'),
  'expected function signature metadata when tree-sitter is disabled'
);

console.log('swift prepare respects tree-sitter disabled option');
