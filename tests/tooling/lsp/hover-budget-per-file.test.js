#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { applyTestEnv, withTemporaryEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'lsp-hover-budget-per-file');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const tracePath = path.join(tempRoot, 'trace.jsonl');
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\nint sub(int a, int b) { return a - b; }\n';

const buildDocBundle = (name, docId) => {
  const virtualPath = `.poc-vfs/src/${name}.cpp#seg:${name}.cpp`;
  const addStart = docText.indexOf('add');
  const subStart = docText.indexOf('sub');
  const docs = {
    virtualPath,
    text: docText,
    languageId: 'cpp',
    effectiveExt: '.cpp',
    docHash: `hash_${name}`
  };
  const targets = [{
    chunkRef: {
      docId,
      chunkUid: `ck64:v1:test:src/${name}.cpp:add`,
      chunkId: `chunk_${name}_add`,
      file: `src/${name}.cpp`,
      segmentUid: null,
      segmentId: null,
      range: { start: addStart, end: addStart + 3 }
    },
    virtualPath,
    virtualRange: { start: addStart, end: addStart + 3 },
    symbolHint: { name: 'add', kind: 'function' }
  }, {
    chunkRef: {
      docId,
      chunkUid: `ck64:v1:test:src/${name}.cpp:sub`,
      chunkId: `chunk_${name}_sub`,
      file: `src/${name}.cpp`,
      segmentUid: null,
      segmentId: null,
      range: { start: subStart, end: subStart + 3 }
    },
    virtualPath,
    virtualRange: { start: subStart, end: subStart + 3 },
    symbolHint: { name: 'sub', kind: 'function' }
  }];
  return { doc: docs, targets };
};

const bundleA = buildDocBundle('sample_a', 0);
const bundleB = buildDocBundle('sample_b', 1);

let result = null;
await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
  result = await collectLspTypes({
    rootDir: tempRoot,
    vfsRoot: tempRoot,
    documents: [bundleA.doc, bundleB.doc],
    targets: [...bundleA.targets, ...bundleB.targets],
    cmd: process.execPath,
    args: [serverPath, '--mode', 'stall-signature-help-two-symbols'],
    parseSignature: () => null,
    hoverMaxPerFile: 1,
    signatureHelpEnabled: false,
    definitionEnabled: false,
    typeDefinitionEnabled: false,
    referencesEnabled: false
  });
});

const events = await parseJsonLinesFile(tracePath);
const hoverCount = events.filter((evt) => evt.kind === 'request' && evt.method === 'textDocument/hover').length;
assert.equal(hoverCount, 2, 'expected hover budget to allow one hover request per file');
assert.equal(
  Number(result?.hoverMetrics?.skippedByBudget || 0) >= 2,
  true,
  'expected per-file hover budget suppression metrics'
);
const files = Array.isArray(result?.hoverMetrics?.files) ? result.hoverMetrics.files : [];
const sampleAStats = files.find((entry) => String(entry?.virtualPath || '').includes('sample_a.cpp'));
const sampleBStats = files.find((entry) => String(entry?.virtualPath || '').includes('sample_b.cpp'));
assert.equal(Number(sampleAStats?.requested || 0), 1, 'expected sample_a to consume one hover request');
assert.equal(Number(sampleBStats?.requested || 0), 1, 'expected sample_b to consume one hover request');

console.log('LSP hover budget per-file test passed');
