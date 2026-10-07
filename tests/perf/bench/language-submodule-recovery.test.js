#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { recoverRepoSubmodules, summarizeRepoCheckout } from '../../../tools/bench/language/submodule-recovery.js';
import { __setGitCommandRunnerForTests, ensureRepoBenchmarkReady } from '../../../tools/bench/language/repos.js';
import { createRepoLifecycle } from '../../../tools/bench/language-repos/lifecycle.js';
import { createBenchRunLedger, readBenchRunLedger } from '../../../tools/bench/language-repos/run-ledger.js';
import { classifyBenchTask, evaluateBenchVerdict } from '../../../tools/bench/language/verdict.js';
import { parseBenchLanguageArgs } from '../../../tools/bench/language/cli.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(process.cwd(), 'bench-submodule-recovery');
fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });
const root = path.join(tempRoot, 'repo');
fs.mkdirSync(root);
fs.writeFileSync(path.join(root, 'main.cpp'), 'int main() { return 0; }\n');
const declarations = new Map([
  [root, ['dead', 'auth', 'good', 'partial', 'dirty', 'space lib', 'timeout']],
  [path.join(root, 'partial'), ['nested-dead', 'nested-good']]
]);
for (const [cwd, paths] of declarations) {
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, '.gitmodules'), paths.map((relative) => (
    `[submodule "${relative}"]\n path = ${relative}\n url = https://example.invalid/${relative}.git\n`
  )).join(''));
}
for (const relative of ['good', 'dirty', 'space lib', 'partial/nested-good']) {
  fs.mkdirSync(path.join(root, relative), { recursive: true });
}
const calls = [];
const ready = new Set(['partial', 'dirty']);
const response = (ok = true, stdout = '', stderr = '', status = ok ? 0 : 128) => ({ ok, stdout, stderr, status });
const runGit = (cwd, args, options) => {
  calls.push({ cwd, args, timeoutMs: options.timeoutMs });
  assert.ok(options.timeoutMs >= 100 && options.timeoutMs <= 120000);
  if (args[0] === 'rev-parse') return response(true, `${cwd}\n`);
  if (args[0] === 'config') {
    assert.ok(args.includes('--no-includes'));
    assert.equal(args[args.indexOf('--file') + 1], '-');
    assert.equal(options.input, fs.readFileSync(path.join(cwd, '.gitmodules'), 'utf8'), 'Git receives the contained descriptor snapshot');
    return response(true, declarations.get(cwd).map((relative) => `submodule.${relative}.path\n${relative}\0`).join(''));
  }
  const modulePath = path.relative(root, path.join(cwd, args.at(-1))).split(path.sep).join('/');
  if (args.includes('status')) {
    const marker = modulePath === 'dirty' ? '+' : ready.has(modulePath) ? ' ' : '-';
    return response(true, `${marker}1234567 ${args.at(-1)}\n`);
  }
  if (args.includes('sync')) return response();
  if (args.includes('update')) {
    assert.ok(args.includes('--init') && args.includes('--checkout'));
    assert.equal(args[args.indexOf('--jobs') + 1], '1');
    assert.ok(!args.includes('--recursive') && !args.includes('--force'));
    if (modulePath === 'dead' || modulePath === 'partial/nested-dead') {
      return response(false, '', 'fatal: Repository not found.');
    }
    if (modulePath === 'auth') {
      return response(false, '', 'fatal: authentication failed https://user:fake@example.invalid/repo?token=fake');
    }
    if (modulePath === 'timeout') {
      return { ...response(false, '', 'timed out'), status: null, signal: 'SIGTERM', timedOut: true };
    }
    ready.add(modulePath);
    return response();
  }
  throw new Error(`Unexpected controlled Git command: ${args.join(' ')}`);
};
const logs = [];
const recovery = recoverRepoSubmodules({ repoPath: root, runGit, onLog: (line) => logs.push(line) });
assert.equal(recovery.ok, true);
assert.equal(recovery.partialReady, true);
assert.equal(recovery.discoveryComplete, true);
assert.equal(recovery.updated, true);
assert.deepEqual(recovery.entries.filter((entry) => entry.missing).map((entry) => entry.path),
  ['dead', 'auth', 'timeout', 'partial/nested-dead']);
assert.ok(ready.has('good') && ready.has('space lib') && ready.has('partial/nested-good'), 'independent siblings still finish');
assert.equal(calls.filter((call) => call.args.includes('update') && call.args.at(-1) === 'dirty').length, 0, 'preserve existing local revisions');
assert.ok(recovery.warnings.some((warning) => warning.path === 'auth' && warning.reason === 'auth'));
assert.ok(recovery.warnings.some((warning) => warning.path === 'timeout' && warning.reason === 'timeout'));
assert.ok(logs.every((line) => !line.includes('user:fake') && !line.includes('token=fake')));
assert.equal(fs.readFileSync(path.join(root, 'main.cpp'), 'utf8'), 'int main() { return 0; }\n');

let elapsed = 0;
let launches = 0;
const expired = recoverRepoSubmodules({ repoPath: root, timeoutMs: 120, now: () => elapsed,
  runGit: (cwd) => { launches += 1; elapsed = 25; return response(true, `${cwd}\n`); } });
