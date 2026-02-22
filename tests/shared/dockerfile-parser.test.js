#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../helpers/test-env.js';
import { parseDockerfileFromClause, parseDockerfileInstruction } from '../../src/shared/dockerfile.js';

applyTestEnv();

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

const spacedFrom = parseDockerfileFromClause('FROM --platform $TARGETPLATFORM ghcr.io/acme/runtime:1 AS runtime');
assert.deepEqual(
  spacedFrom,
  { image: 'ghcr.io/acme/runtime:1', stage: 'runtime', instruction: 'FROM' },
  'expected FROM clause parser to support spaced option assignment'
);

const spacedEqualsFrom = parseDockerfileFromClause('FROM --platform = $TARGETPLATFORM ghcr.io/acme/runtime:2 AS final');
assert.deepEqual(
  spacedEqualsFrom,
  { image: 'ghcr.io/acme/runtime:2', stage: 'final', instruction: 'FROM' },
  'expected FROM clause parser to support spaced equals assignment'
);

console.log('dockerfile parser test passed');
