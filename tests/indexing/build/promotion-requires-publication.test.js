#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { applyTestEnv } from '../../helpers/test-env.js';
import { seedPublishedArtifacts } from '../../helpers/artifact-publication.js';
import { promoteBuild } from '../../../src/index/build/promotion.js';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { assertArtifactPublicationReady, writeArtifactPublicationRecord } from '../../../src/index/build/artifact-publication.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-promotion-publication-'));
applyTestEnv({ cacheRoot: tempRoot });

try {
  const repoRoot = path.join(tempRoot, 'repo');
  const userConfig = {};
  await fs.mkdir(repoRoot, { recursive: true });

  const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  const buildRoot = path.join(buildsRoot, 'build-a');
  await fs.mkdir(buildRoot, { recursive: true });

  await assert.rejects(
    () => promoteBuild({
      repoRoot,
      userConfig,
      buildId: 'build-a',
      buildRoot,
      stage: 'stage2',
      modes: ['code']
    }),
    /missing publication record/
  );

  await seedPublishedArtifacts({ buildRoot, mode: 'code', buildId: 'build-a' });
  await promoteBuild({
    repoRoot,
    userConfig,
    buildId: 'build-a',
    buildRoot,
    stage: 'stage2',
    modes: ['code']
  });

  const current = JSON.parse(await fs.readFile(path.join(buildsRoot, 'current.json'), 'utf8'));
  assert.equal(current.buildId, 'build-a');
  assert.equal(current.stage, 'stage2');
  assert.equal(current.extensions.__poc_generated.kind, 'builds-current');
  assert.equal(Object.keys(current)[0], 'extensions');
  current.extensions.caller = { preserved: true };
  await fs.writeFile(path.join(buildsRoot, 'current.json'), JSON.stringify(current));
  await promoteBuild({ repoRoot, userConfig, buildId: 'build-a', buildRoot, stage: 'stage2', modes: ['code'] });
  const next = JSON.parse(await fs.readFile(path.join(buildsRoot, 'current.json'), 'utf8'));
  assert.deepEqual(next.extensions.caller, { preserved: true });
  const candidate = path.join(buildsRoot, 'build-b');
  const seeded = await seedPublishedArtifacts({ buildRoot: candidate, mode: 'code', buildId: 'build-b' });
  const publicationPath = path.join(candidate, 'artifact-publication.code.json');
  const published = await fs.readFile(publicationPath, 'utf8');
  const validationPayload = JSON.parse(await fs.readFile(path.join(candidate, 'artifact-publication.code.validation.json'), 'utf8'));
  const chunkPath = path.join(seeded.outDir, 'chunk_meta.json');
  const chunkBytes = await fs.readFile(chunkPath), manifestBytes = await fs.readFile(seeded.manifestPath);
  const currentPath = path.join(buildsRoot, 'current.json'), pointerBefore = await fs.readFile(currentPath);
  const promoteCandidate = () => promoteBuild({ repoRoot, userConfig, buildId: 'build-b', buildRoot: candidate,
    stage: 'stage2', modes: ['code'] });
  const writeCandidate = () => writeArtifactPublicationRecord({ buildRoot: candidate, outDir: seeded.outDir,
    mode: 'code', buildId: 'build-b', pieceEntries: seeded.pieceEntries, manifestPath: seeded.manifestPath,
    publicationValidation: validationPayload });
  for (const status of ['unknown', '', null]) {
    await assert.rejects(writeArtifactPublicationRecord({ buildRoot: candidate, outDir: seeded.outDir,
      mode: 'code', pieceEntries: seeded.pieceEntries, manifestPath: seeded.manifestPath, status }), /unknown publication status/);
  }
  for (const replacement of [{ status: 'unknown' }, { publicationValidation: null },
    { publicationValidation: { ok: false } }, { publicationValidation: {} }]) {
    await fs.writeFile(publicationPath, JSON.stringify({ ...JSON.parse(published), ...replacement }));
    await assert.rejects(assertArtifactPublicationReady({ buildRoot: candidate, modes: ['code'] }));
    await assert.rejects(promoteCandidate());
    assert.deepEqual(await fs.readFile(currentPath), pointerBefore);
  }
  await fs.writeFile(publicationPath, published);
  for (const mutate of [
    async () => { const manifest = JSON.parse(manifestBytes); manifest.pieces[0].count = 99;
      await fs.writeFile(seeded.manifestPath, JSON.stringify(manifest)); },
    async () => fs.unlink(chunkPath),
    async () => { const changed = Buffer.from(chunkBytes.toString().replace('rows', 'r0ws'));
      assert.equal(changed.length, chunkBytes.length); await fs.writeFile(chunkPath, changed); }
  ]) {
    await mutate();
    await assert.rejects(writeCandidate(), 'same-root stale validation cannot authorize changed bytes/inventory');
    await assert.rejects(assertArtifactPublicationReady({ buildRoot: candidate, modes: ['code'] }));
    await assert.rejects(promoteCandidate());
    assert.deepEqual(await fs.readFile(currentPath), pointerBefore, 'integrity failure cannot change the selected pointer');
    await fs.writeFile(chunkPath, chunkBytes); await fs.writeFile(seeded.manifestPath, manifestBytes);
  }
  await assertArtifactPublicationReady({ buildRoot: candidate, modes: ['code'] });
  await promoteCandidate();
  assert.equal(JSON.parse(await fs.readFile(currentPath, 'utf8')).buildId, 'build-b', 'unchanged independently qualified generation promotes');

  console.log('promotion requires publication test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
