import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createInferenceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
const root = await fs.realpath(await makeTempDir('poc-history-reader-'));
const vaultRoot = path.join(root, 'vault'), sourcePath = path.join(root, 'authored.json');
await fs.mkdir(vaultRoot, { mode: 0o700 });
const request = { requestContext: 'owned', partition: 'own' };
const access = { principalId: 'fixture', tenantId: 'fixture', ownerType: 'individual', ownerId: 'fixture',
  sourceScope: 'authored-fixture', policyEpoch: '1', allowed: true };
const options = { vaultRoot, verifyPrivateVault: () => true, resolveAccess: input =>
  input.requestContext === 'owned' && input.partition === 'own' ? access : null,
resolveImportSource: () => ({ path: sourcePath, policyEpoch: '1' }) };
const service = createInferenceHistoryService(options);
const time = Date.parse('2026-04-15T12:00:00.000Z') / 1000;
const message = (id, parent, role, text, extra = {}) => ({ id, parent,
  message: { id: `message-${id}`, author: { role }, create_time: time,
    content: { content_type: 'text', parts: [text] }, ...extra } });
const conversation = { id: 'alpha', title: 'Authored context', current_node: 'end', mapping: {
  start: message('start', null, 'user', 'Please find the visible example.'),
  thought: message('thought', 'start', 'assistant', 'hidden thoughtword', { content: { content_type: 'thoughts', parts: ['hidden thoughtword'] } }),
  analysis: message('analysis', 'thought', 'assistant', 'hidden analysisword', { channel: 'analysis' }),
  tool: message('tool', 'analysis', 'tool', 'hidden toolword'),
  directed: message('directed', 'tool', 'assistant', 'hidden directedword', { recipient: 'tool-handler' }),
  hidden: message('hidden', 'directed', 'assistant', 'hidden concealedword', { metadata: { is_visually_hidden_from_conversation: true } }),
  target: message('target', 'hidden', 'assistant', `${'padding '.repeat(350)}needle visible response sandbox:/mnt/data/authored-demo.html`, { channel: 'final' }),
  end: message('end', 'target', 'user', 'Thank you.'),
  alternative: message('alternative', 'start', 'user', 'offbranch cobalt')
} };
const branch = { ...structuredClone(conversation), id: 'beta', title: 'Authored branch' };
const independent = { id: 'gamma', title: 'Independent equal text', current_node: 'independent', mapping: {
  independent: message('independent', null, 'user', conversation.mapping.target.message.content.parts[0])
} };
try {
  await fs.writeFile(sourcePath, JSON.stringify([conversation, branch, independent]));
  await service.importExport(request);
  const found = await service.search({ ...request, query: 'needle', snippetChars: 120 });
  assert.equal(found.totalMatches, 2);
  assert.equal(found.totalMatchedUnits, 3);
  assert.equal(found.complete, true);
  assert.deepEqual(found.query.tokens, ['needle']);
  assert.equal(found.query.semantics, 'literal_word_AND');
  assert.equal(found.coverage.records, 3);
  assert.equal(found.coverage.exportCutoff, null);
  assert.match(found.coverage.indexedMessageBounds.first, /^2026-04-15/);
  assert.equal(found.limits.snippetChars, 120);
  for (const hit of found.hits) {
    assert.ok(hit.text.includes('needle'));
    assert.ok(hit.text.length <= 120);
    assert.ok(hit.snippet.start > 0);
    assert.equal(hit.artifacts[0].availability, 'unknown');
    assert.equal(hit.artifacts[0].filesystemAuthority, 'none');
  }
  const shared = found.hits.find(hit => hit.groupCount === 2);
  assert.ok(shared);
  assert.equal(new Set(shared.provenance.references.map(ref => ref.recordRef)).size, 2);
  assert.equal(shared.provenance.totalReferences, 2);
  assert.ok(shared.provenance.references.every(ref => ref.occurrences.length === 1));
  const refs = await service.readReferences({ ...request, sourceRef: shared.sourceRef, top: 1 });
  assert.equal(refs.totalReferences, 2);
  assert.equal(refs.references.length, 1);
  assert.equal(refs.nextOffset, 1);
  const nextRefs = await service.readReferences({ ...request, sourceRef: shared.sourceRef, offset: 1, top: 1 });
  assert.notEqual(refs.references[0].sourceRef, nextRefs.references[0].sourceRef);
  assert.equal((await service.search({ ...request, query: 'needle', top: 1 })).nextOffset, 1);
  assert.equal((await service.search({ ...request, query: 'needle', top: 1, offset: 1 })).hits.length, 1);
  assert.equal((await service.search({ ...request, query: 'needle', role: 'user' })).totalMatches, 1);
  assert.equal((await service.search({ ...request, query: 'needle', role: 'assistant' })).hits[0].groupCount, 2);
  assert.equal((await service.search({ ...request, query: 'needle', dateFrom: '2026-04-16' })).hits.length, 0);
  assert.equal((await service.search({ ...request, query: 'needle', dateTo: '2026-04-15' })).totalMatches, 2);
  assert.equal((await service.search({ ...request, query: 'cobalt', pathState: 'on_selected_path' })).hits.length, 0);
  assert.ok((await service.search({ ...request, query: 'cobalt', pathState: 'off_selected_path' })).hits.length);
  for (const query of ['thoughtword', 'analysisword', 'toolword', 'directedword', 'concealedword']) {
    const empty = await service.search({ ...request, query });
    assert.deepEqual(empty.hits, []);
    assert.equal(empty.totalMatches, 0);
    assert.match(empty.caveat, /never-discussed is not established/);
  }
  const context = await service.readContext({ ...request, sourceRef: shared.sourceRef, snapshotRef: shared.snapshotRef });
  assert.equal(context.totalVisibleMessages, 3);
  assert.equal(context.messages.length, 3);
  assert.deepEqual(context.messages.map(value => value.role), ['user', 'assistant', 'user']);
  assert.ok(context.messages.every(value => value.text.length <= 1200));
  assert.ok(!JSON.stringify(context).includes('hidden'));
  assert.equal(context.messages[1].projection.truncated, true);
  assert.equal(context.messages[1].artifacts[0].reference, 'sandbox:/mnt/data/authored-demo.html');
  const contextPage = await service.readContext({ ...request, sourceRef: shared.sourceRef, snapshotRef: shared.snapshotRef, offset: 0, top: 1 });
  assert.equal(contextPage.nextOffset, 1);
  assert.equal((await service.readContext({ ...request, sourceRef: shared.sourceRef, snapshotRef: shared.snapshotRef, offset: 1, top: 1 })).messages[0].anchor, true);
  const original = await service.readOriginal({ ...request, snapshotRef: shared.snapshotRef });
  assert.deepEqual(original.raw, shared.title === branch.title ? branch : conversation);
  assert.ok(original.rawJson.includes('hidden analysisword'), 'raw remains explicit opt-in unchanged evidence');
  await assert.rejects(service.search({ ...request, query: 'needle', role: 'tool' }), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
  await assert.rejects(service.search({ ...request, query: 'needle', dateFrom: '2026-02-30' }), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
  await assert.rejects(service.readContext({ ...request, sourceRef: shared.sourceRef, snapshotRef: shared.snapshotRef, messageChars: 4001 }), { code: 'ERR_INFERENCE_HISTORY_INPUT' });
  await assert.rejects(service.readContext({ ...request, requestContext: 'other', sourceRef: shared.sourceRef, snapshotRef: shared.snapshotRef }), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  const searchOnly = createInferenceHistoryService({ ...options, resolveAccess: input => input.action === 'search' ? access : null });
  await assert.rejects(searchOnly.readContext({ ...request, sourceRef: shared.sourceRef, snapshotRef: shared.snapshotRef }), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  let deleted = false;
  const raced = createInferenceHistoryService({ ...options, audit: async ({ action }) => {
    if (action === 'read_context' && !deleted) { deleted = true; await service.deleteRecord({ ...request, recordRef: shared.recordRef }); }
  } });
  await assert.rejects(raced.readContext({ ...request, sourceRef: shared.sourceRef, snapshotRef: shared.snapshotRef }), { code: 'ERR_INFERENCE_HISTORY_DENIED' });
  console.log('Visible context, strict type/channel exclusion, snippets, filters, exact branch groups, provenance, pagination and tombstones passed.');
} finally { await rmDirRecursive(root); }