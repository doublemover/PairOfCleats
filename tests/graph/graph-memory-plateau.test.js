#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndex } from '../../src/graph/store.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const CHILD_FLAG = '--graph-plateau-child';

if (!process.argv.includes(CHILD_FLAG) && typeof global.gc !== 'function') {
  const filePath = path.resolve(process.argv[1]);
  const child = spawnSync(
    process.execPath,
    ['--expose-gc', filePath, CHILD_FLAG],
    {
      encoding: 'utf8'
    }
  );
  if (child.status !== 0) {
    console.error(child.stdout || '');
    console.error(child.stderr || '');
    process.exit(child.status ?? 1);
  }
  process.stdout.write(child.stdout || '');
  process.exit(0);
}

assert.equal(typeof global.gc, 'function', 'expected --expose-gc in child process');

const pad = (value, width = 6) => String(value).padStart(width, '0');
const chunkId = (i) => `chunk-${pad(i)}`;

const buildSyntheticGraph = ({ nodes, fanout, file }) => {
  const edgesOut = Array.from({ length: nodes }, () => []);
  for (let i = 0; i < nodes; i += 1) {
    const targets = [];
    for (let j = 1; j <= fanout; j += 1) targets.push((i + j) % nodes);
    targets.sort((a, b) => a - b);
    edgesOut[i] = targets;
  }
  const edgesIn = Array.from({ length: nodes }, () => []);
  for (let i = 0; i < nodes; i += 1) {
    for (const target of edgesOut[i]) edgesIn[target].push(i);
  }
  for (const list of edgesIn) list.sort((a, b) => a - b);

  const ids = Array.from({ length: nodes }, (_, i) => chunkId(i));
  const graphNodes = ids.map((id, i) => ({
    id,
    file,
    out: edgesOut[i].map((target) => ids[target]),
    in: edgesIn[i].map((source) => ids[source])
  }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    callGraph: {
      nodeCount: nodes,
      edgeCount: nodes * fanout,
      nodes: graphNodes
    },
    usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
    importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
  };
};

const graphRelations = buildSyntheticGraph({
  nodes: 2500,
  fanout: 8,
  file: 'src/file.js'
});

const graphIndex = buildGraphIndex({
  graphRelations,
  repoRoot: null,
  includeCsr: true
});

const caps = {
  maxDepth: 3,
  maxFanoutPerNode: 50,
  maxNodes: 400,
  maxEdges: 800,
  maxPaths: 300,
  maxWorkUnits: 50000
};

const runs = 80;
const heapValues = [];
let lastPayload = null;

for (let i = 0; i < runs; i += 1) {
  const seed = { type: 'chunk', chunkUid: chunkId(i) };
  lastPayload = buildGraphNeighborhood({
    seed,
    graphIndex,
    direction: 'both',
    depth: 2,
    includePaths: true,
    caps
  });
  global.gc();
  heapValues.push(process.memoryUsage().heapUsed);
}

assert.ok(graphIndex._traversalCache, 'expected traversal cache to exist');
assert.ok(
  graphIndex._traversalCache.size <= 32,
  `expected traversal cache bounded to 32 entries (got ${graphIndex._traversalCache.size})`
);

assert.ok(lastPayload?.stats?.counts?.workUnitsUsed <= caps.maxWorkUnits, 'expected caps to bound workUnitsUsed');
assert.ok(lastPayload?.stats?.counts?.nodesReturned <= caps.maxNodes, 'expected caps to bound nodes');
assert.ok(lastPayload?.stats?.counts?.edgesReturned <= caps.maxEdges, 'expected caps to bound edges');

const tail = heapValues.slice(-20);
const minTail = Math.min(...tail);
const maxTail = Math.max(...tail);
const range = maxTail - minTail;
const THRESHOLD = 80 * 1024 * 1024;
assert.ok(
  range < THRESHOLD,
  `expected heap plateau window range < ${THRESHOLD} bytes (got ${range})`
);

console.log('graph memory plateau test passed');
