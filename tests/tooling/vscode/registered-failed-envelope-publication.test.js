import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
import { prepareServiceMappingFixture } from '../../helpers/vscode/service-mapping-fixture.js';
import { getRuntimeCapabilityManifest } from '../../../src/shared/runtime-capability-manifest.js';

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-failed-envelope-' });
const baseUrl = 'http://127.0.0.1:4311';
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js'), apiServerUrl: baseUrl, apiExecutionMode: 'require' } });
const mapping = prepareServiceMappingFixture(harness, { repoRoot: root, baseUrl });
try {
  harness.activate(); harness.inputQueue.push('failed producer');
  harness.queuedFetchResults.push({ json: { ok: true, runtimeManifest: getRuntimeCapabilityManifest() } },
    { json: mapping.status }, { json: { ok: false, message: 'declined operation', code: [{ file: 'src/app.ts' }] } });
  await harness.runCommand('pairofcleats.search');
  assert.equal(harness.workspaceStateStore.has('pairofcleats.searchHistory'), false);
  assert.match(harness.errorMessages.at(-1), /unsuccessful operation/);
  assert.equal(harness.openedDocuments.length, 0);
  harness.setGlobalConfiguration({ apiExecutionMode: 'cli' });
  harness.setConfiguration({ inlineHoverEnabled: true, inlineDiagnosticsEnabled: false, inlineDecorationsEnabled: false });
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ ok: false, warnings: [{ message: 'failed response must not become a hover' }] }) });
  const document = { uri: harness.fakeVscode.Uri.file(path.join(root, 'src', 'app.ts')), getText: () => 'Widget', version: 1,
    getWordRangeAtPosition: () => ({ start: { line: 0, character: 0 }, end: { line: 0, character: 6 } }) };
  const hover = await harness.hoverProviders[0].provider.provideHover(document, { line: 0, character: 3 }, {});
  assert.equal(hover, null);
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered successful HTTP/CLI transports cannot publish explicit failed producer envelopes; execution deferred.');
