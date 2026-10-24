import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { assertArtifactPublicationReady } from '../../../src/index/build/artifact-publication.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'publication-binding-'));
const a = path.join(root,'build-a'), b = path.join(root,'build-b');
try {
  await seedPublishedArtifacts({ buildRoot: a });
  await assertArtifactPublicationReady({ buildRoot: a, modes: ['code'] });
  if (process.platform === 'win32') {
    await assertArtifactPublicationReady({ buildRoot: a.toUpperCase(), modes: ['code'] });
  }
  await fs.mkdir(b);
  const record = 'artifact-publication.code.json';
  await fs.copyFile(path.join(a,record), path.join(b,record));
  await assert.rejects(assertArtifactPublicationReady({ buildRoot: b, modes: ['code'] }), /requested generation/);
  const manifestBefore = await fs.readFile(path.join(a,'index-code','pieces','manifest.json'));
  const payload = JSON.parse(await fs.readFile(path.join(a,record),'utf8'));
  for (const replacement of [
    { mode: 'prose' }, { buildRoot: b }, { indexDir: path.join(a, 'index-prose') },
    { generationId: 'a-different-generation' }, { schemaVersion: 999 }, { artifactSurfaceVersion: '999.0.0' }
  ]) {
    await fs.writeFile(path.join(a,record), JSON.stringify({ ...payload, ...replacement }));
    await assert.rejects(assertArtifactPublicationReady({ buildRoot: a, modes: ['code'] }), /requested generation/);
  }
  assert.deepEqual(await fs.readFile(path.join(a,'index-code','pieces','manifest.json')), manifestBefore);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('publication generation binding passed');
