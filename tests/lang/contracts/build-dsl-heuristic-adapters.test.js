#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { LANGUAGE_REGISTRY } from '../../../src/index/language-registry/registry-data.js';

applyTestEnv();

const CASES = [
  {
    id: 'cmake',
    ext: '.cmake',
    relPath: 'CMakeLists.txt',
    source: [
      'include("deps/core.cmake")',
      'function(register_target name)',
      '  if(name)',
      '    add_library(${name} STATIC src.cpp)',
      '  endif()',
      'endfunction()'
    ].join('\n'),
    expectedImport: 'deps/core.cmake',
    expectedExport: 'register_target',
    expectedUsage: 'add_library'
  },
  {
    id: 'starlark',
    ext: '.bzl',
    relPath: 'tools/defs.bzl',
    source: [
      'load("//tools:defs.bzl", "macro")',
      'def build_target(name):',
      '    native.cc_library(name = name)'
    ].join('\n'),
    expectedImport: '//tools:defs.bzl',
    expectedExport: 'build_target',
    expectedUsage: 'cc_library'
  },
  {
    id: 'nix',
    ext: '.nix',
    relPath: 'default.nix',
    source: [
      'deps = import ./deps.nix;',
      'pkg = callPackage ./pkg.nix { };'
    ].join('\n'),
    expectedImport: './deps.nix',
    expectedExport: 'deps',
    expectedUsage: 'callPackage'
  },
  {
    id: 'makefile',
    ext: '',
    relPath: 'Makefile',
    source: [
      'include common.mk',
      'build: prep',
      '\t@echo build',
      'prep:',
      '\t@echo prep'
    ].join('\n'),
    expectedImport: 'common.mk',
    expectedExport: 'build',
    expectedUsage: 'prep'
  },
  {
    id: 'dockerfile',
    ext: '',
    relPath: 'Dockerfile',
    source: [
      'FROM node:20 AS builder',
      'COPY --from=builder /app/dist /dist',
      'FROM nginx:1.27',
      'COPY --from=builder /dist /usr/share/nginx/html'
    ].join('\n'),
    expectedImport: 'node:20',
    expectedExport: 'builder',
    expectedUsage: 'node:20'
  }
];

for (const testCase of CASES) {
  const entry = LANGUAGE_REGISTRY.find((row) => row.id === testCase.id);
  assert.ok(entry, `missing registry entry for ${testCase.id}`);

  const capability = entry.capabilityProfile;
  assert.ok(capability && capability.state === 'partial', `${testCase.id} should keep explicit partial capability profile`);
  assert.ok(Array.isArray(capability.diagnostics), `${testCase.id} should expose capability diagnostics`);

  const relations = entry.buildRelations({ text: testCase.source, relPath: testCase.relPath, options: {} }) || {};
  assert.ok(Array.isArray(relations.imports), `${testCase.id} should emit imports array`);
  assert.ok(relations.imports.includes(testCase.expectedImport), `${testCase.id} should keep expected import`);
  assert.ok(Array.isArray(relations.exports), `${testCase.id} should emit exports array`);
  assert.ok(relations.exports.includes(testCase.expectedExport), `${testCase.id} should emit heuristic export symbol`);
  assert.ok(Array.isArray(relations.usages), `${testCase.id} should emit usages array`);
  assert.ok(relations.usages.includes(testCase.expectedUsage), `${testCase.id} should emit DSL usage`);
  assert.ok(Array.isArray(relations.calls), `${testCase.id} should emit calls array`);
  assert.ok(relations.calls.some((entryCall) => Array.isArray(entryCall) && entryCall[1] === testCase.expectedUsage), `${testCase.id} should emit call edges`);

  const chunk = {
    name: testCase.expectedExport,
    start: 0,
    end: testCase.source.length
  };
  const docmeta = entry.extractDocMeta({ chunk });
  assert.equal(docmeta?.symbol, testCase.expectedExport, `${testCase.id} should emit heuristic docmeta symbol`);

  const flow = entry.flow({
    text: testCase.source,
    chunk,
    options: { astDataflowEnabled: true, controlFlowEnabled: true }
  });
  assert.ok(flow && flow.controlFlow, `${testCase.id} should emit control flow summary`);
  assert.equal(typeof flow.controlFlow.branches, 'number', `${testCase.id} controlFlow.branches must be numeric`);
}

console.log('build DSL heuristic adapters contract test passed');
