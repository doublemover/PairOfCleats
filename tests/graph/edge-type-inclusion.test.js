#!/usr/bin/env node
import assert from 'node:assert';
import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { chunkCallGraphRelations } from './helpers/graph-fixtures.js';

const graphRelations = chunkCallGraphRelations();

const result = buildGraphNeighborhood({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  graphRelations,
  edgeFilters: { edgeTypes: ['call'] },
  depth: 1
});

assert(result.edges.length > 0, 'expected callGraph edges to remain when edgeTypes filter supplied');

console.log('graph edgeTypes include graph test passed');
