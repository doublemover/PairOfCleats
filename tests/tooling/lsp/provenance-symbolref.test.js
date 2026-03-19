#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveSymbolJoinKey } from '../../../src/shared/identity.js';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { parseCppTwoIntParamSignature } from '../../helpers/lsp-signature-fixtures.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, `lsp-provenance-symbolref-${process.pid}-${Date.now()}`);
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const serverPath = path.join(root, 'tests', 'fixtures', 'lsp', 'stub-lsp-server.js');
const docText = 'const sentinel = 1;\n';
const virtualPath = '.poc-vfs/src/sample.cpp#seg:provenance-symbolref.cpp';
const chunkUid = 'ck64:v1:test:src/sample.cpp:provenance-symbolref';

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
      chunkId: 'chunk_provenance_symbolref',
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
  parseSignature: (detailText) => parseCppTwoIntParamSignature(detailText, {
    bareNames: ['add'],
    bareReturnType: 'unknown'
  })
});

const entry = result.byChunkUid?.[chunkUid] || null;
assert.ok(entry, 'expected enriched LSP entry');
assert.equal(entry.payload?.returnType, 'int', 'expected enriched return type');
assert.ok(entry.symbolRef, 'expected LSP symbolRef envelope');
assert.equal(resolveSymbolJoinKey(entry.symbolRef)?.type, 'symbolId', 'expected symbolRef to resolve via symbolId');
assert.equal(entry.symbolRef?.evidence?.scheme, 'lsp', 'expected LSP evidence scheme');
assert.equal(entry.symbolRef?.evidence?.confidence, 'high', 'expected high symbolRef confidence for completed stage result');

const provenance = entry.provenance || null;
assert.ok(provenance && typeof provenance === 'object', 'expected provenance entry');
assert.equal(provenance.provider, process.execPath, 'expected provenance provider to be runtime command');
assert.equal(provenance.source, 'lsp', 'expected provenance source tag');
assert.equal(provenance.stages?.documentSymbol, true, 'expected documentSymbol provenance flag');
assert.equal(provenance.stages?.hover?.requested, true, 'expected hover stage request provenance');
assert.equal(provenance.stages?.signatureHelp?.requested, true, 'expected signatureHelp stage request provenance');
assert.equal(provenance.stages?.signatureHelp?.succeeded, true, 'expected signatureHelp stage success provenance');
assert.equal(provenance.evidence?.tier, 'full', 'expected full evidence tier');
assert.equal(provenance.confidence?.tier, 'high', 'expected high calibrated confidence tier');
assert.equal(provenance.quality?.incomplete, false, 'expected complete quality result');
assert.equal(Number(provenance.quality?.paramCoverage || 0), 1, 'expected full parameter coverage');

console.log('LSP provenance symbolRef test passed');
