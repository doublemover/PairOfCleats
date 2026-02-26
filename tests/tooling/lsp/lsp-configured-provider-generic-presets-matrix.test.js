#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'configured-lsp-generic-presets-matrix');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const fixturesBin = path.join(root, 'tests', 'fixtures', 'lsp', 'bin');
const originalPath = process.env.PATH || '';
process.env.PATH = `${fixturesBin}${path.delimiter}${originalPath}`;

const presetMatrix = [
  { preset: 'gopls', providerId: 'lsp-gopls' },
  { preset: 'rust-analyzer', providerId: 'lsp-rust-analyzer' },
  { preset: 'yaml-language-server', providerId: 'lsp-yaml-language-server' },
  { preset: 'lua-language-server', providerId: 'lsp-lua-language-server' },
  { preset: 'zls', providerId: 'lsp-zls' }
];

try {
  const docText = 'int add(int a, int b) { return a + b; }\n';
  for (const [index, entry] of presetMatrix.entries()) {
    const chunkUid = `ck64:v1:test:src/sample-${entry.preset}-${index}`;
    const result = await runToolingProviders({
      strict: true,
      repoRoot: tempRoot,
      buildRoot: tempRoot,
      toolingConfig: {
        lsp: {
          enabled: true,
          servers: [{
            preset: entry.preset,
            languages: ['cpp'],
            uriScheme: 'poc-vfs'
          }]
        }
      },
      cache: {
        enabled: false
      }
    }, {
      documents: [{
        virtualPath: `.poc-vfs/src/sample-${index}.cpp#seg:stub.cpp`,
        text: docText,
        languageId: 'cpp',
        effectiveExt: '.cpp',
        docHash: `hash-stub-${index}`
      }],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid,
          chunkId: `chunk_${entry.preset}_${index}`,
          file: `src/sample-${index}.cpp`,
          segmentUid: null,
          segmentId: null,
          range: { start: 0, end: docText.length }
        },
        virtualPath: `.poc-vfs/src/sample-${index}.cpp#seg:stub.cpp`,
        virtualRange: { start: 0, end: docText.length },
        symbolHint: { name: 'add', kind: 'function' },
        languageId: 'cpp'
      }],
      kinds: ['types']
    });

    assert.ok(result.byChunkUid instanceof Map, `expected map output for preset ${entry.preset}`);
    assert.equal(
      result.byChunkUid.has(chunkUid),
      true,
      `expected preset ${entry.preset} to enrich target`
    );
    const providerDiag = result.diagnostics?.[entry.providerId] || null;
    assert.ok(providerDiag && providerDiag.runtime, `expected runtime diagnostics for ${entry.providerId}`);
  }

  console.log('configured LSP generic presets matrix test passed');
} finally {
  process.env.PATH = originalPath;
}
