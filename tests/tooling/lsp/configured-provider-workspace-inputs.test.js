#!/usr/bin/env node
import assert from 'node:assert/strict';
import { prepareConfiguredProviderInputs } from '../../../src/index/tooling/lsp-provider/index.js';

const prepared = prepareConfiguredProviderInputs({
  providerId: 'lsp-gopls',
  inputs: {
    documents: [
      { virtualPath: '.poc-vfs/pkg/main.go#seg:main', languageId: 'go' },
      { virtualPath: '.poc-vfs/pkg/util.go#seg:util', languageId: 'go' }
    ],
    targets: [
      { virtualPath: '.poc-vfs/pkg/main.go#seg:main', chunkRef: { chunkUid: 'chunk-main' } },
      { virtualPath: '.poc-vfs/pkg/util.go#seg:util', chunkRef: { chunkUid: 'chunk-util' } }
    ],
    kinds: ['types']
  }
});

assert.equal(Array.isArray(prepared.documents), true, 'expected startup document selection to return documents');
assert.equal(Array.isArray(prepared.targets), true, 'expected startup document selection to return targets');
assert.ok(prepared.documents.length >= 1, 'expected at least one startup document');
assert.equal(
  prepared.targets.every((target) => prepared.documents.some((doc) => doc.virtualPath === target.virtualPath)),
  true,
  'expected startup targets to remain aligned with startup documents'
);

console.log('configured provider workspace input shaping test passed');
