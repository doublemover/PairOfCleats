import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sourceNavigationArgs, qualifiedNavigationRows, verifyLocationSource } = require('../../../extensions/vscode/source-navigation.js');
const { readGitHead, serviceRelativeFile, validateServiceRoot, verifyServiceRevision } = require('../../../extensions/vscode/service-repository.js');
const { createEditorProgressDecoder, applyProgressEvent, apiReadinessFrame, describeTask } = require('../../../extensions/vscode/progress-view.js');
const { collectEvidenceSources, evidenceSeed, renderEvidencePreview } = require('../../../extensions/vscode/evidence-collection.js');

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'poc-editor-source-contract-'));
try {
  const file = path.join(temporary, 'snow 雪.js');
  const text = 'const value = "😀";\nvalue();\n';
  fs.writeFileSync(file, text);
  const hash = createHash('sha256').update(Buffer.from(text)).digest('hex');
  const document = { uri: { fsPath: file }, version: 7, isDirty: false, getText: () => text };
  const args = sourceNavigationArgs(document, { line: 1, character: 2 }, false);
  assert.equal(args[args.indexOf('--source-hash') + 1], hash);
  assert.equal(args[args.indexOf('--source-version') + 1], '7');
  assert.equal(args[args.indexOf('--line') + 1], '2');
  assert.equal(args[args.indexOf('--column') + 1], '3');
  assert.equal(args[args.indexOf('--include-declaration') + 1], 'false');
  assert.throws(() => sourceNavigationArgs({ ...document, isDirty: true }, { line: 1, character: 0 }), /saved source/);
  assert.throws(() => sourceNavigationArgs({ ...document, getText: () => 'changed' }, { line: 0, character: 0 }), /differs from disk/);
  assert.equal(verifyLocationSource(file, hash), true);
  fs.appendFileSync(file, 'changed');
  assert.equal(verifyLocationSource(file, hash), false, 'stale offsets are never joined to changed source');
  const exact = { sourceHash: hash, coordinateUnit: 'utf16', startLine: 1, startCol: 1, endLine: 2, endCol: 3 };
  assert.deepEqual(qualifiedNavigationRows({ status: 'resolved', binding: { status: 'resolved' }, results: [exact, { ...exact, sourceHash: null }] }), [exact]);
  assert.deepEqual(qualifiedNavigationRows({ status: 'partial', binding: { status: 'resolved' }, results: [exact] }), [], 'native providers do not imply completeness for partial reference sets');
  assert.deepEqual(qualifiedNavigationRows({ status: 'ambiguous', results: [exact] }), []);
  assert.deepEqual(qualifiedNavigationRows({ status: 'approximate', results: [exact] }), []);

  fs.mkdirSync(path.join(temporary, '.git'));
  const commit = 'a'.repeat(40);
  fs.writeFileSync(path.join(temporary, '.git', 'HEAD'), `${commit}\n`);
  assert.equal(readGitHead(temporary), commit);
  assert.equal(validateServiceRoot('/srv/雪 project'), '/srv/雪 project');
  assert.throws(() => validateServiceRoot('/srv/a/../other'), /traversal/);
  assert.equal(serviceRelativeFile('/srv/雪 project/src/a.js', '/srv/雪 project'), 'src/a.js');
  assert.equal(serviceRelativeFile('C:\\remote repo\\src\\a.js', 'C:\\remote repo'), 'src/a.js');
  assert.throws(() => serviceRelativeFile('/srv/sibling/a.js', '/srv/repo'), /outside/);
  assert.throws(() => serviceRelativeFile('D:\\other\\a.js', 'C:\\repo'), /outside/);
  assert.equal(verifyServiceRevision({ coverage: { currentProvenance: { commit, dirty: false } } }, commit).commit, commit);
  assert.throws(() => verifyServiceRevision({ coverage: { currentProvenance: { commit: 'b'.repeat(40) } } }, commit), /does not match/);
  assert.throws(() => verifyServiceRevision({ coverage: { currentProvenance: { commit, dirty: true } } }, commit), /dirty/);

  const events = [], logs = [];
  const frame = { proto: 'poc.progress@2', event: 'task:progress', ts: '2026-10-22T10:00:00.000Z', stage: 'parsing', message: '雪', current: 2, total: 5 };
  const bytes = Buffer.from(JSON.stringify(frame) + '\n');
  const decoder = createEditorProgressDecoder({ onEvent: value => events.push(value), onText: value => logs.push(value), maxLineBytes: 1024 });
  for (const byte of bytes) decoder.push(Buffer.from([byte]));
  decoder.push(Buffer.from('x'.repeat(2048) + '\n'));
  decoder.push(Buffer.from('{"proto":"poc.progress@2","event":"task:progress","ts":"invalid"}\n'));
  decoder.flush();
  assert.deepEqual(events, [frame], 'split UTF-8 is decoded once and malformed/oversized lines never become events');
  assert.equal(logs.length, 2);
  const state = applyProgressEvent({ phase: 'starting', startedAt: 100 }, frame, 200);
  assert.equal(state.stage, 'parsing');
  assert.equal(state.current, 2);
  assert.equal(state.phase, 'indexing');
  assert.equal(apiReadinessFrame('[api] listening at http://localhost:7345'), null);
  assert.equal(apiReadinessFrame(JSON.stringify({ ok: true, port: 7345, baseUrl: 'http://127.0.0.1:7345' })), 'http://127.0.0.1:7345');
  assert.equal(apiReadinessFrame(JSON.stringify({ ok: true, port: 7345, baseUrl: 'http://token:secret@127.0.0.1:7345' })), null);
  assert.match(describeTask({ spec: { title: 'Build' }, repoRoot: '/repo', sessionId: 'exact-2', stopping: true, progress: state }, 300), /State: stopping/);

  const packet = { version: '1.0.0', seed: { type: 'file', path: 'a.js' }, primary: { file: 'a.js', ref: null, excerpt: 'literal [command](command:do-not-run)' },
    provenance: { repo: '/repo', indexSignature: 'generation-a', generatedAt: '2026-10-22T10:00:00.000Z', capsUsed: {} }, evidence: { schemaVersion: 1, complete: false, semantic: { included: true, state: 'partial' } },
    warnings: [{ code: 'partial_frontier', message: 'Unknown flow remains' }], graph: { version: '1.0.0', seed: { type: 'file', path: 'a.js' }, provenance: { generatedAt: '2026-10-22T10:00:00.000Z', capsUsed: {}, indexSignature: 'generation-a' }, nodes: [{ file: 'b.js', ref: { type: 'chunk', chunkUid: 'two' } }], edges: [] },
    risk: null };
  assert.deepEqual(collectEvidenceSources(packet).map(value => value.file), ['a.js', 'b.js']);
  assert.deepEqual(collectEvidenceSources({ flows: [{ evidence: { callSitesByStep: [[{ details: { file: 'witness.js', startLine: 3 } }]] } }] }).map(value => value.file), ['witness.js']);
  assert.equal(evidenceSeed({ ref: { type: 'chunk', chunkUid: 'two' } }), 'chunk:two');
  const preview = renderEvidencePreview([packet], 'Investigate partial flow', ['one excluded by user']);
  assert.deepEqual(JSON.parse(preview.json), [packet], 'JSON export does not replace the canonical packet or strip warnings');
  assert.match(preview.markdown, /Unknown flow remains/);
  assert.match(preview.markdown, /one excluded by user/);
  assert.match(preview.markdown, /Token estimate unavailable/);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
console.log('Source qualification, cross-host mapping, structured progress and reviewed canonical evidence contracts passed');
