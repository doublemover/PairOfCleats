#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-signature-help-timeout-adaptive-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'const sentinel = 1;\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:signature-help-timeout.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:signature-help-timeout';

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
  const match = detail.match(/^int\s+add\s*\(\s*int\s+([A-Za-z_]\w*)\s*,\s*int\s+([A-Za-z_]\w*)\s*\)$/);
  if (!match) return null;
  return {
    signature: detail,
    returnType: 'int',
    paramTypes: {
      [match[1]]: 'int',
      [match[2]]: 'int'
    },
    paramNames: [match[1], match[2]]
  };
};

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
      chunkId: 'chunk_signature_help_timeout',
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
  args: [serverPath, '--mode', 'stall-signature-help'],
  parseSignature,
  signatureHelpTimeoutMs: 1000,
  hoverDisableAfterTimeouts: 1,
  definitionEnabled: false,
  typeDefinitionEnabled: false,
  referencesEnabled: false
});

assert.equal(
  Number(result?.hoverMetrics?.signatureHelpRequested || 0) >= 1,
  true,
  'expected signatureHelp stage request'
);
assert.equal(
  Number(result?.hoverMetrics?.signatureHelpSucceeded || 0),
  0,
  'expected signatureHelp stage timeout to prevent success'
);
assert.equal(
  Number(result?.hoverMetrics?.timedOut || 0) >= 1,
  true,
  'expected timeout metric increment'
);
assert.equal(
  Array.isArray(result?.checks) && result.checks.some((entry) => entry?.name === 'tooling_signature_help_timeout'),
  true,
  'expected signature-help timeout check'
);

console.log('LSP signatureHelp timeout adaptive test passed');
