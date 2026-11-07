import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';

for (const scenario of ['current', 'windows-case-root', 'unc-case-root', 'editor-replaced', 'service-replaced', 'service-dirty', 'other-service-root', 'posix-case-root']) {
  const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-api-health-response-' });
  let mapping, statusReads = 0;
  const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
    globalConfigValues: { apiExecutionMode: 'require', apiServerUrl: 'http://127.0.0.1:4311' },
    fetchImpl: async url => {
      if (url.includes('/capabilities')) return new Response(JSON.stringify({ ok: true, runtimeManifest: getRuntimeCapabilityManifest() }));
      const payload = structuredClone(mapping.status);
      if (++statusReads === 2) {
        if (scenario === 'editor-replaced') fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'b'.repeat(40));
        if (scenario === 'service-replaced') payload.status.coverage.currentProvenance.head.commitId = 'b'.repeat(40);
        if (scenario === 'service-dirty') payload.status.coverage.currentProvenance.dirty = true;
        if (scenario === 'other-service-root') payload.status.repo.root = '/srv/another';
        if (scenario === 'posix-case-root') payload.status.repo.root = '/srv/Project';
        if (scenario === 'windows-case-root') payload.status.repo.root = 'c:/srv/project';
        if (scenario === 'unc-case-root') payload.status.repo.root = '\\\\SERVER\\share\\project';
      }
      return new Response(JSON.stringify(payload));
    } });
  mapping = prepareServiceMappingFixture(harness, { repoRoot: root, serviceRoot: scenario === 'windows-case-root'
    ? 'C:\\srv\\Project' : scenario === 'unc-case-root' ? '//server/Share/Project' : '/srv/project' });
  try {
    harness.activate(); await harness.runCommand('pairofcleats.indexHealth');
    assert.equal(harness.spawnCalls.length, 0); assert.equal(statusReads, 2);
    const session = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
    const current = ['current', 'windows-case-root', 'unc-case-root'].includes(scenario);
    assert.equal(session.status, current ? 'succeeded' : 'failed',
      `${scenario}: ${harness.errorMessages.at(-1) || 'no error message'}`);
    if (current) assert(harness.infoMessages.some(message => /Index Health completed/.test(message)));
    else {
      assert(!harness.infoMessages.some(message => /Index Health completed/.test(message)));
      assert.match(harness.errorMessages.at(-1), /identity changed|revision does not match|dirty|different repository/);
    }
  } finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
}

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-api-health-cancel-' });
let mapping, statusReads = 0, entered;
const ready = new Promise(resolve => { entered = resolve; });
const callbacks = new Set();
const token = { isCancellationRequested: false,
  onCancellationRequested(callback) { callbacks.add(callback); return { dispose: () => callbacks.delete(callback) }; } };
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { apiExecutionMode: 'require', apiServerUrl: 'http://127.0.0.1:4311' },
  fetchImpl: async (url, options) => {
    if (url.includes('/capabilities')) return new Response(JSON.stringify({ ok: true, runtimeManifest: getRuntimeCapabilityManifest() }));
    if (++statusReads === 1) return new Response(JSON.stringify(mapping.status));
    entered(); return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => { const error = new Error('cancelled owned fixture request'); error.name = 'AbortError'; reject(error); }, { once: true });
    });
  } });
mapping = prepareServiceMappingFixture(harness, { repoRoot: root, serviceRoot: '/srv/project' });
try {
  harness.activate();
  harness.fakeVscode.window.withProgress = (options, callback) => {
    assert.equal(options.cancellable, true); return callback({ report() {} }, token);
  };
  const pending = harness.runCommand('pairofcleats.indexHealth'); await ready;
  token.isCancellationRequested = true; for (const callback of [...callbacks]) callback(); await pending;
  assert.equal(callbacks.size, 0);
  assert.equal(harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0].status, 'cancelled');
  assert.deepEqual(harness.errorMessages, []);
  assert(!harness.infoMessages.some(message => /Index Health completed/.test(message)));
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered API health final response root/revision/cleanliness and progress cancellation controls authored; execution deferred.');
