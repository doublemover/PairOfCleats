#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

applyTestEnv();

const cmake = LANGUAGE_REGISTRY.find((entry) => entry.id === 'cmake');
assert.ok(cmake, 'expected cmake language registry entry');

const cmakeSource = [
  'include(core/module.cmake)',
  'add_subdirectory(src/tools)',
  'find_package(OpenSSL REQUIRED)'
].join('\n');

const collected = cmake.collectImports(cmakeSource) || [];
const relations = cmake.buildRelations({ text: cmakeSource }) || {};

assert.ok(Array.isArray(relations.imports), 'expected simple-language relations to expose imports');
assert.deepEqual(
  relations.imports.slice().sort(),
  Array.from(new Set(collected)).sort(),
  'expected simple-language relation imports to match collector output'
);

const starlark = LANGUAGE_REGISTRY.find((entry) => entry.id === 'starlark');
assert.ok(starlark, 'expected starlark language registry entry');
const starlarkSource = 'load("//tools:defs.bzl", "macro")\n';
const starlarkRelations = starlark.buildRelations({ text: starlarkSource }) || {};
assert.equal(starlarkRelations.imports.includes('//tools:defs.bzl'), true);

console.log('simple-language relations contract test passed');
