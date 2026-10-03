#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { chunkCallGraphRelations } from './helpers/graph-fixtures.js';

const graphRelations = chunkCallGraphRelations();

const withoutPaths = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  depth: 1,
  includePaths: false
});

const withPaths = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  depth: 1,
  includePaths: true
});

assert.strictEqual(withoutPaths.paths, null);
assert(Array.isArray(withPaths.paths) && withPaths.paths.length > 0);

console.log('graph witness path lazy test passed');
