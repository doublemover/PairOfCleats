import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { createRepositoryQuestionFixture } from '../../helpers/repository-question-fixture.js';
import { createRepositoryAnswerRunner } from '../../../src/integrations/tooling/repository-answer.js';
import { createRetainedAnswerStore } from '../../../src/context-pack/answers/retention.js';
import { createRepositoryQuestionService } from '../../../src/semantic/questions/execute.js';
import { semanticHash } from '../../../src/index/semantic/identity.js';
import { getRepoCacheRoot } from '../../../src/shared/repo-paths.js';
import { publishSemanticPage } from '../../../src/semantic/page-publication.js';
import { assertRepositoryAnswer } from '../../../src/contracts/validators/repository-answer.js';
import { runRepositoryAnswerCli } from '../../../tools/analysis/repository-answer.js';
import { runRepositoryAnswerTool } from '../../../tools/mcp/tools/handlers/repository-answer.js';
import { handleRepositoryAnswerRoute } from '../../../tools/api/router/repository-answer.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('semantic/questions/answer-retention-admission/')[1];
assert.ok(['opt-in-and-history', 'late-result-and-publication', 'resume-and-cancellation', 'transport-retention'].includes(mode));
const fixture = await createRepositoryQuestionFixture();
const request = { schemaVersion: 1, mode: 'compile', questionRef: { id: 'persisted-question', revision: '1' }, query: { ...fixture.request, limits: { records: 1 } } };
const retainedRequest = { schemaVersion: 1, mode: 'retained', repoRoot: fixture.root, questionRef: request.questionRef };
const checked = result => { assertRepositoryAnswer('result', result); assert.equal(result.serializedBytes, Buffer.byteLength(JSON.stringify(result)) + 1); return result; };
const store = () => createRetainedAnswerStore({ repoRoot: fixture.root });
const collect = async (run, original) => {
  const pages = []; let input = original;
  for (let index = 0; index < 128; index++) {
    const page = checked(await run(input)); pages.push(page);
    assert.ok(page.retained); assert.equal(page.retained.answerDigest, page.answer.digest);
    if (!page.continuation) return pages;
    input = { ...original, query: { ...original.query, cursor: page.continuation }, retention: { expectedBaseDigest: page.retained.answerDigest } };
  }
  assert.fail('retained query did not finish its bounded original continuation');
};
const route = async input => {
  const req = new EventEmitter(), res = new EventEmitter(); req.aborted = false; res.destroyed = false; res.writableEnded = false;
  let response;
  res.writeHead = status => { res.statusCode = status; }; res.end = body => { response = JSON.parse(body); res.writableEnded = true; };
  await handleRepositoryAnswerRoute({ req, res, corsHeaders: {}, parseJsonBody: async () => input, resolveRepo: async () => fixture.root });
  assert.equal(res.statusCode, 200, JSON.stringify(response)); assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
  return checked(response.result);
};
try {
  const retainedRoot = path.join(getRepoCacheRoot(fixture.root), 'answers-v1');
  if (mode === 'opt-in-and-history') {
    const run = createRepositoryAnswerRunner();
    await run(request); await assert.rejects(fs.stat(retainedRoot), { code: 'ENOENT' });
    assert.equal((await run(retainedRequest)).status, 'empty');
    await assert.rejects(fs.stat(retainedRoot), { code: 'ENOENT' }, 'reading an absent optional store cannot create answer artifacts');
    const pages = await collect(run, { ...request, retention: { expectedBaseDigest: null } });
    assert.deepEqual(pages.flatMap(page => page.answer.inputs.queryReceipt.rows).map(row => row.bindings.map(binding => binding.ref.localId)), [[0, 2, 4], [0, 8, 4]]);
    const last = pages.at(-1), current = checked(await run(retainedRequest));
    assert.deepEqual(current.answer, last.answer); assert.equal(current.currentSourceAdmission, 'not-established-by-retention');
    const old = checked(await run({ ...retainedRequest, revisionReceipt: pages[0].retained }));
    assert.deepEqual(old.answer, pages[0].answer); assert.equal(old.status, 'historical-answer');
    assert.ok(last.work.retentionElapsedMs > 0); assert.ok(last.work.totalElapsedMs >= last.work.retentionElapsedMs);
    const damaged = structuredClone(pages[0].retained); damaged.manifestHash = '0'.repeat(64);
    await assert.rejects(run({ ...retainedRequest, revisionReceipt: damaged }), { code: 'ENOENT' });
  } else if (mode === 'late-result-and-publication') {
    const service = createRepositoryQuestionService(); let prepared, start, finish;
    const began = new Promise(resolve => { start = resolve; }), continueQuery = new Promise(resolve => { finish = resolve; });
    const run = createRepositoryAnswerRunner({ queryRunner: async (query, options) => {
      prepared = await service({ store: fixture.artifact, request: query, signal: options.signal, deferPublication: true });
      start(); await continueQuery; return prepared;
    } });
    const late = run({ ...request, retention: { expectedBaseDigest: null } });
    await began;
    const newer = await store().begin({ questionRef: { ...request.questionRef, revision: '2' }, worldId: semanticHash('answer.world.v1', request.query.question.world), expectedBaseDigest: null });
    finish(); await assert.rejects(late, { code: 'ERR_ANSWER_RETENTION_CONFLICT' });
    assert.equal((await store().read(request.questionRef)).pending.intentId, newer.intentId);
    assert.ok(prepared.cursor);
    await assert.rejects(service({ store: fixture.artifact, request: { ...request.query, cursor: prepared.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' }, 'a failed retained publication cannot install its prepared cursor');
    const normal = await service({ store: fixture.artifact, request: request.query });
    assert.ok(normal.cursor); assert.doesNotThrow(() => publishSemanticPage(normal)); service.dispose();
  } else if (mode === 'resume-and-cancellation') {
    let queries = 0, abortOnCommit = false;
    const controller = new AbortController();
    const run = createRepositoryAnswerRunner({ queryRunner: async (...args) => { queries++; return (await import('../../../src/integrations/tooling/repository-query.js')).runRepositoryQuery(...args); },
      createRetentionStore: options => {
        const actual = createRetainedAnswerStore(options);
        return { ...actual, prepare: (...args) => {
          const staged = actual.prepare(...args);
          return { ...staged, commit: async () => { if (abortOnCommit) controller.abort(); return staged.commit(); } };
        } };
      } });
    const intent = await store().begin({ questionRef: request.questionRef, worldId: semanticHash('answer.world.v1', request.query.question.world), expectedBaseDigest: null });
    const wrong = structuredClone(intent); wrong.questionRef.revision = 'wrong';
    await assert.rejects(run({ ...request, retention: { expectedBaseDigest: null, resumeIntent: wrong } }), { code: 'ERR_ANSWER_RETENTION_CONFLICT' });
    assert.equal(queries, 0);
    abortOnCommit = true;
    await assert.rejects(run({ ...request, retention: { expectedBaseDigest: null, resumeIntent: intent } }, { signal: controller.signal }), { name: 'AbortError' });
    const pending = await store().read(request.questionRef); assert.equal(pending.answer, null); assert.deepEqual(pending.pending, intent);
    abortOnCommit = false;
    const page = checked(await run({ ...request, retention: { expectedBaseDigest: null, resumeIntent: intent } }));
    assert.equal(page.retained.epoch, intent.epoch); assert.equal((await store().read(request.questionRef)).answer.digest, page.answer.digest);
    await assert.rejects(run({ ...request, retention: { expectedBaseDigest: null, resumeIntent: intent } }), { code: 'ERR_ANSWER_RETENTION_CONFLICT' });
    assert.equal(queries, 2, 'invalid and already-completed resume intents fail before query work');
  } else {
    const input = { ...request, retention: { expectedBaseDigest: null } }, file = path.join(fixture.root, 'retain.json');
    await fs.writeFile(file, JSON.stringify(input)); let written = '';
    const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) { written += chunk; setImmediate(done); } });
    await runRepositoryAnswerCli([process.execPath, 'repository-answer.js', '--request', file, '--all'], { output });
    const cli = written.trim().split('\n').map(line => checked(JSON.parse(line)));
    assert.ok(cli.every(page => page.retained)); assert.equal(cli.at(-1).continuation, null);
    assert.deepEqual((await runRepositoryAnswerTool(retainedRequest)).answer, cli.at(-1).answer);
    assert.deepEqual((await route(retainedRequest)).answer, cli.at(-1).answer);
    const mcpInput = { ...input, questionRef: { id: 'mcp-retained', revision: '1' } };
    const mcp = await collect(runRepositoryAnswerTool, mcpInput);
    const apiInput = { ...input, questionRef: { id: 'api-retained', revision: '1' } };
    const api = await collect(route, apiInput);
    const tuples = pages => pages.flatMap(page => page.answer.inputs.queryReceipt.rows).map(row => row.bindings.map(binding => binding.ref.localId));
    assert.deepEqual(tuples(api), tuples(cli)); assert.deepEqual(tuples(mcp), tuples(cli));
    assert.deepEqual((await route({ ...retainedRequest, questionRef: apiInput.questionRef, revisionReceipt: api[0].retained })).answer, api[0].answer);
  }
} finally { await fixture.cleanup(); }
console.log('Opt-in answer retention preserves live admission, cursor publication and transport parity.');
