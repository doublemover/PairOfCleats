#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildSymbolIndex, resolveSymbolRef } from '../../../../src/index/type-inference-crossfile/resolver.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const buildEntry = ({ name, file, chunkUid }) => ({
  name,
  qualifiedName: name,
  file,
  chunkUid,
  symbol: {
    scheme: 'poc',
    qualifiedName: name,
    symbolKey: `sym:${name}`,
    scopedId: null,
    symbolId: `sym:${chunkUid}`,
    kindGroup: 'function',
    chunkUid
  }
});

const basicEntries = [
  buildEntry({ name: 'Alpha', file: 'src/app.js', chunkUid: 'uid-alpha' }),
  buildEntry({ name: 'Ns.Gamma', file: 'src/lib.js', chunkUid: 'uid-gamma' })
];
const basicIndex = buildSymbolIndex(basicEntries);
const basicFileSet = new Set(['src/app.js', 'src/lib.js']);

const resolved = resolveSymbolRef({
  targetName: 'Alpha',
  symbolIndex: basicIndex,
  fileSet: basicFileSet
});
if (resolved.status !== 'resolved' || resolved.resolved?.chunkUid !== 'uid-alpha') {
  fail('Expected direct name to resolve to uid-alpha.');
}

const leafResolved = resolveSymbolRef({
  targetName: 'Gamma',
  symbolIndex: basicIndex,
  fileSet: basicFileSet
});
if (leafResolved.status !== 'resolved' || leafResolved.resolved?.chunkUid !== 'uid-gamma') {
  fail('Expected leaf name to resolve to uid-gamma.');
}

const ambiguousEntries = [
  buildEntry({ name: 'Dup', file: 'src/one.js', chunkUid: 'uid-one' }),
  buildEntry({ name: 'Dup', file: 'src/two.js', chunkUid: 'uid-two' })
];
const ambiguousIndex = buildSymbolIndex(ambiguousEntries);
const ambiguous = resolveSymbolRef({
  targetName: 'Dup',
  symbolIndex: ambiguousIndex,
  fileSet: new Set(['src/one.js', 'src/two.js'])
});
if (ambiguous.status !== 'ambiguous' || ambiguous.candidates.length !== 2) {
  fail('Expected ambiguous result to include two candidates.');
}

const importEntries = [
  buildEntry({ name: 'Beta', file: 'src/lib.js', chunkUid: 'uid-beta' }),
  buildEntry({ name: 'Beta', file: 'src/other.js', chunkUid: 'uid-beta-other' })
];
const importIndex = buildSymbolIndex(importEntries);
const fileRelations = new Map([
  ['src/app.js', { importBindings: { Local: { imported: 'Beta', module: './lib' } } }]
]);
const importResult = resolveSymbolRef({
  targetName: 'Local',
  fromFile: 'src/app.js',
  fileRelations,
  symbolIndex: importIndex,
  fileSet: new Set(['src/lib.js', 'src/other.js'])
});
if (importResult.status !== 'resolved' || importResult.resolved?.chunkUid !== 'uid-beta') {
  fail('Expected import bindings to narrow to uid-beta.');
}
if (importResult.importHint?.resolvedFile !== 'src/lib.js') {
  fail('Expected import hint to include resolved file for relative import.');
}

const unresolved = resolveSymbolRef({
  targetName: 'Missing',
  symbolIndex: importIndex,
  fileSet: new Set(['src/lib.js', 'src/other.js'])
});
if (unresolved.status !== 'unresolved') {
  fail('Expected missing symbol to be unresolved.');
}

console.log('symbolref-resolution tests passed');

