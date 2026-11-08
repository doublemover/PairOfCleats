import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createSemanticEvidenceWorkflow } = require('../../../extensions/vscode/semantic-evidence.js');
const { createEditorOperations } = require('../../../extensions/vscode/editor-operations.js');

// Actual adapter/operation owner, inert UI and typed consumer boundaries.
const generation = { baseBuildId: 'semantic-adapter-lifetime', semanticRevision: 0 };
const ref = { partitionId: 'sy1:' + 'a'.repeat(64), localId: 1 };
const fixtures = [], gates = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const fixture = ({ api = false } = {}) => {
  const value = { queue: [], requests: [], copies: [], errors: [], reports: [], repo: { repoRoot: '/selected' },
    seed: { generation: { ...generation }, selector: { target: { ...ref } } },
    payload: { generation: { ...generation }, status: 'partial', records: [{ kind: 'operation', ref: { ...ref }, span: [0, 1] }], edges: [], frontier: [] } };
  value.operations = createEditorOperations({ spawn() { assert.fail('semantic adapter does not spawn'); } });
  value.transport = { transport: api ? 'api' : 'cli', execution: { capabilities: { 'semantic-find': true } } };
  const ui = { window: {
    async showQuickPick(items) { assert(Object.isFrozen(items)); const next = value.queue.shift(); return typeof next === 'function' ? next(items) : items.find(item => item.action === next || item.value === next || item === next); },
    async showInputBox() { return value.inputs?.shift(); }, async showTextDocument() {}, async showErrorMessage(message) { value.errors.push(message); }
  }, workspace: { async openTextDocument(document) { value.reports.push(document.content); return document; } },
  env: { clipboard: { async writeText(text) { value.copies.push(text); } } } };
  value.run = createSemanticEvidenceWorkflow({ vscode: value.operations.wrapVscode(ui), operations: value.operations,
    resolveRepo: async () => value.repo, chooseTransport: async () => value.transport,
    getCursorSeed: () => value.seed,
    execute: async (operation, request) => { assert(Object.isFrozen(request)); assert(Object.isFrozen(request.generation));
      value.requests.push({ operation, request }); return value.execute ? value.execute(operation, request) : value.payload; } });
  fixtures.push(value); return value;
};
try {
  const changedCursor = fixture(); changedCursor.queue.push(items => { changedCursor.seed.selector.target.localId++; return items.find(item => item.value === 'cursor'); });
  await changedCursor.run(); assert.equal(changedCursor.requests.length, 0); assert(changedCursor.errors.some(message => /cursor identity changed/.test(message)));
  const copiedRoute = fixture(); copiedRoute.queue.push(items => ({ ...items.find(item => item.value === 'cursor') }));
  await copiedRoute.run(); assert.equal(copiedRoute.requests.length, 0); assert(copiedRoute.errors.some(message => /original item/.test(message)));
  for (const action of ['more', 'plan', 'copy']) {
    const forged = fixture(); forged.queue.push('cursor', items => ({ ...items.find(item => item.action === 'copy'), action }));
    await forged.run(); assert.equal(forged.requests.length, 1); assert.equal(forged.copies.length, 0);
    assert(forged.errors.some(message => /original item/.test(message)));
  }

  const immutable = fixture(); const expected = structuredClone(immutable.payload);
  immutable.queue.push('cursor', items => {
    immutable.payload.records[0].ref.localId = 77; immutable.payload.frontier.push({ reason: 'replacement' }); immutable.repo.repoRoot = '/foreign';
    return items.find(item => item.action === 'copy');
  }, 'back');
  await immutable.run(); assert.deepEqual(JSON.parse(immutable.copies[0]), expected); assert.equal(immutable.requests[0].request.repoRoot, '/selected');

  const typed = fixture(); typed.queue.push('cursor', items => items.find(item => item.record), 'trace', () => ['forgedEdge']); typed.inputs = ['2'];
  await typed.run(); assert.equal(typed.requests.length, 1); assert(typed.errors.some(message => /original picker items/.test(message)));
  const sparse = fixture(); sparse.queue.push('cursor', items => items.find(item => item.record), 'trace', () => new Array(1)); sparse.inputs = ['2'];
  await sparse.run(); assert.equal(sparse.requests.length, 1); assert(sparse.errors.some(message => /dense original/.test(message)));

  // Capability mutations cannot inject a service operation into a previously
  // admitted menu; copied plan/more actions never bypass original membership.
  const api = fixture({ api: true }); api.inputs = [generation.baseBuildId];
  api.queue.push('Structural operation', items => { api.transport.execution.capabilities['semantic-trace'] = true;
    return items.find(item => item.record); }, items => { assert(!items.some(item => item.value === 'trace')); return { value: 'trace' }; }, 'back');
  api.inputs.push('invoke'); await api.run(); assert.equal(api.requests.length, 1); assert(api.errors.some(message => /original item/.test(message)));

  const page = fixture({ api: true }); page.inputs = [generation.baseBuildId, 'invoke']; page.payload.cursor = 'original-cursor';
  const original = structuredClone(page.payload), next = { ...structuredClone(page.payload), cursor: null, frontier: [{ reason: 'page frontier' }] };
  page.execute = (_operation, request) => request.cursor ? next : page.payload;
  page.queue.push('Structural operation', 'more', 'copy', 'back', 'copy', 'back');
  await page.run(); assert.deepEqual(JSON.parse(page.copies[0]), next); assert.deepEqual(JSON.parse(page.copies[1]), original);
  assert.equal(page.requests[1].request.cursor, 'original-cursor'); assert.equal(page.requests[1].request.generation.baseBuildId, generation.baseBuildId);

  const stale = fixture(), entered = deferred(), gate = deferred(); let first = true;
  stale.execute = async () => { if (first) { first = false; entered.resolve(); await gate.promise; } return stale.payload; };
  stale.queue.push('cursor'); const older = stale.run(); await entered.promise;
  stale.queue.push('cursor', 'back'); await stale.run(); gate.resolve(); await older;
  assert.equal(stale.requests.length, 2); assert.equal(stale.reports.length, 1, 'late old typed response cannot publish a newer workflow view');
} finally { for (const gate of gates) gate.resolve(); for (const value of fixtures) await value.operations.dispose(); }
console.log('Semantic adapter immutable payload/cursor/capability/continuation controls authored; execution deferred.');
