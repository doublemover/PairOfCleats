import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

// Actual registered command consumer, with a fixture-only short deadline and
// inert child. A zero close code/valid JSON cannot turn a timeout into success.
const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-buffered-timeout-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
try {
  harness.activate(); harness.queuedResults.push({ persistent: true, stdout: JSON.stringify({ repoRoot: root }) });
  const registered = harness.extension._test.OPERATOR_COMMAND_SPECS.find(spec => spec.id === 'pairofcleats.configDump');
  await harness.extension._test.executeOperatorWorkflow({ ...registered, timeoutMs: 1 }, { repoRoot: root }, {
    command: process.execPath, args: [path.join(root, 'bin', 'pairofcleats.js'), 'config', 'dump', '--json', '--repo', root] });
  assert.equal(harness.spawnCalls[0].child.killed, true);
  assert.equal(harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0].status, 'failed');
  assert.match(harness.errorMessages.at(-1), /timed out/);
  assert.equal(harness.infoMessages.some(message => /completed/.test(message)), false);
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Buffered operator timeout/result precedence regression authored; execution deferred.');
