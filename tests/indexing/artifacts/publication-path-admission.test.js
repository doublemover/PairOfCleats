import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { validateArtifactPublicationGeneration } from '../../../src/index/build/artifact-publication.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const buildRoot = await makeTempDir('publication-path-admission-');
const originalLstat = fs.lstatSync;
try {
  const fixture = await seedPublishedArtifacts({ buildRoot });
  const input = { ...fixture, buildRoot, mode: 'code', buildId: path.basename(buildRoot) };
  assert.equal((await validateArtifactPublicationGeneration(input)).ok, true);
  const target = path.join(fixture.outDir, fixture.pieceEntries[0].path);
  let rejected = 0;
  fs.lstatSync = function(filename, ...args) {
    if (path.resolve(filename) === target) { rejected++; return { isSymbolicLink: () => true }; }
    return originalLstat.call(this, filename, ...args);
  };
  await assert.rejects(validateArtifactPublicationGeneration(input), { code: 'ERR_ARTIFACT_PATH' },
    'the actual stat boundary retains physical authority after identity-only comparisons');
  assert.equal(rejected, 1, 'unsafe actual access is rejected before any file stat');
  fs.lstatSync = originalLstat;
  const manifest = JSON.parse(await fsPromises.readFile(fixture.manifestPath, 'utf8'));
  for (const label of ['../outside.json', target, '.']) {
    await fsPromises.writeFile(fixture.manifestPath, JSON.stringify({ ...manifest,
      pieces: [...manifest.pieces, { name: 'untrusted', path: label, format: 'json' }] }));
    await assert.rejects(validateArtifactPublicationGeneration(input), { code: 'ERR_ARTIFACT_PATH' });
  }
  await fsPromises.writeFile(fixture.manifestPath, JSON.stringify(manifest));
  await fsPromises.rm(target);
  await assert.rejects(validateArtifactPublicationGeneration(input), { code: 'ENOENT' },
    'a former successful comparison cannot authorize missing current bytes');
} finally { fs.lstatSync = originalLstat; await rmDirRecursive(buildRoot); }
console.log('Publication keeps lexical rejection and current physical admission without repeated identity-walk work.');
