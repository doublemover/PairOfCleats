import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createCompilerSourceIndex } from '../../../src/index/semantic/compiler-source-index.js';
import { createSemanticCompilerSession } from '../../../src/index/semantic/compiler-session.js';
import { createCompilerBoundaryFixture } from '../../helpers/compiler-boundary-fixture.js';

// UNVALIDATED: deterministic join counts, not a wall-time/heap benchmark.
const digest = text => createHash('sha256').update(text).digest('hex');
const keyPath = file => process.platform === 'win32' ? path.resolve(file).toLowerCase() : path.resolve(file);
for (const count of [1000, 10000]) {
  const root = path.resolve('fixture-source-index'), inventory = new Map(), factsBySource = new Map(), texts = new Map();
  for (let index = 0; index < count; index++) {
    const file = 'source-' + index + '.ts', text = 'export const value = ' + index + ';';
    const source = { sourceUnitId: 'source:' + index, path: file, textHash: digest(text), mapping: null };
    const item = { source, sourceMap: null }; inventory.set(keyPath(path.join(root, file)), item); texts.set(file, text);
  }
  const indexed = createCompilerSourceIndex({ root, inventory, factsBySource, texts });
  for (let index = 0; index < count; index++) {
    const file = 'source-' + index + '.ts';
    assert.equal(indexed.sourceForDoc({ virtualPath: file, text: texts.get(file) }).source.path, file);
    assert.equal(indexed.sourceForDoc({ virtualPath: file, text: 'changed' }), undefined, 'ordinary path cannot label a different text as retained');
  }
  assert.equal(indexed.snapshot().lookups, count * 2); assert.equal(indexed.snapshot().candidates, count * 2);
  assert.equal(indexed.snapshot().documentTextHashes, 0, 'ordinary retained text joins need no new digest or inventory scan');
}
for (const count of [5, 20]) {
  const root = path.resolve('fixture-segment-index'), inventory = new Map(), factsBySource = new Map(), texts = new Map();
  factsBySource.set('parent', ['parent.vue', { sourceUnitId: 'parent' }]);
  for (let index = 0; index < count; index++) {
    const file = 'segment-' + index + '.ts', text = 'export const segment = ' + index + ';';
    const item = { source: { sourceUnitId: 'segment:' + index, path: file, textHash: digest(text), mapping: { parentSourceUnitId: 'parent' } },
      sourceMap: { segmentUid: 'same-range', parentStart: 10, parentEnd: 1000, localEnd: text.length } };
    inventory.set(keyPath(path.join(root, file)), item); texts.set(file, text);
  }
  const indexed = createCompilerSourceIndex({ root, inventory, factsBySource, texts });
  const doc = { virtualPath: 'segment-0.ts', containerPath: 'parent.vue', segmentUid: 'same-range',
    segmentRange: { start: 10, end: 1000 }, text: texts.get('segment-0.ts') };
  for (let repeat = 0; repeat < 10; repeat++) assert.equal(indexed.sourceForDoc(doc).source.path, 'segment-0.ts');
  assert.equal(indexed.snapshot().candidates, 10); assert.equal(indexed.snapshot().documentTextHashes, 1);
  doc.text = texts.get('segment-1.ts'); assert.equal(indexed.sourceForDoc(doc).source.path, 'segment-1.ts');
  assert.equal(indexed.snapshot().documentTextHashes, 2, 'mutated document text invalidates its digest memo');
  doc.semanticSourceUnitId = 'segment:0'; assert.equal(indexed.sourceForDoc(doc), undefined);
  const collision = { ...inventory.values().next().value, source: { ...inventory.values().next().value.source, sourceUnitId: 'collision' } };
  inventory.set(keyPath(path.join(root, 'collision.ts')), collision);
  const ambiguous = createCompilerSourceIndex({ root, inventory, factsBySource, texts });
  assert.throws(() => ambiguous.sourceForDoc({ ...doc, text: texts.get('segment-0.ts'), semanticSourceUnitId: null }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-session-source-index-'));
try {
  const text = 'export function retained(value: number) { return value; }';
  const fixture = await createCompilerBoundaryFixture(root, { 'retained.ts': text });
  const session = await createSemanticCompilerSession({ state: fixture.state,
    runtime: { root, buildRoot: root, semanticPolicy: fixture.policy } });
  const document = { virtualPath: 'retained.ts', containerPath: 'retained.ts', text, segmentUid: null };
  const prepared = session.prepareDocuments([document]);
  assert.equal(prepared[0].semanticSourceUnitId, fixture.documents[0].item.source.sourceUnitId);
  assert.equal(session.describeCompilerDocuments(prepared)[0].authority.sourceUnitId, prepared[0].semanticSourceUnitId);
  assert.equal(session.describeCompilerDocuments([{ ...document, text: text + ' changed' }])[0].authority.sourceUnitId, null);
  assert.ok(session.identityStats().candidates <= session.identityStats().lookups);
  const sourceFile = fixture.documents[0].sourceFile, ts = fixture.documents[0].ts;
  const duplicate = ts.createSourceFile(sourceFile.fileName, 'export const changed = true;', ts.ScriptTarget.Latest, true);
  assert.throws(() => session.beginGroup({ ts, program: { getSourceFiles: () => [sourceFile, duplicate] },
    options: {}, documents: prepared, configPath: null }), { code: 'ERR_SEMANTIC_SOURCE_MISMATCH' });
  const group = session.beginGroup({ ts, program: fixture.program, options: {}, documents: prepared, configPath: null });
  assert.equal(group.sourceObjectHashes.get(sourceFile).hash, fixture.documents[0].item.source.textHash);
  console.log('Compiler source joins use bounded identity candidates and preserve actual retained-text admission.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
