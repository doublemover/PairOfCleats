// Actual CLI/category owners; authored UNRUN while source workers are active.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inspectStorageCategory } from '../../../tools/storage/category-inventory.js';
import { inspectManagedStorageReceipts } from '../../../tools/storage/managed-receipt-inventory.js';
import { inspectEmbeddingStorageProfile, EMBEDDING_STORAGE_METADATA } from '../../../tools/storage/embedding-adapter.js';
import { runStorageCli } from '../../../tools/storage/cli.js';
import { resolveEmbeddingCacheProfile } from '../../../src/shared/embeddings-cache/layout.js';
import { buildCacheIdentity } from '../../../tools/build/embeddings/cache.js';
import { writePersistentCommandProbeCache } from '../../../src/index/tooling/command-probe-persistent-cache.js';
import { buildToolInstallReceipt, writeToolInstallReceipt } from '../../../tools/tooling/install-receipts.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'poc-storage-category-cancel-'));
const home = path.join(root, 'home'), tooling = path.join(home, 'tooling'), repo = path.join(root, 'repo');
const open = fsp.open, lstat = fsp.lstat, opendir = fsp.opendir, lstatSync = fs.lstatSync;
const openSync = fs.openSync, closeSync = fs.closeSync, now = Date.now, log = console.log, exitCode = process.exitCode;
const samePath = (left, right) => typeof left === 'string' && (process.platform === 'win32'
  ? path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase() : path.resolve(left) === path.resolve(right));
