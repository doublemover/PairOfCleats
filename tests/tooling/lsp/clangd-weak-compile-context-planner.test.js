#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const tempRoot = resolveTestCachePath(root, `clangd-weak-compile-context-planner-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'include'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'third_party'), { recursive: true });

registerDefaultToolingProviders();
const provider = getToolingProvider('clangd');
assert.ok(provider, 'expected clangd provider');

const fixtureCmd = path.join(
  root,
  'tests',
  'fixtures',
  'lsp',
  'bin',
  process.platform === 'win32' ? 'clangd.cmd' : 'clangd'
);
await fs.access(fixtureCmd);

const ctx = {
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    clangd: {
      cmd: fixtureCmd,
      args: ['--background-index=false', '--log=error'],
      maxDocsWithoutCompileCommands: 1,
      autoInferIncludeRoots: false
    }
  },
  logger: () => {},
  strict: true
};

const sourceText = 'int alpha(void) { return 1; }\n';
const headerText = '#pragma once\nint alpha(void);\n';
const vendorHeaderText = '#pragma once\nint vendor_only(void);\n';

const sourceDoc = {
  virtualPath: 'src/main.cc',
  effectiveExt: '.cc',
  languageId: 'cpp',
  text: sourceText,
  docHash: 'doc-source',
  containerPath: 'src/main.cc'
};
const headerDoc = {
  virtualPath: 'include/main.h',
  effectiveExt: '.h',
  languageId: 'cpp',
  text: headerText,
  docHash: 'doc-header',
  containerPath: 'include/main.h'
};
const vendorHeaderDoc = {
  virtualPath: 'third_party/vendor.h',
  effectiveExt: '.h',
  languageId: 'cpp',
  text: vendorHeaderText,
  docHash: 'doc-vendor-header',
  containerPath: 'third_party/vendor.h'
};

const sourceChunkUid = 'ck:test:clangd-weak-compile-context:source';
const headerChunkUid = 'ck:test:clangd-weak-compile-context:header';
const vendorChunkUid = 'ck:test:clangd-weak-compile-context:vendor';

const createTarget = (virtualPath, file, chunkUid, chunkId, symbolName, text) => ({
  virtualPath,
  languageId: 'cpp',
  chunkRef: {
    chunkUid,
    chunkId,
    file,
    start: 0,
    end: text.length
  },
  virtualRange: {
    start: 0,
    end: text.length
  },
  symbolHint: {
    name: symbolName,
    kind: 'function'
  }
});

const output = await provider.run(ctx, {
  documents: [headerDoc, vendorHeaderDoc, sourceDoc],
  targets: [
    createTarget(headerDoc.virtualPath, 'include/main.h', headerChunkUid, 'chunk_header', 'alpha', headerText),
    createTarget(vendorHeaderDoc.virtualPath, 'third_party/vendor.h', vendorChunkUid, 'chunk_vendor', 'vendor_only', vendorHeaderText),
    createTarget(sourceDoc.virtualPath, 'src/main.cc', sourceChunkUid, 'chunk_source', 'alpha', sourceText)
  ]
});

assert.equal(Boolean(output?.byChunkUid?.[sourceChunkUid]), true, 'expected actionable source file to survive weak compile-context reduction');
assert.equal(Boolean(output?.byChunkUid?.[headerChunkUid]), false, 'expected header-only target to be dropped under weak compile context');
assert.equal(Boolean(output?.byChunkUid?.[vendorChunkUid]), false, 'expected low-value third-party header to be dropped under weak compile context');

const checks = Array.isArray(output?.diagnostics?.checks) ? output.diagnostics.checks : [];
const scopeReductionCheck = checks.find((check) => check?.name === 'clangd_weak_compile_context_scope_reduced');
assert.ok(scopeReductionCheck, 'expected weak compile-context scope reduction check');
assert.equal(scopeReductionCheck.selectedDocs, 1, 'expected one selected document after weak compile-context reduction');
assert.equal(scopeReductionCheck.totalDocs, 3, 'expected total document count in scope reduction check');
assert.equal(scopeReductionCheck.droppedHeaders >= 1, true, 'expected at least one dropped header in scope reduction check');

console.log('clangd weak compile context planner test passed');
