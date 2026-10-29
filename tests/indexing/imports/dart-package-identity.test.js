import assert from 'node:assert/strict';
import { resolveDartImport } from '../../../src/index/build/import-resolution/resolvers/common-paths.js';
const lookup = { fileSet: new Set(['lib/foo.dart']), caseSensitive: true };
const resolve = (spec, dartPackageName = null, selected = lookup) => resolveDartImport({
  spec, dartPackageName, lookup: selected, importerInfo: { importerDir: 'lib' } });
assert.equal(resolve('package:other/foo.dart'), null);
assert.equal(resolve('package:other/foo.dart', 'own'), null);
assert.equal(resolve('package:own/foo.dart', 'own'), 'lib/foo.dart');
assert.equal(resolve('./foo.dart'), 'lib/foo.dart');
assert.equal(resolve('dart:core'), null);
for (const spec of ['package:', 'package:own/', 'package:/foo.dart']) assert.equal(resolve(spec, 'own'), null);
const explicit = { fileSet: new Set(['lib/foo.dart', 'packages/other/foo.dart']), caseSensitive: true };
assert.equal(resolve('package:other/foo.dart', null, explicit), 'packages/other/foo.dart');
console.log('Dart package identity and explicit external roots passed');
