#!/usr/bin/env node
import { buildPhpChunks } from '../src/lang/php.js';

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const phpText = [
  '<?php',
  'class Widget {',
  '  public function render(): string {',
  '    return "ok";',
  '  }',
  '}',
  '',
  'function make_widget(string $name): Widget {',
  '  return new Widget();',
  '}'
].join('\n');

const chunks = buildPhpChunks(phpText) || [];
const methodChunk = chunks.find((chunk) => chunk.kind === 'MethodDeclaration' && chunk.name === 'Widget.render');
expect(!!methodChunk, 'Expected to find PHP method chunk for Widget.render.');

const duplicateFn = chunks.find((chunk) => chunk.kind === 'FunctionDeclaration' && chunk.name === 'render');
expect(!duplicateFn, 'Did not expect a top-level FunctionDeclaration for render inside Widget.');

const globalFn = chunks.find((chunk) => chunk.kind === 'FunctionDeclaration' && chunk.name === 'make_widget');
expect(!!globalFn, 'Expected to find top-level FunctionDeclaration for make_widget.');

console.log('PHP method uniqueness test passed.');
