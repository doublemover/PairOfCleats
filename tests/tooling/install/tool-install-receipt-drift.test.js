#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildToolInstallReceipt, writeToolInstallReceipt, readToolInstallReceipts, verifyToolInstallReceipt } from '../../../tools/tooling/install-receipts.js';
import { planToolLifecycle } from '../../../tools/tooling/lifecycle.js';

const suite = path.join(process.cwd(), '.tmp', 'tasks', 'tool-install-receipt-drift');
await fs.mkdir(suite, { recursive: true });
const root = await fs.mkdtemp(path.join(suite, 'case-'));
try {
  const managed = path.join(root, 'managed');
  await fs.mkdir(managed);
  const executable = path.join(managed, 'server');
  await fs.writeFile(executable, 'first bytes');
  const receipt = buildToolInstallReceipt({ tool: { id: 'test-server' }, result: { path: executable, probe: { ok: true } }, toolingRoot: managed });
  assert.equal(receipt.ownership, 'managed');
  assert.equal(receipt.verification.protocol, 'not-probed');
  writeToolInstallReceipt(managed, receipt);
  assert.equal(readToolInstallReceipts(managed, 'test-server').length, 1);
  assert.equal(verifyToolInstallReceipt(receipt).state, 'bytes-intact');
  await fs.writeFile(executable, 'changed bytes, same displayed version');
  assert.equal(verifyToolInstallReceipt(receipt).state, 'repair-required');
  const outside = path.join(root, 'external');
  await fs.writeFile(outside, 'external bytes');
  const external = buildToolInstallReceipt({ tool: { id: 'external-server' }, result: { path: outside, probe: { ok: true } }, toolingRoot: managed });
  assert.equal(external.ownership, 'external');
  assert.deepEqual(external.ownedPaths, []);
  writeToolInstallReceipt(managed, external);
  const remove = await planToolLifecycle({ toolingRoot: managed, id: 'external-server', operation: 'remove' });
  assert.equal(remove.state, 'blocked');
  assert.ok(remove.blockers.some(blocker => blocker.code === 'external-install-not-owned'));
  assert.equal(await fs.readFile(outside, 'utf8'), 'external bytes');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Durable tool receipts detect byte drift and preserve external ownership.');
