import assert from 'node:assert/strict';
import { parseRawWorkspaceBuildArgs, runRepoBuild, runWorkspaceBuild, runWorkspaceBuildReport } from '../../../tools/workspace/build.js';

const parse = (...args) => parseRawWorkspaceBuildArgs(['--workspace', 'fixture.jsonc', ...args]);
for (const name of ['strict', 'include-disabled', 'json']) {
  const field = name === 'include-disabled' ? 'includeDisabled' : name;
  for (const [tokens, expected] of [
    [[`--${name}`], true], [[`--${name}=true`], true], [[`--${name}=false`], false],
    [[`--no-${name}`], false], [[`--${name}`, 'false'], false],
    [[`--no-${name}`, `--${name}=true`], true], [[`--${name}`, `--no-${name}`], false]
  ]) {
    const options = parse(...tokens, '--mode', 'code');
    assert.equal(options[field], expected, tokens.join(' '));
    assert.deepEqual(options.buildArgs, ['--mode', 'code']);
  }
  for (const token of [`--${name}=invalid`, `--${name}=`, `--no-${name}=true`]) assert.throws(() => parse(token));
}
for (const name of ['watch', 'config-dump']) {
  for (const tokens of [[`--${name}`], [`--${name}=true`], [`--${name}`, 'true']]) {
    assert.throws(() => parse(...tokens), /workspace build.*does not support/);
  }
  assert.doesNotThrow(() => parse(`--${name}=false`));
  assert.doesNotThrow(() => parse(`--${name}`, `--no-${name}`));
}
const repos = ['a', 'b', 'c', 'd'].map(repoId => ({ repoId, repoRootCanonical: `/fixture/${repoId}`, enabled: repoId !== 'd' }));
const workspace = { repos };
const options = { buildArgs: [], concurrency: 1, strict: true, includeDisabled: false };
for (const result of [{ exitCode: null, signal: 'SIGTERM' }, { exitCode: 2, signal: null },
  { exitCode: null, signal: null }, new Error('unexpected build adapter failure')]) {
  const started = [];
  const diagnostics = await runWorkspaceBuild(workspace, options, { runBuild: async ({ repo }) => {
    started.push(repo.repoId);
    if (result instanceof Error) throw result;
    return { ...result, repoId: repo.repoId, status: 'failed' };
  } });
  assert.deepEqual(started, ['a']);
  assert.equal(diagnostics[0].status, 'failed');
  if (result.exitCode === null) assert.equal(diagnostics[0].exitCode, null);
}
let releaseB;
const started = [];
const pending = runWorkspaceBuild(workspace, { ...options, concurrency: 2 }, { runBuild: async ({ repo }) => {
  started.push(repo.repoId);
  if (repo.repoId === 'b') await new Promise(resolve => { releaseB = resolve; });
  return { repoId: repo.repoId, status: repo.repoId === 'a' ? 'failed' : 'passed', exitCode: repo.repoId === 'a' ? null : 0 };
} });
await Promise.resolve();
assert.deepEqual(started, ['a', 'b']);
releaseB();
assert.equal((await pending).length, 2, 'already claimed work settles after strict failure');
const all = await runWorkspaceBuild(workspace, { ...options, strict: false, includeDisabled: true },
  { runBuild: async ({ repo }) => ({ repoId: repo.repoId, status: 'failed', exitCode: null }) });
assert.equal(all.length, 4);

// UNVALIDATED extension: invocation accounting through the actual build owner.
const serial = await runWorkspaceBuildReport({ repos: [...repos].reverse() }, options,
  { runBuild: async () => ({ repoId: 'adapter-cannot-change-target', status: 'failed', exitCode: 1 }) });
assert.deepEqual([serial.configured, serial.selected, serial.attempted, serial.total, serial.passed,
  serial.failed, serial.skippedAfterFailure, serial.excludedDisabled], [4, 3, 1, 1, 0, 1, 2, 1]);
