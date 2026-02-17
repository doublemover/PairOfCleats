#!/usr/bin/env node
import assert from 'node:assert/strict';
import { classifyQuery } from '../../../src/retrieval/query-intent.js';
import { applyGraphRanking } from '../../../src/retrieval/pipeline/graph-ranking.js';
import { buildResultBundles } from '../../../src/retrieval/output/format.js';

const buildSmokeSnapshot = () => {
  const intentPath = classifyQuery({
    query: 'src/server/index.js',
    tokens: ['src/server/index.js'],
    phrases: []
  });
  const intentLow = classifyQuery({
    query: 'alpha',
    tokens: ['alpha'],
    phrases: []
  });
  const entries = [
    { idx: 0, score: 1, chunk: { chunkUid: 'a' }, scoreBreakdown: {} },
    { idx: 1, score: 0.95, chunk: { chunkUid: 'b' }, scoreBreakdown: {} },
    { idx: 2, score: 0.94, chunk: { chunkUid: 'c' }, scoreBreakdown: {} },
    { idx: 3, score: 0.93, chunk: { chunkUid: 'g' }, scoreBreakdown: {} },
    { idx: 4, score: 0.92, chunk: { chunkUid: 'h' }, scoreBreakdown: {} },
    { idx: 5, score: 0.91, chunk: { chunkUid: 'i' }, scoreBreakdown: {} }
  ];
  const graphRelations = {
    callGraph: {
      nodes: [
        { id: 'a', out: ['b', 'c', 'd', 'e'], in: [] },
        { id: 'b', out: ['g', 'h'], in: ['a'] },
        { id: 'c', out: ['i', 'j'], in: ['a'] },
        { id: 'd', out: [], in: ['a'] },
        { id: 'e', out: [], in: ['a'] },
        { id: 'g', out: [], in: ['b'] },
        { id: 'h', out: [], in: ['b'] },
        { id: 'i', out: [], in: ['c'] },
        { id: 'j', out: [], in: ['c'] }
      ]
    },
    usageGraph: { nodes: [] }
  };
  const ranking = applyGraphRanking({
    entries,
    graphRelations,
    config: {
      enabled: true,
      weights: { degree: 0.05, proximity: 0.5 },
      seedSelection: 'top1',
      maxGraphWorkUnits: 100,
      expansion: {
        maxDepth: 2,
        maxWidthPerNode: 2,
        maxVisitedNodes: 8
      }
    },
    explain: true
  });
  const bundles = buildResultBundles({
    code: [
      { id: 'c1', file: 'src/z.js', score: 1, scoreType: 'bm25' },
      { id: 'c2', file: 'src/a.js', score: 1, scoreType: 'bm25' }
    ],
    prose: [
      { id: 'p1', file: 'src/a.js', score: 1, scoreType: 'fts' },
      { id: 'p2', file: 'src/b.js', score: 1, scoreType: 'fts' }
    ],
    extractedProse: [],
    records: []
  });
  return {
    intentPath: {
      type: intentPath.type,
      bucket: intentPath.confidenceBucket,
      abstain: intentPath.abstain,
      effectiveType: intentPath.effectiveType,
      confidence: Number(intentPath.confidence.toFixed(3))
    },
    intentLow: {
      type: intentLow.type,
      bucket: intentLow.confidenceBucket,
      abstain: intentLow.abstain,
      effectiveType: intentLow.effectiveType,
      confidence: Number(intentLow.confidence.toFixed(3))
    },
    expansion: {
      stopReason: ranking.stats?.stopReason || null,
      visitedNodes: ranking.stats?.visitedNodes ?? null,
      widthLimitedNodes: ranking.stats?.widthLimitedNodes ?? null,
      order: ranking.entries.map((entry) => entry?.chunk?.chunkUid || null)
    },
    bundles: {
      schemaVersion: bundles.schemaVersion,
      order: bundles.groups.map((group) => group.file),
      topBundleModes: bundles.groups[0]?.hits?.map((hit) => hit.mode) || []
    }
  };
};

const first = buildSmokeSnapshot();
const second = buildSmokeSnapshot();

assert.deepEqual(first, second, 'expected deterministic IQ regression snapshot');
assert.deepEqual(
  first,
  {
    intentPath: {
      type: 'path',
      bucket: 'medium',
      abstain: false,
      effectiveType: 'path',
      confidence: 0.742
    },
    intentLow: {
      type: 'mixed',
      bucket: 'low',
      abstain: true,
      effectiveType: 'mixed',
      confidence: 0.24
    },
    expansion: {
      stopReason: 'maxWidthPerNode',
      visitedNodes: 5,
      widthLimitedNodes: 3,
      order: ['a', 'b', 'c', 'g', 'i', 'h']
    },
    bundles: {
      schemaVersion: 1,
      order: ['src/a.js', 'src/b.js', 'src/z.js'],
      topBundleModes: ['code', 'prose']
    }
  },
  'IQ regression smoke snapshot drift detected'
);

console.log('iq regression smoke test passed');
