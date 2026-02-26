#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `configured-lsp-go-rust-signatures-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const runSingleLanguageCase = async ({
  languageId,
  mode,
  symbolName,
  returnType,
  paramTypes,
  chunkUid
}) => {
  const virtualPath = `.poc-vfs/src/sample.${languageId}#seg:${mode}.txt`;
  const docText = languageId === 'go'
    ? 'package main\nfunc Add(a int, b int) int { return a + b }\n'
    : 'fn add(a: i32, b: i32) -> i32 { a + b }\n';
  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      enabledTools: ['lsp-test'],
      lsp: {
        enabled: true,
        servers: [{
          id: 'test',
          cmd: process.execPath,
          args: [serverPath, '--mode', mode],
          languages: [languageId],
          uriScheme: 'poc-vfs'
        }]
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
      effectiveExt: languageId === 'go' ? '.go' : '.rs',
      docHash: `hash-${mode}`
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: `chunk_${mode}`,
        file: `src/sample.${languageId}`,
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
  for (const [name, expectedType] of Object.entries(paramTypes)) {
    assert.equal(
      hit.payload?.paramTypes?.[name]?.[0]?.type,
      expectedType,
      `unexpected param type ${name} for ${languageId}`
    );
  }
};

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

console.log('configured LSP go/rust signature parsing test passed');
