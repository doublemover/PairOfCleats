import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

// The actual registered result-tree command consumes normalized saved evidence.
// Native document/display and scheduler boundaries use the existing inert host.
const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-result-tree-open-' });
const file = fixture.resolvePath('src', 'app.ts'), text = 'Widget\n'; fs.writeFileSync(file, text);
const sourceHash = createHash('sha256').update(text).digest('hex');
const harness = createVsCodeRuntimeHarness({ repoRoot: fixture.root, activeFile: file,
  workspaceState: { 'pairofcleats.searchHistory': [{ resultSetId: 'original-saved-source', query: 'Widget', repoRoot: fixture.root,
    hits: [{ file: 'src/app.ts', section: 'code', sourceHash, coordinateUnit: 'utf16', startLine: 1, startCol: 1, endLine: 1, endCol: 7 }] }] } });
const gates = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
let selections = 0;
try {
  harness.activate();
  const provider = harness.treeProviders[0], node = provider.getChildren()[0].children[0];
  assert.equal(node.hit.coordinateUnit, 'utf16', 'normalization retains explicit original range-unit evidence');
  harness.fakeVscode.window.showTextDocument = async document => ({ document, set selection(_value) { selections++; }, revealRange() {} });
  const run = () => harness.registeredCommands.get('pairofcleats.openResultHit')(node);
  await run(); assert.equal(selections, 1);

  harness.fakeVscode.workspace.textDocuments.length = 0;
  const originalOpen = harness.fakeVscode.workspace.openTextDocument, entered = deferred(), gate = deferred(); let first = true;
  harness.fakeVscode.workspace.openTextDocument = async input => {
    const document = await originalOpen.call(harness.fakeVscode.workspace, input);
    if (first) { first = false; entered.resolve(); await gate.promise; } return document;
  };
  const older = run(); await entered.promise; await run(); gate.resolve(); await older;
  assert.equal(selections, 2, 'new registered tree opening revokes delayed original selection');
  assert.equal(harness.spawnCalls.length, 0);

  harness.fakeVscode.workspace.openTextDocument = originalOpen;
  fs.writeFileSync(file, text + 'different bytes'); harness.fakeVscode.workspace.textDocuments.length = 0;
  await run(); assert.equal(selections, 2); assert(harness.errorMessages.some(message => /differs from indexed/.test(message)));
  assert.equal(harness.spawnCalls.length, 0, 'opening saved evidence never refreshes source by another search');
} finally {
  for (const gate of gates) gate.resolve();
  await harness.extension.deactivate(); harness.restoreGlobals();
}
console.log('Registered result-tree original source and keyed opening controls authored; execution deferred.');
