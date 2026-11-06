import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createRepositoryQuestionFixture } from '../../helpers/repository-question-fixture.js';
import { createRepositoryQuestionService } from '../../../src/semantic/questions/execute.js';
import { createRepositoryQueryRunner } from '../../../src/integrations/tooling/repository-query.js';
import { compileRepositoryQuestion } from '../../../src/semantic/questions/compile.js';
import { executeFiniteRepositoryQuestion } from '../../../src/semantic/questions/reference.js';
import { createSemanticContinuationBudget } from '../../../src/semantic/continuation-budget.js';
import { publishSemanticPage } from '../../../src/semantic/page-publication.js';
import { runRepositoryQueryCli } from '../../../tools/analysis/repository-query.js';
import { runRepositoryQueryTool } from '../../../tools/mcp/tools/handlers/repository-query.js';
import { handleRepositoryQueryRoute } from '../../../tools/api/router/repository-query.js';
import { getToolDefs } from '../../../src/integrations/mcp/defs.js';
import { assertRepositoryQuery } from '../../../src/contracts/validators/repository-question-live.js';

const mode = process.env.PAIROFCLEATS_TEST_ID?.split('semantic/questions/indexed-execution/')[1];
assert.ok(['reader-parity-and-oracle', 'correlation-and-scalars', 'unknown-and-diagnostics', 'cursor-authority',
  'reader-publication', 'retention-and-cancellation', 'profile-admission', 'transport-parity'].includes(mode));
