import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createRepositoryQuestionFixture } from '../../helpers/repository-question-fixture.js';
import { createRepositoryAnswerRunner } from '../../../src/integrations/tooling/repository-answer.js';
import { createRepositoryQuestionService } from '../../../src/semantic/questions/execute.js';
import { applyEvidenceDelivery } from '../../../src/context-pack/delivery/apply.js';
import { assertRepositoryAnswer } from '../../../src/contracts/validators/repository-answer.js';
import { runRepositoryAnswerCli } from '../../../tools/analysis/repository-answer.js';
import { runRepositoryAnswerTool } from '../../../tools/mcp/tools/handlers/repository-answer.js';
import { handleRepositoryAnswerRoute } from '../../../tools/api/router/repository-answer.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('semantic/questions/answer-delivery/')[1];
assert.ok(['source-and-untrusted-base', 'publication-and-overflow', 'transport-parity'].includes(mode));
const fixture = await createRepositoryQuestionFixture();
const questionRef = { id: 'delivered-calls', revision: '1' };
const request = { schemaVersion: 1, mode: 'deliver', questionRef, query: { ...fixture.request, limits: { records: 1 } }, quoteRefs: [fixture.ref(4)], quoteRoles: [['caller-source']],
  delivery: { schemaVersion: 1, contextRef: { consumerId: 'client-reported-name', sessionId: 'client-session', contextEpoch: 0, windowRevision: 0,
    taskRef: questionRef, branchId: 'client-branch', scopeDigest: 'a'.repeat(64), policyDigest: 'b'.repeat(64), worldRef: fixture.request.question.world },
  expectedBaseDigest: 'c'.repeat(64), requiredExactSourceRoles: ['caller-source'], unresolvedRoles: ['configuration-binding'], continuation: null,
  limits: { packetBytes: 131072, reconstructedBytes: 131072 } } };
const checked = result => {
  assertRepositoryAnswer('result', result); assert.equal(result.kind, 'repository-answer-delivery'); assert.equal(result.plan.mode, 'full');
  assert.equal(result.contextAuthority, 'client-reported-no-visibility-attestation'); assert.equal(result.availability, 'self-contained-full-pack');
  assert.equal(result.serializedBytes, Buffer.byteLength(JSON.stringify(result)) + 1); assert.ok(result.serializedBytes <= 131072);
  return result;
};
const rows = pages => pages.flatMap(page => {
  const window = applyEvidenceDelivery(null, page.plan), descriptor = window.manifest.entries.find(entry => entry.representation === 'qualified-answer');
  return JSON.parse(window.bodies.find(body => body.id === descriptor.id).text).inputs.queryReceipt.rows;
});
const collect = async run => {
  const pages = []; let cursor = null;
  for (let index = 0; index < 128; index++) {
    const page = checked(await run({ ...request, query: { ...request.query, cursor } })); pages.push(page);
    assert.equal(page.plan.target.continuation?.cursor ?? null, page.continuation);
    if (!page.continuation) return pages; cursor = page.continuation;
  }
  assert.fail('full evidence delivery did not finish its original query continuation');
};
try {
  if (mode === 'source-and-untrusted-base') {
    const run = createRepositoryAnswerRunner(), page = checked(await run(request)), window = applyEvidenceDelivery(null, page.plan);
    assert.equal(page.plan.fallbackReason, 'UnknownBase'); assert.deepEqual(page.plan.operations.retain, []);
    assert.equal(page.plan.bodies.length, page.plan.target.entries.length);
    const source = window.manifest.entries.find(entry => entry.representation === 'exact-source');
    assert.equal(window.bodies.find(body => body.id === source.id).text, '0'); assert.equal(source.source.sourceHash, fixture.source.byteHash);
    assert.deepEqual(window.manifest.unresolvedRoles, ['configuration-binding']); assert.equal(window.manifest.cost.fullPromptTokens, null);
    let calls = 0;
    const blocked = createRepositoryAnswerRunner({ queryRunner: () => { calls++; assert.fail('invalid delivery reached query hydration'); } });
    for (const mutate of [r => { r.delivery.visible = true; }, r => { r.delivery.contextRef.worldRef = { ...r.delivery.contextRef.worldRef, sourceSnapshotId: 'forged' }; },
      r => { r.delivery.contextRef.taskRef = { ...r.delivery.contextRef.taskRef, revision: 'other' }; }, r => { r.quoteRoles = []; }, r => { r.retention = { expectedBaseDigest: null }; }]) {
      const invalid = structuredClone(request); mutate(invalid); await assert.rejects(blocked(invalid), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
    }
    assert.equal(calls, 0);
  } else if (mode === 'publication-and-overflow') {
    const service = createRepositoryQuestionService(); let prepared;
    const run = createRepositoryAnswerRunner({ queryRunner: async (query, options) => {
      prepared = await service({ store: fixture.artifact, request: query, signal: options.signal, deferPublication: true }); return prepared;
    } });
    await assert.rejects(run({ ...request, delivery: { ...request.delivery, limits: { packetBytes: 1024, reconstructedBytes: 131072 } } }), { reason: 'MandatoryOverflow' });
    assert.ok(prepared.cursor);
    await assert.rejects(service({ store: fixture.artifact, request: { ...request.query, cursor: prepared.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    const badClose = createRepositoryAnswerRunner({ queryRunner: async (query, options) => {
      prepared = await service({ store: fixture.artifact, request: query, signal: options.signal, deferPublication: true }); return prepared;
    }, resolveIndexDir: async () => fixture.indexDir, openStore: async () => ({ store: fixture.artifact, close: async () => { throw 0; } }) });
    const rejected = await badClose(request).then(() => ({ failed: false }), error => ({ failed: true, error }));
    assert.equal(rejected.failed, true); assert.equal(rejected.error, 0);
    await assert.rejects(service({ store: fixture.artifact, request: { ...request.query, cursor: prepared.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    checked(await run(request)); service.dispose();
  } else {
    const file = path.join(fixture.root, 'deliver.json'); await fs.writeFile(file, JSON.stringify(request)); let written = '';
    const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) { written += chunk; setImmediate(done); } });
    await runRepositoryAnswerCli([process.execPath, 'repository-answer.js', '--request', file, '--all'], { output });
    const cli = written.trim().split('\n').map(line => checked(JSON.parse(line))), mcp = await collect(runRepositoryAnswerTool);
    const api = await collect(async input => {
      const req = new EventEmitter(), res = new EventEmitter(); req.aborted = false; res.destroyed = false; res.writableEnded = false; let response;
      res.writeHead = status => { res.statusCode = status; }; res.end = body => { response = JSON.parse(body); res.writableEnded = true; };
      await handleRepositoryAnswerRoute({ req, res, corsHeaders: {}, parseJsonBody: async () => input, resolveRepo: async () => fixture.root });
      assert.equal(res.statusCode, 200, JSON.stringify(response)); return response.result;
    });
    const tuples = pages => rows(pages).map(row => row.bindings.map(binding => binding.ref.localId));
    assert.deepEqual(tuples(cli), [[0, 2, 4], [0, 8, 4]]); assert.deepEqual(tuples(mcp), tuples(cli)); assert.deepEqual(tuples(api), tuples(cli));
  }
} finally { await fixture.cleanup(); }
console.log('Public answer delivery returns self-contained verified source packs without accepting visibility claims.');
