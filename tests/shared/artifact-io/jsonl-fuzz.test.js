import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io/loaders.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'artifact-io', 'loader-hardening');
const testRoot = await prepareArtifactIoTestDir('jsonl-fuzz', { root });

const malformedDir = path.join(testRoot, 'malformed');
const malformedPartsDir = path.join(malformedDir, 'sample.parts');
await fs.mkdir(path.join(malformedDir, 'pieces'), { recursive: true });
await fs.mkdir(malformedPartsDir, { recursive: true });
await fs.copyFile(
  path.join(fixtureRoot, 'malformed.part-000000.jsonl'),
  path.join(malformedPartsDir, 'sample.part-000000.jsonl')
);
await writePiecesManifest(malformedDir, [
  { name: 'sample', path: 'sample.parts/sample.part-000000.jsonl' }
]);

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
await fs.mkdir(path.join(corruptDir, 'pieces'), { recursive: true });
await fs.mkdir(corruptPartsDir, { recursive: true });
await fs.copyFile(
  path.join(fixtureRoot, 'corrupt.part-000000.jsonl.gz'),
  path.join(corruptPartsDir, 'sample.part-000000.jsonl.gz')
);
await writePiecesManifest(corruptDir, [
  { name: 'sample', path: 'sample.parts/sample.part-000000.jsonl.gz' }
]);

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

const validCompressedDir = path.join(testRoot, 'valid-compressed');
const validCompressedPartsDir = path.join(validCompressedDir, 'sample.parts');
await fs.mkdir(path.join(validCompressedDir, 'pieces'), { recursive: true });
await fs.mkdir(validCompressedPartsDir, { recursive: true });
const validPayload = Buffer.from('{"id":1,"name":"ok"}\n{"id":2,"name":"ok2"}\n', 'utf8');
await fs.writeFile(
  path.join(validCompressedPartsDir, 'sample.part-000000.jsonl.gz'),
  zlib.gzipSync(validPayload)
);
await writePiecesManifest(validCompressedDir, [
  { name: 'sample', path: 'sample.parts/sample.part-000000.jsonl.gz' }
]);

const validRows = await loadJsonArrayArtifact(validCompressedDir, 'sample', { strict: false });
assert.equal(validRows.length, 2, 'expected valid compressed shard to load materialized rows');
const validStreamRows = [];
for await (const row of loadJsonArrayArtifactRows(validCompressedDir, 'sample', { strict: false })) {
  validStreamRows.push(row);
}
assert.equal(validStreamRows.length, 2, 'expected valid compressed shard to stream rows');

console.log('jsonl fuzz test passed');
