#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runRepoBuild, runWorkspaceBuildReport } from '../../../tools/workspace/build.js';
import { resolveDispatchRuntimeEnv } from '../../../bin/dispatch-runtime-env.js';
import { spawnSubprocess } from '../../../src/shared/subprocess/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const checkout = process.cwd();
const probe = path.join(checkout, 'tests/fixtures/workspace/build-child-probe.js');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-workspace-child-runtime-'));
const repos = ['first project', 'second project'].map((name, index) => ({ repoId: `repo-${index}`,
  repoRootCanonical: path.join(root, name), enabled: true }));
const env = applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off', syncProcess: false,
  extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify(repos.map(repo => repo.repoRootCanonical)),
    NODE_OPTIONS: null, UV_THREADPOOL_SIZE: null, PAIROFCLEATS_NODE_OPTIONS: null,
    PAIROFCLEATS_MAX_OLD_SPACE_MB: null, PAIROFCLEATS_UV_THREADPOOL_SIZE: null } });
const originalExecArgv = [...process.execArgv];
try {
  for (const [index, repo] of repos.entries()) {
    await fs.mkdir(repo.repoRootCanonical);
    await fs.writeFile(path.join(repo.repoRootCanonical, '.pairofcleats.json'), JSON.stringify({ runtime: {
      maxOldSpaceMb: index ? 768 : 512, uvThreadpoolSize: index ? 8 : 2,
      nodeOptions: index ? '--enable-source-maps' : '--trace-warnings'
    } }));
  }
  const unrelated = path.join(root, 'unrelated');
  await fs.mkdir(unrelated);
  await fs.writeFile(path.join(unrelated, '.pairofcleats.json'), '{ invalid unrelated runtime config');
  const caller = await resolveDispatchRuntimeEnv({ root: unrelated, scriptPath: 'tools/workspace/build.js', baseEnv: env });
  assert.deepEqual(caller, env);
  const makeSpawn = (repo, mode = null, onStderr = null) => async (command, args, options) => {
    assert.equal(args[args.lastIndexOf('--repo') + 1], repo.repoRootCanonical);
    return spawnSubprocess(command, [probe, ...args.slice(1)], { ...options, onStderr,
      env: { ...options.env, POC_WORKSPACE_PROBE_OUTPUT: path.join(root, `${repo.repoId}.json`),
        ...(mode ? { POC_WORKSPACE_PROBE_MODE: mode } : {}) } });
  };
  // These flags are never forwarded to the spawned child and cannot override it.
  process.execArgv.push('--max-old-space-size=96');
  const report = await runWorkspaceBuildReport({ repos }, { concurrency: 2, buildArgs: ['--mode', 'code'], baseEnv: caller }, {
    runBuild: request => runRepoBuild(request, { spawn: makeSpawn(request.repo) })
  });
  assert.equal(report.outcome, 'passed');
  for (const [index, repo] of repos.entries()) {
    const observed = JSON.parse(await fs.readFile(path.join(root, `${repo.repoId}.json`), 'utf8'));
    const outcome = report.entries.find(entry => entry.repoId === repo.repoId);
    assert.equal(observed.repoRoot, repo.repoRootCanonical);
    assert.equal(observed.cwd, repo.repoRootCanonical);
    assert.deepEqual(observed.execArgv, []);
    assert.equal(observed.uvThreadpoolSize, index ? '8' : '2');
    assert.equal(observed.nodeOptions.includes(`--max-old-space-size=${index ? 768 : 512}`), true);
    assert.equal(observed.nodeOptions.includes('--max-old-space-size=96'), false);
    assert.ok(Math.abs(observed.heapLimitBytes / 1024 / 1024 - (index ? 768 : 512)) < 100);
    assert.equal(outcome.startup.runtime.maxOldSpaceMb.planned.source, 'config');
    assert.equal(outcome.startup.runtime.uvThreadpoolSize.planned.source, 'config');
  }
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.UV_THREADPOOL_SIZE, undefined);
  const explicit = { ...caller, NODE_OPTIONS: '--max-old-space-size=384 --trace-warnings', UV_THREADPOOL_SIZE: '3' };
  const forced = await runRepoBuild({ repo: repos[0], buildArgs: ['--mode', 'code'], baseEnv: explicit }, { spawn: makeSpawn(repos[0]) });
  assert.equal(forced.status, 'passed');
  assert.equal(forced.startup.runtime.maxOldSpaceMb.planned.source, 'external-env');
  assert.equal(forced.startup.runtime.uvThreadpoolSize.planned.source, 'external-env');
  const observed = JSON.parse(await fs.readFile(path.join(root, 'repo-0.json'), 'utf8'));
  assert.equal(observed.nodeOptions, explicit.NODE_OPTIONS);
  assert.equal(observed.uvThreadpoolSize, '3');
  const failed = await runRepoBuild({ repo: repos[0], buildArgs: [], baseEnv: caller }, { spawn: makeSpawn(repos[0], 'fail') });
  assert.equal(failed.status, 'failed'); assert.equal(failed.exitCode, 7);
  const signalled = await runRepoBuild({ repo: repos[0], buildArgs: [], baseEnv: caller }, { spawn: makeSpawn(repos[0], 'signal') });
  assert.equal(signalled.status, 'failed');
  if (signalled.signal) assert.equal(signalled.exitCode, null);
  const controller = new AbortController();
  const cancelled = await runRepoBuild({ repo: repos[0], buildArgs: [], baseEnv: caller, signal: controller.signal }, {
    spawn: makeSpawn(repos[0], 'wait', text => { if (text.includes('workspace-probe-ready')) controller.abort(); })
  });
  assert.equal(cancelled.status, 'failed');
} finally {
  process.execArgv.splice(0, process.execArgv.length, ...originalExecArgv);
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Workspace children observe their own startup config and preserve explicit caller environment.');
