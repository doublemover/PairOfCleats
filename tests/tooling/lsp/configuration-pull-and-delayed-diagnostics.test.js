import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lsp-settings-'));
const tracePath = path.join(root, 'trace.jsonl');
const text = 'road: 1\n';
const virtualPath = 'sample.yaml';
const chunkUid = 'ck64:v1:test:yaml:delayed';
try {
  const result = await collectLspTypes({
    rootDir: root, vfsRoot: root,
    documents: [{ virtualPath, text, effectiveExt: '.yaml' }],
    targets: [{
      chunkRef: { docId: 0, chunkUid, chunkId: 'yaml-delayed', file: virtualPath, segmentUid: null,
        segmentId: null, range: { start: 0, end: text.length } },
      virtualPath, virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'road', kind: 'property' }
    }],
    cmd: process.execPath, args: [path.resolve('tests/fixtures/lsp/configuration-pull-server.js'), tracePath],
    initializationOptions: resolveLspServerPresetByKey('yaml').initializationOptions,
    captureDiagnostics: true, sessionPoolingEnabled: false, vfsColdStartCache: false,
    timeoutMs: 3000, retries: 0, documentSymbolConcurrency: 1, hoverConcurrency: 1,
    hoverEnabled: false, signatureHelpEnabled: false, definitionEnabled: false,
    typeDefinitionEnabled: false, referencesEnabled: false, semanticTokensEnabled: false, inlayHintsEnabled: false
  });
  assert.equal(result.diagnosticsCount, 1);
  assert.equal(result.diagnosticsByChunkUid[chunkUid][0].message, 'delayed fixture diagnostic');
  assert.equal(result.runtime.diagnosticsDrain.observedUris, 1);
  assert.equal(result.runtime.diagnosticsDrain.timedOut, false);
  const events = (await fs.readFile(tracePath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).kind);
  assert.ok(events.includes('settings'));
  assert.equal(events.filter((kind) => kind === 'close').length, 1);
  assert.ok(events.indexOf('diagnostics') < events.indexOf('close'), 'close only after diagnostic capture');
  console.log('Configured settings pull and delayed diagnostics survive until owned document close');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
