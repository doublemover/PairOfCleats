import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createDiagnosticsCollector } from '../../../src/integrations/tooling/providers/lsp/diagnostics.js';

const collector = createDiagnosticsCollector({
  captureDiagnostics: true, checks: [], checkFlags: {}, maxDiagnosticUris: 4, maxDiagnosticsPerUri: 2
});
const controller = new AbortController();
const waiting = collector.waitForDiagnostics(['file:///one', ['file:///two', 'poc-vfs:///two']], {
  timeoutMs: 500, signal: controller.signal
});
assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
collector.setDiagnosticsForUri('file:///one', []);
collector.setDiagnosticsForUri('poc-vfs:///two', [{ message: 'fixture' }]);
assert.deepEqual(await waiting, { expectedUris: 2, observedUris: 2, pendingUris: 0, timedOut: false, timeoutMs: 500 });
assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
assert.equal((await collector.waitForDiagnostics(['file:///one'])).timedOut, false);
const timeout = await collector.waitForDiagnostics(['file:///absent'], { timeoutMs: 10 });
assert.equal(timeout.timedOut, true);
assert.equal(timeout.pendingUris, 1);
const aborted = collector.waitForDiagnostics(['file:///absent'], { timeoutMs: 2000, signal: controller.signal });
controller.abort();
await assert.rejects(aborted, { name: 'AbortError' });
assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
assert.throws(() => collector.waitForDiagnostics([], { signal: controller.signal }), { name: 'AbortError' });
const zero = await collector.waitForDiagnostics(['file:///absent'], { timeoutMs: 0 });
assert.equal(zero.timeoutMs, 0);
assert.equal(zero.pendingUris, 1);
const capped = await collector.waitForDiagnostics(Array.from({ length: 8 }, (_, i) => `file:///unknown-${i}`), { timeoutMs: 0 });
assert.equal(capped.expectedUris, 4);
console.log('Diagnostic drain is event-driven, bounded and abort-clean');
