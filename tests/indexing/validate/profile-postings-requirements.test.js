import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validateIndexArtifacts } from '../../../src/index/validate.js';
import { buildArtifactLists } from '../../../src/index/validate/artifacts.js';
import { buildIndexProfileState, INDEX_PROFILE_VECTOR_ONLY } from '../../../src/contracts/index-profile.js';
import { buildIndexStateArtifactsBlock } from '../../../src/index/build/index-state-profile.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createBaseIndex, defaultUserConfig } from './helpers.js';
import { updatePiecesManifest } from '../../helpers/pieces-manifest.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const { dir: root } = await prepareIsolatedTestCacheDir('profile-postings-requirements');
assert.ok(root.startsWith(path.resolve('.tmp') + path.sep), 'the disposable fixture stays inside the repository temporary root');
try {
  const postings = { ...defaultUserConfig.indexing.postings, fielded: true };
  const userConfig = { ...defaultUserConfig, indexing: { profile: INDEX_PROFILE_VECTOR_ONLY, postings } };
  const lists = buildArtifactLists(userConfig, postings);
  assert.equal(lists.sparseEnabled, false);
  assert.ok(lists.requiredArtifacts.includes('dense_vectors'));
  assert.ok(!lists.requiredArtifacts.includes('token_postings'));
  const state = { generatedAt: new Date().toISOString(), mode: 'code', artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    profile: buildIndexProfileState(INDEX_PROFILE_VECTOR_ONLY),
    embeddings: { enabled: true, mode: 'service', service: true, pending: true, ready: false },
    artifacts: buildIndexStateArtifactsBlock({ profileId: INDEX_PROFILE_VECTOR_ONLY, mode: 'code', embeddingsEnabled: false, postingsConfig: postings }) };
  const { repoRoot, indexRoot, indexDir } = await createBaseIndex({ rootDir: root, indexState: state });
  await fs.unlink(path.join(indexDir, 'token_postings.json'));
  await updatePiecesManifest(indexDir, manifest => { manifest.pieces = manifest.pieces.filter(piece => piece.name !== 'token_postings'); });
  const run = (strict, config = userConfig) => validateIndexArtifacts({ root: repoRoot, indexRoot, modes: ['code'],
    userConfig: config, strict, sqliteEnabled: false, lmdbEnabled: false });
  for (const strict of [true, false]) {
    const report = await run(strict);
    assert.equal(report.ok, false, 'queued work cannot substitute for required dense artifacts');
    assert.ok(report.issues.some(issue => issue.includes('dense_vectors')), report.issues.join('\n'));
    assert.ok(!report.issues.some(issue => /field_postings|field_tokens|token_postings/u.test(issue)),
      'the actual vector-only validation owner cannot require intentionally omitted sparse output:\n' + report.issues.join('\n'));
    const sparse = await run(strict, { ...userConfig, indexing: { postings } });
    for (const name of ['field_postings', 'field_tokens', 'token_postings']) {
      assert.ok(sparse.issues.some(issue => issue.includes(name)), 'default profiles retain required ' + name);
    }
  }
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), JSON.stringify({
    vocab: ['invalid'], postings: [[[99, 1]]], docLengths: [1], avgDocLen: 1, totalDocs: 1 }));
  await updatePiecesManifest(indexDir, manifest => { manifest.pieces.push({
    type: 'postings', name: 'token_postings', format: 'json', path: 'token_postings.json' }); });
  for (const strict of [true, false]) {
    const report = await run(strict);
    assert.ok(report.issues.some(issue => issue.includes('token_postings')), 'present corrupt sparse data remains invalid');
  }
  await updatePiecesManifest(indexDir, manifest => { manifest.pieces.push({
    type: 'postings', name: 'field_tokens', format: 'json', path: 'missing-field-tokens.json' }); });
  assert.ok((await run(false)).issues.some(issue => issue.includes('field_tokens')),
    'an explicitly declared missing optional artifact cannot become an allowed omission');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Profile-aware sparse validation retains dense readiness and present-data integrity.');
