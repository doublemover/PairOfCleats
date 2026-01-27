#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildLineIndex } from '../../src/shared/lines.js';
import { discoverSegments, chunkSegments } from '../../src/index/segments.js';
import { buildTypeScriptRelations } from '../../src/lang/typescript.js';

const source = `
const View = () => <div>{bar()}</div>;
`;

const segments = discoverSegments({
  text: source,
  ext: '.tsx',
  relPath: 'sample.tsx',
  mode: 'code',
  languageId: 'typescript',
  segmentsConfig: null,
  extraSegments: []
});

const chunks = chunkSegments({
  text: source,
  ext: '.tsx',
  relPath: 'sample.tsx',
  mode: 'code',
  segments,
  lineIndex: buildLineIndex(source)
});

const relations = buildTypeScriptRelations(source, null, { ext: '.tsx' });
const call = Array.isArray(relations?.callDetails)
  ? relations.callDetails.find((detail) => detail.calleeNormalized === 'bar')
  : null;

assert.ok(call, 'expected bar() call detail');
assert.ok(Number.isFinite(call.start) && Number.isFinite(call.end), 'call detail should include offsets');
assert.ok(source.slice(call.start, call.end).includes('bar'), 'offsets should be absolute in container text');
const containingChunk = chunks.find((chunk) => call.start >= chunk.start && call.end <= chunk.end);
assert.ok(containingChunk, 'expected callsite to map to a chunk in container space');

console.log('segment callsite offset test passed');
