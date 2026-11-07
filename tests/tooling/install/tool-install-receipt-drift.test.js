#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildToolInstallReceipt, writeToolInstallReceipt, readToolInstallReceipts, verifyToolInstallReceipt, projectToolSecondaryStorage } from '../../../tools/tooling/install-receipts.js';
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
  assert.equal(receipt.secondaryStorage.state, 'unknown-or-not-recorded');
  const profileIdentity = 'a'.repeat(64), runId = 'fixture-run';
  const storage = { prepared: true, source: 'declared-not-observed-writes', profileIdentity, runId,
    settlement: { resourceId: `${profileIdentity}:${runId}`, settled: true, pending: false },
    env: { SECRET_TOKEN: 'never-store-this-value' },
    locations: [{ environmentKey: 'npm_config_cache', path: path.join(root, 'shared-cache'), retention: 'downloadable', external: true,
      source: 'inherited-or-explicit-environment', purpose: 'npm', file: false, cleanupAuthority: true }],
    exceptions: [{ environmentKey: 'npm_config_cache', path: path.join(root, 'shared-cache'), kind: 'deliberate-environment-override',
      status: 'external-shared-read-only-inventory', secret: 'never-store-this-value' }] };
  const projection = projectToolSecondaryStorage(storage);
  assert.equal(projection.state, 'settled-declared-not-observed');
  assert.equal(projection.locations[0].cleanupAuthority, false, 'a location observation never grants removal authority');
  assert.equal(projection.locations[0].external, true);
  assert.equal(JSON.stringify(projection).includes('never-store-this-value'), false);
  const crashLocation = { ...storage.locations[0], environmentKey: 'ERL_CRASH_DUMP', retention: 'evidence', file: true };
  const crashProjection = projectToolSecondaryStorage({ ...storage, locations: [crashLocation] });
  assert.equal(crashProjection.locations[0].retention, 'evidence');
  assert.equal(crashProjection.locations[0].cleanupAuthority, false, 'crash evidence does not become scratch cleanup authority');
  assert.throws(() => projectToolSecondaryStorage({ ...storage, locations: [{ ...crashLocation, retention: 'unknown-tier' }] }),
    /Invalid canonical secondary storage location/);
  for (const invalidRunId of ['.', '..']) assert.throws(() => projectToolSecondaryStorage({ ...storage, runId: invalidRunId,
    settlement: { resourceId: `${profileIdentity}:${invalidRunId}`, settled: true, pending: false } }),
  /Invalid canonical secondary storage identity/);
  assert.equal(projectToolSecondaryStorage({ ...storage, settlement: { resourceId: 'wrong-resource', settled: true, pending: false } }).state, 'unknown-or-not-recorded');
  const stored = buildToolInstallReceipt({ tool: { id: 'storage-server' }, action: { cmd: 'fixture', args: [], scope: 'cache', storage },
    result: { path: executable, probe: { ok: true } }, toolingRoot: managed });
  assert.deepEqual(stored.secondaryStorage, projection);
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