let isStopped = () => false, laterAdmissions = 0, numeric = null;
const restore = () => {
  fsp.open = open; fsp.lstat = lstat; fsp.opendir = opendir; fs.lstatSync = lstatSync;
  fs.openSync = openSync; fs.closeSync = closeSync; Date.now = now; console.log = log; process.exitCode = exitCode;
};
const trackAdmissions = () => {
  const admit = () => { if (isStopped()) laterAdmissions += 1; };
  fsp.open = (...args) => { admit(); return open(...args); };
  fsp.lstat = (...args) => { admit(); return lstat(...args); };
  fsp.opendir = (...args) => { admit(); return opendir(...args); };
  fs.lstatSync = (...args) => { admit(); return lstatSync(...args); };
  fs.openSync = (...args) => { admit(); return openSync(...args); };
};
applyTestEnv({ cacheRoot: path.join(home, 'cache'), embeddings: 'off' });
try {
  await fsp.mkdir(repo);
  const controller = new AbortController(); controller.abort();
  isStopped = () => true; trackAdmissions();
  for (const category of ['command-probes', 'dictionaries', 'managed-installations', 'embedding-profiles']) {
    const result = await inspectStorageCategory({ category, root: tooling, home, signal: controller.signal });
    assert.equal(result.stopReason, 'cancelled'); assert.equal(result.complete, false); assert.equal(result.lease, null);
  }
  const managed = await inspectManagedStorageReceipts({ root: tooling, home, signal: controller.signal });
  assert.equal(managed.stopReason, 'cancelled'); assert.equal(managed.receiptInventory, null);
  await assert.rejects(inspectStorageCategory({ category: 'command-probes', root: tooling, home, maxEntries: 0 }), TypeError);
  assert.equal(laterAdmissions, 0, 'pre-cancelled or invalid requests admit no policy, lease or path readers');
  restore(); isStopped = () => false;

  const { identity } = buildCacheIdentity({ provider: 'stub', modelId: 'cancel-metadata', dims: 2 });
  const profile = resolveEmbeddingCacheProfile({ cacheRoot: root, identity });
  const selected = path.join(profile.canonical, 'global-chunks', EMBEDDING_STORAGE_METADATA[0]);
  await fsp.mkdir(path.dirname(selected), { recursive: true }); await fsp.writeFile(selected, '{}');
  for (const stopReason of ['cancelled', 'time-budget']) {
    const cancellation = new AbortController(); let clock = 0;
    isStopped = () => cancellation.signal.aborted || clock >= 1000; laterAdmissions = 0; trackAdmissions();
    if (stopReason === 'time-budget') Date.now = () => clock;
    fsp.lstat = async (file, ...args) => {
      if (isStopped()) laterAdmissions += 1;
      const stat = await lstat(file, ...args);
      if (samePath(file, selected)) {
        if (stopReason === 'cancelled') cancellation.abort(); else clock = 1000;
      }
      return stat;
    };
    const result = await inspectEmbeddingStorageProfile({ cacheRoot: root, identity,
      signal: cancellation.signal, maxDurationMs: 1000 });
    assert.equal(result.stopReason, stopReason); assert.equal(result.physical, null); assert.equal(result.complete, false);
    assert.equal(laterAdmissions, 0, 'metadata loops and revalidation stop before admitting another native reader');
    restore();
  }

  isStopped = () => false;
  assert.equal(writePersistentCommandProbeCache({ providerId: 'fixture', command: process.execPath, args: ['--version'], cwd: root,
    probeEnv: {}, toolingConfig: { cache: { dir: tooling } }, attempted: [{ ok: true }] }), true);
  const probes = path.join(tooling, 'command-probes');
  const probe = path.join(probes, (await fsp.readdir(probes)).find(name => name.endsWith('.json')));
  const consumer = path.join(tooling, 'fixture-consumer'); await fsp.writeFile(consumer, 'not executed');
  const receipt = buildToolInstallReceipt({ tool: { id: 'fixture-tool' }, toolingRoot: tooling,
    result: { path: consumer, probe: { ok: true, identity: { version: '1' } } }, action: { cmd: 'npm', args: [], scope: 'cache' } });
  const receiptPath = writeToolInstallReceipt(tooling, receipt);
  const machineConfig = path.join(root, 'machine-config.json'); await fsp.writeFile(machineConfig, '{}');
  for (const boundary of ['command-probes', 'managed-installations', 'machine-config']) {
    const cancellation = new AbortController(); laterAdmissions = 0;
    isStopped = () => cancellation.signal.aborted; trackAdmissions();
    if (boundary === 'command-probes') {
      fs.openSync = (file, ...args) => { if (isStopped()) laterAdmissions += 1; const fd = openSync(file, ...args); if (samePath(file, probe)) numeric = fd; return fd; };
      fs.closeSync = fd => { const result = closeSync(fd); if (fd === numeric) { numeric = null; cancellation.abort(); } return result; };
    } else fsp.open = async (file, ...args) => {
      if (isStopped()) laterAdmissions += 1;
      const handle = await open(file, ...args);
      if (!samePath(file, boundary === 'machine-config' ? machineConfig : receiptPath)) return handle;
      return { fd: handle.fd, stat: handle.stat.bind(handle), read: handle.read.bind(handle),
        close: async () => { const result = await handle.close(); cancellation.abort(); return result; } };
    };
    let result;
    if (boundary === 'machine-config') {
      console.log = () => {};
      result = await runStorageCli(['explain', '--repo', repo, '--home', home, '--machine-config', machineConfig, '--json'], { signal: cancellation.signal });
      assert.equal(result.state, 'cancelled'); assert.equal(result.mutationPerformed, false);
    } else {
      result = await inspectStorageCategory({ category: boundary, root: boundary === 'command-probes' ? probes : tooling,
        home, registeredRoots: [home], signal: cancellation.signal });
      assert.equal(result.stopReason, 'cancelled'); assert.equal(result.complete, false);
      assert.match(result.leaseRevalidation, /not-performed/);
      if (boundary === 'managed-installations') assert.equal(result.secondaryInventory, null);
    }
    assert.equal(cancellation.signal.aborted, true, 'the actual selected reader exercised the cancellation boundary');
    assert.equal(laterAdmissions, 0, 'settled cancellation never admits path revalidation, a final lease scan or fallback locator reads');
    restore();
  }
  const bounded = await inspectStorageCategory({ category: 'command-probes', root: probes, home, maxEntries: 1 });
  assert.equal(bounded.stopReason, 'entry-budget'); assert.equal(bounded.complete, false); assert.deepEqual(bounded.files, []);
} finally {
  restore(); if (numeric !== null) closeSync(numeric);
  await fsp.rm(root, { recursive: true, force: true });
}
console.log('Storage CLI and category readers stop new admission after cancellation or exhausted inspection budgets.');
