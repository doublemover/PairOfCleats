import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-result-admission-' });
const installation = createVsCodeRuntimeTempRepo({ prefix: 'poc-result-installation-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(installation, 'bin', 'pairofcleats.js') } });
try {
  harness.activate();
  for (const command of ['setup', 'bootstrap']) {
    harness.queuedResults.push({ code: 0, stdout: '{}' }); await harness.runCommand(`pairofcleats.${command}`);
    const call = harness.spawnCalls.at(-1);
    assert(call.args.includes('--skip-install'), 'normal editor setup never infers target dependency installation');
    assert.equal(call.args[call.args.indexOf('--repo') + 1], root);
    assert.equal(call.args[0], path.join(installation, 'bin', 'pairofcleats.js'));
    assert.equal(fs.existsSync(path.join(root, 'package.json')), false);
  }
  harness.queuedResults.push({ code: 1, stdout: JSON.stringify({ derived: { repoCacheRoot: path.join(root, 'wrong-cache') } }) });
  const beforeReveal = harness.executeCommandCalls.length;
  await harness.runCommand('pairofcleats.openIndexDirectory');
  assert.equal(harness.executeCommandCalls.length, beforeReveal, 'nonzero config output cannot authorize Explorer publication');

  harness.inputQueue.push('retained query'); harness.quickPickQueue.push(null);
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ code: [{ file: 'src/app.ts', startLine: 1 }] }) });
  await harness.runCommand('pairofcleats.search');
  const previous = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0].resultSetId;
  harness.queuedResults.push({ code: 1, stdout: JSON.stringify({ code: [{ file: 'src/app.ts', startLine: 1 }] }) });
  await harness.runCommand('pairofcleats.repeatLastSearch');
  assert.equal(harness.workspaceStateStore.get('pairofcleats.searchHistory').length, 1);
  assert.equal(harness.workspaceStateStore.get('pairofcleats.searchResults.active'), previous);

  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ ok: false, message: 'producer declined operation' }) });
  await harness.runCommand('pairofcleats.configDump');
  assert.equal(harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0].status, 'failed');
  assert(!harness.infoMessages.some(message => /Config Dump completed/.test(message)));

  const health = { repo: { root, sqlite: { code: false, prose: false } }, health: { selection: 'published-build', issues: [], hints: [],
    modes: { code: { selected: true, status: 'selected' }, prose: { selected: false, status: 'not-built' } },
    backends: { sqlite: { code: { selected: true, status: 'skipped' }, prose: { selected: false, status: 'not-selected' } } } } };
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify(health) });
  const start = harness.outputEvents.length; await harness.runCommand('pairofcleats.indexHealth');
  const text = harness.outputEvents.slice(start).filter(row => row.kind === 'append').map(row => row.line).join('\n');
  assert.match(text, /status: ok/); assert.match(text, /sqlite code: skipped/); assert.match(text, /file prose: not-built; selected: false/);
  assert.doesNotMatch(text, /Bootstrap|sqlite code: missing/);
  harness.queuedResults.push({ code: 0, stdout: '{}' });
  const unknownStart = harness.outputEvents.length; await harness.runCommand('pairofcleats.indexHealth');
  assert(harness.outputEvents.slice(unknownStart).some(row => row.kind === 'append' && /status: unknown/.test(row.line)));
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); for (const dir of [root, installation]) fs.rmSync(dir, { recursive: true, force: true }); }
console.log('Registered setup ownership, failed-result publication and selected health presentation controls authored; execution deferred.');
