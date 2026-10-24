import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSemanticSourceSnapshot } from '../../src/index/semantic/source.js';
import { queryQualifiedNavigation } from '../../tools/tooling/navigation-qualified.js';

// Controlled canonical store interface plus real, ordinary source bytes. This
// does not substitute for producer -> published store -> editor qualification.
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'navigation-binding-'));
const inputA = '//🙂\r\nfunction duplicate() {}\r\nduplicate();\r\n';
const inputB = 'function duplicate() {}\nduplicate();\nimport {duplicate as alias} from "./a.js";\n/*🙂*/ alias();\n';
await fs.writeFile(path.join(root, 'a.js'), inputA);
await fs.writeFile(path.join(root, 'b.js'), inputB);
const source = (file, text) => createSemanticSourceSnapshot({ bytes: Buffer.from(text), repositoryNamespace: 'test-repository', path: file, language: 'javascript' }).manifest;
const a = source('a.js', inputA), b = source('b.js', inputB);
const sa = 'sy1:' + 'a'.repeat(64), sb = 'sy1:' + 'b'.repeat(64);
const aa = 'sa1:' + 'c'.repeat(64), ab = 'sa1:' + 'd'.repeat(64);
const ref = (partitionId, localId) => ({ partitionId, localId });
const ca = ref(sa, 2), cb = ref(sb, 2), alias = ref(sb, 5), da = ref(sa, 3), db = ref(sb, 3);
const ba = ref(aa, 10), bb = ref(ab, 10), bi = ref(ab, 11);
const occurrence = (id, text, spelling, roles = ['reference', 'call']) => {
  const offset = text.lastIndexOf(spelling);
  return { id, kind: 'occurrence', span: [offset, offset + spelling.length], scope: null, data: { nameId: 0, roles, expression: null, flags: [] } };
};
const declaration = (text, id = 3) => ({ id, kind: 'declaration', span: [text.indexOf('function'), text.indexOf('}') + 1],
  scope: null, data: { nameId: 0, declarationKind: 'function', flags: [], initializer: null, typeSyntax: null } });
const binding = (id, owner, status = 'resolved', count = 1) => ({ id, kind: 'binding', span: null, scope: null,
  data: { occurrence: owner, contextKey: 'fixture-compiler', status, signature: null, symbolGroupId: null, candidateCount: count } });
const records = new Map([
  [sa, [occurrence(2, inputA, 'duplicate'), declaration(inputA)]],
  [sb, [{ ...occurrence(2, inputB, 'duplicate'), span: [inputB.indexOf('duplicate();'), inputB.indexOf('duplicate();') + 'duplicate'.length] }, occurrence(5, inputB, 'alias'), declaration(inputB)]],
  [aa, [binding(10, ca)]], [ab, [binding(10, cb), binding(11, alias)]]
]);
const edge = (from, to, kind) => ({ from, to, kind, certainty: 'exact-static', contextKey: 'fixture-compiler' });
let edges = [edge(ba, da, 'bindingCandidate'), edge(bb, db, 'bindingCandidate'), edge(bi, da, 'bindingCandidate'),
  edge(ca, da, 'callTarget'), edge(cb, db, 'callTarget'), edge(alias, da, 'callTarget')];
const generation = { baseBuildId: 'binding-fixture', semanticRevision: 0 };
const manifest = { partitions: [
  { partitionId: sa, sourceUnitId: a.sourceUnitId }, { partitionId: aa, sourceUnitId: a.sourceUnitId },
  { partitionId: sb, sourceUnitId: b.sourceUnitId }, { partitionId: ab, sourceUnitId: b.sourceUnitId }
] };
const identical = (left, right) => left.partitionId === right.partitionId && left.localId === right.localId;
let closes = 0, opens = 0;
const store = {
  generation, withReadScope: operation => operation(),
  async *iterateRows(partitionId, member) {
    if (member === 'semantic_sources') yield partitionId === sa ? a : b;
    else for (const row of records.get(partitionId) || []) yield row;
  },
  async verifySource() {},
  async getRecords(refs) { return refs.map(reference => {
    const row = records.get(reference.partitionId)?.find(row => row.id === reference.localId);
    return row ? { ...row, ref: reference } : null;
  }); },
  async getNeighbors(reference, direction, kinds, { offset, limit }) {
    const all = edges.filter(row => kinds.includes(row.kind) && identical(row[direction === 'downstream' ? 'from' : 'to'], reference));
    return { edges: all.slice(offset, offset + limit), offset: Math.min(all.length, offset + limit), done: offset + limit >= all.length };
  },
  async getCoverage() { return [{ phase: 'syntax', state: 'complete' }, { phase: 'bindings', state: 'complete' }]; }
};
const request = { repoRoot: root, userConfig: { cache: { root: path.join(root, '.cache') } }, kind: 'definitions', query: 'duplicate',
  filePath: 'a.js', sourceHash: a.byteHash, sourceVersion: '7', line: 3, column: 1, coordinateUnit: 'utf16', includeDeclaration: true };
