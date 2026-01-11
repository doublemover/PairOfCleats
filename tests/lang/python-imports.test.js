#!/usr/bin/env node
import { collectPythonImports } from '../../src/lang/python.js';

const source = [
  'import os, sys as system',
  'import json',
  'from collections import defaultdict, namedtuple as nt',
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

expectSet('imports', imports, ['os', 'sys', 'json', 'collections', 'foo.bar']);
expectSet('usages', usages, [
  'system',
  'defaultdict',
  'namedtuple',
  'nt',
  'Baz',
  'Qux',
  'Quux'
]);

console.log('Python imports test passed.');
