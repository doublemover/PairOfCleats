#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildCodeMap } from '../../src/map/build-map.js';
import { prepareMapBuildFixture } from './map-build-fixture.js';

const { repoRoot, indexDir } = await prepareMapBuildFixture({
  tempName: 'map-build-determinism',
  files: [
    ['src/one.js', 'export function one() { return 1; }\n'],
    ['src/two.js', 'import { one } from "./one.js";\nexport function two() { return one(); }\n']
  ],
  buildIndexArgs: ['--stage', 'stage2', '--mode', 'code']
});

const strip = (payload) => {
  const clone = JSON.parse(JSON.stringify(payload));
  clone.generatedAt = null;
  if (clone.buildMetrics) clone.buildMetrics = null;
  return clone;
};

const first = strip(await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } }));
const second = strip(await buildCodeMap({ repoRoot, indexDir, options: { mode: 'code' } }));

assert.equal(JSON.stringify(first), JSON.stringify(second));

console.log('map build determinism test passed');
