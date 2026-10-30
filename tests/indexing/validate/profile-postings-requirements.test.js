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
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';

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
    const changedConfig = await run(strict, { ...userConfig, indexing: { postings } });
    assert.ok(!changedConfig.issues.some(issue => /field_postings|field_tokens|token_postings/u.test(issue)),
      'ambient current defaults cannot turn historically omitted sparse output into corruption');
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
  const validState = structuredClone(state);
  validState.artifacts.present.dense_vectors = true;
  validState.artifacts.omitted = validState.artifacts.omitted.filter(name => name !== 'dense_vectors');
  const good = await createBaseIndex({ rootDir: path.join(root, 'valid'), indexState: validState });
  await fs.writeFile(path.join(good.indexDir, 'dense_vectors_uint8.bin'), Buffer.from([1, 2]));
  await fs.writeFile(path.join(good.indexDir, 'dense_vectors_uint8.bin.meta.json'), JSON.stringify({
    dims: 2, count: 1, path: 'dense_vectors_uint8.bin' }));
  await updatePiecesManifest(good.indexDir, manifest => { manifest.pieces = manifest.pieces.filter(piece => piece.name !== 'token_postings');
    manifest.pieces.push({ name: 'dense_vectors', type: 'embeddings', path: 'dense_vectors_uint8.bin', format: 'binary', bytes: 2, count: 1 },
      { name: 'dense_vectors_binary_meta', type: 'embeddings', path: 'dense_vectors_uint8.bin.meta.json', format: 'json', count: 1 }); });
  const check = (config = userConfig, extra = {}) => validateIndexArtifacts({ root: good.repoRoot, indexRoot: good.indexRoot,
    modes: ['code'], userConfig: config, strict: true, sqliteEnabled: false, lmdbEnabled: false, ...extra });
  const healthy = await check(); assert.equal(healthy.ok, true, healthy.issues.join('\n'));
  const moved = await check({ ...userConfig, indexing: { postings } });
  assert.equal(moved.ok, true, moved.issues.join('\n'));
  assert.equal(moved.modes.code.compatibility.rebuildNeeded, true);
  assert.match(moved.modes.code.compatibility.reason, /profile/);
  assert.equal((await check(userConfig, { producerPoliciesByMode: { code: {
    profile: validState.profile, artifacts: validState.artifacts } } })).ok, true);
  assert.equal((await check(userConfig, { producerPoliciesByMode: { code: {
    profile: { id: 'default', schemaVersion: 1 }, artifacts: validState.artifacts } } })).ok, false);
  const stats = async () => spawnSubprocess(process.execPath,
    [path.resolve('tools/index/stats.js'), '--index-dir', good.indexDir, '--verify', '--json'],
    { timeoutMs: 5000, stdio: ['ignore', 'pipe', 'pipe'], maxOutputBytes: 256 * 1024, rejectOnNonZeroExit: false });
  const verified = await stats(); assert.equal(verified.exitCode, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).verify.ok, true);
  for (const profile of [{ id: 'unknown', schemaVersion: 1 }, { id: 'vector_only', schemaVersion: 99 }]) {
    await fs.writeFile(path.join(good.indexDir, 'index_state.json'), JSON.stringify({ ...validState, profile }));
    assert.equal((await check()).ok, false);
    assert.notEqual((await stats()).exitCode, 0);
  }
  await fs.writeFile(path.join(good.indexDir, 'index_state.json'), JSON.stringify(validState));
  await updatePiecesManifest(good.indexDir, manifest => { manifest.profileId = 'default'; });
  assert.equal((await check()).ok, false, 'conflicting persisted profiles cannot waive sparse requirements');
  assert.notEqual((await stats()).exitCode, 0);
  await updatePiecesManifest(good.indexDir, manifest => { delete manifest.profileId; });
  const sparse = await createBaseIndex({ rootDir: path.join(root, 'sparse') });
  const toggled = { ...defaultUserConfig, indexing: { postings: { fielded: true, enablePhraseNgrams: true, enableChargrams: true } } };
  const legacy = await validateIndexArtifacts({ root: sparse.repoRoot, indexRoot: sparse.indexRoot,
    modes: ['code'], userConfig: toggled, sqliteEnabled: false, lmdbEnabled: false, strict: true });
  assert.equal(legacy.ok, true, legacy.issues.join('\n'));
  assert.equal(legacy.modes.code.compatibility.rebuildNeeded, true, 'changed sparse options are explicit compatibility drift');
  await fs.cp(sparse.indexDir, path.join(good.indexRoot, 'index-prose'), { recursive: true });
  const proseState = path.join(good.indexRoot, 'index-prose', 'index_state.json');
  await fs.writeFile(proseState, JSON.stringify({ ...JSON.parse(await fs.readFile(proseState)), mode: 'prose' }));
  const mixed = await check(defaultUserConfig, { modes: ['code', 'prose'] });
  assert.equal(mixed.ok, true, mixed.issues.join('\n'));
  assert.equal(mixed.modes.code.compatibility.rebuildNeeded, true);
  assert.equal(mixed.modes.prose.compatibility.rebuildNeeded, false);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Profile-aware sparse validation retains dense readiness and present-data integrity.');
