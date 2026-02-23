#!/usr/bin/env node
import assert from 'node:assert/strict';

import { extractComments, normalizeCommentConfig } from '../../../src/index/comments.js';
import { buildLineIndex } from '../../../src/shared/lines.js';

const config = normalizeCommentConfig({ extract: 'all' });

const noMarkerText = [
  'function add(a, b) {',
  '  return a + b;',
  '}',
  'const message = "no comment markers here";'
].join('\n');

const noMarkerResult = extractComments({
  text: noMarkerText,
  ext: '.js',
  languageId: 'javascript',
  lineIndex: buildLineIndex(noMarkerText),
  config
});

assert.equal(
  noMarkerResult.comments.length,
  0,
  'expected fast prefilter to skip extraction when no comment markers exist'
);

const markerText = [
  'const value = 1;',
  '// this is a sufficiently long inline comment for extraction coverage',
  'const done = true;'
].join('\n');

const markerResult = extractComments({
  text: markerText,
  ext: '.js',
  languageId: 'javascript',
  lineIndex: buildLineIndex(markerText),
  config
});

assert.ok(markerResult.comments.length > 0, 'expected comment extraction to still work when markers exist');

console.log('comment marker prefilter test passed');
