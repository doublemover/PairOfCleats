import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { createRepositoryAnswerInput } from '../../helpers/repository-answer-input.js';
import { compileAdmittedQueryAnswer } from '../../../src/context-pack/answers/render.js';
import { createRetainedAnswerStore } from '../../../src/context-pack/answers/retention.js';
import { buildRetainedAnswerGraph, retainedAnswerBytes, retainedAnswerHash } from '../../../src/context-pack/answers/retention-graph.js';
import { getRepoRoot, resolveRepoCacheRootPath } from '../../../src/shared/repo-paths.js';
import { inspectRepoCacheAccess, withExclusiveRepoCacheCleanup } from '../../../src/shared/cache/repo-access.js';
import { ANSWER_RETENTION_MAX_SLOTS } from '../../../src/contracts/schemas/answer-retention.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('semantic/questions/answer-retention/')[1];
assert.ok(['immutable-shared-graph', 'intent-and-base-conflicts', 'interruption-and-resume', 'corruption-and-authority', 'quotas-and-leases', 'native-failure-ownership'].includes(mode));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-answer-'));
const repoRoot = path.join(temporary, 'repo'), userConfig = { cache: { root: path.join(temporary, 'cache') } };
await fs.mkdir(repoRoot);
const cacheRoot = resolveRepoCacheRootPath(repoRoot, userConfig), root = path.join(cacheRoot, 'answers-v1');
const objects = path.join(root, 'objects'), slots = path.join(root, 'slots');
const make = (questionRevision = '1', sourceRevision = 'build-1') => {
  const input = createRepositoryAnswerInput({ revision: sourceRevision }); input.questionRef.revision = questionRevision;
  input.queryReceipt.world.repositoryNamespace = getRepoRoot(repoRoot);
  for (const row of input.queryReceipt.rows) row.detailRequest.repoRoot = input.queryReceipt.world.repositoryNamespace;
  return compileAdmittedQueryAnswer(input);
};
const begin = (store, answer, expectedBaseDigest = null) => store.begin({ questionRef: answer.questionRef, worldId: answer.worldId, expectedBaseDigest });
const fresh = () => createRetainedAnswerStore({ repoRoot, userConfig });
const child = async input => {
  const file = path.join(temporary, 'request.json'); await fs.writeFile(file, JSON.stringify({ repoRoot, userConfig, ...input }));
  const run = runNode(['tests/fixtures/semantic/retained-answer-client.js', file], 'fresh retained-answer process', process.cwd(),
    applyTestEnv({ syncProcess: false }), { timeoutMs: 10000, stdio: 'pipe', allowFailure: true });
  assert.equal(run.status, 0, run.stderr || run.stdout); assert.equal(run.signal, null);
  return JSON.parse(run.stdout);
};
try {
  const store = fresh(), first = make();
  if (mode === 'immutable-shared-graph') {
    await assert.rejects(fs.stat(root), { code: 'ENOENT' }, 'constructing the optional owner writes no answer artifact');
    const intent = await begin(store, first), publication = await store.commit(intent, first);
    const before = await fs.readdir(objects), contents = new Map(await Promise.all(before.map(async name => [name, await fs.readFile(path.join(objects, name), 'utf8')])));
    const graph = buildRetainedAnswerGraph(first);
    assert.equal(before.length, graph.objects.size);
    for (const [name, bytes] of contents) assert.equal(name, retainedAnswerHash(bytes) + '.json');
    assert.ok([...contents.values()].some(bytes => JSON.parse(bytes).kind === 'retained-answer-support'));
    assert.deepEqual((await fresh().read(first.questionRef)).answer, first);
    const second = make('2'), nextGraph = buildRetainedAnswerGraph(second), next = await begin(store, second, first.digest);
    assert.ok([...graph.objects.keys()].some(hash => nextGraph.objects.has(hash)), 'identical support nodes are shared across answer revisions');
    await store.commit(next, second);
    assert.equal((await fs.readdir(objects)).length, new Set([...graph.objects.keys(), ...nextGraph.objects.keys()]).size);
    for (const [name, bytes] of contents) assert.equal(await fs.readFile(path.join(objects, name), 'utf8'), bytes, 'old immutable answers and shared DAG objects remain unchanged');
    const read = await store.read(second.questionRef);
    assert.deepEqual(read.answer, second); assert.equal(read.status, 'historical-answer');
    assert.equal(read.currentSourceAdmission, 'not-established-by-retention'); assert.equal(publication.answerDigest, first.digest);
    assert.deepEqual((await fresh().readRevision(publication)).answer, first, 'the prior immutable revision remains inspectable by its exact receipt');
    const staged = store.prepare(await begin(store, first, second.digest), first);
    assert.throws(() => { staged.receipt.questionRef.revision = 'forged'; }, TypeError);
    assert.equal((await staged.commit()).answerDigest, first.digest);
  } else if (mode === 'intent-and-base-conflicts') {
    await store.commit(await begin(store, first), first);
    const old = make('2'), next = make('3', 'build-2');
    const late = await begin(store, old, first.digest), current = await begin(fresh(), next, first.digest);
    await assert.rejects(store.commit(late, old), { code: 'ERR_ANSWER_RETENTION_CONFLICT' });
    const pending = await store.read(first.questionRef);
    assert.equal(pending.answer.digest, first.digest); assert.equal(pending.status, 'refresh-pending'); assert.deepEqual(pending.pending, current);
    await assert.rejects(begin(store, next, null), { code: 'ERR_ANSWER_RETENTION_CONFLICT' });
    await assert.rejects(store.commit(current, old), { code: 'ERR_ANSWER_RETENTION_CONFLICT' });
    const committed = await store.commit(current, next);
    assert.deepEqual(await fresh().commit(current, next), committed, 'lost delivery may replay exact publication without replaying query work');
    await assert.rejects(store.commit(late, old), { code: 'ERR_ANSWER_RETENTION_CONFLICT' });
    assert.deepEqual((await store.read(next.questionRef)).answer, next);
  } else if (mode === 'interruption-and-resume') {
    await store.commit(await begin(store, first), first);
    const next = make('2', 'build-2'), intent = await begin(store, next, first.digest);
    const originalRename = fs.rename, originalLink = fs.link;
    const failed = Object.assign(new Error('injected head replacement failure'), { code: 'EIO' });
    try {
      fs.rename = async (from, to) => { if (path.dirname(to) === slots) throw failed; return originalRename(from, to); };
      await assert.rejects(store.commit(intent, next), error => error === failed || error.cause === failed);
    } finally { fs.rename = originalRename; }
    let read = await store.read(first.questionRef);
    assert.equal(read.answer.digest, first.digest); assert.deepEqual(read.pending, intent);
    const committed = await child({ mode: 'commit', intent, answer: next });
    assert.equal(committed.answerDigest, next.digest);
    assert.deepEqual((await child({ mode: 'read', questionRef: next.questionRef })).answer, next);
    const last = make('3', 'build-3'), active = await begin(store, last, next.digest), controller = new AbortController();
    try {
      fs.link = async (from, to) => { const result = await originalLink(from, to); if (path.dirname(to) === objects) controller.abort(); return result; };
      await assert.rejects(store.commit(active, last, { signal: controller.signal }), { name: 'AbortError' });
    } finally { fs.link = originalLink; }
    read = await store.read(next.questionRef); assert.equal(read.answer.digest, next.digest); assert.deepEqual(read.pending, active);
    await child({ mode: 'commit', intent: active, answer: last });
    assert.equal((await store.read(last.questionRef)).answer.digest, last.digest, 'resume reuses valid orphan objects and atomically replaces the old complete answer');
  } else if (mode === 'corruption-and-authority') {
    await store.commit(await begin(store, first), first);
    const graph = buildRetainedAnswerGraph(first), manifestPath = path.join(objects, graph.manifestHash + '.json'), original = await fs.readFile(manifestPath);
    await fs.writeFile(manifestPath, original.toString().replace('retained-answer-manifest', 'retained-answer-unknownx'));
    await assert.rejects(store.read(first.questionRef), { code: 'ERR_FILE_INTEGRITY' });
    await fs.writeFile(manifestPath, original);
    const markerPath = path.join(root, 'marker.json'), marker = await fs.readFile(markerPath);
    const foreign = JSON.parse(marker); foreign.repositoryNamespace = path.join(temporary, 'other');
    await fs.writeFile(markerPath, retainedAnswerBytes(foreign));
    await assert.rejects(begin(store, first, first.digest), { code: 'ERR_ANSWER_RETENTION_INTEGRITY' });
    await fs.writeFile(markerPath, marker);
    const [slotName] = await fs.readdir(slots), slotPath = path.join(slots, slotName), slot = await fs.readFile(slotPath);
    await fs.unlink(slotPath); await fs.mkdir(slotPath);
    await assert.rejects(store.read(first.questionRef), { code: 'ERR_ANSWER_RETENTION_INTEGRITY' });
    await fs.rmdir(slotPath); await fs.writeFile(slotPath, slot);
    const wrong = make(); wrong.text += 'unadmitted';
    await assert.rejects(store.commit(await begin(store, first, first.digest), wrong));
    assert.equal((await store.read(first.questionRef)).answer.digest, first.digest);
  } else if (mode === 'quotas-and-leases') {
    await store.commit(await begin(store, first), first);
    assert.ok(inspectRepoCacheAccess(cacheRoot).length > 0);
    const cleanup = await withExclusiveRepoCacheCleanup(cacheRoot, () => assert.fail('retention uses the existing repository cache lease'));
    assert.equal(cleanup.protected, true);
    // Full slot admission uses the real constant and ordinary small files.
    const [name] = await fs.readdir(slots), bytes = await fs.readFile(path.join(slots, name));
    for (let start = 1; start < ANSWER_RETENTION_MAX_SLOTS; start += 16) await Promise.all(Array.from({ length: Math.min(16, ANSWER_RETENTION_MAX_SLOTS - start) }, (_, offset) => {
      const id = 'occupied-' + (start + offset); return fs.writeFile(path.join(slots, retainedAnswerHash('answer-slot-v1\0' + id) + '.json'), bytes);
    }));
    const another = make(); another.questionRef = { id: 'another', revision: '1' };
    await assert.rejects(begin(store, another), { code: 'ERR_ANSWER_RETENTION_QUOTA' });
    assert.equal((await store.read(first.questionRef)).answer.digest, first.digest);
    const before = await fs.readdir(objects);
    await assert.rejects(begin(store, first, null), { code: 'ERR_ANSWER_RETENTION_CONFLICT' });
    assert.deepEqual(await fs.readdir(objects), before, 'no quota recovery silently deletes historical objects');
    const padding = 'x'.repeat(2 * 128 * 1024 - 128);
    for (let start = 0; start < 129; start += 8) await Promise.all(Array.from({ length: Math.min(8, 129 - start) }, (_, offset) => {
      const payload = retainedAnswerBytes({ fixtureInventoryPadding: padding, index: start + offset });
      return fs.writeFile(path.join(objects, retainedAnswerHash(payload) + '.json'), payload);
    }));
    await assert.rejects(begin(store, make('2'), first.digest), { code: 'ERR_ANSWER_RETENTION_QUOTA' }, 'all ordinary encoded object bytes count, including unreferenced objects');
    assert.equal((await store.read(first.questionRef)).answer.digest, first.digest);
  } else {
    await store.commit(await begin(store, first), first);
    const next = make('2', 'build-2'), intent = await begin(store, next, first.digest), rename = fs.rename;
    let settled = false, failure;
    const original = Object.assign(new Error('unsettled native publication'), { code: 'EIO', cacheOwnershipPending: true, cacheOwnershipReleased() { return settled; } });
    try {
      fs.rename = async (from, to) => { if (path.dirname(to) === slots) throw original; return rename(from, to); };
      try { await store.commit(intent, next); assert.fail('pending native work must fail publication'); } catch (error) { failure = error; }
      assert.equal(failure.cacheOwnershipReleased(), false);
      assert.ok(failure.fileLockPublicationSession, 'the actual existing metadata owner survives projection');
      assert.ok(await fs.stat(path.join(cacheRoot, '.answers-v1.write.lock')));
    } finally { fs.rename = rename; settled = true; }
    const receipt = await failure.fileLockPublicationSession.releaseAfterClose();
    assert.equal(receipt.settled, true);
    await assert.rejects(fs.stat(path.join(cacheRoot, '.answers-v1.write.lock')), { code: 'ENOENT' });
    // Preserve failed staging evidence for its publication owner. Do not retry
    // query work or treat a released metadata lock as successful publication.
    const [slotName] = (await fs.readdir(slots)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    const head = JSON.parse(await fs.readFile(path.join(slots, slotName), 'utf8'));
    assert.equal(head.current.answerDigest, first.digest); assert.deepEqual(head.pending, intent);
  }
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
console.log('Retained answers preserve immutable support graphs, exact intents and prior complete revisions.');
