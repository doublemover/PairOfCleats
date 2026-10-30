import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { collectEmbeddingReplayState, repairEmbeddingReplayState } from '../../../tools/service/embedding-replay.js';
import { resolveEmbeddingBackendStageDir } from '../../../tools/service/indexer-service-helpers.js';
import { publishIndexStateMutation } from '../../../src/shared/index-state-publication.js';
import { loadIndexState, writeIndexState } from '../../../tools/build/embeddings/state.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { checksumFile } from '../../../src/shared/hash.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: real recovery/publication owners; current native-stage cleanup
// authority stays with the actual writer, never a legacy diagnostic pathname.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['legacy-reset', 'native-merge', 'stale-embeddings', 'stale-attempt', 'stale-generation',
  'owned-state', 'new-invocation-claim', 'outside-root', 'traversal-mode', 'unreadable-state',
  'pending-read', 'legacy-path-preserved', 'corrupt-manifest', 'idempotent'].includes(selected));
const parent = path.resolve('.tmp/tasks'); await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(path.join(parent, 'embedding-replay-publication-'));
const buildRoot = path.join(root, 'build'), indexDir = path.join(buildRoot, 'index-code');
const statePath = path.join(indexDir, 'index_state.json'), manifestPath = path.join(indexDir, 'pieces', 'manifest.json');
const legacy = path.join(buildRoot, '.embeddings-backend-staging', 'index-code');
const job = { id: 'original-job', repo: root, repoRoot: root, buildRoot, indexDir, mode: 'code', embeddingPayloadFormatVersion: 2 };
const initial = { mode: 'code', buildId: 'original-build', generatedAt: '2026-10-28T00:00:00.000Z',
  embeddings: { pending: true, ready: false }, sqlite: { retained: true }, extensions: { caller: { retained: true } } };
