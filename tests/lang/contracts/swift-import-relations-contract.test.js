#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { buildSwiftRelations, collectSwiftImports } from '../../../src/lang/swift.js';

applyTestEnv();

const noImport = [
  'let counter = 1',
  'counter += 1',
  'print(counter)'
].join('\n');
assert.deepEqual(
  collectSwiftImports(noImport),
  { imports: [], usages: [] },
  'swift import collector should return empty data when no import token exists'
);

const noDeclarations = [
  'import Foundation',
  'let title = "ready"',
  'print(title)'
].join('\n');
const noDeclRelations = buildSwiftRelations(noDeclarations);
assert.deepEqual(noDeclRelations.exports, [], 'swift relations should skip export scan when declaration hints are absent');
assert.deepEqual(noDeclRelations.imports, ['Foundation']);
assert.deepEqual(noDeclRelations.usages, ['Foundation']);

const richSwift = [
  '// import IgnoredByLineComment',
  '/*',
  'import IgnoredByBlockCommentStart',
  '*/',
  '@testable import CoreKit',
  'import UIKit',
  '',
  'public struct Widget {}',
  '  func nested() {}',
  '',
  'func makeWidget() -> Widget {',
  '  Widget()',
  '}'
].join('\n');
const relations = buildSwiftRelations(richSwift);
const importSet = new Set(relations.imports);
const usageSet = new Set(relations.usages);
const exportSet = new Set(relations.exports);

assert.equal(importSet.has('CoreKit'), true);
assert.equal(importSet.has('UIKit'), true);
assert.equal(importSet.has('IgnoredByLineComment'), false);
assert.equal(usageSet.has('CoreKit'), true);
assert.equal(usageSet.has('UIKit'), true);
assert.equal(exportSet.has('Widget'), true);
assert.equal(exportSet.has('makeWidget'), true);
assert.equal(exportSet.has('nested'), false);

console.log('swift import and relations contract test passed');
