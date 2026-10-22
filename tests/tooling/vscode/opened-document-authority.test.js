import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createDocumentAuthority, readVerifiedSource } = require('../../../extensions/vscode/document-authority.js');
const { generationFromContextPack, contextDiscoveryRequest, contextDiscoveryCliArgs } = require('../../../extensions/vscode/semantic-discovery.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-opened-document-authority-'));
const file = path.join(root, 'snow 雪.js');
const raw = '\ufeffa😀z\r\nsecond\r\n';
const hash = value => createHash('sha256').update(Buffer.from(value)).digest('hex');
const sourceHash = hash(raw);
const range = { startLine: 2, startCol: 1, endLine: 2, endCol: 7 };
try {
  fs.writeFileSync(file, raw);
  const document = { version: 1, isDirty: false, getText: () => 'a😀z\nsecond\n' };
  let opened = 0;
  const authority = createDocumentAuthority({ workspace: { async openTextDocument() { opened += 1; return document; } } });
  const first = await authority.qualify({ repoRoot: root, file, uri: { path: file }, sourceHash, range });
  assert.deepEqual(first.offsets, { start: 5, end: 11 });
  await authority.qualify({ repoRoot: root, file, uri: { path: file }, sourceHash, range });
  assert.equal(opened, 1, 'one provider request opens each exact file/hash once');
  await authority.assertCurrent();
  document.version += 1;
  await assert.rejects(authority.assertCurrent(), /version|changed/i);

  const changed = createDocumentAuthority({ workspace: { async openTextDocument() {
    fs.writeFileSync(file, 'changed on disk');
    return { version: 1, isDirty: false, getText: () => 'a😀z\nsecond\n' };
  } } });
  await assert.rejects(changed.qualify({ repoRoot: root, file, uri: {}, sourceHash, range }), /differs|changed/,
    'an await cannot join a prior byte witness to a replaced current source');
  fs.writeFileSync(file, raw);
  const dirty = createDocumentAuthority({ workspace: { async openTextDocument() {
    return { version: 1, isDirty: true, getText: () => raw };
  } } });
  await assert.rejects(dirty.qualify({ repoRoot: root, file, uri: {}, sourceHash, range }), /dirty/);
  const malformed = createDocumentAuthority({ workspace: { async openTextDocument() {
    return { version: 1, isDirty: false, getText: () => raw };
  } } });
  await assert.rejects(malformed.qualify({ repoRoot: root, file, uri: {}, sourceHash,
    range: { startLine: 1, startCol: 4, endLine: 1, endCol: 5 } }), /surrogate/);
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
