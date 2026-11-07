import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig, WORKSPACE_ERROR_CODES } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { runRepoBuild, runWorkspaceBuildReport, runWorkspaceBuildCli } from '../../tools/workspace/build.js';
import { createWorkspaceBuildRecovery, describeWorkspaceReadiness } from '../../tools/workspace/diagnostics.js';
import { runWorkspaceStatusCli } from '../../tools/workspace/status.js';
import { runWorkspaceCatalogCli } from '../../tools/workspace/catalog.js';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../helpers/test-env.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-workspace-member-admission-'));
applyTestEnv({ cacheRoot: path.join(root, 'cache'), embeddings: 'off' });
const workspacePath = path.join(root, 'workspace.jsonc');
const originalArgv = process.argv, originalLog = console.log, originalExitCode = process.exitCode;
const originalStat = fsp.stat, originalOpen = fsp.open, originalStatSync = fs.statSync;
let replacements = 0;
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
const replace = async repo => {
  await fsp.rename(repo.repoRootCanonical, path.join(root, `retained-original-${replacements++}`));
  await fsp.mkdir(repo.repoRootCanonical);
};
try {
  for (const name of ['a', 'b', 'c']) await fsp.mkdir(path.join(root, name));
  await fsp.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache',
    repos: ['a', 'b', 'c'].map(name => ({ root: `./${name}`, alias: name })) }));
  for (const target of [workspacePath, path.join(root, 'a')]) {
    let ready = false, failure;
    const original = Object.freeze(Object.assign(new Error('original workspace stat is still pending'), { code: 'ENOENT',
      cacheOwnershipReleased() { assert.equal(this, original); return ready; } }));
    fs.statSync = (file, ...args) => { if (samePath(file, target)) throw original; return originalStatSync(file, ...args); };
    assert.throws(() => loadWorkspaceConfig(workspacePath), error => { failure = error; return error.cacheOwnershipPending === true; });
    assert.equal(failure.cacheOwnershipReleased(), false, 'a pending stat is not a missing-workspace/member diagnosis');
    ready = true;
    assert.equal(failure.cacheOwnershipReleased(), true);
    fs.statSync = originalStatSync;
  }
  const workspace = loadWorkspaceConfig(workspacePath);
  const ordered = workspace.repos.slice().sort((a, b) => a.repoId.localeCompare(b.repoId));
  await replace(ordered[0]);
  const failed = await runWorkspaceBuildReport(workspace, { strict: true, concurrency: 1 }, {
    runBuild: () => assert.fail('an unchanged pathname cannot authorize a replacement directory')
  });
  assert.equal(failed.failed, 1);
  assert.equal(failed.skippedAfterFailure, 2);
  assert.equal(failed.entries[0].errorCode, WORKSPACE_ERROR_CODES.MEMBER_CHANGED);
  const recovery = createWorkspaceBuildRecovery(workspace, failed, ['--mode', 'code']);
  assert.equal(recovery.state, 'membership-review-required');
  assert.equal(recovery.membershipReview.length, 1);
  assert.equal(recovery.membershipReview[0].command.includes('validate'), true);
  assert.equal(recovery.retryCandidates.some(entry => entry.repoId === ordered[0].repoId), false);
  const partial = await generateWorkspaceManifest(workspace, { write: false, allowPartial: true });
  assert.equal(partial.manifest.repos.length, 2);
  assert.equal(partial.manifest.diagnostics.errors[0].code, WORKSPACE_ERROR_CODES.MEMBER_CHANGED);
  const actions = describeWorkspaceReadiness(workspace, partial.manifest).nextActions.filter(entry => entry.repoId === ordered[0].repoId);
  assert.equal(actions.every(entry => entry.reason === 'member-directory-changed' && entry.command.includes('workspace')
    && entry.command.includes('validate')), true);

  const startupWorkspace = loadWorkspaceConfig(workspacePath);
  const selected = startupWorkspace.repos[0];
  const stopped = await runRepoBuild({ repo: selected, buildArgs: [] }, {
    resolvePlan: async () => { await replace(selected); return { env: {}, evidence: { phase: 'authored-target-plan' } }; },
    spawn: () => assert.fail('replacement during startup planning must stop before spawn')
  });
  assert.equal(stopped.status, 'failed');
  assert.equal(stopped.errorCode, WORKSPACE_ERROR_CODES.MEMBER_CHANGED);

  const queuedWorkspace = loadWorkspaceConfig(workspacePath);
  const queueOrder = queuedWorkspace.repos.slice().sort((a, b) => a.repoId.localeCompare(b.repoId));
  const claims = [];
  const queued = await runWorkspaceBuildReport(queuedWorkspace, { concurrency: 1, strict: false }, {
    runBuild: async ({ repo }) => {
      claims.push(repo.repoId);
      if (repo.repoId === queueOrder[0].repoId) await replace(queueOrder[1]);
      return { status: 'passed', exitCode: 0 };
    }
  });
  assert.deepEqual(claims, [queueOrder[0].repoId, queueOrder[2].repoId], 'only the actual replaced queued member loses admission');
  assert.equal(queued.entries.find(entry => entry.repoId === queueOrder[1].repoId).errorCode, WORKSPACE_ERROR_CODES.MEMBER_CHANGED);

  const immutable = loadWorkspaceConfig(workspacePath).repos[0];
  const launchRoot = immutable.repoRootCanonical;
  const passed = await runRepoBuild({ repo: immutable, buildArgs: [] }, {
    resolvePlan: async () => { immutable.repoRootCanonical = root; return { env: {}, evidence: null }; },
    spawn: async (_command, args, options) => {
      assert.equal(options.cwd, launchRoot);
      assert.equal(args[args.lastIndexOf('--repo') + 1], launchRoot);
      return { exitCode: 0, signal: null, stderr: '' };
    }
  });
  assert.equal(passed.status, 'passed', 'an external descriptor mutation cannot replace an in-flight target snapshot');

  // Actual status/catalog owners must isolate a replacement observed during
  // their asynchronous inventory and retain the other admitted members.
  for (const [name, runCli] of [['status', runWorkspaceStatusCli], ['catalog', runWorkspaceCatalogCli]]) {
    const member = loadWorkspaceConfig(workspacePath).repos[0];
    const pointer = path.join(getRepoCacheRoot(member.repoRootCanonical), 'builds', 'current.json');
    let changed = false;
    fsp.stat = async (file, ...args) => {
      if (!changed && samePath(file, pointer)) { changed = true; await replace(member); }
      return originalStat(file, ...args);
    };
    const output = [];
    console.log = value => output.push(value);
    process.argv = [process.execPath, `workspace-${name}`, '--workspace', workspacePath, '--json'];
    process.exitCode = undefined;
    await runCli();
    assert.equal(changed, true);
    assert.equal(process.exitCode, 1);
    assert.equal(output.length, 1);
    const payload = JSON.parse(output[0]);
    assert.equal(payload.ok, false);
    assert.equal(payload.modes.code.selected, 3);
    assert.equal(payload.modes.code.incompatible, 1);
    assert.equal(payload.nextActions.filter(entry => entry.repoId === member.repoId)
      .every(entry => entry.reason === 'member-directory-changed'), true);
    fsp.stat = originalStat;
    console.log = originalLog;
    process.argv = originalArgv;
  }

  // Mutation while the canonical writer is staging must preserve the previous
  // published manifest. No replacement directory is blessed by publication.
  const publishWorkspace = loadWorkspaceConfig(workspacePath);
  const outputPath = path.join(root, 'published-workspace.json');
  await fsp.writeFile(outputPath, 'previous valid publication remains available');
  let duringStaging = false;
  fsp.open = async (file, flags, ...args) => {
    const handle = await originalOpen(file, flags, ...args);
    if (!duringStaging && flags === 'wx' && samePath(path.dirname(file), root)) {
      duringStaging = true;
      await replace(publishWorkspace.repos[0]);
    }
    return handle;
  };
  await assert.rejects(generateWorkspaceManifest(publishWorkspace, { write: true, manifestPath: outputPath }), /member directory changed/);
  fsp.open = originalOpen;
  assert.equal(duringStaging, true);
  assert.equal(await fsp.readFile(outputPath, 'utf8'), 'previous valid publication remains available');

  // The real build CLI publishes a membership review action when replacement
  // happens between loader admission and the actual child startup boundary.
  const output = [];
  console.log = value => output.push(value);
  process.exitCode = undefined;
  const cli = await runWorkspaceBuildCli(['--workspace', workspacePath, '--strict', '--concurrency', '1', '--json'], {
    runBuild: request => runRepoBuild(request, {
      resolvePlan: async () => { await replace(request.repo); return { env: {}, evidence: null }; },
      spawn: () => assert.fail('CLI cannot build the replacement member')
    }), refreshManifest: async () => ({ manifestPath: outputPath, manifest: { manifestHash: 'authored-not-refreshed' } })
  });
  assert.equal(cli.ok, false);
  assert.equal(cli.recovery.state, 'membership-review-required');
  assert.equal(cli.recovery.membershipReview.length, 1);
  assert.equal(output.length, 1);
} finally {
  fsp.stat = originalStat; fsp.open = originalOpen; fs.statSync = originalStatSync;
  process.argv = originalArgv; console.log = originalLog; process.exitCode = originalExitCode;
  await fsp.rm(root, { recursive: true, force: true });
}
console.log('Workspace member replacement stops actual admission and publication with reviewable recovery.');
