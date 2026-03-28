#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

import { cleanupLspTestRuntime, withLspTestPath } from '../../helpers/lsp-runtime.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const root = process.cwd();
const { dir: tempRoot } = await prepareIsolatedTestCacheDir('configured-lsp-go-rust-signatures', { root });

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
  const caseRoot = path.join(tempRoot, mode);
  const docConfig = docsByLanguage[languageId];
  if (!docConfig) throw new Error(`missing test doc config for ${languageId}`);
  const fileName = `sample${docConfig.ext}`;
  const virtualPath = `.poc-vfs/src/${fileName}#seg:${mode}.txt`;
  const docText = docConfig.text;
  const configuredServerId = `test-${mode}`;
  const configuredProviderId = `lsp-${configuredServerId}`;
  await fs.rm(caseRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(caseRoot, 'src'), { recursive: true });
  const serverConfig = {
    id: configuredServerId,
    cmd: process.execPath,
    args: [serverPath, '--mode', mode],
    languages: [languageId],
    uriScheme: 'poc-vfs',
    timeoutMs: 15000,
    documentSymbolTimeoutMs: 8000,
    hoverTimeoutMs: 8000,
    signatureHelpTimeoutMs: 8000,
    documentSymbolConcurrency: 1,
    hoverConcurrency: 1,
    signatureHelpConcurrency: 1,
    definitionEnabled: false,
    typeDefinitionEnabled: false,
    referencesEnabled: false,
    semanticTokensEnabled: false,
    inlayHintsEnabled: false
  };
  if (languageId === 'go') {
    // Keep the test focused on signature parsing instead of host Go toolchain state.
    serverConfig.goWorkspaceWarmup = false;
    serverConfig.goWorkspaceModuleCmd = process.execPath;
    const goProbeScriptPath = path.join(caseRoot, 'go-probe-ok.js');
    await fs.writeFile(
      goProbeScriptPath,
      "process.stdout.write('example.com/poc-signature-test\\n');\n",
      'utf8'
    );
    serverConfig.goWorkspaceModuleArgs = [goProbeScriptPath];
    await fs.writeFile(path.join(caseRoot, 'go.mod'), 'module example.com/poc-signature-test\n\ngo 1.22\n');
  }
  if (languageId === 'rust') {
    await fs.writeFile(
      path.join(caseRoot, 'Cargo.toml'),
      '[package]\nname = "poc-signature-test"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\npath = "src/lib.rs"\n'
    );
  }
  await fs.writeFile(path.join(caseRoot, 'src', fileName), docText, 'utf8');
  if (languageId === 'rust') {
    await fs.writeFile(path.join(caseRoot, 'src', 'lib.rs'), docText, 'utf8');
  }
  let result = null;
  let hit = null;
  let hitDebug = '';
  for (let attempt = 0; attempt < 3 && !hit; attempt += 1) {
    result = await runToolingProviders({
      strict: true,
      repoRoot: caseRoot,
      buildRoot: caseRoot,
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
    hit = result.byChunkUid.get(chunkUid);
    if (!hit) {
      const providerRuntime = result.metrics?.providerRuntime?.[configuredProviderId] || null;
      const providerDiagnostics = result.diagnostics?.[configuredProviderId] || null;
      hitDebug = JSON.stringify({
        providerRuntime,
        preflightState: providerDiagnostics?.preflight?.state || null,
        fidelityState: providerDiagnostics?.fidelity?.state || null,
        checkNames: Array.isArray(providerDiagnostics?.checks)
          ? providerDiagnostics.checks.map((check) => check?.name).filter(Boolean)
          : []
      });
    }
    if (!hit && attempt < 2) {
      await cleanupLspTestRuntime({
        reason: `configured_lsp_signature_case_${mode}_retry`,
        strict: true
      });
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
  assert.ok(hit, `expected LSP hit for ${languageId}${hitDebug ? `; diagnostics=${hitDebug}` : ''}`);
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
