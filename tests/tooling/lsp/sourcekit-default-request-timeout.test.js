#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createSourcekitProvider } from '../../../src/index/tooling/sourcekit-provider.js';
import { cleanupLspTestRuntime } from '../../helpers/lsp-runtime.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const tempRoot = resolveTestCachePath(process.cwd(), 'sourcekit-default-request-timeout');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(tempRoot, 'src'), { recursive: true });
const text = 'func alpha(value) { return value }\n';
await fs.writeFile(path.join(tempRoot, 'src/one.swift'), text);
const document = { virtualPath: 'src/one.swift', effectiveExt: '.swift', languageId: 'swift',
  text, docHash: 'sourcekit-delay-fixture', containerPath: 'src/one.swift' };
const target = { virtualPath: document.virtualPath, languageId: 'swift',
  chunkRef: { chunkUid: 'ck:test:sourcekit:default-timeout', chunkId: 'alpha', file: document.virtualPath,
    start: 0, end: text.length }, virtualRange: { start: 0, end: text.length },
  symbolHint: { name: 'alpha', kind: 'function' } };
const provider = createSourcekitProvider();
const run = async (settings) => {
  const logs = [];
  const output = await provider.run({ repoRoot: tempRoot, buildRoot: tempRoot, strict: true,
    logger: (line) => logs.push(line), toolingConfig: { sourcekit: {
      cmd: process.execPath,
      args: [path.join(process.cwd(), 'tests/fixtures/lsp/sourcekit-delayed-requests-server.js')],
      hostConcurrencyGate: false, retries: 0, breakerThreshold: 1,
      semanticTokensEnabled: false, signatureHelpEnabled: false,
      ...settings
    } } }, { documents: [document], targets: [target] });
  await cleanupLspTestRuntime({ strict: true });
  return { output, logs };
};
try {
  for (const [label, settings] of [
    ['absent', {}], ['null', { hoverTimeoutMs: null }], ['blank', { hoverTimeoutMs: '' }]
  ]) {
    const { output, logs } = await run(settings);
    assert.ok(logs.some((line) => line.includes('hoverTimeoutMs=3500 signatureHelpTimeoutMs=3500')),
      `${label}: retained log reports resolved per-method defaults`);
    assert.equal(output.provider.version, '2.1.1', 'cached results from the old policy use a different provider version');
    const runtime = output.diagnostics.runtime;
    assert.equal(runtime.requests.byMethod['textDocument/hover'].timedOut, 0, `${label}: hover request fits declared default`);
    assert.equal(runtime.hoverMetrics.succeeded, 1, `${label}: real client returns the delayed type`);
    assert.equal(output.byChunkUid[target.chunkRef.chunkUid].payload.returnType, 'Int');
  }
  const inlay = await run({ hoverEnabled: false });
  assert.equal(inlay.output.diagnostics.runtime.requests.byMethod['textDocument/inlayHint'].timedOut, 0,
    'inlay hints inherit the same declared default');
  assert.equal(inlay.output.diagnostics.runtime.hoverMetrics.inlayHintsSucceeded, 1);
  const { output } = await run({ hoverTimeoutMs: 1000 });
  assert.ok(output.diagnostics.runtime.requests.byMethod['textDocument/hover'].timedOut > 0,
    'an explicit shorter deadline remains effective');
  assert.equal(output.diagnostics.fidelity.state, 'degraded', 'timeouts remain visible');
} finally {
  await cleanupLspTestRuntime({ strict: true });
  await fs.rm(tempRoot, { recursive: true, force: true });
}
console.log('SourceKit absent/null/blank deadlines retain the declared default; explicit short deadlines still time out.');
