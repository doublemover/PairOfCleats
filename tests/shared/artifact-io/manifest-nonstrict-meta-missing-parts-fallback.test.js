#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadJsonArrayArtifact } from '../../../src/shared/artifact-io.js';
import {
  prepareArtifactIoTestDir,
  writePiecesManifest
} from '../../helpers/artifact-io-fixture.js';

const root = process.cwd();
const outDir = await prepareArtifactIoTestDir('manifest-nonstrict-meta-missing-parts', { root });

const partsDir = path.join(outDir, 'sample.parts');
await fs.mkdir(partsDir, { recursive: true });
await fs.writeFile(path.join(partsDir, 'sample.part-000000.jsonl'), '{"id":1}\n');
await fs.writeFile(path.join(outDir, 'sample.meta.json'), JSON.stringify({
  format: 'jsonl-sharded',
  total: 1
}, null, 2));

await writePiecesManifest(outDir, [
  { name: 'sample_meta', path: 'sample.meta.json', format: 'json' },
  { name: 'sample', path: 'sample.parts/sample.part-000000.jsonl', format: 'jsonl' }
]);

await assert.rejects(
  () => loadJsonArrayArtifact(outDir, 'sample', { strict: true }),
  (err) => err?.code === 'ERR_MANIFEST_INVALID',
  'strict mode should fail when sharded meta omits parts'
);

const rows = await loadJsonArrayArtifact(outDir, 'sample', { strict: false });
assert.equal(rows.length, 1, 'non-strict mode should fall back to direct manifest entries when meta omits parts');
assert.equal(rows[0]?.id, 1, 'expected fallback row to load correctly');

console.log('manifest non-strict meta missing parts fallback test passed');
