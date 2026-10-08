import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createInferenceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = await makeTempDir('poc-history-service-');
const vaultRoot = path.join(root, 'private-vault');
await fs.mkdir(vaultRoot, { mode: 0o700 });
let sourcePath = path.join(root, 'synthetic.json');
const secret = 'sk-proj-SYNTHETICsecretvalue1234567890';
const audit = [];
let epoch = '1';
const contexts = {
  alice: { principalId: 'alice', tenantId: 'tenant-a', ownerType: 'individual', ownerId: 'alice' },
  bob: { principalId: 'bob', tenantId: 'tenant-a', ownerType: 'individual', ownerId: 'bob' },
  foreign: { principalId: 'alice', tenantId: 'tenant-b', ownerType: 'individual', ownerId: 'alice' },
  org: { principalId: 'alice', tenantId: 'tenant-a', ownerType: 'organization', ownerId: 'org-a' }
};
const resolveAccess = async ({ requestContext, partition }) => contexts[requestContext] && partition === 'own'
  ? { ...contexts[requestContext], sourceScope: 'chatgpt', policyEpoch: epoch, allowed: true } : null;
const verifyPrivateVault = () => true; // This host owns the synthetic temporary fixture.
const resolveImportSource = () => ({ path: sourcePath, policyEpoch: '1' });
const service = createInferenceHistoryService({ vaultRoot, resolveAccess, resolveImportSource,
  verifyPrivateVault, audit: (row) => audit.push(row) });
const request = { requestContext: 'alice', partition: 'own', source: 'trusted-synthetic-upload' };
const node = (id, parent, children, text, extra = {}) => ({ id, parent, children,
  message: { id: `message-${id}`, author: { role: 'user' }, content: { content_type: 'text', parts: [text] }, ...extra } });
