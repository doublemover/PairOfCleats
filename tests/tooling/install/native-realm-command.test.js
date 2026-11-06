import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { probeNodeRealmLifecycle, probeSqliteNative, probeNativeGrammarRoutes, probeNativeParserWorkerLifecycle,
  probeNativePackage } from '../../../src/shared/native-package-probe.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const mode = process.env.PAIROFCLEATS_TEST_ID?.split('tooling/install/native-realm-command/')[1];
assert.ok(['bounded-original-request', 'status-and-marker-contract', 'original-failures', 'shared-cancellation', 'hidden-synchronous-probes'].includes(mode));
const root = process.cwd(), marker = 'VM_REALM_LIFECYCLE_OK';
const completed = { exitCode: 0, signal: null, stdout: marker, stderr: '' };
if (mode === 'bounded-original-request') {
  const controller = new AbortController(), diagnostic = { original: true };
  const result = await probeNodeRealmLifecycle(root, { signal: controller.signal, run: async (command, args, options) => {
    assert.equal(command, process.execPath); assert.equal(args[0], '-e');
    assert.match(args[1], /\['natural', 'terminate'\]/); assert.match(args[1], /worker\.terminate/);
    assert.equal(options.cwd, root); assert.equal(options.signal, controller.signal);
    assert.equal(options.timeoutMs, 10000); assert.equal(options.maxOutputBytes, 65536);
    assert.equal(options.windowsHide, true); assert.equal(options.rejectOnNonZeroExit, false);
    return { ...completed, diagnostics: diagnostic, diagnosticsPath: 'original-owned-vm-attempt.json' };
  } });
  assert.equal(result.ok, true); assert.equal(result.diagnostics, diagnostic);
  assert.equal(result.diagnosticsPath, 'original-owned-vm-attempt.json');
} else if (mode === 'status-and-marker-contract') {
  for (const child of [{ ...completed, exitCode: -1073741819, stderr: 'last parser log' }, { ...completed, signal: 'SIGTERM' },
    { ...completed, stdout: marker + '\n' }, { ...completed, stdout: '' }, { ...completed, stderr: 'unexpected warning' }]) {
    const result = await probeNodeRealmLifecycle(root, { run: async () => child });
    assert.equal(result.ok, false); assert.equal(result.result, child);
    if (child.exitCode !== 0) {
      assert.match(result.message, /^exit -1073741819/);
      assert.doesNotMatch(result.message, /last parser log/, 'the last JavaScript line cannot attribute a native exception');
    }
    if (child.signal) assert.match(result.message, /^signal SIGTERM/);
  }
} else if (mode === 'original-failures') {
  for (const original of [false, 0, '', null, undefined, Object.freeze(new Error('original child/evidence failure'))]) {
    let caught = false;
    try { await probeNodeRealmLifecycle(root, { run: async () => { throw original; } }); }
    catch (error) { caught = true; assert.equal(error, original); }
    assert.equal(caught, true, 'the actual subprocess/evidence owner keeps original failure and retirement authority');
  }
} else if (mode === 'shared-cancellation') {
  const early = new AbortController(); early.abort(); let calls = 0;
  await assert.rejects(probeNodeRealmLifecycle(root, { signal: early.signal, run: async () => { calls++; } }), { name: 'AbortError' });
  assert.equal(calls, 0);
  const controller = new AbortController(), entered = Promise.withResolvers(), release = Promise.withResolvers();
  const options = { signal: controller.signal, run: async (command, args, selected) => {
    assert.equal(selected.signal, controller.signal); entered.resolve(); await release.promise; return completed;
  } };
  const pending = probeNodeRealmLifecycle(root, options);
  await entered.promise; options.signal = null; options.run = () => assert.fail('mutable caller replaced admitted child');
  const cancelled = Object.freeze(new Error('original invocation cancellation')); controller.abort(cancelled); release.resolve();
  await assert.rejects(pending, error => error === cancelled);
} else {
  const original = childProcess.spawnSync, requests = [];
  childProcess.spawnSync = (command, args, options) => {
    requests.push({ command, args, options });
    return { status: 0, signal: null, stderr: '', stdout: args[1].includes('PARSER_WORKER_LIFECYCLE_OK') ? 'PARSER_WORKER_LIFECYCLE_OK' : '[]' };
  };
  syncBuiltinESMExports();
  try {
    assert.equal(probeSqliteNative(root).ok, true);
    assert.equal(probeNativeGrammarRoutes(root, []).ok, true);
    assert.equal(probeNativeParserWorkerLifecycle(root).ok, true);
    for (const pkgName of ['tree-sitter', 'node-pty', 'inert-fixture-package']) assert.equal((await probeNativePackage(root, pkgName)).ok, true);
    assert.equal(requests.length, 7);
    for (const request of requests) {
      assert.equal(request.command, process.execPath); assert.equal(request.options.windowsHide, true);
      assert.equal(request.options.timeout, 10000); assert.equal(request.options.maxBuffer, 65536);
    }
  } finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
}
console.log('VM lifecycle commands retain original cancellation/status/evidence, and synchronous native probes request hidden Windows children');
