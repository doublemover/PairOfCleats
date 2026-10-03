#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parsePythonSignature } from '../../../src/index/tooling/signature-parse/python.js';
import { parseCppTwoIntParamSignature, parseJsonLinesFile } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const cppParseSignature = (detailText) => parseCppTwoIntParamSignature(detailText, {
  bareNames: ['add'],
  bareReturnType: 'unknown'
});

const runTraceCase = async ({
  name,
  mode,
  docText,
  languageId,
  effectiveExt,
  chunkUid,
  range,
  symbolHint,
  parseSignature,
  extraCollect = {},
  assertPayload,
  assertTrace
}) => {
  const tempRoot = resolveTestCachePath(root, `${name}-${process.pid}-${Date.now()}`);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });
  const tracePath = path.join(tempRoot, 'trace.jsonl');
  const virtualPath = `.poc-vfs/src/${name}${effectiveExt}#seg:${name}${effectiveExt}`;

  let result = null;
  try {
    await withTemporaryEnv({ POC_LSP_TRACE: tracePath }, async () => {
      result = await collectLspTypes({
        rootDir: tempRoot,
        vfsRoot: tempRoot,
        documents: [{
          virtualPath,
          text: docText,
          languageId,
          effectiveExt
        }],
        targets: [{
          chunkRef: {
            docId: 0,
            chunkUid,
            chunkId: `chunk_${name.replace(/[^a-z0-9]+/gi, '_')}`,
            file: `src/${name}${effectiveExt}`,
            segmentUid: null,
            segmentId: null,
            range
          },
          virtualPath,
          virtualRange: range,
          symbolHint
        }],
        cmd: process.execPath,
        args: [serverPath, '--mode', mode],
        parseSignature,
        ...extraCollect
      });
    });

    const payload = result.byChunkUid?.[chunkUid]?.payload || null;
    assert.ok(payload, `expected payload for ${name}`);
    assertPayload(result, payload);

    const traceLines = await parseJsonLinesFile(tracePath);
    assertTrace(traceLines, result);
  } finally {
    // Leave uniquely-named temp roots in place for this matrix to avoid Windows file-handle
    // teardown races from masking the actual fallback assertions under suite load.
  }
};

await runTraceCase({
  name: 'definition-fallback',
  mode: 'definition-richer',
  docText: 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n',
  languageId: 'cpp',
  effectiveExt: '.cpp',
  chunkUid: 'ck64:v1:test:src/sample.cpp:definition-fallback',
  range: (() => {
    const text = 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n';
    const start = text.indexOf('add');
    return { start, end: start + 3 };
  })(),
  symbolHint: { name: 'add', kind: 'function' },
  parseSignature: cppParseSignature,
  assertPayload(result, payload) {
    assert.equal(payload.returnType, 'int');
    assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
    assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
    assert.equal(Number(result?.hoverMetrics?.definitionRequested || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.definitionSucceeded || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.fallbackUsed || 0), 0);
  },
  assertTrace(traceLines) {
    const definitionCalls = traceLines.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/definition').length;
    assert.equal(definitionCalls >= 1, true);
  }
});

await runTraceCase({
  name: 'references-fallback',
  mode: 'references-richer',
  docText: 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n',
  languageId: 'cpp',
  effectiveExt: '.cpp',
  chunkUid: 'ck64:v1:test:src/sample.cpp:references-fallback',
  range: (() => {
    const text = 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n';
    const start = text.indexOf('add');
    return { start, end: start + 3 };
  })(),
  symbolHint: { name: 'add', kind: 'function' },
  parseSignature: cppParseSignature,
  extraCollect: {
    definitionEnabled: false,
    typeDefinitionEnabled: false,
    referencesEnabled: true
  },
  assertPayload(result, payload) {
    assert.equal(payload.returnType, 'int');
    assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
    assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
    assert.equal(Number(result?.hoverMetrics?.referencesRequested || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.referencesSucceeded || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.fallbackUsed || 0), 0);
  },
  assertTrace(traceLines) {
    const referencesCalls = traceLines.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/references').length;
    assert.equal(referencesCalls >= 1, true);
  }
});