let conversation = { id: 'conversation', title: 'Synthetic engineering history', current_node: 'short', mapping: {
  root: { id: 'root', parent: null, children: ['short', 'long'], message: null },
  short: node('short', 'root', [], `Keep feature branch IH-101. ${secret}`),
  long: node('long', 'root', ['longer'], 'Rejected alternative cobalt'),
  longer: node('longer', 'long', [], 'Longer abandoned proposal')
} };
const write = () => fs.writeFile(sourcePath, JSON.stringify([conversation]));
try {
  await write();
  const first = await service.importExport({ ...request, sourcePath });
  assert.equal(first.newSnapshots, 1);
  assert.equal(first.newUnits, 4);
  assert.equal(first.complete, true);
  const repeated = await service.importExport({ ...request, sourcePath });
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.newUnits, 0);
  const [hit] = (await service.search({ ...request, query: 'feature branch' })).hits;
  assert.ok(hit);
  assert.equal(hit.pathState, 'on_selected_path');
  assert.equal(hit.instructionAuthority, 'none');
  assert.ok(!hit.text.includes(secret));
  assert.ok(hit.text.includes('[REDACTED credential]'));
  assert.deepEqual(hit.createdAt, { utc: null, state: 'missing' });
  assert.equal((await service.search({ ...request, query: secret })).hits.length, 0);
  assert.equal((await service.search({ ...request, query: 'cobalt', pathState: 'on_selected_path' })).hits.length, 0);
  assert.equal((await service.search({ ...request, query: 'cobalt', pathState: 'off_selected_path' })).hits.length, 1);
  const original = await service.readOriginal({ ...request, snapshotRef: hit.snapshotRef });
  assert.deepEqual(original.raw, conversation);
  assert.equal(original.occurrences[0].ordinal, 0);
  assert.equal(original.occurrences[0].member, 'conversations.json');
  assert.match(original.occurrences[0].rawSha256, /^[a-f0-9]{64}$/);
  const searchOnly = createInferenceHistoryService({ vaultRoot, verifyPrivateVault,
    resolveAccess: (input) => input.action === 'search' ? resolveAccess(input) : null });
  assert.equal((await searchOnly.search({ ...request, query: 'feature branch' })).hits.length, 1);
  await assert.rejects(searchOnly.readOriginal({ ...request, snapshotRef: hit.snapshotRef }),
    { code: 'ERR_INFERENCE_HISTORY_DENIED' });

  for (const caller of ['bob', 'foreign', 'org']) {
    assert.deepEqual((await service.search({ ...request, requestContext: caller, query: 'feature branch' })).hits, []);
    assert.equal(await service.readOriginal({ ...request, requestContext: caller, snapshotRef: hit.snapshotRef }), null);
  }
  await assert.rejects(service.search({ ...request, requestContext: 'unknown', query: 'feature branch' }),
    { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  await assert.rejects(service.search({ ...request, partition: 'alice', query: 'feature branch' }),
    { code: 'ERR_INFERENCE_HISTORY_DENIED' });

  // Identical exported IDs and bytes have different identities in another tenant.
  await service.importExport({ ...request, requestContext: 'foreign', sourcePath });
  const foreignHit = (await service.search({ ...request, requestContext: 'foreign', query: 'feature branch' })).hits[0];
  assert.notEqual(foreignHit.sourceRef, hit.sourceRef);
  assert.notEqual(foreignHit.recordRef, hit.recordRef);

  // Title/current-path changes create a snapshot while retaining unchanged nodes.
  conversation = { ...conversation, title: 'Updated title', current_node: 'longer' };
  await write();
  const retitled = await service.importExport({ ...request, sourcePath });
  assert.equal(retitled.newSnapshots, 1);
  assert.equal(retitled.newUnits, 0);
  const switched = (await service.search({ ...request, query: 'feature branch' })).hits[0];
  assert.equal(switched.sourceRef, hit.sourceRef);
  assert.equal(switched.pathState, 'off_selected_path');
  assert.notEqual(switched.snapshotRef, hit.snapshotRef);
  assert.equal((await service.search({ ...request, query: 'feature branch', includeHistory: true })).hits.length, 1);

  // Metadata is part of revision identity even when projected body is unchanged.
  conversation.mapping.short.message.metadata = { revision: 2, custom: 'retained' };
  await write();
  const metadataOnly = await service.importExport({ ...request, sourcePath });
  assert.equal(metadataOnly.newSnapshots, 1);
  assert.equal(metadataOnly.newUnits, 1);
  assert.notEqual((await service.search({ ...request, query: 'feature branch' })).hits[0].sourceRef, hit.sourceRef);

  // A later incomplete export never erases previously observed evidence.
  delete conversation.mapping.short;
  conversation.mapping.root.children = ['long'];
  await write();
  await service.importExport({ ...request, sourcePath });
  assert.equal((await service.search({ ...request, query: 'feature branch' })).hits.length, 0);
  assert.equal((await service.search({ ...request, query: 'feature branch', includeHistory: true })).hits.length, 2);
  assert.deepEqual((await service.readOriginal({ ...request, snapshotRef: hit.snapshotRef })).raw, original.raw);

  await fs.writeFile(sourcePath, '[{"id":"broken"},');
  await assert.rejects(service.importExport({ ...request, sourcePath }), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
  assert.equal((await service.search({ ...request, query: 'cobalt' })).hits.length, 1);

  // Revocation between candidate retrieval and response emission denies output.
  let checks = 0;
  const revoked = createInferenceHistoryService({ vaultRoot, verifyPrivateVault, resolveAccess: async (input) => {
    const access = await resolveAccess(input);
    checks += 1;
    return checks > 1 ? null : access;
  } });
  await assert.rejects(revoked.search({ ...request, query: 'cobalt' }), { code: 'ERR_INFERENCE_HISTORY_DENIED' });

  // A policy epoch change before commit rolls an import back.
  checks = 0;
  const changing = createInferenceHistoryService({ vaultRoot, verifyPrivateVault, resolveImportSource, resolveAccess: async (input) => {
    const access = await resolveAccess(input);
    return { ...access, policyEpoch: String(++checks) };
  } });
  conversation.mapping.long.message.content.parts = ['uncommitted moonstone'];
  await write();
  await assert.rejects(changing.importExport({ ...request, sourcePath }), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  assert.equal((await service.search({ ...request, query: 'moonstone' })).hits.length, 0);

  const deletion = await service.deleteRecord({ ...request, recordRef: hit.recordRef });
  assert.equal(deletion.tombstoned, true);
  assert.equal(deletion.originalArchiveRetainedByCaller, true);
  assert.equal(deletion.externalBackupsErased, false);
  assert.equal((await service.search({ ...request, query: 'cobalt', includeHistory: true })).hits.length, 0);
  assert.equal(await service.readOriginal({ ...request, snapshotRef: hit.snapshotRef }), null);
  const retry = await service.importExport({ ...request, sourcePath });
  assert.equal(retry.tombstonedRecords, 1);
  assert.equal((await service.search({ ...request, query: 'moonstone', includeHistory: true })).hits.length, 0);
  assert.equal((await service.search({ ...request, requestContext: 'foreign', query: 'feature branch' })).hits.length, 1);

  // Codex tasks retain independent identity, unknown selected paths, raw items,
  // and gated manifest links without granting filesystem authority.
  sourcePath = path.join(root, 'semantic.zip');
  const task = { id: 'conversation', title: 'Synthetic Codex evidence', archived: false,
    turns: [{ id: 'turn-one', previous_turn_id: 'outside-export', role: 'assistant',
      branch: 'feature/synthetic', turn_status: 'completed',
      input_items: [{ type: 'message', content: [{ type: 'input_text', text: 'quartz task input' }] }],
      output_items: [{ type: 'patch', output_diff: 'quartz patch output', asset_pointer: 'attachment://sample' }] }] };
  const manifest = { export_files: [{ path: 'codex.json', size_bytes: Buffer.byteLength(JSON.stringify([task])) },
    { path: 'absent.dat', size_bytes: 3 }], logical_files: { tasks: { files: ['codex.json'], sharded: false } } };
  const names = { 'absent.dat': 'Synthetic attachment label' };
  await fs.writeFile(sourcePath, zipSync({
    'codex.json': strToU8(JSON.stringify([task])),
    'export_manifest.json': strToU8(JSON.stringify(manifest)),
    'conversation_asset_file_names.json': strToU8(JSON.stringify(names)) }));
  const taskImport = await service.importExport(request);
  assert.equal(taskImport.tasks, 1);
  assert.equal(taskImport.conversations, 0);
  assert.equal(taskImport.records, 1);
  assert.equal(taskImport.complete, false);
  assert.equal(taskImport.memberLinkStates.linked_member, 2);
  assert.equal(taskImport.memberLinkStates.not_in_selected_input, 2);
  const taskHit = (await service.search({ ...request, query: 'quartz' })).hits[0];
  assert.equal(taskHit.evidenceKind, 'exported_codex_task');
  assert.equal(taskHit.pathState, 'unknown');
  assert.notEqual(taskHit.recordRef, hit.recordRef);
  assert.equal(taskHit.sourceDetails.branch, 'feature/synthetic');
  const taskOriginal = await service.readOriginal({ ...request, snapshotRef: taskHit.snapshotRef });
  assert.deepEqual(taskOriginal.raw, task);
  assert.equal(taskOriginal.diagnostics[0].code, 'previous_turn_not_in_export');
  assert.equal(taskOriginal.assetReferences[0].pointer, 'attachment://sample');
  const memberRequest = { ...request, importRef: taskImport.importRef, member: 'export_manifest.json' };
  const memberEvidence = await service.readMemberEvidence(memberRequest);
  assert.deepEqual(memberEvidence.raw, manifest);
  assert.equal(memberEvidence.filesystemAuthority, 'none');
  await assert.rejects(searchOnly.readMemberEvidence(memberRequest), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  await service.deleteRecord({ ...request, recordRef: taskHit.recordRef });
  assert.equal(await service.readMemberEvidence(memberRequest), null);
  assert.equal((await service.search({ ...request, query: 'quartz' })).hits.length, 0);
  assert.equal((await service.importExport(request)).repeated, true);

  const auditText = JSON.stringify(audit);
  for (const value of [secret, 'cobalt', 'feature branch', sourcePath, 'Updated title']) assert.ok(!auditText.includes(value));
  assert.ok(audit.some((row) => row.outcome === 'denied'));
  assert.throws(() => createInferenceHistoryService({ vaultRoot }), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  console.log('Inference history scoped storage, revisions, search, revocation and deletion passed.');
} finally { await rmDirRecursive(root); }
