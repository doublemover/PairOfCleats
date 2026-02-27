#!/usr/bin/env node
import { buildCodeMap } from '../../src/map/build-map.js';
import { prepareMapBuildFixture } from './map-build-fixture.js';

const { repoRoot, indexDir } = await prepareMapBuildFixture({
  tempName: 'map-build-heap-guard',
  files: [
    ['src/alpha.js', 'export function alpha() { return 1; }\n'],
    ['src/beta.js', 'import { alpha } from "./alpha.js";\nexport function beta() { return alpha(); }\n']
  ],
  buildIndexArgs: ['--stage', 'stage2', '--mode', 'code']
});

let threw = false;
try {
  await buildCodeMap({
    repoRoot,
    indexDir,
    options: {
      mode: 'code',
      maxEdgeBytes: 10
    }
  });
} catch (err) {
  threw = true;
  const message = err?.message || String(err);
  if (!message.includes('max-edge-bytes') && !message.includes('edges')) {
    console.error(`Failed: unexpected guardrail message: ${message}`);
    process.exit(1);
  }
}

if (!threw) {
  console.error('Failed: expected guardrail to throw for edges');
  process.exit(1);
}

console.log('map build heap guard test passed');
