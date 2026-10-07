#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const removeDirWithRetry = async (targetPath, attempts = 6) => {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      const code = String(error?.code || '').trim().toUpperCase();
      if (!['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  if (lastError) throw lastError;
};

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-request-cache-hit-${process.pid}-${Date.now()}`);
await removeDirWithRetry(tempRoot);
await fs.mkdir(tempRoot, { recursive: true });

const cacheRoot = path.join(tempRoot, 'cache');
const firstTracePath = path.join(tempRoot, 'trace-first.jsonl');
const secondTracePath = path.join(tempRoot, 'trace-second.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'const sentinel = 1;\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:request-cache.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:request-cache';

const parseSignature = (detailText) => {
  const detail = String(detailText || '').trim();
  if (!detail) return null;
  if (detail === 'add') {
    return {
      signature: detail,
      returnType: 'unknown',
      paramTypes: {},
      paramNames: ['a', 'b']
    };
  }
  if (detail === 'int add(int a, int b)') {
    return {
      signature: detail,
      returnType: 'int',
      paramTypes: {
        a: 'int',
        b: 'int'
      },
      paramNames: ['a', 'b']
    };
  }
  return null;
};

const runCollect = async (tracePath) => {
  let result = null;
  await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
    result = await collectLspTypes({
      rootDir: tempRoot,
      vfsRoot: tempRoot,
      cacheRoot,
      documents: [{
        virtualPath,
        text: docText,
        languageId: 'cpp',
        effectiveExt: '.cpp',
        docHash: 'doc-hash-request-cache'
      }],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid,
          chunkId: 'chunk_request_cache',
          file: 'src/sample.cpp',
          segmentUid: null,
          segmentId: null,
          range: { start: 0, end: docText.length }
        },
        virtualPath,
        virtualRange: { start: 0, end: docText.length },
        symbolHint: { name: 'add', kind: 'function' }
      }],
      cmd: process.execPath,
      args: [serverPath, '--mode', 'signature-help'],
      providerId: 'clangd',
      providerVersion: '9.9.9',
      workspaceKey: 'repo-root',
      parseSignature
    });
  });
  return result;
};

try {
  const first = await runCollect(firstTracePath);
  const second = await runCollect(secondTracePath);

  const firstEvents = await parseJsonLinesFile(firstTracePath);
  const secondEvents = await parseJsonLinesFile(secondTracePath);
  const firstRequestCount = firstEvents.filter((entry) => entry.kind === 'request').length;
  const secondRequestCount = secondEvents.filter((entry) => entry.kind === 'request').length;

  assert.equal(firstRequestCount > 0, true, 'expected initial run to issue LSP requests');
  assert.equal(secondRequestCount < firstRequestCount, true, 'expected persistent request cache to suppress second-run requests');
  assert.equal(
    Number(second?.runtime?.requestCache?.persistedHits || 0) >= 1,
    true,
    'expected second run to report persisted request cache hits'
  );
  assert.equal(
    Number(second?.runtime?.requestCache?.byKind?.hover?.hits || 0) >= 1,
    true,
    'expected hover request cache hit telemetry'
  );
  assert.equal(
    Number(second?.runtime?.requestCache?.byKind?.signature_help?.hits || 0) >= 1,
    true,
    'expected signatureHelp request cache hit telemetry'
  );

  console.log('LSP persistent request cache hit test passed');
} finally {
  await __testLspSessionPool.reset();
  await removeDirWithRetry(tempRoot);
}
