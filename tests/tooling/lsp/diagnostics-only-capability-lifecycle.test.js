import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { collectLspTypes } from '../../../src/integrations/tooling/providers/lsp.js';
import { buildLspCapabilityGate } from '../../../src/integrations/tooling/providers/lsp/capabilities.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { getTrackedSubprocessCount } from '../../../src/shared/subprocess/tracking.js';
import { __testLspSessionPool } from '../../../src/integrations/tooling/providers/lsp/session-pool.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-diagnostic-only-'));
const stub = path.resolve('tests/fixtures/lsp/diagnostics-only-server.js');
const text = 'bad = missing\n';
const uid = 'ck64:v1:test:diagnostics:only';
const inputs = { documents: [{ virtualPath: 'sample.py', text, languageId: 'python', effectiveExt: '.py' }],
  targets: [{ chunkRef: { docId: 0, chunkUid: uid, chunkId: 'diagnostic-only', file: 'sample.py',
    range: { start: 0, end: text.length } }, virtualPath: 'sample.py',
  virtualRange: { start: 0, end: text.length }, symbolHint: { name: 'bad', kind: 'variable' } }] };
const config = { rootDir: root, ...inputs, cmd: process.execPath, captureDiagnostics: true,
  collectTypes: false, sessionPoolingEnabled: false, vfsColdStartCache: false, timeoutMs: 3000, retries: 0 };
const readTrace = async (file) => (await fs.readFile(file, 'utf8')).trim().split('\n').map((line) => JSON.parse(line).kind);
try {
  const gate = buildLspCapabilityGate({ capabilityMask: { documentSymbol: false }, collectTypes: false });
  assert.equal(gate.capabilities.documentSymbol, false);
  assert.equal(gate.requested.documentSymbol, false);
  assert.equal(gate.skipSymbolCollection, false);
  assert.ok(Object.values(gate.effective).every((value) => value === false));
  assert.equal(buildLspCapabilityGate({ capabilityMask: { documentSymbol: false } }).skipSymbolCollection, true);
  for (const uriScheme of ['file', 'poc-vfs']) {
    const trace = path.join(root, `${uriScheme}-trace.jsonl`);
    const result = await collectLspTypes({ ...config, uriScheme, args: [stub, trace] });
    assert.deepEqual(result.byChunkUid, {});
    assert.equal(result.runtime.capabilities.documentSymbol, false);
    assert.equal(result.runtime.collectionMode, 'diagnostics-only');
    assert.equal(result.diagnosticsCount, 1);
    assert.equal(result.diagnosticsByChunkUid[uid][0].message, 'current owned result');
    assert.equal(result.runtime.diagnosticsDrain.observedUris, 1);
    const events = await readTrace(trace);
    assert.equal(events.filter((event) => event === 'open').length, 1);
    assert.equal(events.filter((event) => event === 'close').length, 1);
    assert.ok(events.indexOf('diagnostics') < events.indexOf('close'));
    assert.ok(!events.includes('unexpected-type-request'));
  }
  const trace = path.join(root, 'configured-trace.jsonl');
  const provider = createConfiguredLspProvider(normalizeServerConfig({ id: 'diagnostic-only-fixture',
    languages: ['python'], cmd: process.execPath, args: [stub, trace], requireWorkspaceModel: false }, 0));
  const configured = await provider.run({ repoRoot: root, toolingConfig: { lsp: { enabled: true,
    sessionPoolingEnabled: false } } }, { ...inputs, kinds: ['diagnostics'] });
  assert.equal(configured.diagnostics.diagnosticsCount, 1);
  assert.equal(configured.diagnostics.fidelity.contributes.typeEnrichment, false);
  assert.equal(configured.diagnostics.fidelity.contributes.diagnostics, true);
  assert.equal(configured.diagnostics.fidelity.semanticCoverage.state, 'missing');
  assert.equal(configured.diagnostics.fidelity.semanticCoverage.confidence, 'none');
  await __testLspSessionPool.reset();
  const controller = new AbortController();
  const abortTrace = path.join(root, 'abort-trace.jsonl');
  const timer = setTimeout(() => controller.abort(), 200);
  await assert.rejects(collectLspTypes({ ...config, args: [stub, abortTrace, '--slow'], abortSignal: controller.signal }),
    (error) => error?.name === 'AbortError' || error?.code === 'ABORT_ERR');
  clearTimeout(timer);
  assert.equal(getTrackedSubprocessCount(), 0, 'abort reaps the owned server');
  assert.ok(!(await readTrace(abortTrace)).includes('unexpected-type-request'));
  console.log('Diagnostics-only collection preserves capabilities, owned URI/version binding, close and abort cleanup');
} finally {
  await __testLspSessionPool.reset();
  await fs.rm(root, { recursive: true, force: true });
}
