import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { writeArtifactPublicationRecord, writeArtifactPublicationValidationReport,
  assertArtifactPublicationReady, readArtifactPublicationRecord } from '../../../src/index/build/artifact-publication.js';
import { updateSqliteState } from '../../../src/storage/sqlite/build/index-state.js';
import { updateIndexStateNamespace } from '../../../src/shared/index-state-publication.js';
import { loadIndexState } from '../../../tools/build/embeddings/state.js';
import { publishEmbeddingGeneration } from '../../../tools/build/embeddings/publication.js';
import { refreshArtifactPublication } from '../../../src/index/build/publication-state-refresh.js';
import { SCHEMA_VERSION } from '../../../src/storage/sqlite/schema.js';

const { dir } = await prepareIsolatedTestCacheDir('publication-state-refresh-integrity');
const buildRoot = path.join(dir, 'build'), mode = 'code';
try {
  const { outDir, manifestPath, pieceEntries } = await seedPublishedArtifacts({ buildRoot, mode });
  const statePath = path.join(outDir, 'index_state.json');
  await fs.writeFile(statePath, JSON.stringify({ mode, buildId: 'build', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    generatedAt: '2026-10-29T00:00:00.000Z', embeddings: { enabled: false } }));
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const statePiece = { name: 'index_state', path: 'index_state.json', format: 'json' };
  manifest.pieces.push(statePiece); pieceEntries.push(statePiece);
  await fs.writeFile(manifestPath, JSON.stringify(manifest));
  const input = { buildRoot, outDir, mode, buildId: 'build', manifestPath, pieceEntries };
  await writeArtifactPublicationRecord({ ...input, publicationValidation: await writeArtifactPublicationValidationReport(input) });
  const ready = () => assertArtifactPublicationReady({ buildRoot, modes: [mode] });
  await ready();
  const before = await readArtifactPublicationRecord(buildRoot, mode);
  await updateSqliteState(outDir, { ready: true, file: 'index-code.db', schemaVersion: SCHEMA_VERSION });
  await ready();
  const sqlite = await readArtifactPublicationRecord(buildRoot, mode);
  assert.notDeepEqual(sqlite.publicationValidation.integrityBinding, before.publicationValidation.integrityBinding);
  await updateIndexStateNamespace(outDir, 'lmdb', { ready: true }); await ready();
  const stateBeforeFailure = await fs.readFile(statePath);
  const chunks = path.join(outDir, 'chunk_meta.json'), original = await fs.readFile(chunks);
  await fs.writeFile(chunks, Buffer.from(original.toString().replace('rows', 'r0ws')));
  await assert.rejects(updateSqliteState(outDir, { ready: false }), { code: 'ERR_ARTIFACT_PUBLICATION_INTEGRITY' });
  assert.deepEqual(await fs.readFile(statePath), stateBeforeFailure, 'unowned artifact mutation fails before controlled state publication');
  await fs.writeFile(chunks, original); await ready();
  const indexState = loadIndexState(statePath);
  indexState.embeddings = { enabled: true, ready: true, pending: false, embeddingGeneration: 'a'.repeat(64) };
  let qualified = false;
  const result = await publishEmbeddingGeneration({ statePath, indexState, publishManifest: async () => {},
    validate: async () => { await assert.rejects(ready(), { code: 'ERR_ARTIFACT_PUBLICATION_INTEGRITY' }); return { ok: true }; },
    commitReceipt: async () => {},
    qualifyArtifactPublication: async () => { await refreshArtifactPublication({ buildRoot, outDir, mode }); qualified = true; }
  });
  assert.equal(result.ok, true); assert.equal(qualified, true); await ready();
  assert.equal(JSON.parse(await fs.readFile(statePath)).embeddings.ready, true);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Controlled SQLite/LMDB state updates and final Stage3 publication refresh exact integrity without accepting unrelated mutation.');