const tuple = row => row.bindings.map(binding => binding.ref.localId);
const collect = async (service, store, request, options = {}) => {
  let cursor = request.cursor || null, last; const rows = [], pages = [];
  for (let index = 0; index < 128; index++) {
    last = await service({ store, request: { ...request, cursor }, ...options });
    assertRepositoryQuery('page', last); rows.push(...last.rows); pages.push(last); cursor = last.cursor;
    assert.equal(last.counts.emittedThroughCursor, rows.length);
    assert.ok(Buffer.byteLength(JSON.stringify(last)) + 1 <= (request.limits?.bytes || 65536));
    if (!cursor) return { rows, pages, last };
  }
  assert.fail('query failed to finish a small closed retained inventory');
};
const fixture = await createRepositoryQuestionFixture();
try {
  if (mode === 'reader-parity-and-oracle') {
    const service = createRepositoryQuestionService(), artifact = await collect(service, fixture.artifact, fixture.request);
    const sqlite = await collect(service, fixture.sqlite, fixture.request);
    assert.deepEqual(artifact.rows.map(tuple), [[0, 2, 4], [0, 8, 4]]);
    assert.deepEqual(sqlite.rows, artifact.rows, 'different physical indexes produce the same logical rows, witnesses and source refs');
    assert.equal(artifact.last.status, 'complete-in-retained-input'); assert.equal(artifact.last.counts.totalInRetainedRelation, 2);
    assert.equal(artifact.last.completion.analysis, 'incomplete'); assert.equal(artifact.last.completion.programSemantics, 'not-established');
    const source = row => ({ sourceUnitId: fixture.source.sourceUnitId, sourceHash: fixture.source.byteHash,
      path: fixture.source.path, span: row.span, coordinateUnit: 'utf16' });
    const nodes = fixture.canonicalRows.filter(entry => entry.family === 'node').map(entry => entry.row);
    const model = { schemaVersion: fixture.request.schemaVersion, world: fixture.request.question.world,
      domain: { state: 'complete', meaning: 'supplied-finite-input' },
      entities: nodes.filter(row => [0, 1, 2, 3, 4, 5, 8].includes(row.id)).map(row => ({ ref: fixture.ref(row.id), source: source(row),
        ...(row.kind === 'expression' ? { sort: 'Invocation', invocationKind: 'call' } : row.kind === 'literal' ? { sort: 'Literal', scalar: row.data.scalar }
          : { sort: 'Declaration', name: row.id === 3 ? 'other' : 'parseRequest' }) })),
      targets: [{ id: 'direct', invocation: fixture.ref(0), declaration: fixture.ref(2), certainty: 'modeled' },
        { id: 'compiler-occurrence', invocation: fixture.ref(0), declaration: fixture.ref(8), certainty: 'modeled' },
        { id: 'other-call', invocation: fixture.ref(1), declaration: fixture.ref(3), certainty: 'modeled' }],
      operands: [0, 1].map(index => ({ id: 'arg-' + index, invocation: fixture.ref(index), role: 'argument', ordinal: 1, child: fixture.ref(index + 4), flags: [] })) };
    const oracle = executeFiniteRepositoryQuestion(compileRepositoryQuestion(fixture.request.question), model);
    assert.deepEqual(artifact.rows.map(tuple), oracle.rows.map(tuple));
    assert.equal(new Set(artifact.rows.map(row => row.rowId)).size, 2, 'duplicate names remain different declaration identities');
    for (const row of artifact.rows) {
      assert.equal(fixture.bytes.toString('utf8').slice(...row.bindings[2].source.span), '0');
      assert.ok(row.detailRequest.refs.some(ref => ref.localId === row.bindings[1].ref.localId));
      assert.equal(row.witnesses.filter(witness => witness.meaning === 'recorded-target-candidate').length, 1, 'duplicate supporting contexts do not invent independent rows');
    }
    service.dispose();
  } else if (mode === 'correlation-and-scalars') {
    for (const scalar of [{ type: 'number', representation: '1' }, { type: 'boolean', representation: 'false' }, { type: 'string', representation: '0' }]) {
      const changed = await createRepositoryQuestionFixture({ scalar, secondScalar: { type: 'number', representation: '0' } });
      try {
        const service = createRepositoryQuestionService(), result = await collect(service, changed.artifact, changed.request);
        assert.deepEqual(result.rows, [], 'a matching literal on the other call cannot satisfy the target call; types do not coerce');
        assert.ok(result.pages.some(page => page.refutations.length)); service.dispose();
      } finally { await changed.cleanup(); }
    }
  } else if (mode === 'unknown-and-diagnostics') {
    const store = { ...fixture.artifact, getSourceReference: async (record, options) => record.ref.localId === 8 ? null : fixture.artifact.getSourceReference(record, options) };
    const service = createRepositoryQuestionService(), result = await collect(service, store, fixture.request);
    assert.deepEqual(result.rows.map(tuple), [[0, 2, 4]]); assert.equal(result.last.status, 'partial');
    assert.equal(result.last.cursor, null, 'unknown source qualification is not a fake resumable work remainder');
    assert.equal(result.last.counts.totalInRetainedRelation, null);
    assert.ok(result.pages.some(page => page.frontier.some(item => item.reason === 'source-coordinate-adapter-unavailable')));
    assert.ok(result.pages.some(page => page.refutations.some(item => item.reason === 'typed-scalar-differs')));
    assert.ok(result.pages[0].originMap.some(item => item.authored.some(origin => origin.clauseId === 'zero')));
    service.dispose();
    const spread = await createRepositoryQuestionFixture({ operandFlags: ['spread'] });
    try {
      const partial = await collect(createRepositoryQuestionService(), spread.artifact, spread.request);
      assert.deepEqual(partial.rows, []); assert.equal(partial.last.status, 'partial');
      assert.ok(partial.pages.some(page => page.frontier.some(item => item.reason === 'operand-unavailable-or-unqualified')));
    } finally { await spread.cleanup(); }
  } else if (mode === 'cursor-authority') {
    const service = createRepositoryQuestionService(), request = { ...fixture.request, limits: { records: 1 } };
    let first = await service({ store: fixture.artifact, request });
    while (!first.rows.length) first = await service({ store: fixture.artifact, request: { ...request, cursor: first.cursor } });
    assert.ok(first.cursor);
    const nextRequest = { ...request, cursor: first.cursor }, next = await service({ store: fixture.artifact, request: nextRequest });
    assert.deepEqual((await service({ store: fixture.artifact, request: nextRequest })).rows, next.rows, 'reading a cursor is replayable and does not consume it');
    const changed = structuredClone(nextRequest); changed.question.where.all[0].id = 'changed-origin';
    await assert.rejects(service({ store: fixture.artifact, request: changed }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    await assert.rejects(service({ store: { ...fixture.artifact, backend: 'changed' }, request: nextRequest }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    const wrongWorld = structuredClone(nextRequest); wrongWorld.question.world.contextKey = 'another-provider-world';
    await assert.rejects(service({ store: fixture.artifact, request: wrongWorld }), { code: 'ERR_SEMANTIC_SCOPE_MISMATCH' });
    const wrongGeneration = { ...nextRequest, generation: { ...nextRequest.generation, baseBuildId: 'different' } };
    await assert.rejects(service({ store: fixture.artifact, request: wrongGeneration }), { code: 'ERR_SEMANTIC_GENERATION_MISMATCH' });
    const now = Date.now;
    try {
      Date.now = () => now() + 86400001;
      await assert.rejects(service({ store: fixture.artifact, request: nextRequest }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    } finally { Date.now = now; }
    service.dispose(); assert.equal(service.continuationStats().retainedBytes, 0);
  } else if (mode === 'reader-publication') {
    let failClose = false, closes = 0;
    const runner = createRepositoryQueryRunner({ resolveIndexDir: async () => fixture.indexDir,
      openStore: async () => ({ store: fixture.artifact, manifest: fixture.manifest, close: () => { closes++; if (failClose) throw 0; } }) });
    const request = { ...fixture.request, limits: { records: 1 } };
    let first = await runner(request, { userConfig: {} });
    while (!first.rows.length) first = await runner({ ...request, cursor: first.cursor }, { userConfig: {} });
    failClose = true;
    await assert.rejects(runner({ ...request, cursor: first.cursor }, { userConfig: {} }), error => error === 0);
    failClose = false;
    const recovered = await runner({ ...request, cursor: first.cursor }, { userConfig: {} });
    assert.deepEqual(recovered.rows.map(tuple), [[0, 8, 4]], 'failed native cleanup cannot advance the delivered base');
    assert.ok(closes >= 3);
    const service = createRepositoryQuestionService();
    const provisional = await service({ store: fixture.artifact, request, deferPublication: true });
    assert.equal(service.continuationStats().cursors, 0);
    publishSemanticPage(provisional);
    assert.ok(service.continuationStats().cursors > 0); service.dispose();
  } else if (mode === 'retention-and-cancellation') {
    const budget = createSemanticContinuationBudget({ maxBytes: 128 * 1024 }), service = createRepositoryQuestionService({ retentionBudget: budget });
    const request = { ...fixture.request, limits: { records: 1 } };
    const first = await service({ store: fixture.artifact, request }); assert.ok(first.cursor);
    await service({ store: fixture.artifact, request: { ...request, cursor: first.cursor } });
    await assert.rejects(service({ store: fixture.artifact, request: { ...request, cursor: first.cursor } }), { code: 'ERR_SEMANTIC_CURSOR_EXPIRED' });
    assert.ok(budget.stats().retainedBytes <= budget.stats().maxBytes);
    service.dispose(); assert.equal(budget.stats().retainedBytes, 0);
    const controller = new AbortController(); let reads = 0;
    const cancelling = { ...fixture.artifact, getRelatedPage: async (...args) => {
      const page = await fixture.artifact.getRelatedPage(...args); reads++; controller.abort(); return page;
    } };
    const cancelled = createRepositoryQuestionService();
    await assert.rejects(cancelled({ store: cancelling, request, signal: controller.signal }), { name: 'AbortError' });
    assert.ok(reads > 0); assert.equal(cancelled.continuationStats().cursors, 0);
    await assert.rejects(collect(createRepositoryQuestionService({ maxStateBytes: 65536 }), fixture.artifact, fixture.request), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
  } else if (mode === 'profile-admission') {
    let reads = 0;
    const store = { ...fixture.artifact, findOperationsInSourceOrder: () => { reads++; throw new Error('large artifact read'); } };
    const service = createRepositoryQuestionService(), unsupported = structuredClone(fixture.request);
    unsupported.question.select = ['$c', '$d']; unsupported.question.distinctBy = ['$c', '$d'];
    await assert.rejects(service({ store, request: unsupported }), error => error.code === 'ERR_SEMANTIC_QUERY_CONTRACT'
      && error.diagnostics.some(item => item.path[0] === 'select'));
    let getters = 0;
    const accessor = { ...fixture.request, get question() { getters++; return fixture.request.question; } };
    await assert.rejects(service({ store, request: accessor }), { code: 'ERR_SEMANTIC_QUERY_CONTRACT' });
    assert.equal(getters, 0); assert.equal(reads, 0, 'invalid physical plans and request accessors fail before indexed reads');
    await assert.rejects(service({ store, request: { ...fixture.request, limits: { bytes: 1024 } } }), { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
    assert.equal(reads, 0, 'mandatory metadata is admitted before operation hydration');
    const wrongCall = { ...fixture.artifact, getRelatedPage: async (owner, member, options) => {
      const page = await fixture.artifact.getRelatedPage(owner, member, options);
      if (member === 'semantic_edges' && owner.localId === 0) for (const row of page.rows) if (row.from.localId === 0) row.callSite = fixture.ref(1);
      return page;
    } };
    await assert.rejects(collect(service, wrongCall, fixture.request), { code: 'ERR_SEMANTIC_INTEGRITY' });
    const prefix = structuredClone(fixture.request); prefix.question.bind[0].scan = { sourcePrefix: 'original.js', invocationKind: 'call' };
    const description = await service({ store: fixture.artifact, request: { schemaVersion: prefix.schemaVersion,
      repoRoot: prefix.repoRoot, generation: prefix.generation, mode: 'describe', scan: prefix.question.bind[0].scan } });
    prefix.question.world = description.world;
    assert.deepEqual((await collect(service, fixture.artifact, prefix)).rows.map(tuple), [[0, 2, 4], [0, 8, 4]]);
    service.dispose();
  } else {
    const requestFile = path.join(fixture.root, 'question.json'); await fs.writeFile(requestFile, JSON.stringify(fixture.request));
    let written = '';
    const output = new Writable({ highWaterMark: 1, write(chunk, _encoding, callback) { written += chunk; setImmediate(callback); } });
    await runRepositoryQueryCli([process.execPath, 'repository-query.js', '--request', requestFile, '--all'], { output });
    const cliPages = written.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(cliPages.flatMap(page => page.rows).map(tuple), [[0, 2, 4], [0, 8, 4]]);
    const definition = getToolDefs().find(tool => tool.name === 'repository_query'); assert.ok(definition);
    const mcp = await collect(({ request }) => runRepositoryQueryTool(request), null, fixture.request);
    assert.deepEqual(mcp.rows.map(tuple), [[0, 2, 4], [0, 8, 4]]);
    const api = await collect(async ({ request }) => {
      const req = new EventEmitter(), res = new EventEmitter();
      req.aborted = false; res.destroyed = false; res.writableEnded = false;
      let response;
      res.writeHead = status => { res.statusCode = status; };
      res.end = body => { response = JSON.parse(body); res.writableEnded = true; };
      await handleRepositoryQueryRoute({ req, res, corsHeaders: {}, parseJsonBody: async () => request,
        resolveRepo: async () => fixture.root });
      assert.equal(res.statusCode, 200);
      assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
      return response.result;
    }, null, fixture.request);
    assert.deepEqual(api.rows, mcp.rows);
  }
} finally { await fixture.cleanup(); }
console.log('Indexed repository questions preserve correlation, paging, ownership and transport contracts.');
