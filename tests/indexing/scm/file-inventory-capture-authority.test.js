import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gitProvider } from '../../../src/index/scm/providers/git.js';
import { jjProvider } from '../../../src/index/scm/providers/jj.js';
import { assertScmProvider } from '../../../src/index/scm/provider.js';
import { discoverEntries } from '../../../src/index/build/discover.js';
import { getScmCommandRunner, setScmCommandRunner, runScmCommand } from '../../../src/index/scm/runner.js';
import { getScmRuntimeConfig, setScmRuntimeConfig } from '../../../src/index/scm/runtime.js';
import { completeScmFixtureOutput } from '../../helpers/scm-output.js';
import { inspectScmFileInventory } from '../../../src/index/scm/file-inventory.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-scm-inventory-'));
const originalRunner = getScmCommandRunner(), originalConfig = getScmRuntimeConfig(), originalWarn = console.warn;
const warnings = [], calls = [];
let selected = null, fallback = null;
const commandResult = stdout => completeScmFixtureOutput(stdout);
assert.throws(() => inspectScmFileInventory(commandResult('unframed'), { provider: 'git', operation: 'tracked', framing: 'unknown' }), TypeError);
try {
  console.warn = message => warnings.push(String(message));
  setScmRuntimeConfig({ maxConcurrentProcesses: 1, jj: { snapshotWorkingCopy: false } });
  setScmCommandRunner(async (command, args) => {
    calls.push({ command, args });
    if (args.includes('--version')) return commandResult('jj fixture\n');
    if (command === 'jj' && args.includes('op')) return commandResult('a'.repeat(64));
    if (args.includes('merge-base')) return commandResult('');
    if (fallback && command === 'jj' && !args.includes('-0')) return fallback;
    return selected;
  });
  for (const provider of [gitProvider, jjProvider]) {
    const wrapped = assertScmProvider(provider);
    for (const operation of ['tracked', 'changed']) {
      const method = operation === 'tracked' ? 'listTrackedFiles' : 'getChangedFiles';
      const delimiter = provider.name === 'jj' && operation === 'changed' ? '\n' : '\0';
      const stdout = [' spaced name.js', 'folder/雪😀.js'].join(delimiter) + delimiter;
      const input = { repoRoot: root, fromRef: 'old', toRef: 'new' };
      for (const scenario of ['complete', 'empty', 'truncated', 'partial-first', 'encoding-loss', 'missing-receipt',
        'unknown-capture', 'extent-mismatch', 'unterminated', 'terminal-signal']) {
        const output = scenario === 'empty' ? '' : scenario === 'unterminated' ? stdout.slice(0, -1)
          : scenario === 'partial-first' ? 'suffix.js' + delimiter + 'kept.js' + delimiter : stdout;
        selected = commandResult(output);
        const capture = selected.outputCapture.stdout;
        if (scenario === 'truncated' || scenario === 'partial-first') {
          capture.truncated = true; capture.droppedBytes = 19; capture.observedBytes += 19;
        }
        if (scenario === 'encoding-loss') capture.encodingLoss = true;
        if (scenario === 'missing-receipt') delete selected.outputCapture;
        if (scenario === 'unknown-capture') delete capture.truncated;
        if (scenario === 'extent-mismatch') capture.outputBytes++;
        if (scenario === 'terminal-signal') selected.signal = 'SIGTERM';
        for (const adapter of [provider, wrapped]) {
          const result = await adapter[method](input);
          if (scenario === 'complete' || scenario === 'empty') {
            assert.equal(result.complete, true); assert.equal(result.inventory.complete, true);
            assert.deepEqual(result.filesPosix, scenario === 'empty' ? [] : [' spaced name.js', 'folder/雪😀.js']);
            assert.equal(result.inventory.capture.outputBytes, Buffer.byteLength(output));
          } else {
            assert.equal(result.ok, false, provider.name + '/' + operation + '/' + scenario);
            assert.equal(result.complete, false); assert.equal(result.inventory.complete, false);
            assert.equal(result.filesPosix, undefined, 'a retained tail cannot supply authoritative names');
          }
        }
      }
      const controller = new AbortController(); controller.abort();
      const before = calls.length;
      await assert.rejects(wrapped[method]({ ...input, signal: controller.signal }), { code: 'ABORT_ERR' });
      assert.equal(calls.length, before, 'pre-abort cannot launch another provider command');
    }
  }
  selected = commandResult('earlier.js\0kept.js\0');
  const history = await assertScmProvider(gitProvider).getHistoryAffectedFiles({ repoRoot: root, fromRef: 'old', toRef: 'new' });
  assert.equal(history.complete, true); assert.equal(history.inventory.operation, 'history');
  assert.deepEqual(history.filesPosix, ['earlier.js', 'kept.js']);
  selected.outputCapture.stdout.encodingLoss = true;
  const badHistory = await assertScmProvider(gitProvider).getHistoryAffectedFiles({ repoRoot: root, fromRef: 'old', toRef: 'new' });
  assert.equal(badHistory.complete, false); assert.equal(badHistory.filesPosix, undefined);
  const contradictory = assertScmProvider({ ...gitProvider, listTrackedFiles: async () => ({ complete: true, filesPosix: ['kept.js'],
    inventory: { schemaVersion: 1, provider: 'git', operation: 'tracked', status: 'complete', complete: true, reason: null,
      capture: { observedBytes: 8, retainedBytes: 8, droppedBytes: 0, outputBytes: 8, encodingLoss: false, truncated: true } } }) });
  assert.equal((await contradictory.listTrackedFiles({ repoRoot: root })).complete, false);
  assert.equal(warnings.length, 0, 'successful-but-incomplete output cannot start the JJ fallback');
  selected = commandResult('');
  selected.exitCode = 1; fallback = commandResult('one.js\ntwo.js\n');
  const compatibility = await assertScmProvider(jjProvider).listTrackedFiles({ repoRoot: root });
  assert.equal(compatibility.complete, true); assert.deepEqual(compatibility.filesPosix, ['one.js', 'two.js']);
  assert.deepEqual(warnings, ['[scm] jj file list -0 failed; falling back to newline output.']);
  fallback.outputCapture.stdout.truncated = true;
  const incompleteFallback = await jjProvider.listTrackedFiles({ repoRoot: root });
  assert.equal(incompleteFallback.complete, false); assert.equal(incompleteFallback.filesPosix, undefined);
  fallback = null;
  selected = commandResult(Array.from({ length: 10001 }, (_, index) => 'file-' + index + '.js\n').join(''));
  const capped = await jjProvider.getChangedFiles({ repoRoot: root, fromRef: 'old', toRef: 'new' });
  assert.equal(capped.complete, false); assert.equal(capped.inventory.reason, 'record-limit');
  assert.equal(capped.filesPosix, undefined);
  assert.equal(warnings.at(-1), '[scm] jj changed files truncated to 10000 entries.');
  assert.equal(warnings.length, 2);

  await fs.writeFile(path.join(root, 'earlier.js'), 'export const earlier = 1;\n');
  await fs.writeFile(path.join(root, 'kept.js'), 'export const kept = 1;\n');
  selected = commandResult('kept.js\0');
  Object.assign(selected.outputCapture.stdout, { truncated: true, droppedBytes: 11, observedBytes: 19 });
  const metrics = {};
  const discovery = await discoverEntries({ root, modes: ['code'], scmProvider: 'git', scmRepoRoot: root,
    scmProviderImpl: assertScmProvider(gitProvider), metrics });
  assert.deepEqual(discovery.entries.map(row => row.rel), ['earlier.js', 'kept.js']);
  assert.equal(metrics.selectionPolicy, 'filesystem-fallback'); assert.equal(metrics.source, 'filesystem-bounded');
  assert.equal(metrics.scmInventory.complete, false); assert.equal(metrics.scmInventory.reason, 'stdout-truncated');
  assert.equal(metrics.candidateEnumerationComplete, true, 'actual fallback candidates complete without claiming SCM coverage');
  selected = commandResult('');
  const emptyMetrics = {};
  const empty = await discoverEntries({ root, modes: ['code'], scmProvider: 'git', scmRepoRoot: root,
    scmProviderImpl: assertScmProvider(gitProvider), metrics: emptyMetrics });
  assert.deepEqual(empty.entries, []); assert.equal(emptyMetrics.selectionPolicy, 'scm-tracked-only');
  assert.equal(emptyMetrics.scmInventory.complete, true, 'qualified empty output must not crawl untracked files');
  const undeclared = await discoverEntries({ root, modes: ['code'], scmProvider: 'git', scmRepoRoot: root,
    scmProviderImpl: { listTrackedFiles: async () => ({ filesPosix: ['kept.js'] }) }, metrics: {} });
  assert.deepEqual(undeclared.entries.map(row => row.rel), ['earlier.js', 'kept.js']);

  setScmCommandRunner(originalRunner);
  const captured = await runScmCommand(process.execPath, ['-e', 'process.stdout.write("earlier.js\\0" + "x".repeat(256) + "\\0kept.js\\0")'],
    { maxOutputBytes: 64, outputMode: 'string', captureStdout: true, captureStderr: true, rejectOnNonZeroExit: false });
  assert.equal(captured.exitCode, 0); assert.equal(captured.outputCapture.stdout.truncated, true);
  assert.ok(captured.outputCapture.stdout.droppedBytes > 0); assert.ok(captured.stdout.endsWith('kept.js\0'));
  setScmCommandRunner(async () => captured);
  const endToEnd = await assertScmProvider(gitProvider).listTrackedFiles({ repoRoot: root });
  assert.equal(endToEnd.complete, false); assert.equal(endToEnd.inventory.reason, 'stdout-truncated');
  assert.equal(endToEnd.filesPosix, undefined);
  console.log('SCM file inventory capture authority, framing, explicit fallback and qualified empty lists passed');
} finally {
  console.warn = originalWarn; setScmCommandRunner(originalRunner); setScmRuntimeConfig(originalConfig);
  await fs.rm(root, { recursive: true, force: true });
}
