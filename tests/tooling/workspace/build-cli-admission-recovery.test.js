#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runWorkspaceBuildCli } from '../../../tools/workspace/build.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';

const checkout = process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-workspace-build-cli-'));
const workspacePath = path.join(root, 'workspace.jsonc');
const env = applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const output = [], originalLog = console.log, originalExit = process.exitCode;
console.log = value => output.push(value);
try {
  for (const name of ['a', 'b', 'c', 'disabled', 'unrelated']) await fs.mkdir(path.join(root, name));
  await fs.writeFile(path.join(root, 'unrelated', '.pairofcleats.json'), '{ unrelated invalid config');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache', repos: [
    ...['a', 'b', 'c'].map(name => ({ root: `./${name}`, alias: name })), { root: './disabled', enabled: false }
  ] }));
  const started = [];
  const payload = await runWorkspaceBuildCli(['--workspace', workspacePath, '--mode', 'code', '--concurrency', '1', '--strict=true', '--json=true'], {
    runBuild: async ({ repo, buildArgs }) => {
      started.push(repo.alias);
      assert.deepEqual(buildArgs, ['--mode', 'code']);
      return { status: 'failed', exitCode: null, signal: null, error: 'authored failed child' };
    }, refreshManifest: async () => { throw Object.assign(new Error('authored manifest refresh failure'), { code: 'ERR_FIXTURE_REFRESH' }); }
  });
  assert.deepEqual(started, ['a']);
  assert.equal(payload.ok, false);
  assert.equal(payload.diagnostics.selected, 3);
  assert.equal(payload.diagnostics.skippedAfterFailure, 2);
  assert.equal(payload.diagnostics.excludedDisabled, 1);
  assert.equal(payload.manifestRefresh, 'failed');
  assert.equal(payload.manifestError.code, 'ERR_FIXTURE_REFRESH');
  assert.equal(payload.recovery.retryCandidates.length, 3);
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), payload);
  for (const retry of payload.recovery.retryCandidates) {
    assert.equal(retry.command[retry.command.lastIndexOf('--repo') + 1], retry.repoRootCanonical);
    assert.equal(retry.command.includes('--strict=true'), false);
  }
  process.exitCode = originalExit;
  const before = await fs.readdir(root, { recursive: true });
  for (const mode of ['watch', 'config-dump']) {
    for (const tokens of [[`--${mode}`], [`--${mode}=true`], [`--${mode}`, 'true'], [`--${mode}=false`, `--${mode}`]]) {
      await assert.rejects(runWorkspaceBuildCli(['--workspace', workspacePath, '--json', ...tokens], {
        runBuild: () => assert.fail('finite preview/watch rejection must precede child admission'),
        refreshManifest: () => assert.fail('finite preview/watch rejection cannot publish inventory')
      }), /does not support/);
    }
  }
  assert.deepEqual(await fs.readdir(root, { recursive: true }), before);
  const missingWorkspace = path.join(root, 'must-not-be-read.jsonc');
  for (const entrypoint of [[path.join(checkout, 'tools/workspace/build.js')],
    [path.join(checkout, 'bin/pairofcleats.js'), 'workspace', 'build'],
    [path.join(checkout, 'bin/pairofcleats.js'), 'index', 'build']]) {
    for (const option of ['--watch=true', '--config-dump=true', '--strict=invalid']) {
      const result = runNode([...entrypoint, '--workspace', missingWorkspace, option], 'workspace build rejection',
        path.join(root, 'unrelated'), env, { stdio: 'pipe', timeoutMs: 5000, allowFailure: true });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /does not support|requires true or false/);
      assert.doesNotMatch(result.stderr, /ENOENT|unrelated invalid config/);
    }
  }
} finally {
  console.log = originalLog;
  process.exitCode = originalExit;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Workspace CLI rejects non-build modes before admission and retains actionable failed-build reports.');
