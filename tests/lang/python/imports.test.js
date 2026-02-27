#!/usr/bin/env node
import { collectPythonImports } from '../../../src/lang/python.js';

const source = [
  'import Foo, foo',
  'import os, sys as system',
  'import json',
  'from collections import defaultdict, namedtuple as nt',
  'from . import sibling',
  'from ..pkg.sub import Util as UtilAlias',
  'from foo.bar import Baz as Qux, Quux',
  '# from ignored import nope'
].join('\n');

const { imports, usages } = collectPythonImports(source);
const sorted = (items) => items.slice().sort();

const expectSet = (label, actual, expected) => {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  const actualText = JSON.stringify(actualSorted);
  const expectedText = JSON.stringify(expectedSorted);
  if (actualText !== expectedText) {
    console.error(`${label} mismatch: ${actualText} !== ${expectedText}`);
    process.exit(1);
  }
};

expectSet('imports+relative', imports, ['Foo', 'foo', 'os', 'sys', 'json', 'collections', '.', '..pkg.sub', 'foo.bar']);
expectSet('usages', usages, [
  'sibling',
  'Util',
  'UtilAlias',
  'system',
  'defaultdict',
  'namedtuple',
  'nt',
  'Baz',
  'Qux',
  'Quux'
]);

const expectedOrder = imports.slice().sort((a, b) => (
  String(a).toLowerCase().localeCompare(String(b).toLowerCase()) || String(a).localeCompare(String(b))
));
if (JSON.stringify(imports) !== JSON.stringify(expectedOrder)) {
  console.error('imports order should be deterministic and case-aware sorted');
  process.exit(1);
}

console.log('Python imports test passed.');
