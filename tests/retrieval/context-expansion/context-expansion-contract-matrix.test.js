#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildContextIndex, expandContext } from '../../../src/retrieval/context-expansion.js';
import { graphRelationsFromEdges } from '../../graph/helpers/graph-fixtures.js';

const fixtureRoot = path.join(
  process.cwd(),
  'tests',
  'fixtures',
  'retrieval',
  'context-expansion'
);

const GRAPH_GENERATED_AT = '2026-01-01T00:00:00.000Z';
const DEFAULT_EXPAND_OPTIONS = {
  maxPerHit: 5,
  maxTotal: 5
};

const createSeedTargetChunkMeta = () => [
  { id: 0, chunkUid: 'seed', file: 'src/a.js', name: 'alpha' },
  { id: 1, chunkUid: 'target', file: 'src/b.js', name: 'beta' }
];

const createGraphRelations = (options = {}) => graphRelationsFromEdges({
  generatedAt: GRAPH_GENERATED_AT,
  ...options
});

const runExpandContextCase = ({
  hits = [{ id: 0 }],
  chunkMeta,
  fileRelations = null,
  graphRelations = null,
  contextIndex = null,
  allowedIds = null,
  options = {}
}) => expandContext({
  hits,
  chunkMeta,
  fileRelations,
  graphRelations,
  repoMap: null,
  contextIndex,
  allowedIds,
  options: {
    ...DEFAULT_EXPAND_OPTIONS,
    ...options
  }
});

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
      const expansionCase = {
        hits,
        chunkMeta,
        fileRelations,
        contextIndex,
        options: {
          maxTotal: 10,
          includeCalls: true,
          includeImports: true,
          includeUsages: true
        }
      };

      const expanded = runExpandContextCase(expansionCase);
      const ids = new Set(expanded.contextHits.map((hit) => hit.id));
      assert.equal(ids.has(1), true);
      assert.equal(ids.has(2), true);

      const filtered = runExpandContextCase({
        ...expansionCase,
        allowedIds: new Set([2])
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
      const result = runExpandContextCase({
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
      const chunkMeta = createSeedTargetChunkMeta();
      const graphRelations = createGraphRelations({
        callEdges: [['seed', 'target']],
        usageEdges: [['seed', 'target']]
      });
      const result = runExpandContextCase({
        chunkMeta,
        graphRelations,
        options: {
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
      const graphRelations = createGraphRelations({
        callEdges: [['seed', neighbors]]
      });
      const result = runExpandContextCase({
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
      const chunkMeta = createSeedTargetChunkMeta();
      const graphRelations = createGraphRelations({
        callEdges: [['seed', 'target']]
      });
      const buildOnce = () => runExpandContextCase({
        chunkMeta,
        graphRelations,
        options: {
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
