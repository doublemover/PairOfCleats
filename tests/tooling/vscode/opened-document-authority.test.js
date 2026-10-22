import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDocumentAuthority, readVerifiedSource, sourceRangeOffsets, documentOffsets } = require('../../../extensions/vscode/document-authority.js');
const { sourceNavigationArgs } = require('../../../extensions/vscode/source-navigation.js');
const { generationFromContextPack, contextDiscoveryRequest, contextDiscoveryCliArgs } = require('../../../extensions/vscode/semantic-discovery.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-opened-document-authority-'));
const file = path.join(root, 'snow 雪.js');
const uri = { scheme: 'file', fsPath: file };
const raw = '\ufeffa😀z\r\nsecond\r\n';
const hash = value => createHash('sha256').update(Buffer.from(value)).digest('hex');
const sourceHash = hash(raw);
const range = { startLine: 2, startCol: 1, endLine: 2, endCol: 7 };
try {
  fs.writeFileSync(file, raw);
  const document = { uri, version: 1, isDirty: false, getText: () => 'a😀z\nsecond\n' };
  let opened = 0;
  const authority = createDocumentAuthority({ workspace: { async openTextDocument() { opened += 1; return document; } } });
  const first = await authority.qualify({ repoRoot: root, file, uri, sourceHash, range });
  assert.deepEqual(first.offsets, { start: 5, end: 11 });
  assert.deepEqual(first.originalSource, { file: 'snow 雪.js', contentDigest: sourceHash, byteLength: Buffer.byteLength(raw),
    span: { start: 11, end: 17, unit: 'utf8-byte' } }, 'metadata-only original-byte witness retains BOM/astral/CRLF bytes without buffer-offset relabeling');
  assert(Object.isFrozen(first.originalSource)); assert(Object.isFrozen(first.originalSource.span));
  await authority.qualify({ repoRoot: root, file, uri, sourceHash, range });
  assert.equal(opened, 1, 'one provider request opens each exact file/hash once');
  await authority.assertCurrent();
  const sibling = path.join(root, 'identical-sibling.js'), siblingUri = { scheme: 'file', fsPath: sibling };
  fs.writeFileSync(sibling, raw);
  await assert.rejects(authority.qualify({ repoRoot: root, file, uri: siblingUri, sourceHash, range }), /URI|source file/,
    'a cached source/hash cannot grant an identical-text sibling document location authority');
  const otherRoot = path.join(root, 'other-root'); fs.mkdirSync(otherRoot);
  const rootAuthority = createDocumentAuthority({ workspace: { async openTextDocument() { return document; } } });
  await rootAuthority.qualify({ repoRoot: root, file, uri, sourceHash, range });
  await assert.rejects(rootAuthority.qualify({ repoRoot: otherRoot, file, uri, sourceHash, range }), /outside/,
    'a cached file/hash from another repository root cannot bypass selected-root admission');
  const wrongOpened = createDocumentAuthority({ workspace: { async openTextDocument() { return { ...document, uri: siblingUri }; } } });
  await assert.rejects(wrongOpened.qualify({ repoRoot: root, file, uri, sourceHash, range }), /URI|source file/);
  const virtualOpened = createDocumentAuthority({ workspace: { async openTextDocument() { return { ...document, uri: { scheme: 'untitled', fsPath: file } }; } } });
  await assert.rejects(virtualOpened.qualify({ repoRoot: root, file, uri, sourceHash, range }), /URI|source file/);
  const closedOpened = createDocumentAuthority({ workspace: { async openTextDocument() { return { ...document, isClosed: true }; } } });
  await assert.rejects(closedOpened.qualify({ repoRoot: root, file, uri, sourceHash, range }), /closed/);
  document.uri = siblingUri;
  await assert.rejects(authority.assertCurrent(), /URI|source file/, 'last publication rechecks the actual document file binding');
  document.uri = uri;
  document.isClosed = true; await assert.rejects(authority.assertCurrent(), /closed/); document.isClosed = false;
  document.version += 1;
  await assert.rejects(authority.assertCurrent(), /version|changed/i);

  const retainedBuffer = { uri, version: 1, isDirty: false, getText: () => 'a😀z\nsecond\n' };
  const spanAuthority = createDocumentAuthority({ workspace: { async openTextDocument() { return retainedBuffer; } } });
  const selectedSpan = await spanAuthority.qualify({ repoRoot: root, file, uri, sourceHash, span: { start: 7, end: 13 } });
  assert.deepEqual(selectedSpan.offsets, { start: 5, end: 11 });
  fs.writeFileSync(file, raw + 'changed after opening');
  await assert.rejects(spanAuthority.assertCurrent(), /differs|changed/,
    'an unchanged saved buffer cannot hide disk replacement during a later editor await');
  fs.writeFileSync(file, raw);

  const changed = createDocumentAuthority({ workspace: { async openTextDocument() {
    fs.writeFileSync(file, 'changed on disk');
    return { uri, version: 1, isDirty: false, getText: () => 'a😀z\nsecond\n' };
  } } });
  await assert.rejects(changed.qualify({ repoRoot: root, file, uri, sourceHash, range }), /differs|changed/,
    'an await cannot join a prior byte witness to a replaced current source');
  fs.writeFileSync(file, raw);
  const dirty = createDocumentAuthority({ workspace: { async openTextDocument() {
    return { uri, version: 1, isDirty: true, getText: () => raw };
  } } });
  await assert.rejects(dirty.qualify({ repoRoot: root, file, uri, sourceHash, range }), /dirty/);
  const malformed = createDocumentAuthority({ workspace: { async openTextDocument() {
    return { uri, version: 1, isDirty: false, getText: () => raw };
  } } });
  await assert.rejects(malformed.qualify({ repoRoot: root, file, uri, sourceHash,
    range: { startLine: 1, startCol: 4, endLine: 1, endCol: 5 } }), /surrogate/);
  const mixed = 'one\rsecond\r\nthird\nfourth\r', normalizedMixed = 'one\nsecond\nthird\nfourth\n';
  assert.deepEqual(sourceRangeOffsets(mixed, { startLine: 4, startCol: 1, endLine: 4, endCol: 7 }), { start: 18, end: 24 });
  assert.deepEqual(sourceRangeOffsets(mixed, { startLine: 5, startCol: 1, endLine: 5, endCol: 1 }), { start: 25, end: 25 });
  assert.throws(() => sourceRangeOffsets(mixed, { startLine: 2, startCol: 8, endLine: 2, endCol: 8 }), /column/);
  assert.deepEqual(documentOffsets({ isDirty: false, getText: () => normalizedMixed }, { sourceText: mixed, start: 18, end: 24 }), { start: 17, end: 23 });
  assert.throws(() => documentOffsets({ isDirty: false, getText: () => mixed }, { sourceText: mixed, start: 11, end: 11 }), /boundary/,
    'a CRLF interior cannot become a native protocol position even when the host retained raw line endings');
  assert.throws(() => documentOffsets({ isDirty: false, getText: () => normalizedMixed + 'other edit' }, { sourceText: mixed, start: 18, end: 24 }), /differs/);
  fs.writeFileSync(file, mixed);
  const mixedDocument = { uri, version: 2, isDirty: false, getText: () => normalizedMixed };
  const mixedAuthority = createDocumentAuthority({ workspace: { async openTextDocument() { return mixedDocument; } } });
  const mixedQualified = await mixedAuthority.qualify({ repoRoot: root, file, uri, sourceHash: hash(mixed),
    range: { startLine: 4, startCol: 1, endLine: 4, endCol: 7 } });
  assert.deepEqual(mixedQualified.offsets, { start: 17, end: 23 });
  assert.deepEqual(mixedQualified.originalSource.span, { start: 18, end: 24, unit: 'utf8-byte' });
  const cursorArgs = sourceNavigationArgs(mixedDocument, { line: 3, character: 0 }, true, root);
  assert.equal(cursorArgs[cursorArgs.indexOf('--line') + 1], '4'); assert.equal(cursorArgs[cursorArgs.indexOf('--column') + 1], '1');
  await mixedAuthority.assertCurrent(); fs.writeFileSync(file, raw);
  assert.throws(() => readVerifiedSource({ repoRoot: path.join(root, 'missing'), file, sourceHash }));

  const generation = { baseBuildId: 'retained-build', semanticRevision: 0 };
  const section = { schemaVersion: 1, repoRoot: '/service/repo', generation, status: 'partial',
    discovery: { generation }, detail: null, trace: null, selector: { field: 'sourcePath', value: 'snow 雪.js' },
    followUps: [{ operation: 'semantic_find', request: { repoRoot: '/service/repo', generation } }], warnings: ['partial remains partial'] };
  const discovered = generationFromContextPack({ semantic: section }, '/service/repo');
  assert.deepEqual(discovered.generation, generation);
  assert.equal(discovered.status, 'partial');
  assert.equal(generationFromContextPack({ semantic: section }, '/editor/repo'), null);
  assert.equal(generationFromContextPack({ runtime: { buildId: 'guess' } }, '/service/repo'), null);
  assert.throws(() => generationFromContextPack({ semantic: { ...section,
    trace: { generation: { baseBuildId: 'replacement', semanticRevision: 0 } } } }, '/service/repo'), /conflicting/);
  const request = contextDiscoveryRequest('/service/repo', 'file:snow 雪.js');
  assert.equal(request.includeSemantic, true);
  assert.equal(request.includeRisk, false);
  assert.equal(request.includeGraph, false);
  assert.equal(request.maxBytes, 8192);
  assert.equal(request.maxWallClockMs, 250);
  const cliArgs = contextDiscoveryCliArgs('/editor/repo', 'file:snow 雪.js');
  assert.equal(cliArgs[cliArgs.indexOf('--includeSemantic') + 1], 'true');
  assert.equal(cliArgs[cliArgs.indexOf('--repo') + 1], '/editor/repo');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('Opened-document byte/buffer authority and canonical semantic generation discovery contracts passed');
