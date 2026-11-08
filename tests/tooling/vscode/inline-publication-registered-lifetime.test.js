import assert from 'node:assert/strict';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

// Authored registered-provider controls; inert process/host boundaries. Index
// publication invalidates interaction authority without claiming a generation.
const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-inline-publication-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: fixture.root, activeFile: fixture.resolvePath('src', 'app.ts'),
  globalConfigValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js') },
  configValues: { inlineHoverEnabled: true, inlineDiagnosticsEnabled: false, inlineDecorationsEnabled: false } });
const document = { uri: harness.fakeVscode.Uri.file(fixture.resolvePath('src', 'app.ts')), version: 1,
  isDirty: false, isClosed: false, getText: () => 'Widget', getWordRangeAtPosition: () => ({ start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }) };
const position = { line: 0, character: 2 };
const flush = () => new Promise(setImmediate);
const packet = name => JSON.stringify({ risk: { status: 'partial', flows: [] }, warnings: [{ code: name, message: name }] });
try {
  harness.activate(); harness.fakeVscode.window.activeTextEditor.document = document;
  const provider = harness.hoverProviders[0].provider;
  for (const invalidate of [() => harness.fireIndexPublication(),
    () => harness.fireDocumentEvent('onDidCloseTextDocument', document),
    () => harness.setActiveEditor({ document: { ...document, uri: harness.fakeVscode.Uri.file(fixture.resolvePath('README.md')) } })]) {
    harness.fakeVscode.window.activeTextEditor.document = document;
    harness.queuedResults.push({ persistent: true });
    const pending = provider.provideHover(document, position, {}); await flush();
    const child = harness.spawnCalls.at(-1).child; invalidate(); await flush();
    child.stdout.emit('data', Buffer.from(packet('OLD_GENERATION'))); child.emit('close', 0);
    assert.equal((await pending) == null, true, 'publication/close/editor invalidation cannot return stale native hover content');
    assert.equal(child.killed, true, 'invalidated inline hover releases its owned CLI work');
  }
  harness.fakeVscode.window.activeTextEditor.document = document;
  harness.queuedResults.push({ code: 0, stdout: packet('CURRENT_GENERATION') });
  const current = await provider.provideHover(document, position, {});
  assert.match(JSON.stringify(current), /CURRENT_GENERATION/);
  document.isClosed = true; const spawns = harness.spawnCalls.length;
  assert.equal(await provider.provideHover(document, position, {}), null);
  assert.equal(harness.spawnCalls.length, spawns, 'closed documents never dispatch inline lookups');
  assert.deepEqual(harness.errorMessages, []);
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); }
console.log('Registered inline publication epoch/cancellation/closed-source controls authored; execution deferred.');