const ownerEntry = buildEntry({ name: 'Owned', file: 'src/owner.js', chunkUid: 'uid-owner' });
const mismatchedOwner = structuredClone(ownerEntry);
mismatchedOwner.symbol.chunkUid = 'uid-unrelated';
const rejectedIndex = buildSymbolIndex([mismatchedOwner]);
assert.equal(rejectedIndex.byName.has('Owned'), false, 'a symbol cannot name a different host chunk');
assert.equal(rejectedIndex.byFile.has('src/owner.js'), false, 'import narrowing cannot reintroduce an unowned candidate');
for (const malformed of ['', 3, true, {}, []]) {
  for (const field of ['owner', 'symbol']) {
    const entry = structuredClone(ownerEntry);
    if (field === 'owner') entry.chunkUid = malformed;
    else entry.symbol.chunkUid = malformed;
    assert.equal(buildSymbolIndex([entry]).byName.has('Owned'), false, `explicit ${field} identity is not an omitted legacy identity`);
  }
}
for (const omitted of ['owner', 'symbol']) {
  const entry = structuredClone(ownerEntry);
  if (omitted === 'owner') delete entry.chunkUid;
  else delete entry.symbol.chunkUid;
  const result = resolveSymbolRef({ targetName: 'Owned', symbolIndex: buildSymbolIndex([entry]), fileSet: new Set(['src/owner.js']) });
  assert.equal(result.status, 'resolved');
  assert.equal(result.resolved.chunkUid, 'uid-owner', 'one-sided legacy identity retains its existing compatible owner');
}
const suppliedIndex = { byName: new Map([['Owned', [mismatchedOwner, ownerEntry]]]),
  byFile: new Map([['src/owner.js', [mismatchedOwner, ownerEntry]]]) };
for (const imported of [false, true]) {
  const result = resolveSymbolRef({ targetName: 'Owned', fromFile: 'src/use.js', symbolIndex: suppliedIndex,
    fileSet: new Set(['src/owner.js', 'src/use.js']),
    fileRelations: imported ? new Map([['src/use.js', { importBindings: { Owned: { imported: 'Owned', module: './owner.js' } } }]]) : null });
  assert.equal(result.status, 'resolved');
  assert.equal(result.candidates.length, 1, 'caller-supplied indexes must apply the same owner check before scoring/capping');
  assert.equal(result.resolved.chunkUid, 'uid-owner');
}
console.log('symbolref canonical owner agreement and legacy one-sided identity controls passed');

const members = buildSymbolIndex([
  buildEntry({ name: 'Beta', file: 'src/lib.js', chunkUid: 'uid-class' }),
  buildEntry({ name: 'Beta.run', file: 'src/lib.js', chunkUid: 'uid-method' }),
  buildEntry({ name: 'Other.run', file: 'src/lib.js', chunkUid: 'uid-other-method' })
]);
for (const [targetName, imported, expected] of [
  ['Local.run', 'Beta', 'uid-method'], ['Local.missing', 'Beta', null], ['Local.Run', 'Beta', null],
  ['ns.Beta.run', '*', 'uid-method'], ['ns.missing', '*', null], ['ns', '*', null]
]) {
  const rootName = targetName.split('.')[0];
  const result = resolveSymbolRef({ targetName, fromFile: 'src/use.js', symbolIndex: members,
    fileSet: new Set(['src/use.js', 'src/lib.js']), fileRelations: new Map([['src/use.js', {
      importBindings: { [rootName]: { imported, module: './lib.js' } }
    }]]) });
  assert.equal(result.status, expected ? 'resolved' : 'unresolved', targetName);
  assert.equal(result.resolved?.chunkUid ?? null, expected, targetName);
}
const unrelatedEntry = { ...buildEntry({ name: 'Unrelated', file: 'src/lib.js', chunkUid: 'uid-unrelated' }), kind: 'function' };
assert.equal(resolveSymbolRef({ targetName: 'Missing', kindHint: 'function',
  symbolIndex: { byName: new Map([['Missing', [unrelatedEntry]]]) }, fileSet: new Set(['src/lib.js']) }).status, 'unresolved',
  'a kind hint can rank matching candidates, but cannot manufacture a name match');
console.log('symbolref imported member path, case and positive name-match controls passed');

for (const module of ['./missing.js', 'external-package', '@configured/alias']) {
  const result = resolveSymbolRef({ targetName: 'Alpha', fromFile: 'src/use.js', symbolIndex: basicIndex,
    fileSet: basicFileSet, fileRelations: new Map([['src/use.js', {
      importBindings: { Alpha: { imported: 'Alpha', module } }
    }]]) });
  assert.equal(result.status, 'unresolved', `known import ${module} cannot escape to repository-global Alpha`);
  assert.deepEqual(result.candidates, []);
  assert.equal(result.importHint.moduleSpecifier, module);
  assert.equal(result.importHint.resolvedFile, null);
}
assert.equal(resolveSymbolRef({ targetName: 'Alpha', fromFile: 'src/use.js', symbolIndex: basicIndex,
  fileSet: basicFileSet }).resolved.chunkUid, 'uid-alpha', 'unimported heuristic resolution retains its existing route');
console.log('symbolref unavailable import module boundaries and unimported name compatibility controls passed');
