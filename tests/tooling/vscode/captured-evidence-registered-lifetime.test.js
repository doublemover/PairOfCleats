import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { createVsCodeRuntimeHarness, prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';

// Actual registered Open Captured Evidence, populated by the actual context-pack
// consumer. Process/editor/clipboard boundaries use the existing inert harness.
const fixture = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-captured-command-' });
const file = fixture.resolvePath('src', 'app.ts'), text = 'Widget\n'; fs.writeFileSync(file, text);
const payload = () => ({ version: '1.0.0', seed: { type: 'file', path: 'src/app.ts' },
  primary: { file: 'src/app.ts', name: 'Widget', sourceHash: createHash('sha256').update(text).digest('hex'),
    coordinateUnit: 'utf16', startLine: 1, startCol: 1, endLine: 1, endCol: 7 },
  provenance: { repo: fixture.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION },
  evidence: { schemaVersion: 1, complete: false }, warnings: [], graph: null, risk: null });
const harness = createVsCodeRuntimeHarness({ repoRoot: fixture.root, workspaceFolders: [{ path: fixture.root }], activeFile: file,
  globalConfigValues: { cliPath: fixture.resolvePath('bin', 'pairofcleats.js'), apiExecutionMode: 'cli' } });
const gates = []; let selections = 0, displays = 0, originalOpen;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
try {
  harness.activate(); originalOpen = harness.fakeVscode.workspace.openTextDocument;
  harness.fakeVscode.window.showTextDocument = async document => { displays++; return { document,
    set selection(_value) { selections++; }, revealRange() {} }; };
  const spec = harness.extension._test.OPERATOR_COMMAND_SPECS.find(item => item.id === 'pairofcleats.contextPack');
  const capture = async (data = payload()) => {
    harness.queuedResults.push({ code: 0, stdout: JSON.stringify(data) });
    await harness.extension._test.runOperatorCommand(spec, { repoContext: { ok: true, repoRoot: fixture.root,
      repoUri: harness.fakeVscode.Uri.file(fixture.root) }, inputContext: { seed: 'file:src/app.ts', hops: 0, presentationMode: 'output' } });
  };
  const run = () => harness.registeredCommands.get('pairofcleats.openEvidence')();
  const reset = () => { fs.writeFileSync(file, text); harness.fakeVscode.workspace.textDocuments.length = 0;
    harness.quickPickQueue.length = 0; harness.fakeVscode.workspace.openTextDocument = originalOpen; };
  const originalItem = items => { assert(Object.isFrozen(items)); assert(Object.isFrozen(items[0].hit)); return items[0]; };

  await run(); assert(harness.infoMessages.some(message => /capture evidence first/.test(message)));
  {
    const node = { hit: { file: 'src/app.ts' }, resultSet: { repoRoot: fixture.root, hits: [] } };
    let nativeArgumentCalls = 0;
    for (const extra of [[node], () => { nativeArgumentCalls++; return true; }]) {
      const errors = harness.errorMessages.length;
      harness.quickPickQueue.push(() => undefined);
      await harness.registeredCommands.get('pairofcleats.copyContext')(node, extra);
      assert.equal(harness.quickPickQueue.length, 0, 'ordinary command extras do not replace the private parent prerequisite');
      assert.equal(harness.errorMessages.length, errors);
    }
    assert.equal(nativeArgumentCalls, 0, 'native command arguments cannot become a revocation callback');
  }
  reset(); await capture(); harness.quickPickQueue.push(originalItem, 'Open Source');
  let before = selections; await run(); assert.equal(selections, before + 1);
  reset(); await capture(); harness.quickPickQueue.push(items => ({ ...items[0] }), 'Open Source');
  before = displays; await run(); assert.equal(displays, before, 'registered command rejects copied original item');
  reset(); await capture(); harness.quickPickQueue.push(originalItem, 'Open Injected Source');
  before = displays; await run(); assert.equal(displays, before, 'registered command admits only offered source/context actions');

  reset(); await capture(); harness.quickPickQueue.push(async items => { await capture(); return items[0]; }, 'Open Source');
  before = displays; await run(); assert.equal(displays, before, 'another actual publication revokes original picker');
  reset(); const unknown = payload(); delete unknown.primary.sourceHash; await capture(unknown);
  harness.quickPickQueue.push(originalItem, 'Open Source');
  harness.fakeVscode.workspace.openTextDocument = async input => { const document = await originalOpen.call(harness.fakeVscode.workspace, input);
    if (input.scheme === 'file') await capture(); return document; };
  before = displays; await run(); assert.equal(displays, before, 'unknown-freshness path cannot display after another actual evidence publication');

  reset(); await capture(); harness.quickPickQueue.push(originalItem, 'Open Source');
  const entered = deferred(), gate = deferred(); let first = true;
  harness.fakeVscode.workspace.openTextDocument = async input => {
    const document = await originalOpen.call(harness.fakeVscode.workspace, input);
    if (first) { first = false; entered.resolve(); await gate.promise; } return document;
  };
  const older = run(); await entered.promise; harness.quickPickQueue.length = 0;
  harness.quickPickQueue.push(originalItem, 'Open Source'); before = selections; await run(); gate.resolve(); await older;
  assert.equal(selections, before + 1, 'late registered opener cannot publish a second exact selection');

  reset(); await capture();
  const operationFailure = Object.freeze(new Error('registered original captured picker'));
  const notificationFailure = Object.freeze(new Error('registered original captured notification'));
  harness.quickPickQueue.push(() => { throw operationFailure; });
  const originalNotify = harness.fakeVscode.window.showErrorMessage;
  harness.fakeVscode.window.showErrorMessage = async message => { harness.errorMessages.push(message); throw notificationFailure; };
  try {
    const result = await run(); assert.equal(result.primaryError, operationFailure);
    assert.deepEqual(result.inspectionErrors, [notificationFailure]);
  } finally { harness.fakeVscode.window.showErrorMessage = originalNotify; }
} finally {
  for (const gate of gates) gate.resolve();
  if (originalOpen) harness.fakeVscode.workspace.openTextDocument = originalOpen;
  await harness.extension.deactivate(); harness.restoreGlobals();
}
console.log('Registered captured evidence original publication/path/picker lifetime controls authored; execution deferred.');
