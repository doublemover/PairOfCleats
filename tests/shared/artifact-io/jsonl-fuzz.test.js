import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io/loaders.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'artifact-io', 'loader-hardening');
const testRoot = path.join(root, '.testCache', 'jsonl-fuzz');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });

const malformedDir = path.join(testRoot, 'malformed');
const malformedPartsDir = path.join(malformedDir, 'sample.parts');
await fs.mkdir(malformedPartsDir, { recursive: true });
await fs.copyFile(
  path.join(fixtureRoot, 'malformed.part-000000.jsonl'),
  path.join(malformedPartsDir, 'sample.part-000000.jsonl')
);

await assert.rejects(
  () => loadJsonArrayArtifact(malformedDir, 'sample', { strict: false }),
  /Invalid JSONL|JSON parse/i,
  'expected malformed JSONL shard to fail materialized loader'
);

await assert.rejects(
  async () => {
    for await (const _row of loadJsonArrayArtifactRows(malformedDir, 'sample', { strict: false })) {
      // consume rows
    }
  },
  /Invalid JSONL|JSON parse/i,
  'expected malformed JSONL shard to fail streaming loader'
);

const corruptDir = path.join(testRoot, 'corrupt');
const corruptPartsDir = path.join(corruptDir, 'sample.parts');
await fs.mkdir(corruptPartsDir, { recursive: true });
await fs.copyFile(
  path.join(fixtureRoot, 'corrupt.part-000000.jsonl.gz'),
  path.join(corruptPartsDir, 'sample.part-000000.jsonl.gz')
);

await assert.rejects(
  () => loadJsonArrayArtifact(corruptDir, 'sample', { strict: false }),
  /header check|gzip|zlib|unexpected|invalid|corrupt/i,
  'expected corrupt compressed shard to fail materialized loader'
);

await assert.rejects(
  async () => {
    for await (const _row of loadJsonArrayArtifactRows(corruptDir, 'sample', { strict: false })) {
      // consume rows
    }
  },
  /header check|gzip|zlib|unexpected|invalid|corrupt/i,
  'expected corrupt compressed shard to fail streaming loader'
);

console.log('jsonl fuzz test passed');
