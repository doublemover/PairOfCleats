import assert from 'node:assert/strict';
import path from 'node:path';
import { bindScmReadSession, createScmReadSession } from '../../../src/index/scm/read-session.js';
import { assertScmProvider } from '../../../src/index/scm/provider.js';
import { jjProvider } from '../../../src/index/scm/providers/jj.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { createRunResourceScope } from '../../../src/shared/lifecycle/run-scope.js';
import { completeScmFixtureOutput as output } from '../../helpers/scm-output.js';

const root = path.resolve('tests/fixtures/scm/jj'), original = getScmCommandRunner(), config = getScmRuntimeConfig();
const a = 'a'.repeat(64), b = 'b'.repeat(64), calls = []; let operation = a, fail = false, gate = null;
const sessions = [], make = options => { const session = createScmReadSession({ repoRoot: root, ...options }); sessions.push(session); return {
  session, provider: bindScmReadSession(assertScmProvider(jjProvider), session) }; };
try {
  setScmRuntimeConfig({ maxConcurrentProcesses: 2, jj: { snapshotWorkingCopy: true } });
  setScmCommandRunner(async (_command, args) => {
    calls.push(args);
    if (args.includes('--version')) return output('fixture\n');
    if (args.includes('status')) { if (gate) await gate; return output('', { exitCode: fail ? 1 : 0 }); }
    if (args.includes('op')) return output(operation);
    const pin = args.find(x => x.startsWith('--at-operation='))?.split('=')[1];
    assert.ok([a, b].includes(pin), 'every content command uses an immutable admitted operation');
    if (args.includes('file') && args.includes('list')) return output('file.js\0');
    if (args.includes('diff')) return output('');
    if (args.includes('bookmarks')) return output('');
    return output(JSON.stringify({ commit_id: pin, change_id: 'same-logical-change', author: pin[0], timestamp: '2026-10-29T00:00:00Z' }) + '\n');
  });
  const first = make();
  const [one, two, files] = await Promise.all([first.provider.getRepoProvenance({ repoRoot: root }),
    first.provider.getRepoProvenance({ repoRoot: root }), first.provider.listTrackedFiles({ repoRoot: root })]);
  assert.equal(one.head.operationId, a); assert.equal(two.head.commitId, a); assert.deepEqual(files.filesPosix, ['file.js']);
  assert.equal(calls.filter(x => x.includes('status')).length, 1);
  assert.equal(calls.filter(x => x.includes('op')).length, 1);
  operation = b;
  assert.equal((await first.provider.getRepoProvenance({ repoRoot: root })).head.commitId, a);
  const next = make(); assert.equal((await next.provider.getRepoProvenance({ repoRoot: root })).head.commitId, b);
  const metaA = await first.provider.getFileMetaBatch({ repoRoot: root, filesPosix: ['file.js'], headId: a, includeChurn: false });
  const metaB = await next.provider.getFileMetaBatch({ repoRoot: root, filesPosix: ['file.js'], headId: b, includeChurn: false });
  assert.equal(metaA.fileMetaByPath['file.js'].lastAuthor, 'a'); assert.equal(metaB.fileMetaByPath['file.js'].lastAuthor, 'b');
  fail = true; const failed = make();
  await assert.rejects(failed.provider.getRepoProvenance({ repoRoot: root }), { code: 'ERR_SCM_OPERATION_UNAVAILABLE' });
  const attempts = calls.length; fail = false;
  await assert.rejects(failed.provider.getRepoProvenance({ repoRoot: root }), { code: 'ERR_SCM_OPERATION_UNAVAILABLE' });
  assert.equal(calls.length, attempts, 'failed acquisition is session-scoped and never memoizes mutable @');
  assert.equal((await make().provider.getRepoProvenance({ repoRoot: root })).head.commitId, b);
  let release; gate = new Promise(resolve => { release = resolve; });
  const old = make(), pending = old.provider.getRepoProvenance({ repoRoot: root });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  let drained = false; const closing = old.session.close().then(() => { drained = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(drained, false);
  gate = null; const newer = make(); assert.equal((await newer.provider.getRepoProvenance({ repoRoot: root })).head.commitId, b);
  release(); await rejected; await closing;
  await assert.rejects(old.provider.listTrackedFiles({ repoRoot: root }), { name: 'AbortError' });
  assert.equal((await newer.provider.getRepoProvenance({ repoRoot: root })).head.commitId, b);
  setScmRuntimeConfig({ jj: { snapshotWorkingCopy: false } });
  const before = calls.length, historical = make({ operationId: a });
  assert.equal((await historical.provider.getRepoProvenance({ repoRoot: root })).head.operationId, a);
  assert.ok(calls.slice(before).every(args => !args.includes('status') && !args.includes('op')));
  const scope = createRunResourceScope(), scoped = make({ owner: scope });
  await scoped.provider.getRepoProvenance({ repoRoot: root }); await scope.close();
  assert.equal(scoped.session.isSettled(), true);
  let resourceSettled = false;
  const ownedFailure = Object.assign(new Error('original SCM child still owns work'), { cacheOwnershipPending: true,
    cacheOwnershipReleased: () => resourceSettled });
  const retained = make(); const failing = bindScmReadSession({ getFileMeta() { throw ownedFailure; } }, retained.session);
  await assert.rejects(failing.getFileMeta({ repoRoot: root }), error => error === ownedFailure);
  ownedFailure.cacheOwnershipReleased = () => true;
  await assert.rejects(retained.session.close(), error => error.cacheOwnershipPending === true);
  assert.equal(retained.session.isSettled(), false);
  resourceSettled = true; await retained.session.close(); assert.equal(retained.session.isSettled(), true);
  setScmCommandRunner(async (_command, args) => {
    assert.ok(args.includes('op'), 'a truncated operation cannot authorize any content command');
    const result = output(a); Object.assign(result.outputCapture.stdout, { truncated: true, droppedBytes: 1, observedBytes: 65 });
    return result;
  });
  await assert.rejects(make().provider.getRepoProvenance({ repoRoot: root }), { code: 'ERR_SCM_OPERATION_UNAVAILABLE' });
} finally {
  setScmCommandRunner(original); setScmRuntimeConfig(config);
  await Promise.all(sessions.map(session => session.close()));
}
console.log('Registered JJ readers share immutable session pins, recover in later sessions, and drain late acquisition without root retention.');
