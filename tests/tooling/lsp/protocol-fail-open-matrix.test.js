#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';

const cases = [
  {
    mode: 'malformed-hover',
    expectedCheck: null,
    unexpectedChecks: ['tooling_initialize_failed', 'tooling_document_symbol_failed'],
    expectFailedMetric: true,
    timeoutMs: 1500,
    hoverRequireMissingReturn: true,
    parseSignature: () => null
  },
  {
    mode: 'malformed-document-symbol',
    expectedCheck: 'tooling_document_symbol_failed',
    unexpectedChecks: ['tooling_initialize_failed'],
    expectFailedMetric: true,
    timeoutMs: 1500,
    parseSignature: (detail) => ({
      signature: detail,
      returnType: 'int',
      paramTypes: { a: 'int', b: 'int' }
    })
  },
  {
    mode: 'malformed-initialize',
    expectedCheck: 'tooling_initialize_failed',
    unexpectedChecks: [],
    expectFailedMetric: false,
    timeoutMs: 1200,
    parseSignature: (detail) => ({
      signature: detail,
      returnType: 'int',
      paramTypes: { a: 'int', b: 'int' }
    })
  },
  {
    mode: 'disconnect-on-document-symbol',
    expectedCheck: 'tooling_document_symbol_failed',
    unexpectedChecks: ['tooling_initialize_failed'],
    expectFailedMetric: true,
    timeoutMs: 1500,
    parseSignature: (detail) => ({
      signature: detail,
      returnType: 'int',
      paramTypes: { a: 'int', b: 'int' }
    })
  },
  {
    mode: 'capability-drift-hover',
    expectedCheck: null,
    unexpectedChecks: ['tooling_initialize_failed'],
    expectFailedMetric: true,
    timeoutMs: 1500,
    hoverRequireMissingReturn: true,
    parseSignature: () => null
  },
  {
    mode: 'inconsistent-document-symbol',
    expectedCheck: null,
    unexpectedChecks: ['tooling_initialize_failed'],
    expectFailedMetric: false,
    timeoutMs: 1500,
    parseSignature: () => null
  },
  {
    mode: 'disconnect-on-hover',
    expectedCheck: null,
    unexpectedChecks: ['tooling_initialize_failed', 'tooling_document_symbol_failed'],
    expectFailedMetric: true,
    timeoutMs: 1500,
    hoverRequireMissingReturn: true,
    parseSignature: () => null
  },
  {
    mode: 'stall-initialize',
    expectedCheck: 'tooling_initialize_failed',
    unexpectedChecks: [],
    expectFailedMetric: false,
    expectTimedOutMetric: true,
    timeoutMs: 250,
    parseSignature: (detail) => ({
      signature: detail,
      returnType: 'int',
      paramTypes: { a: 'int', b: 'int' }
    })
  },
  {
    mode: 'delayed-partial-document-symbol',
    expectedCheck: null,
    unexpectedChecks: ['tooling_document_symbol_failed', 'tooling_initialize_failed'],
    expectChunk: true,
    timeoutMs: 2000,
    parseSignature: (detail) => ({
      signature: String(detail || 'add'),
      returnType: 'int',
      paramTypes: { a: 'int', b: 'int' }
    })
  },
  {
    mode: 'fragmented-responses',
    expectedCheck: null,
    unexpectedChecks: ['tooling_initialize_failed'],
    expectChunk: true,
    timeoutMs: 2000,
    args: ['--fragment-size', '3'],
    parseSignature: (detail) => ({
      signature: detail,
      returnType: 'int',
      paramTypes: { a: 'int', b: 'int' }
    })
  }
];

for (const [index, testCase] of cases.entries()) {
  const tempRoot = resolveTestCachePath(root, `lsp-protocol-fail-open-${index}-${process.pid}-${Date.now()}`);
  await fs.mkdir(tempRoot, { recursive: true });

  const virtualPath = `.poc-vfs/src/sample.cpp#seg:${testCase.mode}.cpp`;
  const result = await collectLspTypes({
    rootDir: tempRoot,
    vfsRoot: tempRoot,
    documents: [{
      virtualPath,
      text: docText,
      languageId: 'cpp',
      effectiveExt: '.cpp',
      docHash: `hash-${testCase.mode}`
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid: `ck64:v1:test:src/sample.cpp:${testCase.mode}`,
        chunkId: `chunk_${testCase.mode.replace(/[^a-z0-9]+/gi, '_')}`,
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
    args: [serverPath, '--mode', testCase.mode, ...(Array.isArray(testCase.args) ? testCase.args : [])],
    parseSignature: testCase.parseSignature,
    retries: 0,
    timeoutMs: testCase.timeoutMs,
    hoverRequireMissingReturn: testCase.hoverRequireMissingReturn || false
  });

  if (testCase.expectChunk) {
    assert.equal(Object.keys(result.byChunkUid || {}).length >= 1, true, `expected ${testCase.mode} to enrich at least one chunk`);
  } else {
    assert.equal(Object.keys(result.byChunkUid || {}).length, 0, `expected ${testCase.mode} to fail open`);
  }
  if (testCase.expectedCheck) {
    assert.equal(result.checks.some((check) => check?.name === testCase.expectedCheck), true);
  }
  for (const unexpectedCheck of testCase.unexpectedChecks) {
    assert.equal(result.checks.some((check) => check?.name === unexpectedCheck), false);
  }
  if (testCase.expectFailedMetric) {
    assert.equal(Number(result.runtime?.requests?.failed || 0) >= 1, true);
  }
  if (testCase.expectTimedOutMetric) {
    assert.equal(Number(result.runtime?.requests?.timedOut || 0) >= 1, true);
  }
}

console.log('LSP protocol fail-open matrix test passed');
