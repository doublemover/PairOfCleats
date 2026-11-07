#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { createSourcekitPreflightFixture, withSourcekitPreflightProvider } from '../../helpers/sourcekit-preflight-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const isAlive = pid => {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
const fixtureEnvironment = () => Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => key.startsWith('PAIROFCLEATS_')));
const priorEnvironment = fixtureEnvironment();
for (const priorCache of ['fresh', 'stale']) {
  const fixture = await createSourcekitPreflightFixture({ root,
    name: `sourcekit-package-preflight-abort-${priorCache}`, resolveDelayMs: 5000 });
  if (priorCache === 'stale') {
    await fs.mkdir(path.dirname(fixture.markerPath), { recursive: true });
    await fs.writeFile(fixture.markerPath, '{obsolete cache record');
  }
  try {
    await withSourcekitPreflightProvider({ fixture }, async ({ provider, ctx, document, target }) => {
      assert.ok(provider, 'expected sourcekit provider');
      assert.equal(process.env.PAIROFCLEATS_CACHE_ROOT, fixture.cacheRoot, 'the abort case owns its cache');
      assert.equal(ctx.toolingConfig.sourcekit.cmd, fixture.fixtureCommand, 'the abort case explicitly selects its fixture command');
      target.chunkRef.chunkUid = 'ck:test:sourcekit:preflight-abort:1';
      const abortController = new AbortController();
      ctx.abortSignal = abortController.signal;
      let started = null;
      const fallback = setTimeout(() => abortController.abort(new Error('Swift resolve did not start promptly')), 1500);
      const abortStartedWork = (async () => {
        while (!abortController.signal.aborted && !started) {
          try { started = JSON.parse(await fs.readFile(fixture.startedPath, 'utf8')); }
          catch { await delay(5); }
        }
        if (!abortController.signal.aborted) {
          await delay(75);
          abortController.abort(new Error('abort sourcekit preflight run'));
        }
      })();
      try {
        const startedAtMs = Date.now();
        await assert.rejects(() => provider.run(ctx, { documents: [document], targets: [target] }),
          err => err?.code === 'ABORT_ERR', 'expected sourcekit run to abort while preflight is in progress');
        assert.ok(Number.isSafeInteger(started?.pid) && started.pid > 0,
          'abort must exercise a started Swift package resolve, not stop during command probing');
        assert.equal(abortController.signal.reason.message, 'abort sourcekit preflight run',
          'the real-operation timer must cancel the resolver rather than the startup guard');
        while (isAlive(started.pid) && Date.now() - startedAtMs < 1950) await delay(10);
        assert.equal(isAlive(started.pid), false, 'aborted package resolution reaps its actual descendant');
        const elapsedMs = Date.now() - startedAtMs;
        assert.ok(elapsedMs < 2000, `expected sourcekit preflight abort to short-circuit promptly (elapsed=${elapsedMs}ms)`);
        assert.equal(await countNonEmptyLines(fixture.counterPath), 1, 'fresh and stale caches each execute exactly one real resolve');
        assert.equal(await fs.access(fixture.completedPath).then(() => true, () => false), false,
          'cancellation cannot report success after leaving the five-second resolver running');
        console.log(JSON.stringify({ measurement: 'sourcekit-preflight-cancellation', priorCache, elapsedMs,
          childPid: started.pid, childReaped: true, resolveAttempts: 1, completionObserved: false, boundMs: 2000 }));
      } finally {
        clearTimeout(fallback);
        abortController.abort(new Error('fixture cleanup'));
        await abortStartedWork;
      }
    });
  } finally {
    await fixture.restorePath();
    assert.deepEqual(fixtureEnvironment(), priorEnvironment, 'fixture cleanup restores cache, trust and resource settings');
  }
}
console.log('sourcekit package preflight abort test passed');
