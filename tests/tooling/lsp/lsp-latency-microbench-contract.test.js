#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-latency-microbench-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'int add(int a, int b) { return a + b; }\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:latency.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:latency';

const sampleCount = 6;
const perRunP50 = [];
const perRunP95 = [];
let requests = 0;
let timedOut = 0;

for (let i = 0; i < sampleCount; i += 1) {
  const result = await collectLspTypes({
    rootDir: tempRoot,
    vfsRoot: tempRoot,
    documents: [{
      virtualPath,
      text: docText,
      languageId: 'cpp',
      effectiveExt: '.cpp'
    }],
    targets: [{
      chunkRef: {
        docId: 0,
        chunkUid,
        chunkId: `chunk_latency_${i}`,
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
    args: [serverPath, '--mode', 'clangd'],
    parseSignature: (detail) => ({
      signature: detail,
      returnType: 'int',
      paramTypes: { a: 'int', b: 'int' }
    })
  });

  const latency = result.runtime?.requests?.latencyMs || {};
  perRunP50.push(Number(latency.p50 || 0));
  perRunP95.push(Number(latency.p95 || 0));
  requests += Number(result.runtime?.requests?.requests || 0);
  timedOut += Number(result.runtime?.requests?.timedOut || 0);
}

const timeoutRatio = requests > 0 ? timedOut / requests : 0;
assert.equal(perRunP50.length, sampleCount, 'expected p50 sample for each microbench run');
assert.equal(perRunP95.length, sampleCount, 'expected p95 sample for each microbench run');
assert.equal(perRunP50.every((value) => Number.isFinite(value) && value >= 0), true, 'expected finite p50 values');
assert.equal(perRunP95.every((value) => Number.isFinite(value) && value >= 0), true, 'expected finite p95 values');
assert.equal(
  perRunP95.every((value, index) => value >= perRunP50[index]),
  true,
  'expected p95 >= p50 for each run'
);
assert.equal(timeoutRatio <= 0.01, true, `expected timeout ratio <= 1%, got ${timeoutRatio}`);

console.log('LSP latency microbench contract test passed');
