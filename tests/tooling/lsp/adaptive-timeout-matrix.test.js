#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseCppTwoIntParamSignature } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');

const parseSignature = (detailText) => parseCppTwoIntParamSignature(detailText, {
  bareNames: ['add'],
  bareReturnType: 'unknown'
});

const cases = [
  {
    name: 'signature-help',
    mode: 'stall-signature-help',
    metricKey: 'signatureHelp',
    checkName: 'tooling_signature_help_timeout',
    timeoutField: 'signatureHelpTimeoutMs',
    timeoutMs: 1000,
    docText: 'const sentinel = 1;\n',
    range: (docText) => ({ start: 0, end: docText.length }),
    featureFlags: { definitionEnabled: false, typeDefinitionEnabled: false, referencesEnabled: false },
    extraAssert(result) {
      assert.equal(Number(result?.hoverMetrics?.timedOut || 0) >= 1, true, 'expected timeout metric increment');
    }
  },
  {
    name: 'definition',
    mode: 'stall-definition',
    metricKey: 'definition',
    checkName: 'tooling_definition_timeout',
    timeoutField: 'definitionTimeoutMs',
    timeoutMs: 1000,
    docText: 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n',
    range: (docText) => {
      const start = docText.indexOf('add');
      return { start, end: start + 3 };
    },
    featureFlags: { typeDefinitionEnabled: false, referencesEnabled: false }
  },
  {
    name: 'references',
    mode: 'stall-references',
    metricKey: 'references',
    checkName: 'tooling_references_timeout',
    timeoutField: 'referencesTimeoutMs',
    timeoutMs: 1000,
    docText: 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n',
    range: (docText) => {
      const start = docText.indexOf('add');
      return { start, end: start + 3 };
    },
    featureFlags: { definitionEnabled: false, typeDefinitionEnabled: false, referencesEnabled: true }
  },
  {
    name: 'type-definition',
    mode: 'stall-type-definition',
    metricKey: 'typeDefinition',
    checkName: 'tooling_type_definition_timeout',
    timeoutField: 'typeDefinitionTimeoutMs',
    timeoutMs: 1000,
    docText: 'int add(int a, int b) { return a + b; }\nint sentinel = add(1, 2);\n',
    range: (docText) => {
      const start = docText.indexOf('add');
      return { start, end: start + 3 };
    },
    featureFlags: { definitionEnabled: false, typeDefinitionEnabled: true, referencesEnabled: false }
  }
];

for (const [index, testCase] of cases.entries()) {
  const tempRoot = resolveTestCachePath(root, `lsp-adaptive-timeout-matrix-${index}-${process.pid}-${Date.now()}`);
  await fs.rm(tempRoot, { recursive: true, force: true });
  await fs.mkdir(tempRoot, { recursive: true });

  try {
    const virtualPath = `.poc-vfs/src/sample.cpp#seg:${testCase.mode}.cpp`;
    const range = testCase.range(testCase.docText);
    const result = await collectLspTypes({
      rootDir: tempRoot,
      vfsRoot: tempRoot,
      documents: [{
        virtualPath,
        text: testCase.docText,
        languageId: 'cpp',
        effectiveExt: '.cpp'
      }],
      targets: [{
        chunkRef: {
          docId: 0,
          chunkUid: `ck64:v1:test:src/sample.cpp:${testCase.mode}`,
          chunkId: `chunk_${testCase.mode.replace(/[^a-z0-9]+/gi, '_')}`,
          file: 'src/sample.cpp',
          segmentUid: null,
          segmentId: null,
          range
        },
        virtualPath,
        virtualRange: range,
        symbolHint: { name: 'add', kind: 'function' }
      }],
      cmd: process.execPath,
      args: [serverPath, '--mode', testCase.mode],
      parseSignature,
      hoverDisableAfterTimeouts: 1,
      [testCase.timeoutField]: testCase.timeoutMs,
      ...testCase.featureFlags
    });

    assert.equal(Number(result?.hoverMetrics?.[`${testCase.metricKey}Requested`] || 0) >= 1, true);
    assert.equal(Number(result?.hoverMetrics?.[`${testCase.metricKey}Succeeded`] || 0), 0);
    assert.equal(Number(result?.hoverMetrics?.[`${testCase.metricKey}TimedOut`] || 0) >= 1, true);
    assert.equal(Array.isArray(result?.checks) && result.checks.some((entry) => entry?.name === testCase.checkName), true);
    testCase.extraAssert?.(result);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

console.log('LSP adaptive timeout matrix test passed');