assert.equal(launches, 1, 'remaining 95ms cannot be rounded up to the runner minimum');
assert.equal(expired.ok, true);
assert.equal(expired.discoveryComplete, false);
assert.equal(expired.partialReady, true);

const cancelled = recoverRepoSubmodules({ repoPath: root,
  runGit: () => ({ ...response(false), status: null, signal: 'SIGINT' }) });
assert.equal(cancelled.ok, false, 'actual cancellation cannot become a partial success');
assert.equal(cancelled.fatal.reason, 'interrupted');
const invalidRoot = recoverRepoSubmodules({ repoPath: root, runGit: () => response(false, '', 'not a git repository') });
assert.equal(invalidRoot.ok, false);
assert.equal(invalidRoot.fatal.reason, 'repo-root-invalid');
const traversal = recoverRepoSubmodules({ repoPath: root, runGit: (cwd, args) => args[0] === 'config'
  ? response(true, 'submodule.bad.path\n../outside\0') : response(true, `${cwd}\n`) });
assert.equal(traversal.ok, false);
assert.equal(traversal.fatal.reason, 'unsafe-path');
if (process.platform !== 'win32') {
  const linkRoot = path.join(tempRoot, 'linked-metadata');
  fs.mkdirSync(linkRoot);
  fs.symlinkSync(path.join(root, '.gitmodules'), path.join(linkRoot, '.gitmodules'));
  const linked = recoverRepoSubmodules({ repoPath: linkRoot, runGit: () => assert.fail('linked metadata cannot launch Git') });
  assert.equal(linked.fatal.reason, 'unsafe-metadata');
}

// Exercise the production adapter's thrown timeout type as well as its result form.
__setGitCommandRunnerForTests((cmd, args, options) => {
  if (args[0] === '--version') return response(true, 'git version fixture\n');
  const cwd = args[1];
  const operation = args.slice(2);
  if (operation[0] === 'rev-parse' && operation[1] === '--is-inside-work-tree') return response(true, 'true\n');
  if (operation.includes('update') && operation.at(-1) === 'timeout') {
    const error = Object.assign(new Error('Subprocess timeout'), {
      name: 'SubprocessTimeoutError', code: 'SUBPROCESS_TIMEOUT',
      result: { exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' }
    });
    throw error;
  }
  return runGit(cwd, operation, options);
});
let summary;
try { summary = ensureRepoBenchmarkReady({ repoPath: root, pullLfs: false }); }
finally { __setGitCommandRunnerForTests(null); }
assert.equal(summary.ok, true);
assert.equal(summary.preflight.state, 'ready_partial_submodules');
assert.equal(summary.preflight.submodulePolicy, 'best-effort');
assert.ok(summary.submodules.warnings.some((warning) => warning.path === 'timeout' && warning.reason === 'timeout'));
const checkout = summarizeRepoCheckout(summary);
assert.deepEqual(checkout.missingPaths, ['dead', 'auth', 'timeout', 'partial/nested-dead']);
const task = { language: 'clike', tier: 'large', repo: 'fixture/repo', diagnostics: {
  checkout, countsByType: { repo_partial_checkout: 1 }
} };
assert.equal(classifyBenchTask(task).resultClass, 'passed_with_degradation');
assert.equal(evaluateBenchVerdict({ tasks: [task], policy: {} }).run.productionClean.metrics.partialCheckoutRepos, 1);
assert.equal(evaluateBenchVerdict({ tasks: [task], policy: {} }).run.productionClean.status, 'fail');
const ledger = createBenchRunLedger({ logsRoot: path.join(tempRoot, 'logs'), runSuffix: 'fixture' });
ledger.recordRepoCompleted(task);
await ledger.close();
const rows = await readBenchRunLedger(ledger.ledgerPath);
assert.deepEqual(rows[0].payload.result.diagnostics.checkout, checkout, 'ledger retains omitted corpus paths and reasons');

const lifecycle = createRepoLifecycle({ appendLog: () => {}, display: null,
  processRunner: { runProcess: async () => ({ ok: false, code: 128 }) },
  cloneEnabled: true, dryRun: false, keepCache: true,
  cloneTool: { label: 'git', supportsMirrorClone: false, buildArgs: () => ['clone', 'fixture'] },
  cloneCommandEnv: {}, mirrorCacheRoot: path.join(tempRoot, 'mirrors'), mirrorRefreshMs: 0,
  cacheRoot: path.join(tempRoot, 'cache'), runDiagnosticsRoot: path.join(tempRoot, 'diagnostics'),
  runSuffix: 'fixture', benchEnvironmentMetadata: {}, logHistory: [] });
const cloneFailed = await lifecycle.ensureRepoPresent({ task: { repo: 'fixture/not-present' },
  repoPath: path.join(tempRoot, 'missing-clone'), repoLabel: 'fixture/not-present' });
assert.equal(cloneFailed.ok, false, 'top-level clone failure remains fatal');
assert.equal(cloneFailed.failureReason, 'clone');
assert.equal(parseBenchLanguageArgs(['--strict-submodules']).strictSubmodules, true);
assert.equal(parseBenchLanguageArgs([]).strictSubmodules, false);
console.log('Submodule recovery preserves usable siblings, explicit coverage, strict opt-in, and bounded failure handling.');
