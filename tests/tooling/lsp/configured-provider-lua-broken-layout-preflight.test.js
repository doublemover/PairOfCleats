#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-provider-lua-broken-layout-${process.pid}-${Date.now()}`);
const toolingRoot = path.join(tempRoot, 'tooling-root');
const binDir = path.join(toolingRoot, 'bin');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(binDir, { recursive: true });

if (process.platform === 'win32') {
  await fs.writeFile(
    path.join(binDir, 'lua-language-server.cmd'),
    '@echo off\r\nif "%1"=="-v" exit /b 0\r\nif "%1"=="--version" exit /b 0\r\nexit /b 0\r\n',
    'utf8'
  );
} else {
  await fs.writeFile(path.join(binDir, 'lua-language-server'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
}

try {
  await withTemporaryEnv({ PATH: path.dirname(process.execPath), Path: path.dirname(process.execPath) }, async () => {
    const docText = 'local function add(a, b) return a + b end\n';
    const chunkUid = 'ck64:v1:test:src/sample.lua:lua-broken-layout';
    const result = await runToolingProviders({
      strict: true,
      repoRoot: tempRoot,
      buildRoot: tempRoot,
      toolingConfig: {
        dir: toolingRoot,
        lsp: {
          enabled: true,
          servers: [{
            preset: 'lua-language-server',
            uriScheme: 'poc-vfs'
          }]
        }
      },
      cache: {
        enabled: false
      }
    }, {
      documents: [{
        virtualPath: '.poc-vfs/src/sample.lua#seg:lua-broken-layout',
        text: docText,
        languageId: 'lua',
        effectiveExt: '.lua',
        docHash: 'hash-lua-broken-layout'
      }],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid,
          chunkId: 'chunk_lua_broken_layout',
          file: 'src/sample.lua',
          segmentUid: null,
          segmentId: null,
          range: { start: 0, end: docText.length }
        },
        virtualPath: '.poc-vfs/src/sample.lua#seg:lua-broken-layout',
        virtualRange: { start: 0, end: docText.length },
        symbolHint: { name: 'add', kind: 'function' },
        languageId: 'lua'
      }],
      kinds: ['types']
    });

    assert.equal(result.byChunkUid.has(chunkUid), false, 'expected broken managed Lua layout to block runtime execution');
    const diagnostics = result.diagnostics?.['lsp-lua-language-server'] || null;
    assert.ok(diagnostics, 'expected Lua provider diagnostics');
    assert.equal(diagnostics?.preflight?.state, 'blocked');
    assert.equal(diagnostics?.fidelity?.state, 'blocked');
    assert.equal(diagnostics?.fidelity?.reasonCode, 'preflight_command_invalid_layout');
    assert.equal(
      Array.isArray(diagnostics?.checks)
      && diagnostics.checks.some((check) => check?.name === 'lsp_command_unavailable'),
      true,
      'expected invalid layout to surface through the command preflight check path'
    );
    assert.match(
      String(diagnostics?.checks?.find((check) => check?.name === 'lsp_command_unavailable')?.message || ''),
      /missing runtime entry/u
    );
  });
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

console.log('configured provider lua broken layout preflight test passed');
