#!/usr/bin/env node
import assert from 'node:assert';
import { renderGraphImpact } from '../../src/retrieval/output/graph-impact.js';

const payload = {
  seed: { type: 'chunk', chunkUid: 'seed' },
  direction: 'downstream',
  depth: 2,
  impacted: [
    { ref: { type: 'chunk', chunkUid: 'b' }, distance: 2 },
    { ref: { type: 'chunk', chunkUid: 'a' }, distance: 1 }
  ],
  truncation: [{ cap: 'maxEdges', limit: 1, observed: 2, omitted: 1 }],
  warnings: [{ code: 'WARN', message: 'example warning' }]
};

const output = renderGraphImpact(payload).split('\n');
const lineA = output.findIndex((line) => line.includes('chunk:a'));
const lineB = output.findIndex((line) => line.includes('chunk:b'));
assert(lineA !== -1 && lineB !== -1, 'expected impact lines for both nodes');
assert(lineA < lineB, 'expected deterministic impact ordering');
assert(output.includes('Truncation:'), 'expected truncation section');
assert(output.includes('Warnings:'), 'expected warnings section');

console.log('graph output determinism test passed');
