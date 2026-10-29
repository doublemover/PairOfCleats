import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { bindScmReadSession, createScmReadSession } from '../../../src/index/scm/read-session.js';
import { getScmProvider } from '../../../src/index/scm/registry.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { getScmCommandRunner, setScmCommandRunner } from '../../../src/index/scm/runner.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createFastIndexingTestConfig } from '../../helpers/fast-indexing-config.js';
import { createBuildRuntime } from '../../../src/index/build/runtime/runtime.js';
import { teardownRuntime } from '../../../src/integrations/core/build-index/runtime.js';
// JJ's immutable index segment names are 128 characters. Keep this ordinary
// fixture path short enough for Windows tools without requiring long-path policy.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-jj-'));
const original = getScmRuntimeConfig(), sessions = [], runtimes = [];
const author = 'Fixture "雪"';
const originalRunner = getScmCommandRunner(), failedCommands = [];
setScmCommandRunner(async (...args) => { const result = await originalRunner(...args);
  if (result.exitCode !== 0) failedCommands.push({ args: args[1], exitCode: result.exitCode, stderr: result.stderr });
  return result; });
const command = args => execFileSync('jj', ['--no-pager', '--color=never', '--config', `user.name=${JSON.stringify(author)}`, '--config', 'user.email=fixture@example.invalid', ...args],
  { cwd: root, windowsHide: true, timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const make = options => { const session = createScmReadSession({ repoRoot: root, ...options }); sessions.push(session);
  return bindScmReadSession(getScmProvider('jj'), session); };
try {
  command(['git', 'init', '--colocate', '.']);
  await fs.writeFile(path.join(root, 'source.js'), 'export const original = 1;\n'); command(['file', 'track', 'source.js']);
  setScmRuntimeConfig({ timeoutMs: 4000, maxConcurrentProcesses: 1, jj: { snapshotWorkingCopy: true } });
  applyTestEnv({ cacheRoot: path.join(root, 'runtime-cache'), embeddings: 'off', testConfig: createFastIndexingTestConfig({ threads: 1,
    indexing: { workerPool: { enabled: false }, scm: { provider: 'jj', maxConcurrentProcesses: 1, jj: { snapshotWorkingCopy: true } } } }) });
  const admit = async () => { const runtime = await createBuildRuntime({ root, argv: { mode: 'code', stage: 'stage1', 'scm-provider': 'jj', threads: 1 }, rawArgv: [] });
    runtimes.push(runtime); assert.equal(runtime.scmProvider, 'jj'); return runtime; };
  const runtimeA = await admit(), a = runtimeA.scmProviderImpl, first = runtimeA.repoProvenance;
  assert.match(first.head.operationId, /^[a-f0-9]{16,128}$/); assert.ok(first.head.commitId, JSON.stringify(failedCommands));
  assert.equal(first.head.author, author, 'JJ serializes Unicode and quoted author text without manual escaping');
  await fs.writeFile(path.join(root, 'source.js'), 'export const edited = 2;\n');
  const runtimeB = await admit(), b = runtimeB.scmProviderImpl, second = runtimeB.repoProvenance;
  assert.notEqual(first.head.commitId, second.head.commitId); assert.equal(first.head.changeId, second.head.changeId);
  assert.notEqual(first.head.operationId, second.head.operationId);
  assert.equal((await a.getRepoProvenance({ repoRoot: root })).head.commitId, first.head.commitId);
  assert.deepEqual((await b.listTrackedFiles({ repoRoot: root })).filesPosix, ['source.js']);
  for (const [provider, provenance] of [[a, first], [b, second]]) {
    for (const includeChurn of [false, true]) {
      const metadata = await provider.getFileMeta({ repoRoot: root, filePosix: 'source.js', headId: provenance.head.commitId, includeChurn });
      assert.equal(metadata.lastCommitId, provenance.head.commitId, 'metadata retains the full immutable commit identity');
      assert.equal(metadata.lastAuthor, author); assert.ok(metadata.lastModifiedAt);
      if (includeChurn) { assert.equal(metadata.churnAdded, 1); assert.equal(metadata.churnDeleted, 0); assert.equal(metadata.churnCommits, 1); }
    }
  }
  const historical = make({ operationId: first.head.operationId });
  assert.equal((await historical.getRepoProvenance({ repoRoot: root })).head.commitId, first.head.commitId);
  command(['new', '-m', 'empty working change']);
  const empty = await make().getRepoProvenance({ repoRoot: root });
  command(['rebase', '-r', '@', '-d', 'root()']);
  const rebased = await make().getRepoProvenance({ repoRoot: root });
  assert.equal(empty.head.changeId, rebased.head.changeId); assert.notEqual(empty.head.commitId, rebased.head.commitId);
  setScmRuntimeConfig({ timeoutMs: 4000, jj: { snapshotWorkingCopy: false } });
  const operation = command(['--ignore-working-copy', 'op', 'log', '--no-graph', '-n', '1', '-T', 'id']);
  await fs.writeFile(path.join(root, 'source.js'), 'export const unsnapshotted = 3;\n');
  await make().getRepoProvenance({ repoRoot: root });
  assert.equal(command(['--ignore-working-copy', 'op', 'log', '--no-graph', '-n', '1', '-T', 'id']), operation,
    'default read-only operation acquisition must not snapshot or mutate the working copy');
} finally { for (const runtime of runtimes) await teardownRuntime(runtime); await Promise.all(sessions.map(session => session.close())); setScmRuntimeConfig(original); setScmCommandRunner(originalRunner);
  await fs.rm(root, { recursive: true, force: true }); }
console.log('Actual JJ edit, empty-change rebase, historical pin and read-only acquisition retain immutable per-session authority.');
