import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { validateArtifactPublicationGeneration, writeArtifactPublicationRecord } from '../../../src/index/build/artifact-publication.js';
import { createArtifactPieceRegistry } from '../../../src/index/build/artifacts/piece-registry.js';

const root = resolveTestCachePath(process.cwd(), `publication-proof-admission-${crypto.randomUUID()}`);
const outDir = path.join(root, 'index-code');
const entry = { name: 'chunk_meta', path: 'chunk_meta.json', format: 'json', count: 0 };
try {
  await fs.mkdir(path.join(outDir, 'pieces'), { recursive: true });
  await fs.writeFile(path.join(outDir, entry.path), '[]');
  const input = { buildRoot: root, outDir, mode: 'code', pieceEntries: [entry] };
  const writeManifest = pieces => fs.writeFile(path.join(outDir, 'pieces', 'manifest.json'), JSON.stringify({ artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces }));
  await writeManifest([entry]);
  const valid = await validateArtifactPublicationGeneration(input);
  assert.equal(valid.ok, true);
  await assert.rejects(writeArtifactPublicationRecord(input), /requires successful/);
  await assert.rejects(writeArtifactPublicationRecord({ ...input, status: 'typo', publicationValidation: { payload: valid } }), /unknown publication status/);
  await assert.rejects(writeArtifactPublicationRecord({ ...input, publicationValidation: { payload: { ...valid, ok: false } } }), /requires successful/);
  const published = await writeArtifactPublicationRecord({ ...input, publicationValidation: { payload: valid } });
  assert.equal(published.payload.publicationValidation.ok, true);
  await writeManifest([{ ...entry, name: 'file_meta' }]);
  assert.equal((await validateArtifactPublicationGeneration(input)).ok, false, 'path and name must refer to the same selected piece');
  await writeManifest([entry, entry]);
  assert.equal((await validateArtifactPublicationGeneration(input)).ok, false, 'duplicate paths cannot be silently overwritten');
  const registry = createArtifactPieceRegistry({ outDir });
  assert.throws(() => registry.addPieceFile(entry, path.join(root, 'outside.json')), { code: 'ERR_ARTIFACT_PATH' });
  await assert.rejects(validateArtifactPublicationGeneration({ ...input, pieceEntries: [{ ...entry, path: '../outside.json' }] }), { code: 'ERR_ARTIFACT_PATH' });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('publication proof admission passed');
