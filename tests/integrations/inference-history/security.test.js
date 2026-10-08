import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { privateReference, digest } from '../../../src/integrations/inference-history/common.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInferenceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { openHistoryStore } from '../../../src/integrations/inference-history/store.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = await fs.realpath(await makeTempDir('poc-history-security-'));
const vaultRoot = path.join(root, 'vault');
const sourcePath = path.join(root, 'synthetic.json');
await fs.mkdir(vaultRoot, { mode: 0o700 });
const request = { requestContext: 'session', partition: 'own' };
const access = { principalId: 'alice', tenantId: 'tenant', ownerType: 'individual', ownerId: 'alice',
  sourceScope: 'chatgpt', policyEpoch: '1', allowed: true };
const options = { vaultRoot, resolveAccess: () => access, verifyPrivateVault: () => true,
  resolveImportSource: () => ({ path: sourcePath, policyEpoch: '1' }) };
const text = 'prefix sk-proj-SYNTHETICsecret1234567890123456789 suffix tungsten';
try {
  await assert.rejects(openHistoryStore(vaultRoot, '../outside', { create: true }), { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
  await assert.rejects(openHistoryStore(vaultRoot, 'x'.repeat(64), { create: true }), { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
  assert.deepEqual(await fs.readdir(vaultRoot), []);
  const raw = [{ id: 'conversation', current_node: 'node', mapping: {
    node: { id: 'node', parent: null, children: [], message: { id: 'message', author: { role: 'user' },
      content: { content_type: 'text', parts: [text] }, create_time: 'sk-proj-invalidtimestampsecret0123456789' } }
  } }];
  await fs.writeFile(sourcePath, JSON.stringify(raw));
  const noSourceGrant = createInferenceHistoryService({ ...options, resolveImportSource: null });
  await assert.rejects(noSourceGrant.importExport({ ...request, sourcePath }), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  let sourceChecks = 0;
  const changedSource = createInferenceHistoryService({ ...options,
    resolveImportSource: () => ({ path: sourcePath, policyEpoch: String(++sourceChecks) }) });
  await assert.rejects(changedSource.importExport(request), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  const narrow = createInferenceHistoryService({ ...options, limits: { maxTextChars: 20 } });
  await narrow.importExport({ ...request, sourcePath: '/untrusted-client-path-must-not-be-opened' });
  const narrowHit = (await narrow.search({ ...request, query: 'prefix' })).hits[0];
  assert.ok(!narrowHit.text.includes('sk-proj'));
  assert.ok(!JSON.stringify(narrowHit).includes('invalidtimestampsecret'));
  assert.equal((await narrow.search({ ...request, query: 'tungsten' })).hits.length, 0);
  const wide = createInferenceHistoryService(options);
  const expanded = await wide.importExport({ ...request, sourcePath });
  assert.equal(expanded.repeated, false);
  assert.equal(expanded.newUnits, 1);
  const hit = (await wide.search({ ...request, query: 'tungsten' })).hits[0];
  assert.notEqual(hit.sourceRef, narrowHit.sourceRef);
  assert.notEqual(hit.projectionFingerprint, narrowHit.projectionFingerprint);

  // This audit callback creates the interleaving after retrieval, before emission.
  let deleted = false;
  const inFlight = createInferenceHistoryService({ ...options, audit: async ({ action, outcome }) => {
    if (action === 'search' && outcome === 'allowed' && !deleted) {
      deleted = true;
      await wide.deleteRecord({ ...request, recordRef: hit.recordRef });
    }
  } });
  await assert.rejects(inFlight.search({ ...request, query: 'tungsten' }), { code: 'ERR_INFERENCE_HISTORY_DENIED' });

  if (process.platform !== 'win32') {
    const publicVault = path.join(root, 'public-vault');
    await fs.mkdir(publicVault, { mode: 0o755 });
    await assert.rejects(openHistoryStore(publicVault, 'a'.repeat(64), { create: true }),
      { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
    const linkVault = path.join(root, 'link-vault');
    await fs.symlink(vaultRoot, linkVault);
    await assert.rejects(openHistoryStore(linkVault, 'a'.repeat(64), { create: true }),
      { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
    await fs.symlink(sourcePath, path.join(vaultRoot, `${'b'.repeat(64)}.sqlite`));
    await assert.rejects(openHistoryStore(vaultRoot, 'b'.repeat(64), { create: true }),
      { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
  }
  const repo = path.join(root, 'repo');
  await fs.mkdir(path.join(repo, '.git'), { recursive: true });
  await fs.writeFile(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/synthetic\n');
  await fs.mkdir(path.join(repo, 'vault'), { mode: 0o700 });
  await assert.rejects(openHistoryStore(path.join(repo, 'vault'), 'a'.repeat(64), { create: true }),
    { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
  const bareRepo = path.join(root, 'synthetic-bare-repo');
  await fs.mkdir(path.join(bareRepo, 'objects'), { recursive: true });
  await fs.writeFile(path.join(bareRepo, 'HEAD'), 'ref: refs/heads/synthetic\n');
  await fs.writeFile(path.join(bareRepo, 'config'), '[core]\n bare = true\n');
  const bareVault = path.join(bareRepo, 'vault');
  await fs.mkdir(bareVault, { mode: 0o700 });
  await assert.rejects(openHistoryStore(bareVault, 'c'.repeat(64),
    { create: true, verifyPrivateVault: () => true }), { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
  assert.deepEqual(await fs.readdir(bareVault), []);
  const databasePath = path.join(vaultRoot, (await fs.readdir(vaultRoot)).find(name => name.endsWith('.sqlite')));
  const partitionKey = path.basename(databasePath, '.sqlite');
  const db = new Database(databasePath);
  db.prepare("DELETE FROM vault_meta WHERE key='reference_key'").run();
  db.close();
  await assert.rejects(openHistoryStore(vaultRoot, partitionKey,
    { create: true, verifyPrivateVault: () => true }), { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
  const check = new Database(databasePath, { readonly: true });
  assert.equal(check.prepare("SELECT value FROM vault_meta WHERE key='reference_key'").get(), undefined);
  check.close();
  const rawCandidate = 'password=1234';
  const keyedA = privateReference('a'.repeat(64), rawCandidate);
  assert.notEqual(keyedA, digest(rawCandidate));
  assert.notEqual(keyedA, privateReference('b'.repeat(64), rawCandidate));
  assert.equal(keyedA, privateReference('a'.repeat(64), rawCandidate));
  console.log('Inference history storage boundaries, projection identity and in-flight tombstones passed.');
} finally { await rmDirRecursive(root); }
