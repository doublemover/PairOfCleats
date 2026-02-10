#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildHtmlChunks } from '../../../src/lang/html.js';

applyTestEnv();

const source = [
  '<html>',
  '<body>',
  '<script>',
  'const answer = 42;',
  '</script>',
  '</body>',
  '</html>'
].join('\n');

const normalChunks = buildHtmlChunks(source, {}) || [];
assert.ok(normalChunks.length > 0, 'expected normal html chunking to produce chunks');

const fallbackChunks = buildHtmlChunks(source, {
  html: { forceParseError: true }
}) || [];
assert.ok(fallbackChunks.length > 0, 'expected fallback chunking to retain chunks on parse errors');
assert.ok(
  fallbackChunks.every((chunk) => Number.isFinite(chunk.start) && Number.isFinite(chunk.end) && chunk.end >= chunk.start),
  'expected fallback chunks to preserve valid ranges'
);

console.log('html chunking fallback test passed');
