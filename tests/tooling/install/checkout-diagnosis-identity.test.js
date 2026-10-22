#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { compareBootstrapIdentity } from '../../../src/shared/bootstrap-readiness.js';
import { diagnoseCheckout, handleCheckoutInformation } from '../../../tools/setup/checkout-diagnose.js';

const actual = { node: 'v26.12.1', abi: '148', platform: 'win32', arch: 'x64' };
const receipt = { schemaVersion: 1, root: 'C:/checkout', runtime: { ...actual, node: 'v26.12.2', abi: '149' } };
assert.deepEqual(compareBootstrapIdentity(receipt, { root: 'C:/checkout', runtime: actual }).map(item => item.field), ['runtime.node', 'runtime.abi']);
assert.deepEqual(compareBootstrapIdentity({ ...receipt, runtime: { ...actual, execPath: 'C:/other/node.exe' } }, { root: receipt.root, runtime: actual }), []);
const suite = path.join(process.cwd(), '.tmp', 'tasks', 'checkout-diagnosis-identity');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  const report = await diagnoseCheckout({ root });
  assert.equal(report.bootstrap.code, 'ERR_BOOTSTRAP_RECEIPT_MISSING');
  assert.equal(report.operationalReadiness, 'not-probed');
  assert.equal(report.prerequisites.state, 'not-probed');
  assert.equal(report.bootstrap.nativeProbes, 'not-run');
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
