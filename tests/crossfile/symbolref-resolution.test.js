#!/usr/bin/env node
import { buildSymbolIndex, resolveSymbolRef } from '../../src/index/type-inference-crossfile/resolver.js';

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
