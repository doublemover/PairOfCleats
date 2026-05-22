#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import { assertHeuristicAdapterCases } from '../helpers/heuristic-adapter-contracts.js';

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
    expectedUsage: 'add_library',
    expectedCapabilityState: 'partial'
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
    expectedUsage: 'cc_library',
    expectedCapabilityState: 'partial'
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
    expectedUsage: 'callPackage',
    expectedCapabilityState: 'partial'
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
    expectedUsage: 'prep',
    expectedCapabilityState: 'partial'
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
    expectedUsage: 'node:20',
    expectedCapabilityState: 'partial'
  }
];

assertHeuristicAdapterCases(CASES, { usageLabel: 'DSL usage' });

console.log('build DSL heuristic adapters contract test passed');
