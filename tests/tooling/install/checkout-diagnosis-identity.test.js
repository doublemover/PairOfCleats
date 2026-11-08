#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BOOTSTRAP_RECEIPT_VERSION, compareBootstrapIdentity, formatBootstrapRequired, getBootstrapRuntimeContext, requireBootstrap } from '../../../src/shared/bootstrap-readiness.js';
import { diagnoseCheckout, handleCheckoutInformation } from '../../../tools/setup/checkout-diagnose.js';

const actual = { node: 'v26.12.1', abi: '148', platform: 'win32', arch: 'x64' };
const receipt = { schemaVersion: BOOTSTRAP_RECEIPT_VERSION, root: 'C:/checkout', runtime: { ...actual, node: 'v26.12.2', abi: '149' } };
assert.deepEqual(compareBootstrapIdentity(receipt, { root: 'C:/checkout', runtime: actual }).map(item => item.field), ['runtime.node', 'runtime.abi']);
assert.deepEqual(compareBootstrapIdentity({ ...receipt, runtime: { ...actual, execPath: 'C:/other/node.exe' } }, { root: receipt.root, runtime: actual }), []);
const matching = { schemaVersion: BOOTSTRAP_RECEIPT_VERSION, root: receipt.root, runtime: actual };
for (const field of ['schemaVersion', 'root', 'runtime.node', 'runtime.abi', 'runtime.platform', 'runtime.arch']) {
  const changed = structuredClone(matching), [parent, child] = field.split('.');
  if (child) changed[parent][child] = 'different'; else changed[parent] = 'different';
  assert.deepEqual(compareBootstrapIdentity(changed, { root: receipt.root, runtime: actual }), [
    { field, expected: child ? actual[child] : matching[parent], observed: 'different' }
  ]);
}
const suite = path.join(process.cwd(), '.tmp', 'tasks', 'checkout-diagnosis-identity');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  const report = await diagnoseCheckout({ root });
  assert.equal(report.bootstrap.code, 'ERR_BOOTSTRAP_RECEIPT_MISSING');
  assert.equal(report.operationalReadiness, 'not-probed');
  assert.equal(report.prerequisites.state, 'not-probed');
  assert.equal(report.bootstrap.nativeProbes, 'not-run');
  let denial;
  await assert.rejects(requireBootstrap({ root }), error => { denial = error; return error.code === 'ERR_BOOTSTRAP_REQUIRED'; });
  for (const key of ['code', 'reason', 'mismatches']) assert.deepEqual(denial.bootstrap[key], report.bootstrap[key]);
  assert.deepEqual(denial.runtime, report.runtime);
  assert.deepEqual(denial.recovery, report.recovery);
  assert.match(denial.message, /ERR_BOOTSTRAP_RECEIPT_MISSING/);
  assert.match(denial.message, /Next action: install/);
  const context = getBootstrapRuntimeContext();
  assert.equal(context.executable, process.execPath);
  const commands = { verify: 'npm run bootstrap:ci -- --verify', repair: 'npm run bootstrap:ci -- --repair', install: 'npm run bootstrap:ci' };
  for (const action of ['verify', 'repair', 'install', 'wait', 'select-runtime']) {
    const text = formatBootstrapRequired({ bootstrap: { reason: 'original reason', code: 'original-code',
      mismatches: [{ field: 'runtime.node', expected: 'current', observed: 'previous' }] },
    recovery: { action, command: commands[action] || null, reason: 'qualified original selection' }, runtime: context }, root);
    assert.ok(text.includes(`Next action: ${action}`));
    assert.match(text, /runtime.node: expected "current"; receipt "previous"/);
    if (commands[action]) assert.ok(text.includes(`  ${commands[action]}\n`));
    else assert.doesNotMatch(text, /npm run bootstrap/, 'wait/runtime selection must not recommend a concurrent install');
  }
  const malformed = formatBootstrapRequired({ bootstrap: { reason: 'invalid identity', code: 'original-code', mismatches: [
    { field: 'root', expected: root, observed: 'x'.repeat(8192) },
    { field: 'runtime.node', expected: process.version, observed: { nested: 'not a runtime identity' } }
  ] }, recovery: { action: 'wait', command: null, reason: 'original owner pending' }, runtime: context }, root);
  assert.match(malformed, /runtime.node: expected .*; receipt <object>/);
  assert.equal(malformed.includes('x'.repeat(513)), false, 'malformed receipt diagnostics remain bounded');
  assert.deepEqual(await fs.readdir(root), []);
  await fs.writeFile(path.join(root, 'package.json'), '{"version":"1.2.3"}');
  for (const args of [['help', '--json'], ['help-all', '--json'], ['--help-all', '--json'], ['bootstrap', '--help', '--json'], ['--version', '--json']]) {
    let stdout = '';
    let stderr = '';
    assert.equal(await handleCheckoutInformation(args, { root, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } }), true);
    const payload = JSON.parse(stdout);
    assert.equal(payload.operationalReadiness, 'not-probed');
    assert.equal(stderr, '');
  }
  for (const args of [['index', 'build'], ['search', '--help'], ['bootstrap', '--repo', 'target']]) assert.equal(await handleCheckoutInformation(args, { root }), false);
  assert.deepEqual((await fs.readdir(root)).sort(), ['package.json']);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Checkout diagnosis identifies mismatches without provisioning.');
