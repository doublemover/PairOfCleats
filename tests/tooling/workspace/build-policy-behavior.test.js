import assert from 'node:assert/strict';
import { parseRawWorkspaceBuildArgs, runRepoBuild, runWorkspaceBuild } from '../../../tools/workspace/build.js';

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
