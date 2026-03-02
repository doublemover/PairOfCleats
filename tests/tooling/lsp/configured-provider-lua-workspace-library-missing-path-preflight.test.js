#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-lua-workspace-library-missing-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'function greet(name)\n  return name\nend\n';
const chunkUid = 'ck64:v1:test:src/sample.lua:lua-workspace-library-missing';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-lua-workspace-library-missing'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'lua-workspace-library-missing',
        preset: 'lua-language-server',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'lua-requires-workspace-library'],
        languages: ['lua'],
        luaWorkspaceLibrary: ['deps/does-not-exist'],
        uriScheme: 'poc-vfs'
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.lua#seg:lua-workspace-library-missing.txt',
    text: docText,
    languageId: 'lua',
    effectiveExt: '.lua',
    docHash: 'hash-lua-workspace-library-missing'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_lua_workspace_library_missing',
      file: 'src/sample.lua',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.lua#seg:lua-workspace-library-missing.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'greet', kind: 'function' },
    languageId: 'lua'
  }],
  kinds: ['types']
});

const hit = result.byChunkUid.get(chunkUid);
assert.ok(hit, 'expected configured lua provider to continue enrichment when workspace library path is missing');
assert.equal(hit.payload?.returnType, 'string', 'expected Lua return type from stub signature');

const checks = Array.isArray(result.diagnostics?.['lsp-lua-workspace-library-missing']?.checks)
  ? result.diagnostics['lsp-lua-workspace-library-missing'].checks
  : [];
assert.equal(
  checks.some((check) => check?.name === 'lua_workspace_library_missing'),
  true,
  'expected lua workspace library missing preflight warning check'
);

console.log('configured LSP lua workspace library missing-path preflight test passed');
