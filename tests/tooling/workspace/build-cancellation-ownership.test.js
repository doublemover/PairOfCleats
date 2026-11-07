#!/usr/bin/env node
import assert from 'node:assert/strict';
import { parseRawWorkspaceBuildArgs, runRepoBuild, runWorkspaceBuildReport } from '../../../tools/workspace/build.js';

assert.throws(() => parseRawWorkspaceBuildArgs(['--workspace', 'fixture.jsonc', '--', '--repo', '/another/target']), /positional arguments/);
assert.deepEqual(parseRawWorkspaceBuildArgs(['--workspace', 'fixture.jsonc', '--mode', 'code', '--']).buildArgs, ['--mode', 'code']);

const workspace = { repos: ['a', 'b', 'c', 'd'].map(repoId => ({ repoId, repoRootCanonical: `/fixture/${repoId}`, enabled: true })) };
for (const buildArgs of [['--watch'], ['--config-dump=true'], ['--strict'], ['--repo', '/different/target'], ['--unknown-child-flag']]) {
  await assert.rejects(runWorkspaceBuildReport(workspace, { buildArgs }, {
    runBuild: () => assert.fail('programmatic fanout cannot bypass finite child admission')
  }));
}
const cancelled = new AbortController();
cancelled.abort();
const before = await runWorkspaceBuildReport(workspace, { signal: cancelled.signal }, {
  runBuild: () => assert.fail('pre-cancelled fanout cannot claim children')
});
assert.equal(before.outcome, 'cancelled');
assert.equal(before.attempted, 0);
assert.equal(before.skippedCancelled, 4);
assert.equal(before.skippedAfterFailure, 0);

const controller = new AbortController();
let started = [];
let releaseB;
const reportPromise = runWorkspaceBuildReport(workspace, { concurrency: 2, signal: controller.signal }, {
  runBuild: async ({ repo, signal }) => {
    assert.equal(signal, controller.signal);
    started.push(repo.repoId);
    if (repo.repoId === 'a') { controller.abort(); return { status: 'passed', exitCode: 0 }; }
    await new Promise(resolve => { releaseB = resolve; });
    return { status: 'passed', exitCode: 0 };
  }
});
// Cancellation during the first claim prevents even the second claim.
assert.deepEqual(started, ['a']);
releaseB?.();
const report = await reportPromise;
assert.equal(report.outcome, 'cancelled');
assert.equal(report.skippedCancelled, 3);

let finishA, finishB;
started = [];
const pendingError = Object.assign(new Error('actual child has not closed'), { cacheOwnershipPending: true,
  cacheOwnershipReleased: () => false });
const pending = runWorkspaceBuildReport(workspace, { concurrency: 2, strict: false }, {
  runBuild: async ({ repo }) => {
    started.push(repo.repoId);
    await new Promise(resolve => { if (repo.repoId === 'a') finishA = resolve; else finishB = resolve; });
    if (repo.repoId === 'a') throw pendingError;
    return { status: 'passed', exitCode: 0 };
  }
});
assert.deepEqual(started, ['a', 'b']);
let settled = false;
pending.then(() => { settled = true; }, () => { settled = true; });
finishA();
await Promise.resolve();
await Promise.resolve();
assert.equal(settled, false, 'already claimed child must settle before reporting unresolved owner');
finishB();
let retained;
await assert.rejects(pending, error => { retained = error; return error.cacheOwnershipPending === true; });
assert.deepEqual(started, ['a', 'b']);
assert.equal(retained.workspaceBuildDiagnostics.outcome, 'settlement-pending');
assert.equal(retained.workspaceBuildDiagnostics.skippedSettlementPending, 2);
assert.deepEqual(retained.workspaceBuildDiagnostics.entries.map(entry => entry.status), ['settlement-pending', 'passed']);
await assert.rejects(runRepoBuild({ repo: workspace.repos[0], buildArgs: [] }, {
  resolveEnv: () => ({}), spawn: () => { throw pendingError; }
}), error => error.cacheOwnershipPending === true && error.cacheOwnershipReleased() === false);

const launchController = new AbortController();
await runRepoBuild({ repo: workspace.repos[0], buildArgs: [], signal: launchController.signal }, {
  resolveEnv: () => { launchController.abort(); return {}; },
  spawn: () => assert.fail('cancellation during env resolution cannot launch a child')
});

const callerEnv = { CALLER: 'original' };
const args = ['--mode', 'code'];
await runWorkspaceBuildReport(workspace, { concurrency: 1, baseEnv: callerEnv, buildArgs: args }, {
  runBuild: async options => {
    assert.equal(options.baseEnv.CALLER, 'original');
    assert.deepEqual(options.buildArgs, ['--mode', 'code']);
    options.baseEnv.CALLER = 'child-local';
    options.buildArgs.length = 0;
    callerEnv.CALLER = 'later-caller-mutation';
    args.length = 0;
    return { status: 'passed', exitCode: 0 };
  }
});
await assert.rejects(runWorkspaceBuildReport(workspace, { concurrency: 0 }), /concurrency/);
const closure = [false, false];
const claims = [];
const owners = ['a', 'b'].map((id, index) => Object.assign(new Error(`pending child ${id}`), {
  cacheOwnershipPending: true, cacheOwnershipReleased: () => closure[index]
}));
let both;
await assert.rejects(runWorkspaceBuildReport(workspace, { concurrency: 2, strict: false }, {
  runBuild: async ({ repo }) => { claims.push(repo.repoId); throw owners[repo.repoId === 'a' ? 0 : 1]; }
}), error => { both = error; return error.cacheOwnershipPending === true; });
assert.deepEqual(claims, ['a', 'b']);
assert.equal(both.workspaceBuildPendingOwners.length, 2, 'every already-claimed pending child retains its original observer');
assert.equal(both.cacheOwnershipReleased(), false);
closure[0] = true;
assert.equal(both.cacheOwnershipReleased(), false);
closure[1] = true;
assert.equal(both.cacheOwnershipReleased(), true);
console.log('Workspace cancellation and pending teardown stop fanout without losing claimed owners.');
