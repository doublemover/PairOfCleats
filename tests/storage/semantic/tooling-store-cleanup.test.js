import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createSemanticServingFixture } from '../../helpers/semantic-serving-fixture.js';
import { openPublishedSemanticStore } from '../../../src/semantic/published-store.js';
import { createSemanticDetailRunner } from '../../../src/integrations/tooling/semantic-detail.js';
import { createSemanticFindRunner } from '../../../src/integrations/tooling/semantic-find.js';
import { createSemanticExplainRunner } from '../../../src/integrations/tooling/semantic-explain.js';
import { createSemanticTraceRunner } from '../../../src/integrations/tooling/semantic-trace.js';

// Actual query services with injected store acquisition/cleanup boundaries.
const fixture = await createSemanticServingFixture();
const contains = (failure, expected) => {
  const queue = [failure], seen = new Set();
  while (queue.length) {
    const value = queue.pop(); if (value === expected) return true;
    if (!value || !['object', 'function'].includes(typeof value) || seen.has(value)) continue;
    seen.add(value); if (Object.hasOwn(value, 'cause')) queue.push(value.cause);
    if (Array.isArray(value.errors)) queue.push(...value.errors);
  }
  return false;
};
try {
  const opened = await openPublishedSemanticStore({ indexDir: fixture.indexDir, repoRoot: fixture.root,
    generation: fixture.generation, requireQueryIndex: true });
  const scope = { repoRoot: fixture.root, generation: fixture.generation };
  const cases = [
    [createSemanticDetailRunner, { ...scope, refs: [fixture.ref] }, 'getCoverage'],
    [createSemanticFindRunner, { ...scope, selector: { field: 'astKind', value: 'Identifier' } }, 'findOperations'],
    [createSemanticTraceRunner, { ...scope, seed: fixture.ref, direction: 'downstream', kinds: ['flowsTo'] }, 'getCoverage'],
    [createSemanticExplainRunner, { ...scope, seed: fixture.ref, direction: 'downstream', kinds: ['flowsTo'] }, 'getCoverage']
  ];
  for (const [create, request, method] of cases) {
    {
      const controller = new AbortController(), originalStat = fs.stat; let opens = 0, stats = 0;
      const runner = create({ openStore: async () => { opens++; return opened; } });
      fs.stat = async (...args) => { stats++; const value = await originalStat(...args); controller.abort(); return value; };
      try { await assert.rejects(runner(request, { userConfig: {}, signal: controller.signal }), { code: 'ABORT_ERR' }); }
      finally { fs.stat = originalStat; }
      assert.equal(opens, 0, 'cancellation during generation lookup acquires no store'); assert.equal(stats, 1);
    }
    {
      let settled = false, resolveClose, markStarted;
      const started = new Promise(resolve => { markStarted = resolve; });
      const closing = new Promise(resolve => { resolveClose = resolve; });
      const runner = create({ openStore: async () => ({ ...opened, close() {
        markStarted(); return closing.then(() => { settled = true; });
      } }) });
      const pending = runner(request, { userConfig: {} }); let returned = false;
      const completion = pending.then(() => { returned = true; });
      // The close callback itself signals admission, avoiding sleep-based timing.
      await Promise.race([started, completion]);
      assert.equal(returned, false); assert.equal(settled, false);
      resolveClose(); const result = await pending;
      assert.equal(settled, true); assert.equal(result.records[0].id, 0);
    }
    for (const primary of [undefined, null, false, 0, '', Object.freeze(new Error('original service failure'))]) {
      const secondary = Object.freeze(new Error('original store close failed')); let closes = 0;
      const runner = create({ openStore: async () => ({ ...opened,
        store: { ...opened.store, [method]: async () => { throw primary; } },
        close: async () => { closes++; throw secondary; }
      }) });
      let failure;
      try { await runner(request, { userConfig: {} }); assert.fail('must reject'); } catch (caught) { failure = caught; }
      assert.equal(closes, 1); assert.equal(contains(failure, primary), true); assert.equal(contains(failure, secondary), true);
    }
    {
      const controller = new AbortController(); let closes = 0;
      const runner = create({ openStore: async options => {
        assert.equal(options.signal, controller.signal);
        return { ...opened, async close() { closes++; controller.abort(); } };
      } });
      await assert.rejects(runner(request, { userConfig: {}, signal: controller.signal }), { code: 'ABORT_ERR' });
      assert.equal(closes, 1, 'cancellation during settled cleanup withholds the final response');
    }
  }
} finally { await fixture.cleanup(); }
console.log('Semantic tooling awaits store cleanup and preserves primary query and cancellation failures.');
