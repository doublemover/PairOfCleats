#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'configured-lsp-generic-presets-mixed-routing');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const fixturesBin = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const originalPath = process.env.PATH || '';
process.env.PATH = `${fixturesBin}${path.delimiter}${originalPath}`;

const scenarios = [
  {
    preset: 'gopls',
    providerId: 'lsp-gopls',
    languageId: 'go',
    ext: '.go',
    text: 'package main\nfunc add(a int, b int) int { return a + b }\n'
  },
  {
    preset: 'rust-analyzer',
    providerId: 'lsp-rust-analyzer',
    languageId: 'rust',
    ext: '.rs',
    text: 'fn add(a: i32, b: i32) -> i32 { a + b }\n'
  },
  {
    preset: 'yaml-language-server',
    providerId: 'lsp-yaml-language-server',
    languageId: 'yaml',
    ext: '.yaml',
    text: 'name: example\nversion: 1\n'
  },
  {
    preset: 'lua-language-server',
    providerId: 'lsp-lua-language-server',
    languageId: 'lua',
    ext: '.lua',
    text: 'local function add(a, b) return a + b end\n'
  },
  {
    preset: 'zls',
    providerId: 'lsp-zls',
    languageId: 'zig',
    ext: '.zig',
    text: 'fn add(a: i32, b: i32) i32 { return a + b; }\n'
  }
];

try {
  const documents = [];
  const targets = [];
  for (const [index, scenario] of scenarios.entries()) {
    const fileName = `sample-${scenario.languageId}-${index}${scenario.ext}`;
    const virtualPath = `.poc-vfs/src/${fileName}#seg:${fileName}`;
    const chunkUid = `ck64:v1:test:src/${fileName}`;
    documents.push({
      virtualPath,
      text: scenario.text,
      languageId: scenario.languageId,
      effectiveExt: scenario.ext,
      docHash: `hash-${scenario.languageId}-${index}`
    });
    targets.push({
      chunkRef: {
        docId: index,
        chunkUid,
        chunkId: `chunk_${scenario.languageId}_${index}`,
        file: `src/${fileName}`,
        segmentUid: null,
        segmentId: null,
        range: { start: 0, end: scenario.text.length }
      },
      virtualPath,
      virtualRange: { start: 0, end: scenario.text.length },
      symbolHint: { name: 'add', kind: 'function' },
      languageId: scenario.languageId
    });
  }

  const result = await runToolingProviders({
    strict: true,
    repoRoot: tempRoot,
    buildRoot: tempRoot,
    toolingConfig: {
      lsp: {
        enabled: true,
        servers: scenarios.map((scenario) => ({
          preset: scenario.preset,
          uriScheme: 'poc-vfs'
        }))
      }
    },
    cache: {
      enabled: false
    }
  }, {
    documents,
    targets,
    kinds: ['types']
  });

  assert.ok(result.byChunkUid instanceof Map, 'expected merged byChunkUid map');
  assert.equal(result.byChunkUid.size, scenarios.length, 'expected enrichment for all mixed preset targets');

  for (const [index, scenario] of scenarios.entries()) {
    const fileName = `sample-${scenario.languageId}-${index}${scenario.ext}`;
    const chunkUid = `ck64:v1:test:src/${fileName}`;
    const entry = result.byChunkUid.get(chunkUid) || null;
    assert.ok(entry, `expected merged entry for ${chunkUid}`);
    const sourceSet = result.sourcesByChunkUid.get(chunkUid);
    assert.ok(sourceSet instanceof Set, `expected source set for ${chunkUid}`);
    assert.equal(sourceSet.has(scenario.providerId), true, `expected ${scenario.providerId} source for ${chunkUid}`);
    assert.equal(sourceSet.size, 1, `expected single-provider source ownership for ${chunkUid}`);
    const providerDiag = result.diagnostics?.[scenario.providerId] || null;
    assert.ok(providerDiag && providerDiag.runtime, `expected runtime diagnostics for ${scenario.providerId}`);
  }

  console.log('configured LSP generic presets mixed routing test passed');
} finally {
  process.env.PATH = originalPath;
}
