import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
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
const testRoot = await prepareArtifactIoTestDir('loader-fallbacks', { root });

const fallbackDir = path.join(testRoot, 'fallback-json');
await fs.mkdir(path.join(fallbackDir, 'pieces'), { recursive: true });
await fs.writeFile(
  path.join(fallbackDir, 'sample.json'),
  JSON.stringify([{ id: 1, value: 'ok' }], null, 2)
);
await assert.rejects(
  () => loadJsonArrayArtifact(fallbackDir, 'sample', { strict: false }),
  /Missing pieces manifest|ERR_MANIFEST_MISSING/,
  'expected hard cutover to reject unmanifested legacy JSON artifacts'
);

const partialDir = path.join(testRoot, 'partial-shards');
const partialPartsDir = path.join(partialDir, 'sample.parts');
await fs.mkdir(path.join(partialDir, 'pieces'), { recursive: true });
await fs.mkdir(partialPartsDir, { recursive: true });
await fs.copyFile(
  path.join(fixtureRoot, 'partial.part-000000.jsonl'),
  path.join(partialPartsDir, 'sample.part-000000.jsonl')
);
await fs.copyFile(
  path.join(fixtureRoot, 'partial.part-000002.jsonl'),
  path.join(partialPartsDir, 'sample.part-000002.jsonl')
);
await writePiecesManifest(partialDir, [
  { name: 'sample', path: 'sample.parts/sample.part-000000.jsonl' },
  { name: 'sample', path: 'sample.parts/sample.part-000002.jsonl' }
]);

await assert.rejects(
  () => loadJsonArrayArtifact(partialDir, 'sample', { strict: false }),
  (err) => err?.code === 'ERR_ARTIFACT_PARTS_MISSING' && /sample\.part-000001\.jsonl/.test(String(err?.message || '')),
  'expected partial shard set to fail with deterministic missing-shard error'
);

await assert.rejects(
  async () => {
    for await (const _row of loadJsonArrayArtifactRows(partialDir, 'sample', { strict: false })) {
      // consume rows
    }
  },
  (err) => err?.code === 'ERR_ARTIFACT_PARTS_MISSING' && /sample\.part-000001\.jsonl/.test(String(err?.message || '')),
  'expected streaming loader to fail with deterministic missing-shard error'
);

console.log('loader fallbacks test passed');
