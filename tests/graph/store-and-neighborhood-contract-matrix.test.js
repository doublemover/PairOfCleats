#!/usr/bin/env node
import assert from 'node:assert';

import { buildGraphNeighborhood } from '../../src/graph/neighborhood.js';
import { buildGraphIndex } from '../../src/graph/store.js';
import { applyTestEnv } from '../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const cases = [
  {
    name: 'adjacency ordering is deterministic and presorted',
    run() {
      const graphA = {
        version: 1,
        callGraph: {
          nodeCount: 2,
          edgeCount: 2,
          nodes: [
            { id: 'chunk-a', out: ['chunk-c', 'chunk-b'], in: [] },
            { id: 'chunk-b', out: [], in: ['chunk-a'] }
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };
      const graphB = {
        version: 1,
        callGraph: {
          nodeCount: 2,
          edgeCount: 2,
          nodes: [
            { id: 'chunk-b', out: [], in: ['chunk-a'] },
            { id: 'chunk-a', out: ['chunk-b', 'chunk-c'], in: [] }
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };

      const indexA = buildGraphIndex({ graphRelations: graphA });
      const indexB = buildGraphIndex({ graphRelations: graphB });
      assert.deepStrictEqual(indexA.callGraphAdjacency.get('chunk-a')?.out || [], ['chunk-b', 'chunk-c']);
      assert.deepStrictEqual(indexA.callGraphAdjacency.get('chunk-a')?.out || [], indexB.callGraphAdjacency.get('chunk-a')?.out || []);
    }
  },
  {
    name: 'csr neighborhood output matches legacy traversal deterministically',
    run() {
      const seed = { type: 'chunk', chunkUid: 'chunk-a' };
      const graphRelations = {
        version: 1,
        generatedAt: '2026-02-01T00:00:00.000Z',
        callGraph: {
          nodeCount: 3,
          edgeCount: 4,
          nodes: [
            { id: 'chunk-a', out: ['chunk-b', 'chunk-c', 'chunk-c'], in: ['chunk-b'] },
            { id: 'chunk-b', out: ['chunk-a'], in: ['chunk-a'] },
            { id: 'chunk-c', out: [], in: ['chunk-a'] }
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };
      const buildLegacy = (direction) => buildGraphNeighborhood({
        seed,
        graphRelations: JSON.parse(JSON.stringify(graphRelations)),
        direction,
        depth: 2,
        includePaths: true,
        caps: { maxDepth: 3, maxFanoutPerNode: 25, maxNodes: 50, maxEdges: 50, maxPaths: 25, maxWorkUnits: 1000 }
      });
      const graphIndex = buildGraphIndex({
        graphRelations: JSON.parse(JSON.stringify(graphRelations)),
        repoRoot: null,
        includeCsr: true
      });
      const buildCsr = (direction) => buildGraphNeighborhood({
        seed,
        graphIndex,
        direction,
        depth: 2,
        includePaths: true,
        caps: { maxDepth: 3, maxFanoutPerNode: 25, maxNodes: 50, maxEdges: 50, maxPaths: 25, maxWorkUnits: 1000 }
      });
      const stripStats = (value) => {
        const cloned = JSON.parse(JSON.stringify(value));
        delete cloned.stats;
        return cloned;
      };

      for (const direction of ['out', 'in', 'both']) {
        assert.deepStrictEqual(stripStats(buildCsr(direction)), stripStats(buildLegacy(direction)));
      }
    }
  },
  {
    name: 'bucket selection prefers the first allowed graph when caps constrain fanout',
    run() {
      const graphRelations = {
        version: 1,
        callGraph: {
          nodeCount: 3,
          edgeCount: 2,
          nodes: [
            { id: 'chunk-a', out: ['chunk-b', 'chunk-c'], in: [] },
            { id: 'chunk-b', out: [], in: ['chunk-a'] },
            { id: 'chunk-c', out: [], in: ['chunk-a'] }
          ]
        },
        usageGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { id: 'chunk-a', out: ['chunk-d'], in: [] },
            { id: 'chunk-d', out: [], in: ['chunk-a'] }
          ]
        },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };

      const neighborhood = buildGraphNeighborhood({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        graphRelations,
        depth: 1,
        caps: { maxFanoutPerNode: 2 }
      });

      assert.strictEqual(neighborhood.edges.length, 2);
      for (const edge of neighborhood.edges) {
        assert.strictEqual(edge.graph, 'callGraph');
      }
    }
  },
  {
    name: 'duplicate symbol edges keep the higher-confidence winner',
    run() {
      const result = buildGraphNeighborhood({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        symbolEdges: [
          {
            from: { chunkUid: 'chunk-a' },
            to: { v: 1, status: 'resolved', resolved: { symbolId: 'sym-a' }, candidates: [] },
            type: 'symbol',
            confidence: 0.2
          },
          {
            from: { chunkUid: 'chunk-a' },
            to: { v: 1, status: 'resolved', resolved: { symbolId: 'sym-a' }, candidates: [] },
            type: 'symbol',
            confidence: 0.9,
            reason: 'better'
          }
        ],
        edgeFilters: { graphs: ['symbolEdges'] },
        depth: 1
      });

      assert.strictEqual(result.edges.length, 1);
      assert.strictEqual(result.edges[0].confidence, 0.9);
    }
  },
  {
    name: 'unknown filters and empty matches emit warnings',
    run() {
      const graphRelations = {
        version: 1,
        callGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { id: 'chunk-a', out: ['chunk-b'], in: [] },
            { id: 'chunk-b', out: [], in: ['chunk-a'] }
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };

      const unknownFilters = buildGraphNeighborhood({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        graphRelations,
        edgeFilters: {
          graphs: ['callGraph', 'mysteryGraph'],
          edgeTypes: ['call', 'mysteryType']
        },
        depth: 1
      });
      const unknownCodes = unknownFilters.warnings?.map((warning) => warning.code) || [];
      assert(unknownCodes.includes('UNKNOWN_GRAPH_FILTER'));
      assert(unknownCodes.includes('UNKNOWN_EDGE_TYPE_FILTER'));

      const noMatch = buildGraphNeighborhood({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        graphRelations,
        edgeFilters: { edgeTypes: ['dataflow'] },
        depth: 1
      });
      const noMatchCodes = noMatch.warnings?.map((warning) => warning.code) || [];
      assert(noMatchCodes.includes('EDGE_TYPE_FILTER_NO_MATCH'));
      assert.strictEqual(noMatch.edges.length, 0);
    }
  },
  {
    name: 'mismatched graph index warns and still prefers supplied graph relations',
    run() {
      const graphA = {
        version: 1,
        callGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { id: 'chunk-a', out: ['chunk-b'], in: [] },
            { id: 'chunk-b', out: [], in: ['chunk-a'] }
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };
      const graphB = {
        version: 1,
        callGraph: {
          nodeCount: 2,
          edgeCount: 1,
          nodes: [
            { id: 'chunk-a', out: ['chunk-c'], in: [] },
            { id: 'chunk-c', out: [], in: ['chunk-a'] }
          ]
        },
        usageGraph: { nodeCount: 0, edgeCount: 0, nodes: [] },
        importGraph: { nodeCount: 0, edgeCount: 0, nodes: [] }
      };

      const graphIndex = buildGraphIndex({ graphRelations: graphA });
      const result = buildGraphNeighborhood({
        seed: { type: 'chunk', chunkUid: 'chunk-a' },
        graphRelations: graphB,
        graphIndex,
        depth: 1
      });

      const codes = result.warnings?.map((warning) => warning.code) || [];
      assert(codes.includes('GRAPH_INDEX_MISMATCH'));
      assert(result.edges.some((edge) => edge.to?.chunkUid === 'chunk-c'));
    }
  }
];

for (const entry of cases) {
  entry.run();
}

console.log('graph store and neighborhood contract matrix test passed');
