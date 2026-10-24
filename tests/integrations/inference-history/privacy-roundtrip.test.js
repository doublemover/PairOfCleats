import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createInferenceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { projectArtifact, ARTIFACT_PROJECTION_VERSION } from '../../../src/integrations/inference-history/artifact-projection.js';
import { planArchiveUnitSpans } from '../../../src/integrations/inference-history/archive-unit-spans.js';
import { openHistoryStore } from '../../../src/integrations/inference-history/store.js';
import { digest } from '../../../src/integrations/inference-history/common.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = await fs.realpath(await makeTempDir('poc-history-privacy-roundtrip-'));
const vaultRoot = path.join(root, 'vault'), input = path.join(root, 'archive.zip');
await fs.mkdir(vaultRoot, { mode: 0o700 });
const artifact = projectArtifact({ text: 'PrivateParcel artifact cobalt remainder.', sourceSha256: 'a'.repeat(64),
  locator: 'src/LocatorBeacon.js', kind: 'code' });
const conversation = { id: 'conversation', title: 'ConversationBeacon', current_node: 'a', mapping: {
  a: { id: 'a', parent: null, children: [], message: { id: 'permitted-message', author: { role: 'user' },
    content: { content_type: 'text', parts: ['PrivateParcel conversation cobalt remainder.'] } } }
} };
const task = { id: 'task', title: 'TaskBeacon', archived: false, turns: [{ id: 'turn', role: 'user',
  branch: 'feature/permitted-branch', input_items: [{ type: 'message',
    content: [{ type: 'input_text', text: 'PrivateParcel task cobalt remainder.' }] }] }] };
await fs.writeFile(input, zipSync({ 'conversations.json': strToU8(JSON.stringify([conversation])),
  'codex.json': strToU8(JSON.stringify([task])), 'artifacts-0001.json': strToU8(JSON.stringify(artifact)) }));
const access = { allowed: true, principalId: 'fixture', tenantId: 'fixture', ownerType: 'individual',
  ownerId: 'fixture', sourceScope: 'synthetic', policyEpoch: '1' };
let human = true;
const service = createInferenceHistoryService({ vaultRoot, verifyPrivateVault: () => true,
  audit: () => ({ persisted: true }), resolveImportSource: () => ({ path: input, policyEpoch: '1' }),
  resolveAccess: () => access, resolveOwnerAccess: () => human ? { ...access, channel: 'human' } : null });