let held, release, inject = false, settled = false;
const open = fsSync.openSync;
const pending = Object.freeze(Object.assign(new Error('original replay read remains outstanding'), {
  cacheOwnershipReleased() { assert.equal(this, pending); return settled; }
}));
const ordinary = Object.freeze(Object.assign(new Error('original replay access denial'), { code: 'EACCES' }));
fsSync.openSync = (file, ...args) => {
  if (inject && typeof file === 'string' && path.resolve(file) === statePath) throw selected === 'pending-read' ? pending : ordinary;
  return open(file, ...args);
};
try {
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.mkdir(legacy, { recursive: true });
  await fs.writeFile(path.join(legacy, 'unowned-sentinel.txt'), 'preserve unknown owner');
  if (['owned-state', 'new-invocation-claim'].includes(selected)) initial.extensions.runtimeAttemptId = 'original-attempt';
  if (selected === 'legacy-path-preserved') initial.embeddings = { pending: false, ready: true };
  await fs.writeFile(statePath, JSON.stringify(initial));
  await fs.writeFile(manifestPath, selected === 'corrupt-manifest' ? '{truncated' : JSON.stringify({ version: 2,
    artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION, pieces: [{ name: 'index_state', type: 'stats', format: 'json', path: 'index_state.json' }] }));
  const before = await fs.readFile(statePath, 'utf8');
  if (['native-merge', 'stale-embeddings', 'stale-attempt', 'stale-generation'].includes(selected)) {
    let entered; const acquired = new Promise(resolve => { entered = resolve; });
    held = publishIndexStateMutation(indexDir, async current => {
      entered(); await new Promise(resolve => { release = resolve; });
      if (selected === 'native-merge') current.sqlite.newer = 9;
      else if (selected === 'stale-embeddings') current.embeddings = { pending: false, ready: true, count: 7 };
      else if (selected === 'stale-attempt') current.extensions.runtimeAttemptId = 'replacement-attempt';
      else current.buildId = 'replacement-build';
    });
    await acquired;
    // Recovery captures the original state synchronously before observations.
    const repairing = repairEmbeddingReplayState(job); release(); await held;
    if (selected === 'native-merge') {
      const report = await repairing; assert.equal(report.repaired, true);
      const saved = JSON.parse(await fs.readFile(statePath, 'utf8'));
      assert.equal(saved.sqlite.newer, 9); assert.equal(saved.sqlite.retained, true); assert.equal(saved.embeddings.pending, false);
      assert.deepEqual(saved.extensions.caller, initial.extensions.caller);
    } else {
      const current = await fs.readFile(statePath, 'utf8');
      await assert.rejects(repairing, { code: 'ERR_INDEX_STATE_PUBLICATION_CONFLICT' });
      assert.equal(await fs.readFile(statePath, 'utf8'), current);
    }
  } else if (['owned-state', 'new-invocation-claim'].includes(selected)) {
    const report = await repairEmbeddingReplayState(job);
    assert.equal(report.repaired, false); assert.ok(report.actions.some(item => item.type === 'retain-owned-index-state'));
    assert.equal(await fs.readFile(statePath, 'utf8'), before, 'replay cannot impersonate a persisted invocation');
    if (selected === 'new-invocation-claim') {
      // The real Stage3 initial-publication owner handles this, using the same
      // original loaded object, explicit claim and pending initialization.
      const state = loadIndexState(statePath);
      state.extensions.runtimeAttemptId = 'new-stage3-attempt';
      state.embeddings = { ...state.embeddings, pending: true, ready: false, lastError: null };
      await writeIndexState(statePath, state, { attemptId: 'new-stage3-attempt', claimAttempt: true });
      const saved = JSON.parse(await fs.readFile(statePath, 'utf8'));
      assert.equal(saved.extensions.runtimeAttemptId, 'new-stage3-attempt'); assert.equal(saved.embeddings.pending, true);
      assert.deepEqual(saved.sqlite, initial.sqlite);
    }
  } else if (selected === 'outside-root') {
    const outside = path.join(root, 'unrelated'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, 'index_state.json'), before);
    await assert.rejects(repairEmbeddingReplayState({ ...job, indexDir: outside }), { code: 'ERR_EMBEDDING_REPLAY_ROOT' });
    assert.equal(await fs.readFile(path.join(outside, 'index_state.json'), 'utf8'), before);
  } else if (selected === 'traversal-mode') {
    for (const mode of ['code/../../../unrelated', '..\\..\\unrelated', 'both', 'unknown']) {
      assert.throws(() => resolveEmbeddingBackendStageDir(job, mode), { code: 'ERR_EMBEDDING_REPLAY_MODE' });
      await assert.rejects(repairEmbeddingReplayState({ ...job, mode }), { code: 'ERR_EMBEDDING_REPLAY_MODE' });
    }
    assert.equal(await fs.readFile(statePath, 'utf8'), before);
  } else if (['unreadable-state', 'pending-read'].includes(selected)) {
    inject = true;
    await assert.rejects(repairEmbeddingReplayState(job), error => errorGraphIncludes(error, selected === 'pending-read' ? pending : ordinary));
    inject = false; assert.equal(await fs.readFile(statePath, 'utf8'), before);
  } else if (selected === 'legacy-path-preserved') {
    const beforeReport = await collectEmbeddingReplayState(job);
    assert.equal(beforeReport.backendStage.exists, true); assert.equal(beforeReport.partialDurableState, false);
    const report = await repairEmbeddingReplayState(job); assert.equal(report.repaired, false);
    assert.equal(await fs.readFile(statePath, 'utf8'), before);
  } else if (selected === 'corrupt-manifest') {
    await assert.rejects(repairEmbeddingReplayState(job), SyntaxError);
    assert.equal(await fs.readFile(manifestPath, 'utf8'), '{truncated', 'failed required publication retains original evidence');
  } else {
    const report = await repairEmbeddingReplayState(job); assert.equal(report.repaired, true);
    assert.equal(report.after.embeddings.pending, false); assert.equal(report.after.embeddings.ready, false);
    assert.ok(report.actions.some(item => item.type === 'reset-pending-index-state'));
    const checksum = await checksumFile(statePath), piece = JSON.parse(await fs.readFile(manifestPath, 'utf8')).pieces[0];
    assert.equal(piece.bytes, (await fs.stat(statePath)).size); assert.equal(piece.checksum, `${checksum.algo}:${checksum.value}`);
    if (selected === 'idempotent') {
      const saved = await fs.readFile(statePath, 'utf8'); assert.equal((await repairEmbeddingReplayState(job)).repaired, false);
      assert.equal(await fs.readFile(statePath, 'utf8'), saved);
    }
  }
  assert.equal(await fs.readFile(path.join(legacy, 'unowned-sentinel.txt'), 'utf8'), 'preserve unknown owner');
} finally {
  inject = false; settled = true; fsSync.openSync = open; release?.(); if (held) await held;
  await fs.rm(root, { recursive: true, force: true });
}
console.log(`Embedding replay publication: ${selected}`);
