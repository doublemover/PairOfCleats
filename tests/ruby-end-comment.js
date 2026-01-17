#!/usr/bin/env node
import { buildRubyChunks } from '../src/lang/ruby.js';

const expect = (condition, message) => {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
};

const rubyText = [
  'class Widget',
  '  def render',
  '    @name',
  '  end # render',
  'end # Widget'
].join('\n');

const chunks = buildRubyChunks(rubyText) || [];
const methodChunk = chunks.find((chunk) =>
  chunk.kind === 'MethodDeclaration' && String(chunk.name || '').includes('Widget.render')
);
expect(!!methodChunk, 'Expected to find Ruby method chunk for Widget.render with end comments.');

console.log('Ruby end-comment chunking test passed.');
