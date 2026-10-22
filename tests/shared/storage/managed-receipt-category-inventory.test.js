import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { stableStringify } from '../../../src/shared/stable-json.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { resolveStorageLayout } from '../../../src/shared/storage/layout.js';
import { planManagedChildStorage, prepareManagedChildStorage } from '../../../src/shared/storage/child-environment.js';
import { buildToolInstallReceipt, writeToolInstallReceipt } from '../../../tools/tooling/install-receipts.js';
import { inspectStorageCategory } from '../../../tools/storage/category-inventory.js';

const temporary = await makeTempDir('poc-managed-receipt-inventory-');
try {
  const home = path.join(temporary, 'home');
  const root = path.join(home, 'tooling');
  const repo = path.join(temporary, 'repo');
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(repo);
  const consumer = path.join(root, 'fixture-consumer');
  await fs.writeFile(consumer, 'fixture consumer bytes; never executed');
  const layout = resolveStorageLayout({ home, env: {} });
  const plan = planManagedChildStorage({ layout, managed: true, command: 'npm', baseEnv: {}, toolId: 'fixture-tool',
    toolIdentity: 'fixture-tool@1', runId: 'fixture-one' });
  const prepared = await prepareManagedChildStorage(plan, { authorizedRoots: [home] });
  const npmLocation = plan.locations.find(location => location.environmentKey === 'npm_config_cache');
  await fs.writeFile(path.join(npmLocation.path, 'download-fragment'), 'owned fixture secondary bytes');
  const storage = { ...prepared, settlement: { resourceId: `${plan.profileIdentity}:${plan.runId}`, settled: true, pending: false } };
  const result = { path: consumer, probe: { ok: true, identity: { version: '1.0.0' } } };
  const receipt = buildToolInstallReceipt({ tool: { id: 'fixture-tool', version: '1.0.0' }, toolingRoot: root, result,
    action: { cmd: 'npm', args: ['fixture-tool@1.0.0'], scope: 'cache', storage } });
  assert.equal(receipt.secondaryStorage.state, 'settled-declared-not-observed');
  const file = writeToolInstallReceipt(root, receipt);
  const before = await fs.readFile(file);
  const inspect = () => inspectStorageCategory({ category: 'managed-installations', root, home,
    registeredRoots: Object.values(layout.descriptors).map(descriptor => descriptor.path) });
  const observed = await inspect();
  assert.equal(observed.complete, true);
  assert.equal(observed.observedWrites, false, 'a canonical settled declaration does not qualify real tool write containment');
  assert.equal(observed.receipts[0].locations.find(location => location.path === npmLocation.path).logicalBytes,
    Buffer.byteLength('owned fixture secondary bytes'));
  assert.equal(observed.deletionAuthority, false);
  assert.equal(observed.receipts[0].locations.every(location => location.protected && location.cleanupAuthority === false), true);
  assert.deepEqual(await fs.readFile(file), before, 'read-only adapter never touches receipt or use timestamps');
  const beamPlan = planManagedChildStorage({ layout, managed: true, command: 'erl', baseEnv: {}, toolId: 'fixture-beam',
    toolIdentity: 'fixture-beam@1', runId: 'fixture-beam-one' });
  const beamPrepared = await prepareManagedChildStorage(beamPlan, { authorizedRoots: [home] });
  const crash = beamPlan.locations.find(location => location.environmentKey === 'ERL_CRASH_DUMP');
  assert.equal(crash.retention, 'evidence');
  assert.equal(crash.file, true);
  await fs.writeFile(crash.path, 'retained fixture crash evidence');
  const beamReceipt = buildToolInstallReceipt({ tool: { id: 'fixture-beam' }, toolingRoot: root, result,
    action: { cmd: 'erl', args: [], scope: 'cache', storage: { ...beamPrepared,
      settlement: { resourceId: `${beamPlan.profileIdentity}:${beamPlan.runId}`, settled: true, pending: false } } } });
  writeToolInstallReceipt(root, beamReceipt);
  const beamObserved = await inspect();
  assert.equal(beamObserved.complete, true, 'canonical BEAM evidence is admitted by the receipt producer and read-only inventory');
  const crashObserved = beamObserved.receipts.find(entry => entry.toolId === 'fixture-beam').locations
    .find(location => location.environmentKey === 'ERL_CRASH_DUMP');
  assert.equal(crashObserved.logicalBytes, Buffer.byteLength('retained fixture crash evidence'));
  assert.equal(crashObserved.retention, 'evidence');
  assert.equal(crashObserved.cleanupAuthority, false);
  assert.equal(crashObserved.deletionAuthority, false);
  assert.equal(crashObserved.migrationAuthority, false);
  assert.equal(await fs.readFile(crash.path, 'utf8'), 'retained fixture crash evidence');
  const { receiptId: priorId, ...knownBody } = receipt;
  const unknownBody = { ...knownBody, toolId: 'unknown-metadata-tool', source: { ...knownBody.source, pinned: true } };
  const unknownReceipt = { ...unknownBody, receiptId: createHash('sha256').update(stableStringify(unknownBody)).digest('hex') };
  const unknownDirectory = path.join(root, 'install-receipts', unknownReceipt.toolId);
  await fs.mkdir(unknownDirectory);
  const unknownPath = path.join(unknownDirectory, `${unknownReceipt.receiptId}.json`);
  const unknownBytes = JSON.stringify(unknownReceipt) + '\n';
  await fs.writeFile(unknownPath, unknownBytes);
  const unknownMetadata = await inspect();
  assert.equal(unknownMetadata.complete, false, 'a body digest cannot register source retention metadata');
  assert.equal(unknownMetadata.receipts.find(entry => entry.path === unknownPath).status, 'unknown-or-incomplete-receipt');
  assert.equal(unknownMetadata.receipts.find(entry => entry.path === unknownPath).locations, undefined);
  assert.equal(await fs.readFile(unknownPath, 'utf8'), unknownBytes);
  await fs.rm(unknownPath);
  await fs.rmdir(unknownDirectory);
  const env = applyTestEnv({ syncProcess: false });
  const cli = runNode(['tools/storage/cli.js', 'inspect', '--category', 'managed-installations', '--repo', repo,
    '--home', home, '--path', root, '--json'], 'managed receipt storage inventory CLI', process.cwd(), env,
  { stdio: 'pipe', allowFailure: true, timeoutMs: 10000 });
  assert.equal(cli.status, 0, cli.stderr || cli.stdout);
  assert.equal(JSON.parse(cli.stdout).receipts.find(entry => entry.toolId === 'fixture-tool').profileIdentity, plan.profileIdentity);
  const outside = path.join(temporary, 'external-user-cache');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'saved-evidence'), 'external bytes never adopted');
  const externalStorage = { ...storage, locations: [{ ...storage.locations[0], path: outside, external: true }] };
  const external = buildToolInstallReceipt({ tool: { id: 'external-tool' }, toolingRoot: root, result,
    action: { cmd: 'npm', args: ['external-tool@1.0.0'], scope: 'cache', storage: externalStorage } });
  writeToolInstallReceipt(root, external);
  const pending = buildToolInstallReceipt({ tool: { id: 'pending-tool' }, toolingRoot: root, result,
    action: { cmd: 'npm', args: ['pending-tool@1.0.0'], scope: 'cache', storage: { ...storage,
      settlement: { resourceId: 'wrong-resource', settled: true, pending: false } } } });
  writeToolInstallReceipt(root, pending);
  const protectedInventory = await inspect();
  assert.equal(protectedInventory.complete, false);
  const externalObserved = protectedInventory.receipts.find(entry => entry.toolId === 'external-tool');
  assert.equal(externalObserved.locations[0].status, 'declared-external-override-unscanned');
  assert.equal(externalObserved.locations[0].logicalBytes, null);
  assert.equal(protectedInventory.receipts.find(entry => entry.toolId === 'pending-tool').status, 'secondary-writes-not-recorded');
  assert.equal(await fs.readFile(path.join(outside, 'saved-evidence'), 'utf8'), 'external bytes never adopted');
  await fs.writeFile(path.join(path.dirname(file), 'saved-unknown.json'), 'unknown receipt evidence');
  const unknown = await inspect();
  assert.equal(unknown.complete, false);
  assert.equal(unknown.receipts.some(entry => entry.status === 'unknown-or-incomplete-receipt'), true);
  assert.equal(await fs.readFile(path.join(path.dirname(file), 'saved-unknown.json'), 'utf8'), 'unknown receipt evidence');
  const bounded = await inspectStorageCategory({ category: 'managed-installations', root, home, maxEntries: 1 });
  assert.equal(bounded.complete, false);
} finally { await rmDirRecursive(temporary); }
console.log('managed producer receipt category inventory passed');
