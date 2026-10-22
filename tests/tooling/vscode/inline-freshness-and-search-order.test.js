import assert from 'node:assert/strict';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-inline-freshness-' });
const harness = createVsCodeRuntimeHarness({
  repoRoot: fixture.root, workspaceFolders: [{ path: fixture.root }],
  configValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js') }
});
const flush = async () => { await new Promise(setImmediate); await new Promise(setImmediate); };
const pack = (name) => JSON.stringify({ risk: { status: 'partial', flows: [] }, warnings: [{ code: name, message: name }] });
const doc = (name) => ({
  uri: harness.fakeVscode.Uri.file(fixture.resolvePath('src', name)), version: 1, isDirty: false,
  getText: () => 'sameSpelling',
  getWordRangeAtPosition: () => ({ start: { line: 0, character: 0 }, end: { line: 0, character: 12 } })
});
const first = doc('app.ts'), second = doc('other.ts');
try {
  harness.activate();
  harness.queuedResults.push({ persistent: true });
  harness.setActiveEditor({ document: first });
  harness.setConfiguration({ inlineDiagnosticsEnabled: true, inlineDecorationsEnabled: true, inlineHoverEnabled: true });
  await flush();
  const oldChild = harness.spawnCalls.at(-1).child;
  harness.queuedResults.push({ code: 0, stdout: pack('NEW_FILE') });
  harness.setActiveEditor({ document: second });
  await flush();
  oldChild.stdout.emit('data', Buffer.from(pack('OLD_FILE')));
  oldChild.emit('close', 0);
  await flush();
  const entries = harness.diagnosticCollections[0].entries;
  assert.equal(entries.has(first.uri.toString()), false, 'old file diagnostics clear immediately');
  assert.match(entries.get(second.uri.toString())[0].message, /1 warning/);
  const currentDecoration = harness.decorationTypes.at(-1);
  assert.equal(currentDecoration.disposed, false, 'a late old callback cannot dispose the current decoration');

  harness.queuedResults.push({ persistent: true });
  const hover = harness.extension._test.provideInlineHoverAtPosition(second, new harness.fakeVscode.Position(0, 3));
  await flush();
  const hovering = harness.spawnCalls.at(-1).child;
  second.version += 1;
  second.isDirty = true;
  hovering.stdout.emit('data', Buffer.from(pack('OLD_BUFFER')));
  hovering.emit('close', 0);
  assert.equal(await hover, null, 'edits revoke in-flight source identity');

  harness.setConfiguration({ inlineHoverEnabled: false, inlineDiagnosticsEnabled: false, inlineDecorationsEnabled: false });
  await flush();
  assert.equal(entries.size, 0, 'disabled signals clear without an editor switch');
  const before = harness.spawnCalls.length;
  await harness.extension._test.provideInlineHoverAtPosition(first, new harness.fakeVscode.Position(0, 3));
  assert.equal(harness.spawnCalls.length, before, 'disabled policy is checked before any retained data');

  harness.queuedResults.push({ persistent: true });
  const oldSearch = harness.extension._test.executeSearchCommand({ query: 'old' });
  await flush();
  const searchChild = harness.spawnCalls.at(-1).child;
  harness.queuedResults.push({ stdout: JSON.stringify({ code: [], prose: [], extractedProse: [] }), code: 0 });
  const newSearch = harness.extension._test.executeSearchCommand({ query: 'new' });
  await newSearch;
  searchChild.stdout.emit('data', Buffer.from(JSON.stringify({ code: [], prose: [], extractedProse: [] })));
  searchChild.emit('close', 0);
  await oldSearch;
  const history = harness.workspaceStateStore.get('pairofcleats.searchHistory') || [];
  assert.deepEqual(history.map((row) => row.query), ['new'], 'a superseded completion cannot steal persisted active results');
  assert.deepEqual(harness.errorMessages, []);
  assert.equal((await harness.extension.deactivate()).ok, true);
} finally {
  harness.restoreGlobals();
}
console.log('Editor source/policy freshness and latest foreground search publication controls passed.');
