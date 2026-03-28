#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

import { cleanupLspTestRuntime, withLspTestPath } from '../../helpers/lsp-runtime.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-go-rust-signatures-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
await fs.writeFile(
  path.join(tempRoot, 'Cargo.toml'),
  '[package]\nname = "poc-signature-test"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\npath = "src/lib.rs"\n'
);
await fs.writeFile(path.join(tempRoot, 'go.mod'), 'module example.com/poc-signature-test\n\ngo 1.22\n');
await fs.writeFile(path.join(tempRoot, 'src', 'lib.rs'), 'fn bootstrap() {}\n', 'utf8');

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docsByLanguage = {
  go: {
    ext: '.go',
    text: 'package main\nfunc Add(a int, b int) int { return a + b }\n'
  },
  rust: {
    ext: '.rs',
    text: 'fn add(a: i32, b: i32) -> i32 { a + b }\n'
  },
  lua: {
    ext: '.lua',
    text: 'function greet(name: string): string\n  return name\nend\n'
  },
  zig: {
    ext: '.zig',
    text: 'fn add(a: i32, b: i32) i32 { return a + b; }\n'
  }
};

const runSingleLanguageCase = async ({
  languageId,
  mode,
  symbolName,
  returnType,
  paramTypes,
  chunkUid
}) => {
  await cleanupLspTestRuntime({
    reason: `configured_lsp_signature_case_${mode}_start`,
    strict: true
  });
  const docConfig = docsByLanguage[languageId];
  if (!docConfig) throw new Error(`missing test doc config for ${languageId}`);
  const fileName = `sample${docConfig.ext}`;
  const virtualPath = `.poc-vfs/src/${fileName}#seg:${mode}.txt`;
  const docText = docConfig.text;
  const configuredServerId = `test-${mode}`;
  const configuredProviderId = `lsp-${configuredServerId}`;
  const serverConfig = {
    id: configuredServerId,
    cmd: process.execPath,
    args: [serverPath, '--mode', mode],
    languages: [languageId],
    uriScheme: 'poc-vfs'
  };
  if (languageId === 'go') {
    // Keep the test focused on signature parsing instead of host Go toolchain state.
    serverConfig.goWorkspaceWarmup = false;
    serverConfig.goWorkspaceModuleCmd = process.execPath;
    serverConfig.goWorkspaceModuleArgs = ['-e', 'process.stdout.write("ok\\n");'];
  }
  await fs.writeFile(path.join(tempRoot, 'src', fileName), docText, 'utf8');
  if (languageId === 'rust') {
    await fs.writeFile(path.join(tempRoot, 'src', 'lib.rs'), docText, 'utf8');
  }
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: [configuredProviderId],
      lsp: {
        enabled: true,
        servers: [serverConfig]
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents: [{
      virtualPath,
      text: docText,
      languageId,
      effectiveExt: docConfig.ext,
      docHash: `hash-${mode}`
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: `chunk_${mode}`,
        file: `src/${fileName}`,
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: docText.length }
      },
      virtualPath,
      virtualRange: { start: 0, end: docText.length },
      symbolHint: { name: symbolName, kind: 'function' },
      languageId
    }],
    kinds: ['types']
  });
  const hit = result.byChunkUid.get(chunkUid);
  assert.ok(hit, `expected LSP hit for ${languageId}`);
  assert.equal(hit.payload?.returnType, returnType, `unexpected returnType for ${languageId}`);
  assert.equal(result.metrics?.providersExecuted, 1, `expected one executed provider for ${languageId}`);
  assert.equal(
    Number(result.metrics?.providerRuntime?.[configuredProviderId]?.requests?.requests || 0) > 0,
    true,
    `expected request metrics for ${languageId}`
  );
  assert.equal(
    result.metrics?.providerRuntime?.[configuredProviderId]?.degraded?.active,
    false,
    `unexpected degraded mode for ${languageId}`
  );
  for (const [name, expectedType] of Object.entries(paramTypes)) {
    assert.equal(
      hit.payload?.paramTypes?.[name]?.[0]?.type,
      expectedType,
      `unexpected param type ${name} for ${languageId}`
    );
  }
};

await withLspTestPath({ repoRoot: root }, async () => {
  await runSingleLanguageCase({
    languageId: 'go',
    mode: 'go',
    symbolName: 'Add',
    returnType: 'int',
    paramTypes: { a: 'int', b: 'int' },
    chunkUid: 'ck64:v1:test:src/sample.go:go-signature'
  });

  await runSingleLanguageCase({
    languageId: 'rust',
    mode: 'rust',
    symbolName: 'add',
    returnType: 'i32',
    paramTypes: { a: 'i32', b: 'i32' },
    chunkUid: 'ck64:v1:test:src/sample.rs:rust-signature'
  });

  await runSingleLanguageCase({
    languageId: 'lua',
    mode: 'lua',
    symbolName: 'greet',
    returnType: 'string',
    paramTypes: { name: 'string' },
    chunkUid: 'ck64:v1:test:src/sample.lua:lua-signature'
  });

  await runSingleLanguageCase({
    languageId: 'zig',
    mode: 'zig',
    symbolName: 'add',
    returnType: 'i32',
    paramTypes: { a: 'i32', b: 'i32' },
    chunkUid: 'ck64:v1:test:src/sample.zig:zig-signature'
  });
});

console.log('configured LSP go/rust/lua/zig signature parsing test passed');
