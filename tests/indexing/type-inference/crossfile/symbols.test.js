#!/usr/bin/env node
import { addSymbol, leafName, resolveUniqueSymbol, isTypeDeclaration } from '../../../../src/index/type-inference-crossfile/symbols.js';

const fail = (message) => {
  console.error(message);
  process.exit(1);
};

if (leafName('Alpha::Beta.Gamma') !== 'Gamma') {
  fail('leafName should return the last segment.');
}

if (!isTypeDeclaration('Class')) {
  fail('isTypeDeclaration should match class-like kinds.');
}

if (isTypeDeclaration('function')) {
  fail('isTypeDeclaration should ignore non-type kinds.');
}

const directIndex = new Map();
const directEntry = { name: 'Widget', file: 'src/widget.js', kind: 'class' };
addSymbol(directIndex, directEntry.name, directEntry);
if (resolveUniqueSymbol(directIndex, 'Widget') !== directEntry) {
  fail('resolveUniqueSymbol should resolve direct unique matches.');
}

const leafIndex = new Map();
const leafEntry = { name: 'Namespace.Widget', file: 'src/ns.js', kind: 'class' };
addSymbol(leafIndex, 'Widget', leafEntry);
if (resolveUniqueSymbol(leafIndex, 'Namespace.Widget') !== leafEntry) {
  fail('resolveUniqueSymbol should resolve unique leaf matches.');
}

const dupeIndex = new Map();
addSymbol(dupeIndex, 'Dup', { name: 'Dup', file: 'src/one.js' });
addSymbol(dupeIndex, 'Dup', { name: 'Dup', file: 'src/two.js' });
if (resolveUniqueSymbol(dupeIndex, 'Dup') !== null) {
  fail('resolveUniqueSymbol should return null for ambiguous matches.');
}

console.log('type-inference-crossfile symbols tests passed');
