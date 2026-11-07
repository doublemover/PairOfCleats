import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createRepositoryQuestionFixture } from '../../helpers/repository-question-fixture.js';
import { createRepositoryAnswerInput } from '../../helpers/repository-answer-input.js';
import { createRepositoryAnswerRunner } from '../../../src/integrations/tooling/repository-answer.js';
import { createRepositoryQuestionService } from '../../../src/semantic/questions/execute.js';
import { compileAdmittedQueryAnswer, inspectAnswerRevision } from '../../../src/context-pack/answers/render.js';
import { applyAnswerPatch } from '../../../src/context-pack/answers/reconcile.js';
import { assertRepositoryAnswer } from '../../../src/contracts/validators/repository-answer.js';
import { ANSWER_EVIDENCE_VERSION } from '../../../src/contracts/schemas/answer-evidence.js';
import { runRepositoryAnswerCli } from '../../../tools/analysis/repository-answer.js';
import { runRepositoryAnswerTool } from '../../../tools/mcp/tools/handlers/repository-answer.js';
import { handleRepositoryAnswerRoute } from '../../../tools/api/router/repository-answer.js';
import { REPOSITORY_ANSWER_TOOL_SCHEMA } from '../../../src/contracts/schemas/repository-answer.js';
import { compileSchema, createAjv } from '../../../src/shared/validation/ajv-factory.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('semantic/questions/answer-admission/')[1];
assert.ok(['live-query-and-quotes', 'publication-and-failures', 'request-and-history', 'transport-parity'].includes(mode));
const collect = async (run, request) => {
  const pages = []; let cursor = request.query.cursor || null;
  for (let index = 0; index < 128; index++) {
    const page = assertRepositoryAnswer('result', await run({ ...request, query: { ...request.query, cursor } }));
    pages.push(page);
    assert.equal(page.serializedBytes, Buffer.byteLength(JSON.stringify(page)) + 1);
    assert.ok(page.serializedBytes <= 128 * 1024);
    cursor = page.continuation;
    if (!cursor) return pages;
  }
  assert.fail('small admitted answer failed to finish the original query continuation');
};
const tuples = pages => pages.flatMap(page => page.answer.inputs.queryReceipt.rows).map(row => row.bindings.map(binding => binding.ref.localId));
const fixture = await createRepositoryQuestionFixture();
try {
  const request = { schemaVersion: ANSWER_EVIDENCE_VERSION, mode: 'compile', questionRef: { id: 'live-call-question', revision: '1' },
    query: fixture.request, quoteRefs: [fixture.ref(4)] };
  if (mode === 'live-query-and-quotes') {
    await fs.writeFile(fixture.original, fixture.bytes.toString('utf8').replace('0', '9'));
    const pages = await collect(createRepositoryAnswerRunner(), request);
    assert.deepEqual(tuples(pages), [[0, 2, 4], [0, 8, 4]]);
    for (const page of pages) {
      const answer = page.answer, quote = answer.inputs.quotations[0];
      assert.deepEqual(inspectAnswerRevision(answer), answer);
      assert.equal(quote.source.sourceHash, fixture.source.byteHash); assert.equal(quote.text, '0');
      const mapped = answer.fragments.find(fragment => fragment.quoteSpan);
      assert.equal(answer.text.slice(...mapped.quoteSpan), '0');
      assert.equal(answer.world.sourceSnapshotId, fixture.artifact.cursorScope);
      assert.equal(answer.qualification.programSemantics, 'not-established');
      assert.ok(page.work.sourceElapsedMs >= 0); assert.ok(page.work.totalElapsedMs >= page.work.renderElapsedMs);
    }
    const retainedPath = path.join(fixture.indexDir, 'semantic', 'semantic-sources', fixture.source.byteHash + '.utf8');
    const original = await fs.readFile(retainedPath);
    try {
      await fs.writeFile(retainedPath, original.toString('utf8').replace('0', '9'));
      await assert.rejects(createRepositoryAnswerRunner()(request), { code: 'ERR_SEMANTIC_INTEGRITY' });
    } finally { await fs.writeFile(retainedPath, original); }
  } else if (mode === 'publication-and-failures') {
    const service = createRepositoryQuestionService(); let prepared, failClose = true, closes = 0, pendingFailure = null, cancelOnClose = null;
    const queryRunner = async (query, options) => {
      assert.equal(options.deferPublication, true);
      prepared = await service({ store: fixture.artifact, request: query, signal: options.signal, deferPublication: options.deferPublication });
      return prepared;
    };
    const store = { ...fixture.artifact, getSourceSpans: async (...args) => {
      if (pendingFailure) throw pendingFailure;
      return fixture.artifact.getSourceSpans(...args);
    } };
    const run = createRepositoryAnswerRunner({ queryRunner, resolveIndexDir: async () => fixture.indexDir,
      openStore: async () => ({ store, close: () => { closes++; if (failClose) throw 0; cancelOnClose?.abort(); } }) });
    const bounded = { ...request, query: { ...request.query, limits: { records: 1 } } };
    await assert.rejects(run(bounded, { userConfig: {} }), error => error === 0);
    assert.ok(prepared.cursor); assert.equal(service.continuationStats().cursors, 0, 'failed actual cleanup cannot publish the prepared query cursor');
    await assert.rejects(service({ store: fixture.artifact, request: { ...bounded.query, cursor: prepared.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    failClose = false;
    const delivered = await run(bounded, { userConfig: {} });
    assert.equal(delivered.continuation, prepared.cursor, 'the upstream opaque cursor is preserved exactly');
    assert.ok(service.continuationStats().cursors > 0);
    cancelOnClose = new AbortController();
    await assert.rejects(run({ ...bounded, query: { ...bounded.query, cursor: delivered.continuation } }, { userConfig: {}, signal: cancelOnClose.signal }), { name: 'AbortError' });
    assert.notEqual(prepared.cursor, delivered.continuation);
    await assert.rejects(service({ store: fixture.artifact, request: { ...bounded.query, cursor: prepared.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    cancelOnClose = null;
    let settled = false;
    pendingFailure = Object.assign(new Error('original source work'), { cacheOwnershipPending: true, cacheOwnershipReleased: () => settled });
    const retained = await run(bounded, { userConfig: {} }).then(() => assert.fail('pending source operation was hidden'), error => error);
    assert.equal(retained.cacheOwnershipReleased(), false); settled = true; assert.equal(retained.cacheOwnershipReleased(), true);
    pendingFailure = null;
    let replay, cursor = delivered.continuation;
    for (let index = 0; index < 128; index++) {
      replay = await service({ store: fixture.artifact, request: { ...bounded.query, cursor } });
      if (replay.rows.length) break;
      assert.ok(replay.cursor); cursor = replay.cursor;
    }
    assert.equal(replay.rows.length, 1, 'the previously delivered cursor still reaches its next meaningful tuple');
    const expectedDeclaration = delivered.answer.inputs.queryReceipt.rows.length ? 8 : 2;
    assert.deepEqual(replay.rows[0].bindings.map(binding => binding.ref.localId), [0, expectedDeclaration, 4]); assert.ok(closes >= 4);
    service.dispose();
  } else if (mode === 'request-and-history') {
    let calls = 0;
    const blocked = createRepositoryAnswerRunner({ queryRunner: () => { calls++; assert.fail('unadmitted request reached the live query'); } });
    for (const extra of [{ admission: 'checked' }, { queryReceipt: createRepositoryAnswerInput().queryReceipt }, { narrative: 'All paths are safe.' }]) {
      await assert.rejects(blocked({ ...request, ...extra }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
    }
    let getters = 0;
    await assert.rejects(blocked({ ...request, get query() { getters++; return fixture.request; } }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
    assert.equal(getters, 0); assert.equal(calls, 0);
    const unsupported = structuredClone(request); unsupported.query.question.where.all[0].predicate = 'unavailablePredicate';
    await assert.rejects(blocked(unsupported), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' }); assert.equal(calls, 0);
    const historical = compileAdmittedQueryAnswer(createRepositoryAnswerInput());
    const toolSchema = compileSchema(createAjv({ strict: true, allErrors: true }), REPOSITORY_ANSWER_TOOL_SCHEMA);
    for (const valid of [request, { ...request, mode: 'compare', previous: historical }, { schemaVersion: ANSWER_EVIDENCE_VERSION, mode: 'inspect', revision: historical }]) {
      assert.equal(toolSchema(valid), true); assert.doesNotThrow(() => assertRepositoryAnswer('request', valid));
      const invalid = { ...valid, admission: 'checked' };
      assert.equal(toolSchema(invalid), false); assert.throws(() => assertRepositoryAnswer('request', invalid));
    }
    const inspection = await blocked({ schemaVersion: ANSWER_EVIDENCE_VERSION, mode: 'inspect', revision: historical });
    assert.equal(inspection.inspectedDigest, historical.digest);
    assert.equal(inspection.currentSourceAdmission, 'not-established-by-content-inspection'); assert.equal(calls, 0);
    const damaged = structuredClone(historical); damaged.text += 'Unmapped conclusion.';
    await assert.rejects(blocked({ schemaVersion: ANSWER_EVIDENCE_VERSION, mode: 'inspect', revision: damaged }), { code: 'ERR_ANSWER_EVIDENCE_CONTRACT' });
    const run = createRepositoryAnswerRunner(), pages = await collect(run, request), previous = pages[pages.length - 1].answer;
    const comparison = await run({ ...request, mode: 'compare', questionRef: { ...request.questionRef, revision: '2' }, previous });
    assert.equal(comparison.patch.baseDigest, previous.digest); assert.equal(comparison.patch.next.questionRef.revision, '2');
    assert.deepEqual(applyAnswerPatch(previous, comparison.patch), comparison.patch.next);
    await assert.rejects(blocked({ ...request, mode: 'compare', previous: historical }), { code: 'ERR_ANSWER_BASE_MISMATCH' });
    assert.equal(calls, 0, 'wrong historical scope is rejected before hydration');
  } else {
    const bounded = { ...request, query: { ...request.query, limits: { records: 1 } } }, requestFile = path.join(fixture.root, 'answer.json');
    await fs.writeFile(requestFile, JSON.stringify(bounded)); let written = '';
    const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) { written += chunk; setImmediate(done); } });
    await runRepositoryAnswerCli([process.execPath, 'repository-answer.js', '--request', requestFile, '--all'], { output });
    const cli = written.trim().split('\n').map(line => JSON.parse(line)), mcp = await collect(runRepositoryAnswerTool, bounded);
    assert.deepEqual(tuples(cli), [[0, 2, 4], [0, 8, 4]]); assert.deepEqual(tuples(mcp), tuples(cli));
    const route = async input => {
      const req = new EventEmitter(), res = new EventEmitter(); req.aborted = false; res.destroyed = false; res.writableEnded = false;
      let response, resolutions = 0;
      res.writeHead = status => { res.statusCode = status; }; res.end = body => { response = JSON.parse(body); res.writableEnded = true; };
      await handleRepositoryAnswerRoute({ req, res, corsHeaders: {}, parseJsonBody: async () => input,
        resolveRepo: async () => { resolutions++; return fixture.root; } });
      assert.equal(res.statusCode, 200); assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
      if (input.mode === 'inspect') assert.equal(resolutions, 0);
      return response.result;
    };
    const api = await collect(route, bounded); assert.deepEqual(tuples(api), tuples(cli));
    const inspected = await route({ schemaVersion: ANSWER_EVIDENCE_VERSION, mode: 'inspect', revision: api[0].answer });
    assert.equal(inspected.currentSourceAdmission, 'not-established-by-content-inspection');
    assert.equal(inspected.inspectedDigest, api[0].answer.digest);
  }
} finally { await fixture.cleanup(); }
console.log('Live answer admission preserves source authority, original cleanup, publication and transport parity.');
