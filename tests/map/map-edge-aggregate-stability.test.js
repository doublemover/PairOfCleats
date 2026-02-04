#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyTestEnv } from '../helpers/test-env.js';
import { getIndexDir, resolveRepoConfig } from '../../tools/shared/dict-utils.js';
import { buildCodeMap } from '../../src/map/build-map.js';
import { DEFAULT_EDGE_WEIGHTS } from '../../src/map/constants.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'map-edge-aggregate-stability');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'one.js'),
  'export function one() { return 1; }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'two.js'),
  'import { one } from "./one.js";\nexport function two() { return one(); }\n'
);
await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'three.js'),
  'import { one } from "./one.js";\nimport { two } from "./two.js";\nexport function three() { return one() + two(); }\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);

if (buildResult.status !== 0) {
  console.error('Failed: build index for edge aggregate test');
  process.exit(buildResult.status ?? 1);
}

const { userConfig } = resolveRepoConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig, {});

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
