import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';
const require = createRequire(import.meta.url);
const { openSearchHit } = require('../../../extensions/vscode/runtime.js');
const { createEditorOperations } = require('../../../extensions/vscode/editor-operations.js');

// Actual runtime opener, document authority, original failure and operation
// owners. Native document/display boundaries are inert; source bytes are local
// fixture data. No real editor, child, provider or network host is started.
const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-original-search-open-' });
const file = workspace.resolvePath('src', 'app.ts'), sibling = workspace.resolvePath('src', 'sibling.ts');
const sourceText = '\ufeffone\r\n😀Widget\r\nlast\n', bufferText = 'one\n😀Widget\nlast\n';
const sourceHash = createHash('sha256').update(sourceText).digest('hex');
const uri = filePath => ({ scheme: 'file', authority: '', fsPath: path.resolve(filePath), path: path.resolve(filePath).split(path.sep).join('/') });
const gates = [], fixtures = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); const gate = { promise, resolve }; gates.push(gate); return gate; };
const qualifiedHit = () => ({ file: 'src/app.ts', sourceHash, coordinateUnit: 'utf16', startLine: 2, startCol: 3, endLine: 2, endCol: 9 });
const coordinates = selection => [selection.start.line, selection.start.character, selection.end.line, selection.end.character];
const fixture = () => {
  fs.writeFileSync(file, sourceText); fs.writeFileSync(sibling, sourceText);
  const value = { current: true, opens: 0, shows: 0, selections: [], reveals: [] };
  value.api = {
    Uri: { file: uri, joinPath: (base, ...parts) => base.scheme === 'file' ? uri(path.join(base.fsPath, ...parts))
      : { ...base, path: path.posix.join(base.path, ...parts), fsPath: path.posix.join(base.path, ...parts) } },
    Position: class { constructor(line, character) { this.line = line; this.character = character; } },
    Range: class { constructor(start, end) { this.start = start; this.end = end; } },
    Selection: class { constructor(start, end) { this.start = start; this.end = end; } }, TextEditorRevealType: { InCenter: 'center' },
    workspace: { async openTextDocument(input) {
      value.opens++; const document = { uri: input, version: 1, isDirty: false, isClosed: false,
        getText: () => bufferText, positionAt(offset) { const rows = bufferText.slice(0, offset).split('\n');
          return new value.api.Position(rows.length - 1, rows.at(-1).length); } };
      value.document = document; await value.open?.(document); return document;
    } },
    window: { async showTextDocument(document) {
      value.shows++; if (value.show) return value.show(document);
      return { document, set selection(selection) { value.selections.push(selection); }, revealRange(range) { value.reveals.push(range); } };
    } }
  };
  value.repo = { repoRoot: workspace.root, repoUri: uri(workspace.root) };
  value.run = (hit = qualifiedHit()) => openSearchHit(value.api, value.repo, hit, { isCurrent: () => value.current });
  fixtures.push(value); return value;
};
try {
  const original = fixture(), originalResult = await original.run();
  assert.equal(originalResult.sourceVerified, true); assert.equal(originalResult.rangeEvidence, 'qualified-original-utf16');
  assert.deepEqual(coordinates(original.selections[0]), [1, 2, 1, 8]);
  assert.equal(original.reveals.length, 1);

  const mutable = fixture(), changedHit = qualifiedHit();
  mutable.open = () => { changedHit.file = 'src/sibling.ts'; changedHit.sourceHash = 'f'.repeat(64); changedHit.startLine = 99; changedHit.startCol = 99;
    mutable.repo.repoRoot = workspace.resolvePath('foreign'); mutable.repo.repoUri = uri(workspace.resolvePath('foreign')); };
  assert.equal((await mutable.run(changedHit)).sourceVerified, true);
  assert.deepEqual(coordinates(mutable.selections[0]), coordinates(original.selections[0]), 'source path/hash/root/range are original captured request data');

  const approximate = fixture(), displayHint = { file: 'src/app.ts', startLine: 2, startCol: 5, endLine: 3, endCol: 2 };
  approximate.open = () => { displayHint.startLine = 99; displayHint.endCol = 99;
    approximate.api.window.showTextDocument = () => assert.fail('later native display method is not original request authority'); };
  const approximateResult = await approximate.run(displayHint);
  assert.equal(approximateResult.sourceVerified, false); assert.equal(approximateResult.rangeEvidence, 'unqualified-display-hint');
  assert.equal(approximate.selections[0].start.line, 1); assert.equal(approximate.selections[0].end.character, 1);
  const noRange = fixture(), hashOnly = qualifiedHit(); delete hashOnly.coordinateUnit;
  const hashOnlyResult = await noRange.run(hashOnly);
  assert.equal(hashOnlyResult.sourceVerified, true); assert.equal(hashOnlyResult.rangeApplied, false); assert.equal(noRange.shows, 1); assert.equal(noRange.selections.length, 0);
  const remote = fixture(); remote.repo = { repoRoot: null,
    repoUri: { scheme: 'vscode-remote', authority: 'inert-host', path: '/workspace/repo', fsPath: '/workspace/repo' } };
  const remoteResult = await remote.run({ file: 'src/app.ts', startLine: 2, startCol: 1 });
  assert.equal(remoteResult.ok, true); assert.equal(remoteResult.sourceVerified, false); assert.equal(remote.selections.length, 1);
  const remoteQualified = fixture(); remoteQualified.repo = remote.repo;
  assert.equal((await remoteQualified.run()).ok, false); assert.equal(remoteQualified.opens, 0);

  for (const boundary of ['open', 'show']) {
    const revoked = fixture(), entered = deferred(), gate = deferred();
    revoked[boundary] = async document => { entered.resolve(); await gate.promise; return { document, set selection(_value) { assert.fail('revoked original opening cannot select'); } }; };
    const pending = revoked.run(); await entered.promise; revoked.current = false; gate.resolve();
    assert.equal((await pending).kind, 'cancelled'); assert.equal(revoked.selections.length, 0);
    if (boundary === 'open') assert.equal(revoked.shows, 0);
  }

  for (const mutate of [document => { document.version++; }, document => { document.isDirty = true; },
    document => { document.isClosed = true; }, document => { document.uri = uri(sibling); },
    () => { fs.writeFileSync(file, sourceText + 'changed bytes'); }]) {
    const changed = fixture(); changed.show = document => { mutate(document); return { document, set selection(_value) { assert.fail('changed target cannot receive original range'); } }; };
    assert.equal((await changed.run()).ok, false); assert.equal(changed.selections.length, 0);
  }
  const changedDisk = fixture(); fs.writeFileSync(file, 'foreign bytes');
  assert.equal((await changedDisk.run()).ok, false); assert.equal(changedDisk.opens, 0);
  for (const withHash of [true, false]) {
    const different = fixture(); different.show = document => ({ document: { ...document }, set selection(_value) { assert.fail('equal-text sibling editor is not the original opened document'); } });
    const hit = qualifiedHit(); if (!withHash) delete hit.sourceHash;
    assert.equal((await different.run(hit)).ok, false); assert.equal(different.selections.length, 0);
    const wrongUri = fixture(); wrongUri.open = document => { document.uri = uri(sibling); };
    assert.equal((await wrongUri.run(hit)).ok, false); assert.equal(wrongUri.shows, 0);
  }
  let accessors = 0;
  for (const field of ['file', 'sourceHash', 'coordinateUnit', 'startLine', 'startCol', 'endLine', 'endCol']) {
    const invalid = fixture(), hit = qualifiedHit(); Object.defineProperty(hit, field, { get() { accessors++; return 'forged'; } });
    assert.equal((await invalid.run(hit)).ok, false); assert.equal(invalid.opens, 0);
  }
  assert.equal(accessors, 0);
  const inherited = fixture(), inheritedHit = qualifiedHit(); delete inheritedHit.file; Object.setPrototypeOf(inheritedHit, { file: 'src/app.ts' });
  assert.equal((await inherited.run(inheritedHit)).ok, false); assert.equal(inherited.opens, 0);
  const metadata = fixture(), reads = new Map();
  const captured = new Proxy(qualifiedHit(), {
    get() { assert.fail('original hit getters cannot replace passive request evidence'); },
    getOwnPropertyDescriptor(target, field) { reads.set(field, (reads.get(field) || 0) + 1); return Reflect.getOwnPropertyDescriptor(target, field); }
  });
  assert.equal((await metadata.run(captured)).ok, true); assert([...reads.values()].every(count => count === 1));
  const captureRevoked = fixture(); let captureDescriptors = 0;
  const revokedHit = new Proxy(qualifiedHit(), { getOwnPropertyDescriptor(target, field) {
    captureDescriptors++; captureRevoked.current = false; return Reflect.getOwnPropertyDescriptor(target, field);
  } });
  assert.equal((await captureRevoked.run(revokedHit)).kind, 'cancelled'); assert.equal(captureDescriptors, 1); assert.equal(captureRevoked.opens, 0);
  const repositoryGetter = fixture();
  Object.defineProperty(repositoryGetter.repo, 'repoRoot', { get() { accessors++; return workspace.root; } });
  assert.equal((await repositoryGetter.run()).ok, false); assert.equal(repositoryGetter.opens, 0); assert.equal(accessors, 0);

  let messageReads = 0;
  const inspection = Object.freeze({ cacheOwnershipReleased: () => false });
  const primary = Object.freeze(Object.defineProperties({}, { message: { get() { messageReads++; throw inspection; } },
    stack: { get() { assert.fail('generic source-opening diagnostics do not prepare lazy stack'); } } }));
  const failed = fixture(); failed.open = () => { throw primary; };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await failed.run(); assert.equal(result.primaryError, primary); assert.deepEqual(result.inspectionErrors, [inspection]);
    assert.equal(Object.hasOwn(result, 'cacheOwnershipReleased'), false);
  }
  assert.equal(messageReads, 1);
  for (const thrown of [undefined, null, false, 0, '']) {
    const opaque = fixture(); const result = await opaque.run(new Proxy(qualifiedHit(), { getOwnPropertyDescriptor() { throw thrown; } }));
    assert.equal(result.primaryError, thrown); assert.equal(result.ok, false); assert.equal(opaque.opens, 0);
  }

  const constructorRevoked = fixture(); let positionConstructions = 0;
  constructorRevoked.api.Position = class { constructor() { positionConstructions++; constructorRevoked.current = false; } };
  assert.equal((await constructorRevoked.run({ file: 'src/app.ts', startLine: 2 })).kind, 'cancelled');
  assert.equal(positionConstructions, 1); assert.equal(constructorRevoked.opens, 0);
  const setterRevoked = fixture();
  setterRevoked.show = document => ({ document, set selection(value) { setterRevoked.selections.push(value); setterRevoked.current = false; },
    revealRange() { assert.fail('revoked original selection cannot authorize later reveal'); } });
  assert.equal((await setterRevoked.run()).kind, 'cancelled'); assert.equal(setterRevoked.selections.length, 1);
  const changingPosition = fixture(); let positionCalls = 0;
  changingPosition.open = document => {
    const originalPosition = document.positionAt;
    document.positionAt = function(offset) { positionCalls++; this.positionAt = () => assert.fail('later position method cannot replace the original callback');
      return Reflect.apply(originalPosition, this, [offset]); };
  };
  assert.equal((await changingPosition.run()).ok, true); assert.equal(positionCalls, 2);

  const overlap = fixture(), operations = createEditorOperations({ spawn() { assert.fail('opening cannot spawn'); } });
  const entered = deferred(), gate = deferred(); let first = true;
  overlap.open = async () => { if (first) { first = false; entered.resolve(); await gate.promise; } };
  const owned = () => operations.run('result-hit-open', scope => openSearchHit(overlap.api, overlap.repo, qualifiedHit(),
    { isCurrent: () => operations.isCurrent(scope) }), { key: 'result-hit-open' });
  try {
    const older = owned(); await entered.promise; const newer = await owned(); gate.resolve(); const stale = await older;
    assert.equal(newer.ok, true); assert.equal(stale.kind, 'cancelled'); assert.equal(overlap.selections.length, 1);
  } finally { gate.resolve(); await operations.dispose(); }
} finally { for (const gate of gates) gate.resolve(); }
console.log('Actual search-hit original range/source/callback/editor/operation controls authored; execution deferred.');
