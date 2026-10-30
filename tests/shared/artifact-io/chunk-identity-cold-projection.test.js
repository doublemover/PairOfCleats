#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { loadChunkMetaRows, loadChunkMetaIdentityRows } from '../../../src/shared/artifact-io/loaders/chunk-meta.js';
import { buildChunkIdentityEnvelopeFromArtifactRow } from '../../../src/shared/identity.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
applyTestEnv();
const root = resolveTestCachePath(process.cwd(), 'chunk-identity-cold-projection'); await fs.mkdir(root, { recursive: true });
const hot = [{ id: 0, file: 'source.js', start: 1, end: 3 }, { id: 1, file: 'source.js', start: 4, end: 6 }];
const cold = [1, 0].map(id => ({ id, preContext: 'x'.repeat(10000), codeRelations: { calls: Array(100).fill(['caller', 'callee']) }, metaV2: { chunkUid: `uid-${id}`, chunkId: `chunk-${id}`, virtualPath: `source.js#${id}`, lang: 'javascript', mintedByStage: 'fixture', segment: { segmentUid: `seg-${id}`, start: id * 3, end: id * 3 + 3, languageId: 'javascript' } } }));
for (const format of ['json', 'jsonl']) {
  const hotName = `hot.${format}`, coldName = `cold.${format}`;
  const encode = rows => format === 'json' ? JSON.stringify(rows) : rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  await fs.writeFile(path.join(root, hotName), encode(hot)); await fs.writeFile(path.join(root, coldName), encode(cold));
  const manifest = { version: 2, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [{ name: 'chunk_meta', path: hotName, format, count: 2 }, { name: 'chunk_meta_cold', path: coldName, format, count: 2 }] };
  const full = [], projected = [];
  for await (const row of loadChunkMetaRows(root, { manifest, strict: true, preferBinaryColumnar: false })) full.push(row);
  for await (const row of loadChunkMetaIdentityRows(root, { manifest, strict: true, preferBinaryColumnar: false })) projected.push(row);
  assert.deepEqual(projected.map(buildChunkIdentityEnvelopeFromArtifactRow), full.map(buildChunkIdentityEnvelopeFromArtifactRow));
  assert.equal(projected[0].metaV2.mintedByStage, 'fixture');
  assert.equal(Object.hasOwn(projected[0], 'preContext'), false); assert.equal(Object.hasOwn(projected[0], 'codeRelations'), false);
}
