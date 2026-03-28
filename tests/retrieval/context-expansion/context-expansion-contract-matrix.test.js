#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildContextIndex, expandContext } from '../../../src/retrieval/context-expansion.js';

const fixtureRoot = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'retrieval',
  'context-expansion'
);

const cases = [
  {
    name: 'expansion includes call and import targets while honoring allowedIds',
    run() {
      const chunkMeta = [
        { id: 0, file: 'src/a.js', name: 'alpha', codeRelations: { calls: [['alpha', 'beta']] } },
        { id: 1, file: 'src/b.js', name: 'beta' },
        { id: 2, file: 'src/c.js', name: 'gamma' }
      ];
      const fileRelations = new Map([
        ['src/a.js', { importLinks: ['src/c.js'], usages: ['beta'], exports: [] }]
      ]);
      const hits = [{ id: 0, file: 'src/a.js' }];
      const contextIndex = buildContextIndex({ chunkMeta, repoMap: null });

      const expanded = expandContext({
        hits,
        chunkMeta,
        fileRelations,
        repoMap: null,
        contextIndex,
        options: {
          maxPerHit: 5,
          maxTotal: 10,
          includeCalls: true,
          includeImports: true,
          includeUsages: true
        }
      });
      const ids = new Set(expanded.contextHits.map((hit) => hit.id));
      assert.equal(ids.has(1), true);
      assert.equal(ids.has(2), true);

      const filtered = expandContext({
        hits,
        chunkMeta,
        fileRelations,
        repoMap: null,
        contextIndex,
        allowedIds: new Set([2]),
        options: {
          maxPerHit: 5,
          maxTotal: 10,
          includeCalls: true,
          includeImports: true,
          includeUsages: true
        }
      });
      const filteredIds = new Set(filtered.contextHits.map((hit) => hit.id));
      assert.deepEqual([...filteredIds], [2]);
    }
  },
  {
    name: 'shuffled chunk meta resolves docIds through chunkUid map',
    run() {
      const chunkMeta = JSON.parse(
        fs.readFileSync(path.join(fixtureRoot, 'chunk-meta-shuffled.json'), 'utf8')
      );
      const graphRelations = JSON.parse(
        fs.readFileSync(path.join(fixtureRoot, 'graph-relations-basic.json'), 'utf8')
      );
      const result = expandContext({
        hits: [{ id: 7 }],
        chunkMeta,
        graphRelations,
        options: {
          maxPerHit: 5,
          maxTotal: 5,
          includeCalls: true
        }
      });
      const ids = new Set(result.contextHits.map((hit) => hit.id));
      assert.equal(ids.has(42), true);
    }
  },
  {
    name: 'call reason takes precedence over usage',
    run() {
      const chunkMeta = [
        { id: 0, chunkUid: 'seed', file: 'src/a.js', name: 'alpha' },
        { id: 1, chunkUid: 'target', file: 'src/b.js', name: 'beta' }
      ];
      const graphRelations = {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        callGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { id: 'seed', out: ['target'], in: [] },
            { id: 'target', out: [], in: ['seed'] }
          ]
        },
        usageGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { id: 'seed', out: ['target'], in: [] },
            { id: 'target', out: [], in: ['seed'] }
          ]
        },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };
      const result = expandContext({
        hits: [{ id: 0 }],
        chunkMeta,
        graphRelations,
        options: {
          maxPerHit: 5,
          maxTotal: 5,
          includeCalls: true,
          includeUsages: true
        }
      });
      assert.equal((result.contextHits[0]?.context?.reason || '').startsWith('call'), true);
    }
  },
  {
    name: 'work budget prevents candidate explosion and records truncation',
    run() {
      const neighborCount = 50;
      const neighbors = Array.from({ length: neighborCount }, (_, index) => `c${index}`);
      const chunkMeta = [
        { id: 0, chunkUid: 'seed', file: 'src/seed.js', name: 'seed' },
        ...neighbors.map((id, index) => ({
          id: index + 1,
          chunkUid: id,
          file: `src/${id}.js`,
          name: id
        }))
      ];
      const graphRelations = {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        callGraph: {
          nodeCount: neighborCount + 1,
          edgeCount: neighborCount,
          nodes: [
            { id: 'seed', out: neighbors, in: [] },
            ...neighbors.map((id) => ({ id, out: [], in: ['seed'] }))
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };
      const result = expandContext({
        hits: [{ id: 0 }],
        chunkMeta,
        graphRelations,
        options: {
          maxPerHit: 10,
          maxTotal: 10,
          maxWorkUnits: 3,
          includeCalls: true
        }
      });
      assert.equal(result.stats.workUnitsUsed > 3, false);
      const caps = new Set((result.stats.truncation || []).map((entry) => entry.cap));
      assert.equal(caps.has('maxWorkUnits'), true);
    }
  },
  {
    name: 'output is deterministic for identical inputs',
    run() {
      const chunkMeta = [
        { id: 0, chunkUid: 'seed', file: 'src/a.js', name: 'alpha' },
        { id: 1, chunkUid: 'target', file: 'src/b.js', name: 'beta' }
      ];
      const graphRelations = {
        version: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        callGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { id: 'seed', out: ['target'], in: [] },
            { id: 'target', out: [], in: ['seed'] }
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };
      const buildOnce = () => expandContext({
        hits: [{ id: 0 }],
        chunkMeta,
        graphRelations,
        options: {
          maxPerHit: 5,
          maxTotal: 5,
          includeCalls: true
        }
      });
      assert.equal(JSON.stringify(buildOnce()), JSON.stringify(buildOnce()));
    }
  }
];

for (const testCase of cases) {
  testCase.run();
}

console.log('context expansion contract matrix test passed');
