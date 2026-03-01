#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { prependLspTestPath } from '../../helpers/lsp-runtime.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'configured-lsp-generic-presets-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const restorePath = prependLspTestPath({ repoRoot: root });

const presetMatrix = [
  {
    preset: 'gopls',
    providerId: 'lsp-gopls',
    languageId: 'go',
    ext: '.go',
    text: 'package main\nfunc add(a int, b int) int { return a + b }\n',
    symbol: 'add'
  },
  {
    preset: 'rust-analyzer',
    providerId: 'lsp-rust-analyzer',
    languageId: 'rust',
    ext: '.rs',
    text: 'fn add(a: i32, b: i32) -> i32 { a + b }\n',
    symbol: 'add'
  },
  {
    preset: 'yaml-language-server',
    providerId: 'lsp-yaml-language-server',
    languageId: 'yaml',
    ext: '.yaml',
    text: 'name: example\nversion: 1\n',
    symbol: 'name'
  },
  {
    preset: 'lua-language-server',
    providerId: 'lsp-lua-language-server',
    languageId: 'lua',
    ext: '.lua',
    text: 'local function add(a, b) return a + b end\n',
    symbol: 'add'
  },
  {
    preset: 'zls',
    providerId: 'lsp-zls',
    languageId: 'zig',
    ext: '.zig',
    text: 'fn add(a: i32, b: i32) i32 { return a + b; }\n',
    symbol: 'add'
  }
];

try {
  for (const [index, entry] of presetMatrix.entries()) {
    const fileName = `sample-${entry.preset}-${index}${entry.ext}`;
    const chunkUid = `ck64:v1:test:src/${fileName}`;
    const result = await runToolingProviders({
      strict: true,
      repoRoot: tempRoot,
      buildRoot: tempRoot,
      toolingConfig: {
        lsp: {
          enabled: true,
          servers: [{
            preset: entry.preset,
            languages: [entry.languageId],
            uriScheme: 'poc-vfs'
          }]
        }
      },
      cache: {
        enabled: false
      }
    }, {
      documents: [{
        virtualPath: `.poc-vfs/src/${fileName}#seg:${fileName}`,
        text: entry.text,
        languageId: entry.languageId,
        effectiveExt: entry.ext,
        docHash: `hash-stub-${index}`
      }],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid,
          chunkId: `chunk_${entry.preset}_${index}`,
          file: `src/${fileName}`,
          segmentUid: null,
          segmentId: null,
          range: { start: 0, end: entry.text.length }
        },
        virtualPath: `.poc-vfs/src/${fileName}#seg:${fileName}`,
        virtualRange: { start: 0, end: entry.text.length },
        symbolHint: { name: entry.symbol, kind: 'function' },
        languageId: entry.languageId
      }],
      kinds: ['types']
    });

    assert.ok(result.byChunkUid instanceof Map, `expected map output for preset ${entry.preset}`);
    const providerDiag = result.diagnostics?.[entry.providerId] || null;
    if (providerDiag) {
      assert.equal(
        Boolean(providerDiag.runtime) || Array.isArray(providerDiag.checks),
        true,
        `expected diagnostic envelope shape for ${entry.providerId}`
      );
    }
  }

  console.log('configured LSP generic presets matrix test passed');
} finally {
  await restorePath();
}

