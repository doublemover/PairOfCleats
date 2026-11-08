import assert from 'node:assert/strict';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-provider-cancel-' });
const harness = createVsCodeRuntimeHarness({
  repoRoot: fixture.root, workspaceFolders: [{ path: fixture.root }],
  globalConfigValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js') }
});
const listeners = new Set();
const token = {
  isCancellationRequested: false,
  onCancellationRequested(callback) { listeners.add(callback); return { dispose: () => listeners.delete(callback) }; }
};
const cancel = () => { token.isCancellationRequested = true; for (const listener of [...listeners]) listener(); };
const document = {
  uri: harness.fakeVscode.Uri.file(fixture.resolvePath('src', 'app.ts')),
  getWordRangeAtPosition: () => ({ start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }),
  getText: () => 'Widget'
};
const position = new harness.fakeVscode.Position(0, 3);
const flush = () => new Promise((resolve) => setImmediate(resolve));
try {
  harness.activate();
  const definitions = harness.definitionProviders[0].provider;
  const references = harness.referenceProviders[0].provider;
  const symbols = harness.documentSymbolProviders[0].provider;
  const completions = harness.completionProviders[0].provider;
  token.isCancellationRequested = true;
  await definitions.provideDefinition(document, position, token);
  await completions.provideCompletionItems(document, position, token);
  await references.provideReferences(document, position, {}, token);
  await symbols.provideDocumentSymbols(document, token);
  assert.equal(harness.spawnCalls.length, 0);
  token.isCancellationRequested = false;
  const duringLookup = definitions.provideDefinition(document, position, token);
  cancel();
  await duringLookup;
  assert.equal(harness.spawnCalls.length, 0, 'cancellation during asynchronous repo resolution prevents dispatch');
  token.isCancellationRequested = false;
  harness.queuedResults.push({ persistent: true });
  const running = completions.provideCompletionItems(document, position, token);
  await flush();
  assert.equal(harness.spawnCalls.length, 1);
  cancel();
  assert.deepEqual(await running, []);
  assert.equal(harness.killCalls.length, 1);
  assert.equal(listeners.size, 0, 'every provider cancellation subscription is disposed');
  assert.deepEqual(harness.errorMessages, []);
  assert.equal((await harness.extension.deactivate()).ok, true);
} finally {
  harness.restoreGlobals();
}
console.log('VS Code provider cancellation prevents obsolete dispatch and settles running work quietly.');
