#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCodeMap } from '../../src/map/build-map.js';
import { DEFAULT_EDGE_WEIGHTS } from '../../src/map/constants.js';
import { prepareMapBuildFixture } from './map-build-fixture.js';

const { repoRoot, indexDir } = await prepareMapBuildFixture({
  tempName: 'map-edge-aggregate-stability',
  files: [
    ['src/one.js', 'export function one() { return 1; }\n'],
    ['src/two.js', 'import { one } from "./one.js";\nexport function two() { return one(); }\n'],
    [
      'src/three.js',
      'import { one } from "./one.js";\nimport { two } from "./two.js";\nexport function three() { return one() + two(); }\n'
    ]
  ]
});

const mapModel = await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } });
const edgeAggregates = Array.isArray(mapModel.edgeAggregates) ? mapModel.edgeAggregates : [];

const aggregateMap = new Map();
for (const edge of mapModel.edges || []) {
  const fromFile = edge?.from?.file || null;
  const toFile = edge?.to?.file || null;
  if (!fromFile || !toFile) continue;
  const type = edge.type || 'other';
  const key = `${type}:${fromFile}->${toFile}`;
  const weight = DEFAULT_EDGE_WEIGHTS[type] || 1;
  let bucket = aggregateMap.get(key);
  if (!bucket) {
    bucket = {
      type,
      fromFile,
      toFile,
      count: 0,
      weight: 0,
      minWeight: Infinity,
      maxWeight: -Infinity
    };
    aggregateMap.set(key, bucket);
  }
  bucket.count += 1;
  bucket.weight += weight;
  bucket.minWeight = Math.min(bucket.minWeight, weight);
  bucket.maxWeight = Math.max(bucket.maxWeight, weight);
}

const expected = Array.from(aggregateMap.entries())
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([, entry]) => ({
    type: entry.type,
    fromFile: entry.fromFile,
    toFile: entry.toFile,
    count: entry.count,
    weight: entry.weight,
    minWeight: Number.isFinite(entry.minWeight) ? entry.minWeight : null,
    maxWeight: Number.isFinite(entry.maxWeight) ? entry.maxWeight : null
  }));

assert.deepEqual(edgeAggregates, expected);

console.log('map edge aggregate stability test passed');