const request = { requestContext: 'fixture', partition: 'own' };
const partitionKey = digest(JSON.stringify(['inference-history', access.tenantId, access.ownerType, access.ownerId, access.sourceScope]));
const readUnit = async sourceRef => {
  const db = await openHistoryStore(vaultRoot, partitionKey, { verifyPrivateVault: () => true });
  try { return db.prepare('SELECT id,text,metadata FROM units WHERE id=?').get(sourceRef); }
  finally { db.close(); }
};
const violations = [];
try {
  const imported = await service.importExport(request);
  assert.equal(imported.newUnits, 3);
  const initial = await service.search({ ...request, query: 'cobalt' });
  assert.equal(initial.hits.length, 3);
  assert.equal((await service.search({ ...request, query: 'LocatorBeacon', searchField: 'path' })).hits.length, 1);
  for (const before of initial.hits) {
    const policy = { ...request, recordRef: before.recordRef, excluded: false, redactions: ['PrivateParcel'], annotation: '' };
    human = false;
    await assert.rejects(service.ownerSetPrivacy(policy), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
    human = true;
    const changed = await service.ownerSetPrivacy(policy);
    assert.equal(changed.changed, true);
    assert.notEqual(changed.index.generationRef, (before.index ?? initial.index).generationRef);
    assert.equal((await service.ownerSetPrivacy(policy)).changed, false);
    await assert.rejects(service.search({ ...request, query: 'cobalt', expectedGeneration: initial.index.generationRef }),
      { code: 'ERR_INFERENCE_HISTORY_STALE' });
    const redacted = (await service.search({ ...request, query: 'cobalt' })).hits.find(hit => hit.sourceRef === before.sourceRef);
    assert.ok(redacted.text.includes('[REDACTED owner]'));
    assert.ok(!JSON.stringify(redacted).includes('PrivateParcel'));
    assert.equal(redacted.messageId, null);
    const unit = await readUnit(before.sourceRef);
    const metadata = JSON.parse(unit.metadata);
    const expectedDetails = before.evidenceKind === 'recovered_artifact' ? { projectionVersion: ARTIFACT_PROJECTION_VERSION } : {};
    if (JSON.stringify(metadata.sourceDetails) !== JSON.stringify(expectedDetails)) violations.push(`${before.evidenceKind}: redacted identity`);
    if (before.evidenceKind === 'recovered_artifact') {
      try {
        const spans = planArchiveUnitSpans(unit, [unit], { chunkChars: 1000, overlapChars: 100 });
        assert.ok(spans.length > 0);
        assert.ok(spans.every(span => !span.text.includes('PrivateParcel')));
      } catch (error) { violations.push(`artifact planner: ${error.code || error.message}`); }
      assert.equal((await service.search({ ...request, query: 'LocatorBeacon', searchField: 'path' })).hits.length, 0);
    }
    const cleared = await service.ownerSetPrivacy({ ...policy, redactions: [] });
    assert.notEqual(cleared.index.generationRef, changed.index.generationRef);
    const restored = (await service.search({ ...request, query: 'PrivateParcel' })).hits.find(hit => hit.sourceRef === before.sourceRef);
    assert.ok(restored);
    assert.equal(restored.text, before.text);
    assert.equal(restored.ownerRedacted, false);
    if (JSON.stringify(restored.sourceDetails) !== JSON.stringify(before.sourceDetails)) violations.push(`${before.evidenceKind}: restored provenance`);
    if (restored.messageId !== before.messageId) violations.push(`${before.evidenceKind}: restored message`);
    if (before.evidenceKind === 'recovered_artifact') {
      if ((await service.search({ ...request, query: 'LocatorBeacon', searchField: 'path' })).hits.length !== 1) {
        violations.push('artifact discovery: restored locator');
      }
    }
  }
  const taskHit = initial.hits.find(hit => hit.evidenceKind === 'exported_codex_task');
  const current = (await service.search({ ...request, query: 'cobalt' })).index;
  const writeRaw = async raw => {
    const db = await openHistoryStore(vaultRoot, partitionKey, { create: true, verifyPrivateVault: () => true });
    try { db.prepare('UPDATE snapshots SET raw_json=? WHERE id=?').run(JSON.stringify(raw), taskHit.snapshotRef); }
    finally { db.close(); }
  };
  for (const raw of [{ ...task, archived: 'invalid' }, { ...task, turns: [{ ...task.turns[0], id: 'foreign-node' }] }]) {
    await writeRaw(raw);
    await assert.rejects(service.ownerSetPrivacy({ ...request, recordRef: taskHit.recordRef,
      excluded: true, redactions: ['PrivateParcel'], annotation: 'must roll back' }), { code: 'ERR_INFERENCE_HISTORY_STORAGE' });
    await writeRaw(task);
    const inventory = await service.ownerInventory(request);
    assert.equal(inventory.index.generationRef, current.generationRef);
    const record = inventory.records.find(row => row.recordRef === taskHit.recordRef);
    assert.equal(record.excluded, false);
    assert.deepEqual(record.redactions, []);
    assert.equal(record.annotation, '');
    assert.equal((await service.search({ ...request, query: 'PrivateParcel' })).hits.length, 3);
  }
  console.log(JSON.stringify({ privacyRoundtripViolations: violations }));
  assert.deepEqual(violations, []);
} finally {
  await rmDirRecursive(root);
}
console.log('Authorized privacy changes preserve artifact policy and restore permitted source metadata.');
