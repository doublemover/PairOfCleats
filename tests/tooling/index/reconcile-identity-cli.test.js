#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createIdentityReconciliationDriftIndex } from '../../helpers/identity-reconciliation-fixture.js';
import { runNode } from '../../helpers/run-node.js';

const root = process.cwd();
const { indexRoot } = await createIdentityReconciliationDriftIndex({
  root,
  cacheName: 'reconcile-identity-cli'
});

const result = runNode(
  ['tools/index/reconcile-identity.js', '--index-root', indexRoot, '--mode', 'code', '--json'],
  'reconcile identity cli',
  root,
  applyTestEnv({ syncProcess: false }),
  { stdio: 'pipe', allowFailure: true }
);

assert.equal(result.status, 1, `expected failing exit status, got ${result.status}\n${result.stderr}`);
const report = JSON.parse(result.stdout);
assert.equal(report.ok, false, 'expected failing JSON report');
assert.ok(
  report.issues.some((issue) => /symbols chunkUid missing in chunk_meta/i.test(issue.message)),
  'expected CLI report to surface symbol drift'
);

console.log('reconcile identity CLI test passed');
