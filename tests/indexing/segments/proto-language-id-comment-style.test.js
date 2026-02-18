#!/usr/bin/env node
import assert from 'node:assert/strict';
import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const text = [
  '// Service-level documentation for proto comments extraction.',
  'syntax = "proto3";',
  'message Ping {}'
].join('\n');

const result = extractComments({
  text,
  ext: '.proto',
  languageId: 'proto',
  lineIndex: buildLineIndex(text),
  config: normalizeCommentConfig({
    extract: 'all',
    minDocChars: 1,
    minInlineChars: 1,
    minTokens: 1
  })
});

assert.ok(result.comments.length > 0, 'expected proto languageId to resolve a comment style');
assert.ok(
  result.comments.some((entry) => entry.text.includes('Service-level documentation')),
  'expected line comment text to be extracted for proto languageId'
);

console.log('proto languageId comment-style test passed');
