#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsp-collect-abort-signal');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const documents = [{
  virtualPath: '.poc-vfs/src/sample.cpp#seg:abort.cpp',
  text: 'int f() { return 1; }\n',
  languageId: 'cpp',
  effectiveExt: '.cpp',
  docHash: 'abort-doc'
}];

const targets = [{
  chunkRef: {
    chunkUid: 'ck:test:lsp-abort:1',
    chunkId: 'chunk_lsp_abort_1',
    file: 'src/sample.cpp',
    range: { start: 0, end: 10 }
  },
  virtualPath: documents[0].virtualPath,
  virtualRange: { start: 0, end: 10 },
  symbolHint: { name: 'f', kind: 'function' }
}];

const controller = new AbortController();
controller.abort(new Error('abort collectLspTypes before start'));

await assert.rejects(
  () => collectLspTypes({
    rootDir: tempRoot,
    documents,
    targets,
    cmd: process.execPath,
    args: [],
    abortSignal: controller.signal
  }),
  (err) => err?.code === 'ABORT_ERR',
  'expected collectLspTypes to fail fast when abort signal is already aborted'
);

console.log('LSP collect abort-signal test passed');
