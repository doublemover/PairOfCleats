import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { createRepositoryQuestionFixture } from '../../helpers/repository-question-fixture.js';
import { createRepositoryQuestionService } from '../../../src/semantic/questions/execute.js';
import { assertRepositoryQuery } from '../../../src/contracts/validators/repository-question-live.js';
import { runRepositoryQueryCli } from '../../../tools/analysis/repository-query.js';
import { runRepositoryQueryTool } from '../../../tools/mcp/tools/handlers/repository-query.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('semantic/questions/clause-explanation/')[1];
assert.ok(['same-binding-truth', 'unknown-and-authority', 'paging-and-transports'].includes(mode));
const collect = async (run, request) => {
  const pages = [], clauses = []; let cursor = request.cursor || null;
  for (let index = 0; index < 128; index++) {
    const page = await run({ ...request, cursor }); assertRepositoryQuery('explanation', page);
    pages.push(page); clauses.push(...page.clauses);
    assert.equal(page.counts.evaluatedThroughCursor, clauses.length);
    assert.ok(Buffer.byteLength(JSON.stringify(page)) + 1 <= (request.limits?.bytes || 65536));
    cursor = page.cursor;
    if (!cursor) return { pages, clauses, last: page };
  }
  assert.fail('one original binding did not finish its small finite retained relation');
};
const byOrigin = result => new Map(result.clauses.flatMap(clause => result.last.originMap[clause.operatorId].authored.map(origin => [origin.clauseId, clause])));
const fixture = await createRepositoryQuestionFixture();
try {
  const request = { ...fixture.request, mode: 'explain', bindingRefs: { invocation: fixture.ref(0), declaration: fixture.ref(8), literal: fixture.ref(4) } };
  const service = createRepositoryQuestionService(), run = input => service({ store: fixture.artifact, request: input });
  if (mode === 'same-binding-truth') {
    const positive = await collect(run, request), clauses = byOrigin(positive);
    assert.equal(positive.clauses.length, 4);
    assert.ok(positive.clauses.every(clause => clause.status === 'satisfied-in-retained-input'));
    assert.equal(positive.last.questionAtBinding, 'satisfied-in-retained-input');
    assert.equal(positive.last.completion.programSemantics, 'not-established');
    assert.equal(clauses.get('target').witnesses[0].fact.owner.localId, 6, 'the compiler occurrence is tied to the same Invocation');
    const otherCall = { ...request, bindingRefs: { invocation: fixture.ref(1), declaration: fixture.ref(2), literal: fixture.ref(4) } };
    const absent = await collect(run, otherCall), mismatch = byOrigin(absent);
    assert.equal(mismatch.get('target').status, 'refuted-in-retained-input');
    assert.equal(mismatch.get('argument').status, 'refuted-in-retained-input');
    assert.equal(mismatch.get('name').status, 'satisfied-in-retained-input');
    assert.equal(mismatch.get('zero').status, 'satisfied-in-retained-input', 'independent literal/name filters are evaluated at the supplied tuple, despite failed joins');
    assert.equal(absent.last.questionAtBinding, 'refuted-in-retained-input');
    const falseFilters = await collect(run, { ...request, bindingRefs: { invocation: fixture.ref(1), declaration: fixture.ref(3), literal: fixture.ref(5) } });
    const failures = byOrigin(falseFilters);
    assert.equal(failures.get('target').status, 'satisfied-in-retained-input');
    assert.equal(failures.get('argument').status, 'satisfied-in-retained-input');
    assert.equal(failures.get('name').actual, 'other'); assert.equal(failures.get('name').expected, 'parseRequest');
    assert.deepEqual(failures.get('zero').actual, { type: 'number', representation: '1' });
    assert.deepEqual(failures.get('zero').expected, { type: 'number', representation: '0' });
    assert.ok(falseFilters.clauses.every(clause => clause.reason !== 'page-work-or-output-budget'));
    const sqlite = await collect(input => service({ store: fixture.sqlite, request: input }), request);
    assert.deepEqual(sqlite.clauses, positive.clauses); assert.deepEqual(sqlite.last.qualifiedBindings, positive.last.qualifiedBindings);
    const aliased = structuredClone(request);
    aliased.question.where.all.push({ ...aliased.question.where.all[0], id: 'same-target-again' });
    const merged = await collect(run, aliased), origins = byOrigin(merged);
    assert.equal(merged.clauses.length, 4); assert.equal(origins.size, 5);
    assert.equal(origins.get('same-target-again'), origins.get('target'), 'one equivalent operation preserves every authored clause origin');
  } else if (mode === 'unknown-and-authority') {
    const store = { ...fixture.artifact, getSourceReference: async (record, options) => record.ref.localId === 8 ? null : fixture.artifact.getSourceReference(record, options) };
    const partial = await collect(input => service({ store, request: input }), request), clauses = byOrigin(partial);
    assert.equal(clauses.get('target').status, 'unknown'); assert.equal(clauses.get('name').status, 'unknown');
    assert.equal(partial.last.questionAtBinding, 'unknown'); assert.equal(partial.last.cursor, null);
    assert.equal(partial.last.completion.clauses, 'complete', 'all clauses can be examined without establishing their truth');
    await assert.rejects(run({ ...request, bindingRefs: { ...request.bindingRefs, declaration: fixture.ref(4) } }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
    await assert.rejects(run({ ...request, bindingRefs: { ...request.bindingRefs, literal: { partitionId: 'sy1:' + 'f'.repeat(64), localId: 4 } } }), { code: 'ERR_SEMANTIC_SCOPE_MISMATCH' });
    const outside = structuredClone(request); outside.question.bind[0].scan.sourcePaths = ['another.js'];
    const described = await run({ schemaVersion: request.schemaVersion, repoRoot: request.repoRoot, generation: request.generation,
      mode: 'describe', scan: outside.question.bind[0].scan });
    outside.question.world = described.world;
    await assert.rejects(run(outside), { code: 'ERR_SEMANTIC_SCOPE_MISMATCH' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(service({ store: fixture.artifact, request, signal: controller.signal }), { name: 'AbortError' });
  } else {
    const pagedRequest = { ...request, limits: { records: 1 } }, paged = await collect(run, pagedRequest);
    assert.equal(paged.clauses.length, 4); assert.ok(paged.pages.length >= 4);
    const original = paged.pages.find(page => page.clauses.length && page.cursor);
    const nextRequest = { ...pagedRequest, cursor: original.cursor };
    const first = await run(nextRequest), replay = await run(nextRequest);
    assert.deepEqual(replay.clauses, first.clauses); assert.deepEqual(replay.qualifiedBindings, first.qualifiedBindings);
    const otherTuple = { ...nextRequest, bindingRefs: { ...request.bindingRefs, declaration: fixture.ref(2) } };
    await assert.rejects(run(otherTuple), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    await assert.rejects(run({ ...fixture.request, cursor: original.cursor, limits: { records: 1 } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    const mcp = await collect(runRepositoryQueryTool, pagedRequest); assert.deepEqual(mcp.clauses, paged.clauses);
    const requestFile = path.join(fixture.root, 'explanation.json'); await fs.writeFile(requestFile, JSON.stringify(pagedRequest));
    let written = '';
    const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, done) { written += chunk; setImmediate(done); } });
    await runRepositoryQueryCli([process.execPath, 'repository-query.js', '--request', requestFile, '--all'], { output });
    const cliPages = written.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(cliPages.flatMap(page => page.clauses), paged.clauses);
  }
  service.dispose();
} finally { await fixture.cleanup(); }
console.log('Clause explanations preserve every original predicate at the exact bound tuple.');
