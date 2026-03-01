#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { buildCodeMap } from '../../src/map/build-map.js';
import { writeMapJsonStream } from '../../src/map/build-map/io.js';
import { prepareMapBuildFixture } from './map-build-fixture.js';

const { repoRoot, indexDir, tempRoot } = await prepareMapBuildFixture({
  tempName: 'map-build-streaming',
  files: [
    ['src/alpha.js', 'export function alpha() { return 1; }\n'],
    ['src/beta.js', 'import { alpha } from "./alpha.js";\nexport function beta() { return alpha(); }\n']
  ],
  buildIndexArgs: ['--stage', 'stage2', '--mode', 'code']
});

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
assert.deepEqual(streamed, mapModel, 'streamed map should match in-memory model');

console.log('map build streaming test passed');
