#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { chunkCallGraphRelations } from './helpers/graph-fixtures.js';

const graphRelations = chunkCallGraphRelations({ nodeCount: 5, edgeCount: 2 });

const result = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  depth: 1
});

const codes = result.warnings?.map((warning) => warning.code) || [];
assert(codes.includes('GRAPH_COUNT_MISMATCH'), 'expected graph count mismatch warning');

console.log('graph count mismatch warning test passed');
