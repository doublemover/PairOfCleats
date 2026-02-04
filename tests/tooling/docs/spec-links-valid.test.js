#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const requiredDocs = [
  'docs/specs/vfs-manifest-artifact.md',
  'docs/specs/vfs-index.md',
  'docs/specs/vfs-hash-routing.md',
  'docs/specs/vfs-token-uris.md',
  'docs/specs/vfs-io-batching.md',
  'docs/specs/vfs-segment-hash-cache.md',
  'docs/specs/vfs-cdc-segmentation.md',
  'docs/specs/vfs-cold-start-cache.md',
  'docs/specs/tooling-provider-registry.md',
  'docs/specs/tooling-vfs-and-segment-routing.md',
  'docs/specs/map-artifact.md',
  'docs/perf/map-pipeline.md'
];

for (const rel of requiredDocs) {
  const abs = path.join(root, rel);
  try {
    await fs.access(abs);
  } catch {
    assert.fail(`missing required doc: ${rel}`);
  }
}

console.log('spec link validity test passed');
