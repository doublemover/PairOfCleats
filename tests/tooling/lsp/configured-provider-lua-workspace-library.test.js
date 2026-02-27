#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-lua-workspace-library-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'deps', 'lua'), { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'function greet(name)\n  return name\nend\n';
const chunkUid = 'ck64:v1:test:src/sample.lua:lua-workspace-library';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-lua-workspace-library'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'lua-workspace-library',
        preset: 'lua-language-server',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'lua-requires-workspace-library'],
        languages: ['lua'],
        luaWorkspaceLibrary: ['deps/lua'],
        uriScheme: 'poc-vfs'
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.lua#seg:lua-workspace-library.txt',
    text: docText,
    languageId: 'lua',
    effectiveExt: '.lua',
    docHash: 'hash-lua-workspace-library'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_lua_workspace_library',
      file: 'src/sample.lua',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.lua#seg:lua-workspace-library.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'greet', kind: 'function' },
    languageId: 'lua'
  }],
  kinds: ['types']
});

const hit = result.byChunkUid.get(chunkUid);
assert.ok(hit, 'expected configured lua provider to enrich when workspace library settings are supplied');
assert.equal(hit.payload?.returnType, 'string', 'expected Lua return type from stub signature');
assert.equal(hit.payload?.paramTypes?.name?.[0]?.type, 'string', 'expected Lua param type from stub signature');

console.log('configured LSP lua workspace library test passed');
