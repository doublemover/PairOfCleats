#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-docsymbol-policy-skip-init-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const markerPath = path.join(tempRoot, 'server-started.txt');
const virtualPath = '.poc-vfs/third_party/fmt/test/format-test.cc';
const docText = 'int format_test() { return 0; }\n';

const result = await collectLspTypes({
  rootDir: tempRoot,
  vfsRoot: tempRoot,
  providerId: 'clangd',
  documents: [{
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cc'
  }],
  targets: [{
    chunkRef: {
      docId: 0,
      chunkUid: 'ck64:v1:test:third_party/fmt/test/format-test.cc',
      chunkId: 'chunk_docsymbol_policy_skip_init',
      file: 'third_party/fmt/test/format-test.cc',
      segmentUid: null,
      segmentId: null,
      range: { start: 0, end: docText.length }
    },
    virtualPath,
    virtualRange: { start: 0, end: docText.length },
    symbolHint: { name: 'format_test', kind: 'function' }
  }],
  cmd: process.execPath,
  args: [
    '-e',
    "require('node:fs').writeFileSync(process.argv[1], 'started'); setTimeout(() => {}, 5000);",
    markerPath
  ],
  timeoutMs: 1000,
  retries: 0
});

assert.equal(Object.keys(result.byChunkUid).length, 0, 'expected no enrichment when all docs are low-value');
assert.equal(result.runtime?.selection?.selectedDocs, 0, 'expected pre-initialize path policy to select no docs');
assert.match(String(result.runtime?.selection?.reason || ''), /document-symbol-path-policy/, 'expected path-policy no-work reason');
assert.equal(result.checks.some((check) => check?.name === 'tooling_initialize_failed'), false, 'expected provider startup to be skipped entirely');
assert.equal(await fs.stat(markerPath).then(() => true).catch(() => false), false, 'expected low-value path policy to avoid starting the LSP process');

console.log('LSP documentSymbol path policy skips initialize test passed');