await runTraceCase({
  name: 'signature-help-fallback',
  mode: 'signature-help',
  docText: 'const sentinel = 1;\n',
  languageId: 'cpp',
  effectiveExt: '.cpp',
  chunkUid: 'ck64:v1:test:src/sample.cpp:signature-help',
  range: { start: 0, end: 'const sentinel = 1;\n'.length },
  symbolHint: { name: 'add', kind: 'function' },
  parseSignature: cppParseSignature,
  assertPayload(result, payload) {
    assert.equal(payload.returnType, 'int');
    assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
    assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
    assert.equal(Number(result?.hoverMetrics?.signatureHelpRequested || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.signatureHelpSucceeded || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.fallbackUsed || 0), 0);
  },
  assertTrace(traceLines) {
    const calls = traceLines.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/signatureHelp').length;
    assert.equal(calls >= 1, true);
  }
});

await runTraceCase({
  name: 'type-definition-fallback',
  mode: 'type-definition-richer',
  docText: 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n',
  languageId: 'cpp',
  effectiveExt: '.cpp',
  chunkUid: 'ck64:v1:test:src/sample.cpp:type-definition-fallback',
  range: (() => {
    const text = 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n';
    const start = text.indexOf('add');
    return { start, end: start + 3 };
  })(),
  symbolHint: { name: 'add', kind: 'function' },
  parseSignature: cppParseSignature,
  extraCollect: {
    definitionEnabled: false,
    typeDefinitionEnabled: true
  },
  assertPayload(result, payload) {
    assert.equal(payload.returnType, 'int');
    assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
    assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
    assert.equal(Number(result?.hoverMetrics?.definitionRequested || 0), 0);
    assert.equal(Number(result?.hoverMetrics?.typeDefinitionRequested || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.typeDefinitionSucceeded || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.fallbackUsed || 0), 0);
  },
  assertTrace(traceLines) {
    const calls = traceLines.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/typeDefinition').length;
    assert.equal(calls >= 1, true);
  }
});

await runTraceCase({
  name: 'param-fallback-from-source',
  mode: 'signature-help',
  docText: 'int add(int a, int b) { return a + b; }\n',
  languageId: 'cpp',
  effectiveExt: '.cpp',
  chunkUid: 'ck64:v1:test:src/sample.cpp:feedface',
  range: { start: 0, end: 'int add(int a, int b) { return a + b; }\n'.length },
  symbolHint: { name: 'add', kind: 'function' },
  parseSignature: (detailText) => parseCppTwoIntParamSignature(detailText, {
    bareNames: [],
    allowUnnamedPrototype: true
  }),
  assertPayload(result, payload) {
    assert.equal(payload.returnType, 'int');
    assert.deepEqual(payload.paramTypes?.a?.map((entry) => entry.type), ['int']);
    assert.deepEqual(payload.paramTypes?.b?.map((entry) => entry.type), ['int']);
    assert.equal(Number(result?.hoverMetrics?.sourceBootstrapUsed || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.fallbackUsed || 0), 0);
  },
  assertTrace(traceLines) {
    const hoverRequests = traceLines.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/hover').length;
    const signatureHelpRequests = traceLines.filter((entry) => entry.kind === 'request' && entry.method === 'textDocument/signatureHelp').length;
    assert.equal(hoverRequests, 0);
    assert.equal(signatureHelpRequests, 0);
  }
});

await runTraceCase({
  name: 'pyright-function-symbol-priority',
  mode: 'pyright-parameter-shadow',
  docText: 'def greet(name: str) -> str:\n    return "hi"\n',
  languageId: 'python',
  effectiveExt: '.py',
  chunkUid: 'ck64:v1:test:src/sample.py:function-priority',
  range: (() => {
    const text = 'def greet(name: str) -> str:\n    return "hi"\n';
    const start = text.indexOf('greet');
    return { start, end: start + 5 };
  })(),
  symbolHint: { name: 'greet', kind: 'function' },
  parseSignature: (detail) => parsePythonSignature(detail),
  extraCollect: {
    definitionEnabled: false,
    typeDefinitionEnabled: false,
    referencesEnabled: false
  },
  assertPayload(_result, payload) {
    assert.equal(payload.returnType, 'str');
    assert.equal(payload.signature, 'def greet(name: str) -> str');
    assert.notEqual(payload.signature, '(parameter) name: str');
    assert.deepEqual(payload.paramTypes?.name?.map((entry) => entry.type), ['str']);
  },
  assertTrace() {}
});

console.log('LSP fallback runtime contract matrix test passed');
