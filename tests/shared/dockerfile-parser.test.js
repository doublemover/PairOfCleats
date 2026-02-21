#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseDockerfileFromClause, parseDockerfileInstruction } from '../../src/shared/dockerfile.js';

const runInstruction = parseDockerfileInstruction('RUN echo hello');
assert.equal(runInstruction?.instruction, 'RUN', 'expected RUN instruction to parse');

const continuationLine = parseDockerfileInstruction('apt-get update && \\');
assert.equal(continuationLine, null, 'expected non-instruction continuation token to be rejected');

const from = parseDockerfileFromClause('FROM --platform=$BUILDPLATFORM node:20 AS build');
assert.deepEqual(
  from,
  { image: 'node:20', stage: 'build', instruction: 'FROM' },
  'expected FROM clause parser to preserve image and stage'
);

console.log('dockerfile parser test passed');