assert.equal(serial.outcome, 'failed'); assert.deepEqual(serial.entries.map(entry => entry.repoId), ['a']);
assert.deepEqual(serial.skipped, ['b', 'c'].map(repoId => ({ repoId, repoRootCanonical: `/fixture/${repoId}`,
  status: 'skipped', reason: 'strict-failure' })));
assert.deepEqual(serial.excluded, [{ repoId: 'd', repoRootCanonical: '/fixture/d', reason: 'disabled' }]);
let finishA, finishB;
const originalInventory = { repos: repos.map(repo => ({ ...repo })) }, claimed = [];
const parallel = runWorkspaceBuildReport(originalInventory, { ...options, concurrency: 2 }, { runBuild: async ({ repo }) => {
  claimed.push(repo.repoId);
  await new Promise(resolve => { if (repo.repoId === 'a') finishA = resolve; else finishB = resolve; });
  return { repoId: repo.repoId, status: repo.repoId === 'a' ? 'failed' : 'passed', exitCode: repo.repoId === 'a' ? 1 : 0 };
} });
assert.deepEqual(claimed, ['a', 'b']);
originalInventory.repos[2].repoId = 'later-mutation'; originalInventory.repos.length = 0;
finishA(); await Promise.resolve(); await Promise.resolve(); finishB();
const completed = await parallel;
assert.deepEqual(completed.entries.map(entry => [entry.repoId, entry.status]), [['a', 'failed'], ['b', 'passed']]);
assert.deepEqual(completed.skipped.map(entry => entry.repoId), ['c']);
assert.deepEqual(completed.excluded.map(entry => entry.repoId), ['d']);
assert.deepEqual([completed.configured, completed.selected, completed.attempted, completed.passed,
  completed.failed, completed.skippedAfterFailure], [4, 3, 2, 1, 1, 1]);
for (const selectedRepos of [[], repos.map(repo => ({ ...repo, enabled: false }))]) {
  const empty = await runWorkspaceBuildReport({ repos: selectedRepos }, options,
    { runBuild: () => assert.fail('no selected repositories must not launch work') });
  assert.equal(empty.outcome, 'no-work'); assert.equal(empty.selected, 0); assert.equal(empty.total, 0);
  assert.equal(empty.excludedDisabled, selectedRepos.length); assert.deepEqual(empty.skipped, []);
}
const continued = await runWorkspaceBuildReport(workspace, { ...options, strict: false, includeDisabled: true },
  { runBuild: async ({ repo }) => ({ status: repo.repoId === 'a' ? 'failed' : 'passed', exitCode: repo.repoId === 'a' ? 1 : 0 }) });
assert.deepEqual([continued.selected, continued.attempted, continued.passed, continued.failed,
  continued.skippedAfterFailure, continued.excludedDisabled], [4, 4, 3, 1, 0, 0]);
const missingOutcome = await runWorkspaceBuildReport(workspace, options, { runBuild: async () => undefined });
assert.equal(missingOutcome.failed, 1); assert.equal(missingOutcome.skippedAfterFailure, 2);
for (const outcome of [{ exitCode: null, signal: 'SIGTERM' }, { exitCode: 0, signal: null }]) {
  const record = await runRepoBuild({ repo: repos[0], buildArgs: [] }, {
    resolveEnv: async () => ({ TARGET_OWNED: 'a' }),
    spawn: async (_command, _args, config) => { assert.equal(config.env.TARGET_OWNED, 'a'); return outcome; }
  });
  assert.equal(record.exitCode, outcome.exitCode);
  assert.equal(record.status, outcome.exitCode === 0 ? 'passed' : 'failed');
}
const spawnFailure = await runRepoBuild({ repo: repos[0], buildArgs: [] }, {
  resolveEnv: async () => ({}), spawn: async () => { throw Object.assign(new Error('spawn ENOENT'), { result: { exitCode: null } }); }
});
assert.equal(spawnFailure.exitCode, null);
assert.equal(spawnFailure.status, 'failed');
console.log('Workspace boolean, finite-operation and strict scheduling policy passed');
