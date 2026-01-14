#!/usr/bin/env node
import { buildCLikeChunks } from '../src/lang/clike.js';

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const cText = [
  '/**',
  ' * Greets the user.',
  ' */',
  'int greet(int x) {',
  '  return x;',
  '}'
].join('\n');

const cChunks = buildCLikeChunks(cText, '.c', { treeSitter: { enabled: false }, log: () => {} }) || [];
const greetChunk = cChunks.find((chunk) => chunk.kind === 'FunctionDeclaration' && chunk.name === 'greet');
expect(!!greetChunk, 'Expected to find a C-like function chunk for greet.');
expect(
  String(greetChunk.meta?.docstring || '').includes('Greets the user'),
  `Expected greet docstring to include "Greets the user", got: ${JSON.stringify(greetChunk.meta?.docstring || '')}`
);

const objcText = [
  '@interface Widget : NSObject',
  '/// Greets from ObjC.',
  '- (void)greet;',
  '@end'
].join('\n');

const objcChunks = buildCLikeChunks(objcText, '.m', { treeSitter: { enabled: false }, log: () => {} }) || [];
const objcGreet = objcChunks.find((chunk) => chunk.kind === 'MethodDeclaration' && String(chunk.name || '').includes('greet'));
expect(!!objcGreet, 'Expected to find an ObjC method chunk for greet.');
expect(
  String(objcGreet.meta?.docstring || '').includes('Greets from ObjC'),
  `Expected ObjC greet docstring to include "Greets from ObjC", got: ${JSON.stringify(objcGreet.meta?.docstring || '')}`
);

console.log('C-like doc comment extraction test passed.');
