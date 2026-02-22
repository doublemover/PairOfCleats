#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  loadJsonArrayArtifact,
  loadJsonArrayArtifactRows
} from '../../../src/shared/artifact-io/loaders.js';
import { encodeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const testRoot = await prepareArtifactIoTestDir('artifact-io-spec-contract', { root });

const noManifestDir = path.join(testRoot, 'strict-manifest');
await fs.mkdir(noManifestDir, { recursive: true });
await fs.writeFile(path.join(noManifestDir, 'sample.json'), JSON.stringify([{ id: 1 }], null, 2));

await assert.rejects(
  () => loadJsonArrayArtifact(noManifestDir, 'sample', { strict: true }),
  /Missing pieces manifest|ERR_MANIFEST_MISSING/,
  'strict mode must be manifest-first'
);

await assert.rejects(
  () => loadJsonArrayArtifact(noManifestDir, 'sample', { strict: false }),
  /Missing pieces manifest|ERR_MANIFEST_MISSING/,
  'non-strict mode should still require manifest-declared artifacts after cutover'
);

const manifestDir = path.join(testRoot, 'manifest-json');
await fs.mkdir(path.join(manifestDir, 'pieces'), { recursive: true });
await fs.writeFile(path.join(manifestDir, 'sample.json'), JSON.stringify([{ id: 1 }], null, 2));
await writePiecesManifest(manifestDir, [
  { name: 'sample', path: 'sample.json', format: 'json' }
]);

const materializedRows = await loadJsonArrayArtifact(manifestDir, 'sample', { strict: false });
assert.equal(materializedRows.length, 1, 'manifest JSON should load through non-strict path');
const streamedRows = [];
for await (const row of loadJsonArrayArtifactRows(manifestDir, 'sample', { strict: false })) {
  streamedRows.push(row);
}
assert.equal(streamedRows.length, 1, 'streaming loader should yield manifest-backed JSON rows');

const partialDir = path.join(testRoot, 'partial');
const partialParts = path.join(partialDir, 'sample.parts');
await fs.mkdir(path.join(partialDir, 'pieces'), { recursive: true });
await fs.mkdir(partialParts, { recursive: true });
await fs.writeFile(path.join(partialParts, 'sample.part-000000.jsonl'), '{"id":0}\n');
await fs.writeFile(path.join(partialParts, 'sample.part-000002.jsonl'), '{"id":2}\n');
await writePiecesManifest(partialDir, [
  { name: 'sample', path: 'sample.parts/sample.part-000000.jsonl' },
  { name: 'sample', path: 'sample.parts/sample.part-000002.jsonl' }
]);

await assert.rejects(
  () => loadJsonArrayArtifact(partialDir, 'sample', { strict: false }),
  (err) => err?.code === 'ERR_ARTIFACT_PARTS_MISSING',
  'partial shard sequences must fail deterministically'
);

const binaryMissingSidecarsDir = path.join(testRoot, 'binary-missing-sidecars');
await fs.mkdir(path.join(binaryMissingSidecarsDir, 'pieces'), { recursive: true });
const encoded = encodeBinaryRowFrames([Buffer.from('{"id":1}', 'utf8')]);
await fs.writeFile(
  path.join(binaryMissingSidecarsDir, 'sample.binary-columnar.bin'),
  encoded.dataBuffer
);
await fs.writeFile(
  path.join(binaryMissingSidecarsDir, 'sample.binary-columnar.meta.json'),
  JSON.stringify({
    fields: {
      format: 'binary-columnar-v1',
      count: 1,
      data: 'sample.binary-columnar.bin',
      offsets: 'sample.binary-columnar.offsets.bin',
      lengths: 'sample.binary-columnar.lengths.varint'
    }
  }, null, 2)
);
await writePiecesManifest(binaryMissingSidecarsDir, [
  { name: 'sample', path: 'sample.binary-columnar.bin', format: 'binary-columnar' },
  { name: 'sample_binary_columnar_meta', path: 'sample.binary-columnar.meta.json', format: 'json' }
]);
await assert.rejects(
  () => loadJsonArrayArtifact(binaryMissingSidecarsDir, 'sample', { strict: true }),
  (err) => err?.code === 'ERR_MANIFEST_INCOMPLETE' || err?.code === 'ERR_ARTIFACT_PARTS_MISSING',
  'binary-columnar manifests must include offsets/lengths sidecars for strict loads'
);

console.log('artifact io spec contract test passed');
