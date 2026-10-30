import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-completion-independent-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
const flush = () => new Promise(setImmediate);
let text = 'Widget';
const document = { uri: harness.fakeVscode.Uri.file(path.join(root, 'src', 'app.ts')), version: 1, isDirty: true,
  getText: () => text, getWordRangeAtPosition: () => ({ start: { line: 0, character: 0 }, end: { line: 0, character: text.length } }) };
const makeToken = () => {
  const callbacks = new Set();
  return { isCancellationRequested: false, callbacks,
    onCancellationRequested(callback) { callbacks.add(callback); return { dispose: () => callbacks.delete(callback) }; },
    cancel() { this.isCancellationRequested = true; for (const callback of [...callbacks]) callback(); } };
};
const payload = JSON.stringify({ ok: true, results: [{ name: 'WidgetNext', kind: 'function', score: 1 }] });
try {
  harness.activate(); const provider = harness.completionProviders[0].provider;
  assert.deepEqual(await provider.provideCompletionItems(document, { line: 0, character: 0 }, makeToken(), {}), []);
  assert.equal(harness.spawnCalls.length, 0, 'the start of a word is not its entire spelling prefix');
  const firstToken = makeToken(), secondToken = makeToken();
  harness.queuedResults.push({ persistent: true }, { persistent: true });
  const first = provider.provideCompletionItems(document, { line: 0, character: 2 }, firstToken, {}); await flush();
  const second = provider.provideCompletionItems(document, { line: 0, character: 3 }, secondToken, {}); await flush();
  firstToken.cancel(); assert.deepEqual(await first, []);
  assert.equal(harness.spawnCalls[0].child.killed, true); assert.equal(harness.spawnCalls[1].child.killed, false);
  const child = harness.spawnCalls[1].child; child.stdout.emit('data', Buffer.from(payload)); child.emit('close', 0);
  const result = await second; assert.equal(result[0].label, 'WidgetNext'); assert.match(result[0].detail, /Indexed symbol suggestion/);
  assert.equal(firstToken.callbacks.size, 0); assert.equal(secondToken.callbacks.size, 0);
  harness.queuedResults.push({ persistent: true });
  const changed = provider.provideCompletionItems(document, { line: 0, character: 3 }, makeToken(), {}); await flush();
  text = 'Changed';
  const stale = harness.spawnCalls.at(-1).child; stale.stdout.emit('data', Buffer.from(payload)); stale.emit('close', 0);
  assert.deepEqual(await changed, [], 'buffer bytes must still match even if an adapter leaves its version unchanged');
  assert.deepEqual(harness.errorMessages, []);
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered independent completion tokens, rapid-prefix dispatches, zero-prefix and exact buffer controls authored; execution deferred.');
