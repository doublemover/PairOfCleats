import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { prepareVsCodeFixtureWorkspace } from '../../helpers/vscode/runtime-harness.js';
const require = createRequire(import.meta.url);
const { createCapturedEvidenceOpener } = require('../../../extensions/vscode/captured-evidence-open.js');
const { createEvidenceCollection, collectEvidenceSources } = require('../../../extensions/vscode/evidence-collection.js');
const { createEditorOperations } = require('../../../extensions/vscode/editor-operations.js');
const { resolveValidatedHitTarget } = require('../../../extensions/vscode/runtime.js');

// Actual opener, document authority, operation owner, path resolver and nested
// collector. UI/producer/clipboard/file-export boundaries are inert.
const workspace = await prepareVsCodeFixtureWorkspace('vscode/workspace-root', { prefix: 'poc-captured-evidence-' });
const file = workspace.resolvePath('src', 'app.ts'), text = 'Widget\n';
const sourceHash = createHash('sha256').update(text).digest('hex');
const fixtures = [], gates = [];
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; });
  const gate = { promise, resolve }; gates.push(gate); return gate; };
const uri = filePath => ({ scheme: 'file', fsPath: path.resolve(filePath), toString() { return pathToFileURL(this.fsPath).href; } });
const source = () => ({ file: 'src/app.ts', name: 'Widget', sourceHash, coordinateUnit: 'utf16', startLine: 1, startCol: 1, endLine: 1, endCol: 7 });
const fixture = () => {
  fs.writeFileSync(file, text);
  const value = { latest: { repoContext: { repoRoot: workspace.root, repoUri: uri(workspace.root) }, payload: { primary: source() } },
    sourcePicks: 0, sourceOpens: 0, sourceShows: 0, previews: 0, selections: [], copies: [], writes: [], errors: [], infos: [], fetched: [] };
  value.operations = createEditorOperations({ spawn() { assert.fail('captured source adapter does not spawn'); } });
  const api = { Uri: { file: uri, parse: value => uri(fileURLToPath(value)), joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) },
    Selection: class { constructor(start, end) { this.start = start; this.end = end; } },
    workspace: {
      async openTextDocument(input) {
        const preview = typeof input.content === 'string';
        const document = { uri: preview ? { scheme: 'untitled' } : input, version: 1, isDirty: false, isClosed: false,
          content: preview ? input.content : fs.readFileSync(input.fsPath, 'utf8'), getText() { return this.content; },
          positionAt(offset) { const rows = this.content.slice(0, offset).split('\n'); return { line: rows.length - 1, character: rows.at(-1).length }; } };
        if (!preview) { value.sourceOpens++; await value.onOpen?.(document); }
        return document;
      },
      fs: { async writeFile(target, bytes) { value.writes.push({ target, text: bytes.toString('utf8') }); } }
    }, window: {
      async showQuickPick(items, options) {
        assert(Object.isFrozen(items));
        if (options.title === 'Open captured context / risk evidence') {
          value.sourcePicks++; assert(Object.isFrozen(items[0])); assert(Object.isFrozen(items[0].hit));
          return value.chooseSource ? value.chooseSource(items) : items[0];
        }
        if (options.title.startsWith('Select source') || options.title.startsWith('Review evidence')) return [...items];
        if (options.title.startsWith('Reviewed context')) return value.exportAction || 'Copy JSON';
        return value.chooseAction ? value.chooseAction(items) : (value.context ? 'Create Context from This Evidence' : 'Open Source');
      },
      async showInputBox() { return 'Investigate original source'; },
      async showTextDocument(document) {
        if (document.uri.scheme === 'file') value.sourceShows++; else value.previews++;
        if (value.onDisplay) return value.onDisplay(document);
        return { document, set selection(selection) { value.selections.push(selection); }, revealRange() {} };
      },
      async showSaveDialog() { return value.onSave ? value.onSave() : uri(workspace.resolvePath('chosen.json')); },
      showErrorMessage(message) { value.errors.push(message); }, showInformationMessage(message) { value.infos.push(message); }
    }, env: { clipboard: { async writeText(content) { value.copies.push(content); } } } };
  const vscode = value.operations.wrapVscode(api);
  const copy = createEvidenceCollection({ vscode, operations: value.operations, getResults() { assert.fail('opener supplies its original result set'); },
    fetchContext: async (seed, authority) => { value.fetched.push({ seed, authority });
      if (value.fetch) await value.fetch();
      return { version: '1.0.0', seed: { type: 'file', path: 'src/app.ts' }, primary: { file: 'src/app.ts', excerpt: text },
        provenance: { repo: workspace.root, artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION }, evidence: { schemaVersion: 1, complete: false },
        warnings: [{ code: 'partial_frontier', message: 'Original incomplete evidence' }], graph: null, risk: null }; } });
  value.run = createCapturedEvidenceOpener({ vscode, operations: value.operations,
    getEvidence: () => value.getEvidence ? value.getEvidence() : value.latest,
    collectSources: payload => value.collect ? value.collect(payload) : collectEvidenceSources(payload),
    resolveTarget: (repo, hit) => resolveValidatedHitTarget(vscode, repo, hit), createContext: copy });
  fixtures.push(value); return value;
};
try {
  const normal = fixture(); await normal.run(); assert.equal(normal.selections.length, 1);
  assert.deepEqual(normal.selections[0].start, { line: 0, character: 0 }); assert.deepEqual(normal.selections[0].end, { line: 0, character: 6 });
  const mutated = fixture(); mutated.chooseSource = items => {
    mutated.latest.payload.primary.file = 'foreign.ts'; mutated.latest.payload.primary.startCol = 99;
    mutated.latest.repoContext.repoRoot = workspace.resolvePath('foreign'); mutated.latest.repoContext.repoUri.fsPath = workspace.resolvePath('foreign');
    return items[0]; };
  await mutated.run(); assert.equal(mutated.selections.length, 1, 'private source/root/URI capture survives original object mutation');
  assert.equal(mutated.selections[0].start.character, 0);
  for (const configure of [value => { value.chooseSource = items => ({ ...items[0] }); },
    value => { value.chooseAction = () => 'Open Foreign Source'; }]) {
    const invalid = fixture(); configure(invalid); await invalid.run(); assert.equal(invalid.sourceOpens, 0); assert.equal(invalid.selections.length, 0);
  }
  for (const boundary of ['picker', 'action', 'open', 'display']) {
    const stale = fixture(); const replace = () => { stale.latest = { ...stale.latest }; };
    if (boundary === 'picker') stale.chooseSource = items => { replace(); return items[0]; };
    if (boundary === 'action') stale.chooseAction = () => { replace(); return 'Open Source'; };
    if (boundary === 'open') stale.onOpen = replace;
    if (boundary === 'display') stale.onDisplay = document => { replace(); return { document, set selection(_value) { assert.fail('stale display cannot select'); } }; };
    await stale.run(); assert.equal(stale.selections.length, 0, `${boundary} retains original capture identity`);
  }
  for (const mutate of [document => { document.version++; }, document => { document.isDirty = true; },
    document => { document.isClosed = true; }, document => { document.uri = { scheme: 'untitled', fsPath: file }; },
    () => { fs.writeFileSync(file, text + 'replacement'); }]) {
    const changed = fixture(); changed.onDisplay = document => { mutate(document); return { document,
      set selection(_value) { assert.fail('changed target cannot select'); } }; };
    await changed.run(); assert.equal(changed.selections.length, 0); assert.equal(changed.errors.length, 1);
  }
  const sibling = fixture(); sibling.onDisplay = document => ({ document: { ...document }, set selection(_value) { assert.fail('foreign editor cannot select'); } });
  await sibling.run(); assert(sibling.errors.some(message => /Displayed editor/.test(message)));
  const pathEscape = fixture(); pathEscape.latest.payload.primary.file = '../outside.ts'; await pathEscape.run(); assert.equal(pathEscape.sourceOpens, 0);
  const changedHash = fixture(); changedHash.latest.payload.primary.sourceHash = 'a'.repeat(64); await changedHash.run(); assert.equal(changedHash.sourceOpens, 0);
  const noCoordinates = fixture(); noCoordinates.latest.payload.primary.coordinateUnit = 'utf8-byte'; await noCoordinates.run();
  assert.equal(noCoordinates.sourceShows, 1); assert.equal(noCoordinates.selections.length, 0); assert(noCoordinates.infos.some(message => /no exact UTF-16 range/.test(message)));
  const unknown = fixture(); delete unknown.latest.payload.primary.sourceHash; await unknown.run();
  assert.equal(unknown.sourceShows, 1); assert.equal(unknown.selections.length, 0); assert(unknown.infos.some(message => /freshness is unknown/.test(message)));
  const oldFile = fixture(); delete oldFile.latest.payload.primary.sourceHash;
  oldFile.onOpen = () => { oldFile.latest = { ...oldFile.latest }; }; await oldFile.run(); assert.equal(oldFile.sourceShows, 0, 'unqualified file open still checks capture before display');

  const overlap = fixture(), openEntered = deferred(), openGate = deferred(); let firstOpen = true;
  overlap.onOpen = async () => { if (firstOpen) { firstOpen = false; openEntered.resolve(); await openGate.promise; } };
  const older = overlap.run(); await openEntered.promise; await overlap.run(); openGate.resolve(); await older;
  assert.equal(overlap.selections.length, 1, 'late original construction cannot select after a newer keyed opener');

  const nested = fixture(), fetchEntered = deferred(), fetchGate = deferred(); nested.context = true;
  nested.fetch = async () => { fetchEntered.resolve(); await fetchGate.promise; };
  const oldNested = nested.run(); await fetchEntered.promise; nested.context = false; await nested.run(); fetchGate.resolve(); await oldNested;
  assert.equal(nested.sourceShows, 1); assert.equal(nested.previews, 0); assert.equal(nested.copies.length, 0,
    'nested collector must check original parent scope even while its own child scope is current');
  assert.equal(nested.fetched[0].seed, 'file:src/app.ts'); assert.equal(nested.fetched[0].authority.repoRoot, workspace.root);
  const nestedSave = fixture(); nestedSave.context = true; nestedSave.exportAction = 'Export JSON';
  nestedSave.onSave = () => { nestedSave.latest = { ...nestedSave.latest }; return uri(workspace.resolvePath('stale.json')); };
  await nestedSave.run(); assert.equal(nestedSave.writes.length, 0, 'new captured publication revokes pending nested export');

  for (const primary of [undefined, null, false, 0, '']) {
    const failed = fixture(); failed.collect = () => { throw primary; }; const result = await failed.run();
    assert.equal(result.primaryError, primary); assert.equal(result.ok, false); assert.equal(failed.sourcePicks, 0);
  }
  let reads = 0, observed = 0;
  const inspection = Object.freeze({ cacheOwnershipReleased: () => false });
  const original = Object.freeze(Object.defineProperty({}, 'message', { get() { reads++; throw inspection; } }));
  const failingCurrent = fixture(); failingCurrent.getEvidence = () => { observed++; if (observed > 1) throw original; return failingCurrent.latest; };
  const failure = await failingCurrent.run(); assert.equal(failure.primaryError, original); assert.deepEqual(failure.inspectionErrors, [inspection]);
  assert.equal(reads, 1); assert.equal(observed, 2, 'original authority inspection failure cannot be retried during reporting');
  assert.equal(failure.inspectionErrors[0].cacheOwnershipReleased(), false);
} finally { for (const gate of gates) gate.resolve(); for (const value of fixtures) await value.operations.dispose(); }
console.log('Captured evidence original source/picker/nested-parent lifetime controls authored; execution deferred.');
