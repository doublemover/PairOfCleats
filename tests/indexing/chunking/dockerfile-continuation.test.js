#!/usr/bin/env node
import assert from 'node:assert/strict';
import { smartChunk } from '../../../src/index/chunking.js';

const text = [
  'FROM node:20 AS base',
  'RUN apt-get update && \\',
  '    apt-get install -y curl',
  'COPY --from=base /src /dst'
].join('\n');

const chunks = smartChunk({
  text,
  ext: '.dockerfile',
  mode: 'code',
  context: {}
}) || [];

assert.equal(chunks.length, 3, 'expected continuation lines not to create extra instruction chunks');
const names = chunks.map((chunk) => chunk.name);
assert.deepEqual(
  names,
  ['FROM base', 'RUN', 'COPY'],
  'expected only real Dockerfile instructions in chunk headings'
);

console.log('dockerfile continuation chunking test passed');
