#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io/loaders.js';

const root = process.cwd();
const testRoot = path.join(root, '.testCache', 'artifact-io-spec-contract');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });

const strictDir = path.join(testRoot, 'strict-manifest');
await fs.mkdir(strictDir, { recursive: true });
await fs.writeFile(path.join(strictDir, 'sample.json'), JSON.stringify([{ id: 1 }], null, 2));

await assert.rejects(
  () => loadJsonArrayArtifact(strictDir, 'sample', { strict: true }),
  /Missing pieces manifest|ERR_MANIFEST_MISSING/,
  'strict mode must be manifest-first'
);

const nonStrictRows = await loadJsonArrayArtifact(strictDir, 'sample', { strict: false });
assert.equal(nonStrictRows.length, 1, 'non-strict loader should allow legacy json fallback');

await assert.rejects(
  async () => {
    for await (const _row of loadJsonArrayArtifactRows(strictDir, 'sample', { strict: false })) {
      // no-op
    }
  },
  /Materialized read required for sample/,
  'streaming loader should require explicit materialize opt-in for JSON fallback'
);

const partialDir = path.join(testRoot, 'partial');
const partialParts = path.join(partialDir, 'sample.parts');
await fs.mkdir(partialParts, { recursive: true });
await fs.writeFile(path.join(partialParts, 'sample.part-000000.jsonl'), '{"id":0}\n');
await fs.writeFile(path.join(partialParts, 'sample.part-000002.jsonl'), '{"id":2}\n');

await assert.rejects(
  () => loadJsonArrayArtifact(partialDir, 'sample', { strict: false }),
  (err) => err?.code === 'ERR_ARTIFACT_PARTS_MISSING',
  'partial shard sequences must fail deterministically'
);

console.log('artifact io spec contract test passed');
