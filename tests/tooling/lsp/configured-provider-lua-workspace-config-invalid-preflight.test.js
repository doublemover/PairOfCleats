#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-lua-workspace-config-invalid-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.writeFile(path.join(tempRoot, '.luarc.json'), '{"Lua": {"runtime": ', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'local function greet(name) return name end\n';
const chunkUid = 'ck64:v1:test:src/sample.lua:lua-workspace-config-invalid-preflight';

const result = await runToolingProviders({
  strict: true,
  repoRoot: tempRoot,
  buildRoot: tempRoot,
  toolingConfig: {
    enabledTools: ['lsp-lua-workspace-config-invalid'],
    lsp: {
      enabled: true,
      servers: [{
        id: 'lua-workspace-config-invalid',
        preset: 'lua-language-server',
        cmd: process.execPath,
        args: [serverPath, '--mode', 'lua'],
        languages: ['lua'],
        uriScheme: 'poc-vfs',
        preflightRuntimeRequirements: []
      }]
    }
  },
  cache: {
    enabled: false
  }
}, {
  documents: [{
    virtualPath: '.poc-vfs/src/sample.lua#seg:lua-workspace-config-invalid-preflight.txt',
    text: docText,
    languageId: 'lua',
    effectiveExt: '.lua',
    docHash: 'hash-lua-workspace-config-invalid-preflight'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid,
      chunkId: 'chunk_lua_workspace_config_invalid_preflight',
      file: 'src/sample.lua',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath: '.poc-vfs/src/sample.lua#seg:lua-workspace-config-invalid-preflight.txt',
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'greet', kind: 'function' },
    languageId: 'lua'
  }],
  kinds: ['types']
});

assert.equal(result.byChunkUid.has(chunkUid), true, 'expected configured lua provider to continue when .luarc.json is invalid');
const diagnostics = result.diagnostics?.['lsp-lua-workspace-config-invalid'] || {};
assert.equal(diagnostics?.preflight?.state, 'degraded', 'expected configured lua preflight degraded state');
assert.equal(
  diagnostics?.preflight?.reasonCode,
  'lua_workspace_config_invalid',
  'expected lua workspace config invalid reason code'
);
const checks = Array.isArray(diagnostics?.checks) ? diagnostics.checks : [];
assert.equal(
  checks.some((check) => check?.name === 'lua_workspace_config_invalid'),
  true,
  'expected lua workspace config invalid warning check'
);

console.log('configured LSP lua workspace config invalid preflight test passed');
