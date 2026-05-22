#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { buildCodeMap } from '../../src/map/build-map.js';
import { writeMapJsonStream } from '../../src/map/build-map/io.js';
import { DEFAULT_EDGE_WEIGHTS } from '../../src/map/constants.js';
import { prepareMapBuildFixture } from './map-build-fixture.js';

const stripGeneratedFields = (payload) => {
  const clone = JSON.parse(JSON.stringify(payload));
  clone.generatedAt = null;
  if (clone.buildMetrics) clone.buildMetrics = null;
  return clone;
};

const sharedFixture = await prepareMapBuildFixture({
  tempName: 'map-build-contract-matrix',
  files: [
    ['src/one.js', 'export function one() { return 1; }\n'],
    ['src/two.js', 'import { one } from "./one.js";\nexport function two() { return one(); }\n'],
    [
      'src/three.js',
      'import { one } from "./one.js";\nimport { two } from "./two.js";\nexport function three() { return one() + two(); }\n'
    ]
  ],
  buildIndexArgs: ['--stage', 'stage2', '--mode', 'code']
});

const cases = [
  {
    name: 'builds are deterministic across repeated runs',
    async run() {
      const { repoRoot, indexDir } = sharedFixture;

      const first = stripGeneratedFields(await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } }));
      const second = stripGeneratedFields(await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } }));
      assert.equal(JSON.stringify(first), JSON.stringify(second));
    }
  },
  {
    name: 'streamed map output matches in-memory map output',
    async run() {
      const { repoRoot, indexDir, tempRoot } = sharedFixture;

      const mapModel = await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } });
      const outPath = path.join(tempRoot, 'map-stream.json');
      await writeMapJsonStream({
        filePath: outPath,
        mapBase: (() => {
          const base = { ...mapModel };
          delete base.nodes;
          delete base.edges;
          return base;
        })(),
        nodes: mapModel.nodes || [],
        edges: mapModel.edges || []
      });

      const streamed = JSON.parse(await fsPromises.readFile(outPath, 'utf8'));
      assert.deepEqual(streamed, mapModel);
    }
  },
  {
    name: 'edge aggregates stay consistent with emitted edge weights',
    async run() {
      const { repoRoot, indexDir } = sharedFixture;

      const mapModel = await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } });
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

      assert.deepEqual(mapModel.edgeAggregates || [], expected);
    }
  },
  {
    name: 'edge guardrails fail loudly when the byte budget is exceeded',
    async run() {
      const { repoRoot, indexDir } = sharedFixture;

      await assert.rejects(
        () => buildCodeMap({
          repoRoot,
          indexDir,
          options: {
            mode: 'code',
            maxEdgeBytes: 1
          }
        }),
        (error) => {
          const message = error?.message || String(error);
          return message.includes('max-edge-bytes') || message.includes('edges');
        }
      );
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('map build contract matrix test passed');