const options = { openStore: async () => { opens++; return { store, manifest, close: () => { closes++; } }; }, clock: () => 0 };
try {
  const definition = await queryQualifiedNavigation(request, options);
  assert.equal(definition.status, 'resolved');
  assert.deepEqual(JSON.parse(definition.binding.targetId), da);
  assert.equal(definition.results.length, 1);
  assert.equal(definition.results[0].file, 'a.js', 'same spelling in b.js is never pooled');
  assert.equal(definition.results[0].startLine, 2);
  assert.equal(definition.results[0].sourceHash, a.byteHash);
  assert.equal(definition.sourceVersion, '7');
  assert.deepEqual(definition.generation, generation);

  const references = await queryQualifiedNavigation({ ...request, kind: 'references', includeDeclaration: false }, options);
  assert.equal(references.status, 'resolved');
  assert.deepEqual(references.results.map(row => row.file), ['a.js', 'b.js']);
  assert.equal(references.results.find(row => row.file === 'b.js').startCol, 8, 'astral character occupies two UTF-16 units');
  assert.ok(references.results.every(row => row.role === 'reference'));
  const including = await queryQualifiedNavigation({ ...request, kind: 'references', includeDeclaration: true }, options);
  assert.equal(including.results.length, 3);
  assert.equal(including.results[0].role, 'definition');

  records.set(aa, [binding(10, ca, 'ambiguous', 2)]);
  edges.push(edge(ba, db, 'bindingCandidate'));
  const ambiguous = await queryQualifiedNavigation(request, options);
  assert.equal(ambiguous.status, 'ambiguous');
  assert.equal(ambiguous.results.length, 0);
  assert.equal(ambiguous.binding.candidates.length, 2);
  records.set(aa, [binding(10, ca)]); edges = edges.filter(row => !(identical(row.from, ba) && identical(row.to, db)));

  await fs.writeFile(path.join(root, 'a.js'), inputA.replace('duplicate();', 'different();'));
  const stale = await queryQualifiedNavigation(request, options);
  assert.equal(stale.status, 'stale-source');
  assert.equal(stale.results.length, 0);
  await fs.writeFile(path.join(root, 'a.js'), inputA);
  assert.equal((await queryQualifiedNavigation({ ...request, sourceHash: 'f'.repeat(64) }, options)).status, 'stale-source');
  assert.equal((await queryQualifiedNavigation({ ...request, coordinateUnit: 'byte' }, options)).code, 'ERR_NAVIGATION_REQUEST');
  assert.equal((await queryQualifiedNavigation({ ...request, filePath: '../outside.js' }, options)).code, 'ERR_NAVIGATION_REQUEST');
  const partial = await queryQualifiedNavigation(request, { ...options, maxRows: 0 });
  assert.equal(partial.status, 'partial'); assert.ok(partial.degraded.includes('ERR_NAVIGATION_BUDGET'));
  await assert.rejects(() => queryQualifiedNavigation(request, { ...options, openStore: async () => { throw Object.assign(new Error('corrupt declared member'), { code: 'ERR_SEMANTIC_INTEGRITY' }); } }), { code: 'ERR_SEMANTIC_INTEGRITY' });
  assert.ok(opens > 0, 'the control opens its selected store');
  assert.equal(closes, opens, 'every actually opened store closes, including partial and stale paths');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Navigation uses exact source binding witnesses and retained UTF-16 coordinates; ambiguity and stale bytes remain explicit.');
