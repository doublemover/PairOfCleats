import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { processDocumentTypes, createEmptyHoverMetricsResult, createConcurrencyLimiter } from '../../../src/integrations/tooling/providers/lsp/hover-types/index.js';
import { buildTargetLookupIndex } from '../../../src/integrations/tooling/providers/lsp/target-index.js';

const until = async predicate => {
  for (let turn = 0; turn < 200 && !predicate(); turn++) await Promise.resolve();
  assert.ok(predicate(), 'the controlled method queue must reach admission');
};
for (const stage of ['hover', 'signatureHelp']) {
  for (const outcome of ['deadline', 'abort', 'budget', 'healthy']) {
    let now = 1000, reservations = 0;
    const actualNow = Date.now, controller = new AbortController();
    const limiter = createConcurrencyLimiter(1), held = Promise.withResolvers(), wire = [], notifications = [];
    const hoverMetrics = createEmptyHoverMetricsResult(), hoverFileStats = new Map(), entries = new Map();
    const text = 'int add(int a) { return a; }', range = { start: { line: 0, character: 0 }, end: { line: 0, character: text.length } };
    const symbol = { name: 'add', kind: 12, range, selectionRange: { start: { line: 0, character: 4 }, end: { line: 0, character: 7 } } };
    const response = stage === 'hover' ? { contents: 'wire-signal' } : { signatures: [{ label: 'wire-signal' }] };
    const client = { notify: (...args) => { notifications.push(args); }, request: (method, params) => {
      if (method === 'textDocument/documentSymbol') return Promise.resolve([symbol]);
      assert.equal(method, `textDocument/${stage}`); wire.push(params.textDocument.uri);
      return wire.length === 1 ? held.promise : Promise.resolve(response);
    } };
    const reserve = () => {
      if (outcome === 'budget' && reservations === 1) return false;
      reservations++; return true;
    };
    const shared = { cmd: 'authored', client, guard: { isOpen: () => false },
      guardRun: fn => fn({ timeoutMs: 100 }), log: () => {}, languageId: 'cpp',
      parseSignature: detail => detail === 'wire-signal'
        ? { signature: detail, returnType: 'int', paramNames: ['a'], paramTypes: { a: 'int' } } : null,
      openDocs: new Map(), byChunkUid: {}, signatureParseCache: new Map(),
      hoverEnabled: stage === 'hover', signatureHelpEnabled: stage === 'signatureHelp',
      semanticTokensEnabled: false, inlayHintsEnabled: false, definitionEnabled: false,
      typeDefinitionEnabled: false, referencesEnabled: false, hoverRequireMissingReturn: false,
      hoverLimiter: limiter, signatureHelpLimiter: limiter, requestCacheEntries: entries,
      requestCachePersistedKeys: new Set(), requestCacheMetrics: null,
      requestCacheContext: { providerId: 'authored', workspaceKey: 'fixture', generation: 'queued-authority-v1' },
      requestBudgetControllers: { hover: { tryReserve: reserve }, signatureHelp: { tryReserve: reserve } },
      hoverControl: { disabledGlobal: false }, hoverMetrics, hoverFileStats, hoverLatencyMs: [],
      softDeadlineAt: 1010, abortSignal: controller.signal, checks: [], checkFlags: {} };
    const invoke = name => {
      const virtualPath = `.poc-vfs/${name}.cpp`, target = { virtualPath, virtualRange: { start: 0, end: text.length },
        chunkRef: { chunkUid: `ck64:v1:authored:${name}`, file: `${name}.cpp`, range: { start: 0, end: text.length } },
        symbolHint: { name: 'add', kind: 'function' } };
      return processDocumentTypes({ ...shared, openDocs: new Map(), doc: { virtualPath, text, docHash: `authored-${name}` },
        uri: `file:///authored/${name}.cpp`, targetIndexesByPath: new Map([[virtualPath, buildTargetLookupIndex([target])]]) });
    };
    let first, second;
    try {
      Date.now = () => now;
      first = invoke('A'); second = invoke('B');
      const settledFirst = first.then(value => ({ value }), error => ({ error }));
      const settledSecond = second.then(value => ({ value }), error => ({ error }));
      await until(() => wire.length === 1 && limiter.getMetrics().queued === 1);
      if (outcome === 'deadline') now = 1020;
      if (outcome === 'abort') {
        controller.abort();
        assert.equal((await settledSecond).error.code, 'ABORT_ERR');
        assert.equal(limiter.getMetrics().active, 1, 'cancelling B cannot release active A');
      }
      if (outcome === 'healthy') now = 1009;
      held.resolve(response); await Promise.all([settledFirst, settledSecond]);
      assert.equal(wire.length, outcome === 'healthy' ? 2 : 1);
      assert.equal(reservations, wire.length, 'only actual admissions consume the shared budget');
      assert.equal(hoverMetrics.queueEnqueued, 2); assert.equal(hoverMetrics.queueStarted, wire.length);
      assert.equal(hoverMetrics.timedOut, 0);
      assert.equal(stage === 'hover' ? hoverMetrics.requested : hoverMetrics.signatureHelpRequested, wire.length);
      if (outcome === 'deadline') {
        assert.equal(hoverFileStats.get('.poc-vfs/B.cpp').skippedBySoftDeadline, 1);
        assert.equal(entries.size, 1, 'deadline-skipped B cannot insert a negative response cache');
        assert.ok(shared.checks.some(check => check.name === 'tooling_soft_deadline_reached'));
      }
      if (outcome === 'abort') assert.equal(hoverMetrics.queueCancelled, 1);
      if (outcome === 'budget') {
        assert.equal(hoverFileStats.get('.poc-vfs/B.cpp').skippedByBudget, 1);
        assert.equal(entries.size, 1); assert.equal(shared.checks.length, 0);
      }
      if (outcome === 'healthy') {
        assert.equal(entries.size, 2); assert.ok([...entries.values()].every(entry => entry.info && !entry.negative));
        await invoke('A'); assert.equal(wire.length, 2); assert.equal(reservations, 2);
        assert.equal(hoverMetrics.queueEnqueued, 2, 'positive cached results neither enqueue nor spend request budget');
      }
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
      assert.ok(notifications.some(([method]) => method === 'textDocument/didClose'));
    } finally {
      held.resolve(response); await Promise.allSettled([first, second].filter(Boolean)); Date.now = actualNow;
    }
  }
}
console.log('Production hover/signature consumers recheck queued admission, preserve positive caches and avoid skipped timeout/cache claims.');
