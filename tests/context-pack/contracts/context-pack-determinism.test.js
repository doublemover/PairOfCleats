#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { assembleCompositeContextPack } from '../../../src/context-pack/assemble.js';

const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'context-pack-determinism-contract-'));
applyTestEnv({ cacheRoot: repoRoot });

const srcDir = path.join(repoRoot, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'a.js'), 'export function alpha(x) { return x + 1; }\n');
fs.writeFileSync(path.join(srcDir, 'b.js'), 'export function beta() { return 2; }\n');

const chunkMeta = [
  {
    chunkUid: 'chunk-a',
    chunkId: 'a',
    file: 'src/a.js',
    name: 'alpha',
    kind: 'function',
    start: 0,
    end: 60,
    startLine: 1,
    endLine: 1,
    docmeta: {
      inferredTypes: {
        params: {
          z: [{ type: 'string', confidence: 0.6 }],
          x: [{ type: 'number', confidence: 0.9 }]
        },
        returns: [{ type: 'number', confidence: 0.9 }]
      }
    }
  },
  {
    chunkUid: 'chunk-b',
    chunkId: 'b',
    file: 'src/b.js',
    name: 'beta',
    kind: 'function',
    start: 0,
    end: 40,
    startLine: 1,
    endLine: 1
  }
];

const graphRelations = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  callGraph: {
    nodeCount: 2,
    edgeCount: 1,
    nodes: [
      { id: 'chunk-b', file: 'src/b.js', name: 'beta', kind: 'function', chunkId: 'b', out: [], in: ['chunk-a'] },
      { id: 'chunk-a', file: 'src/a.js', name: 'alpha', kind: 'function', chunkId: 'a', out: ['chunk-b'], in: [] }
    ]
  },
  usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
  importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
};

const build = () => assembleCompositeContextPack({
  seed: { type: 'chunk', chunkUid: 'chunk-a' },
  chunkMeta,
  repoRoot,
  graphRelations,
  includeGraph: true,
  includeTypes: true,
  includeRisk: false,
  includeImports: true,
  includeUsages: true,
  includeCallersCallees: true,
  includePaths: false,
  depth: 1,
  maxBytes: 1024,
  maxTokens: 100,
  maxTypeEntries: 20,
  indexSignature: 'context-pack-determinism-signature',
  indexCompatKey: 'context-pack-determinism-compat',
  now: () => '2026-02-10T00:00:00.000Z'
});

const stripDynamic = (value) => {
  const clone = JSON.parse(JSON.stringify(value));
  delete clone.stats;
  if (clone.graph) delete clone.graph.stats;
  return clone;
};

const first = build();
const second = build();
assert.deepEqual(stripDynamic(first), stripDynamic(second), 'expected deterministic composite context pack');

console.log('context pack determinism contract test passed');
