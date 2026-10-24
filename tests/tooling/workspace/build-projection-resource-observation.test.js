import assert from 'node:assert/strict';
import { runRepoBuild, runWorkspaceBuildReport } from '../../../tools/workspace/build.js';

const repo = { repoId: 'a', repoRootCanonical: '/fixture/selected', enabled: true };
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const current = queue.pop();
    if (current === expected) return true;
    if (!current || !['object', 'function'].includes(typeof current) || seen.has(current)) continue;
    seen.add(current);
    const cause = Object.getOwnPropertyDescriptor(current, 'cause');
    const errors = Object.getOwnPropertyDescriptor(current, 'errors');
    if (cause && 'value' in cause) queue.push(cause.value);
    if (Array.isArray(errors?.value)) queue.push(...errors.value);
  }
  return false;
};

for (const source of ['returned-result', 'thrown-result', 'thrown-message']) {
  let ready = true, reads = 0, retained;
  const original = { cacheOwnershipReleased() { assert.equal(this, original); return ready; } };
  const revealPending = () => {
    reads += 1;
    ready = false;
    original.cacheOwnershipReleased = () => true;
  };
  let launch;
  if (source === 'returned-result') {
    Object.defineProperties(original, {
      exitCode: { get() { revealPending(); return 0; } },
      stderr: { value: '' }, signal: { value: null }
    });
    launch = () => original;
  } else if (source === 'thrown-result') {
    Object.defineProperties(original, {
      stderr: { get() { revealPending(); return 'child failed'; } },
      exitCode: { value: 7 }, signal: { value: null }
    });
    const error = Object.freeze(Object.assign(new Error('child rejected'), { result: original }));
    launch = () => { throw error; };
  } else {
    Object.defineProperties(original, {
      message: { get() { revealPending(); return 'child rejected with newly pending work'; } },
      result: { value: { exitCode: 7, signal: null, stderr: '' } }
    });
    launch = () => { throw original; };
  }
  const claims = [];
  await assert.rejects(runWorkspaceBuildReport({ repos: [repo, { ...repo, repoId: 'b' }] }, { concurrency: 1 }, {
    runBuild: request => {
      claims.push(request.repo.repoId);
      return runRepoBuild(request, { resolveEnv: () => ({}), spawn: launch });
    }
  }), error => { retained = error; return error.cacheOwnershipPending === true; });
  assert.deepEqual(claims, ['a'], `${source}: no later child can be admitted from a detached diagnostic projection`);
  assert.equal(contains(retained, original), true);
  assert.equal(retained.workspaceBuildDiagnostics.outcome, 'settlement-pending');
  assert.equal(retained.cacheOwnershipReleased(), false, 'replacing a callback does not replace the original observation');
  if (source !== 'thrown-message') assert.equal(reads, 1, 'the child result field is projected only once');
  else assert.equal(reads > 0, true);
  ready = true;
  assert.equal(retained.cacheOwnershipReleased(), true);
}

{
  let ready = false, projections = 0;
  const original = Object.freeze({ cacheOwnershipReleased() { assert.equal(this, original); return ready; },
    get stderr() { projections += 1; return ''; }, exitCode: 7, signal: null });
  const error = Object.freeze(Object.assign(new Error('wrapper has an original child result'), { result: original }));
  let retained;
  await assert.rejects(runRepoBuild({ repo, buildArgs: [] }, { resolveEnv: () => ({}), spawn: () => { throw error; } }),
    failure => { retained = failure; return failure.cacheOwnershipPending === true; });
  assert.equal(contains(retained, error), true);
  assert.equal(contains(retained, original), true);
  assert.equal(projections, 0, 'an unresolved original result is never projected');
  ready = true;
  assert.equal(retained.cacheOwnershipReleased(), true);
}
console.log('Workspace child diagnostic projections preserve original pending observations.');
