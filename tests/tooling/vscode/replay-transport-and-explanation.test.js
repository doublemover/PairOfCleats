import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const repoA = createVsCodeRuntimeTempRepo({ prefix: 'editor-semantic-a-' });
const repoB = createVsCodeRuntimeTempRepo({ prefix: 'editor-semantic-b-' });
const tools = createVsCodeRuntimeTempRepo({ prefix: 'separate-tool-owner-' });
const cliPath = path.join(tools, 'bin/pairofcleats.js');
const harness = createVsCodeRuntimeHarness({ repoRoot: repoA,
  workspaceFolders: [{ name: 'A', path: repoA }, { name: 'B', path: repoB }],
  globalConfigValues: { cliPath, cliArgs: ['--trace'] } });
harness.activate();
try {
  for (const [id, command] of [['configDump', ['config', 'dump']], ['indexHealth', ['index', 'report']], ['indexValidate', ['index', 'validate']]]) {
    harness.queuedResults.push({ code: 0, stdout: '{}' });
    await harness.runCommand(`pairofcleats.${id}`);
    assert.deepEqual(harness.spawnCalls.at(-1).args, [cliPath, '--trace', ...command, '--json', '--repo', repoA]);
  }
  // Saved executable paths are diagnostic history; rerun resolves today's CLI.
  harness.queuedResults.push({ code: 0, stdout: '{}' });
  await harness.extension._test.rerunWorkflowSession({ sessionId: 'old', commandId: 'pairofcleats.configDump',
    repoRoot: repoA, invocation: { kind: 'operator', command: 'obsolete.exe', args: ['wrong-target'] } });
  assert.equal(harness.spawnCalls.at(-1).args[0], cliPath);
  const initial = { persistent: true };
  harness.queuedResults.push(initial);
  await harness.runCommand('pairofcleats.indexWatchStart');
  const a = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
  harness.setActiveFile(path.join(repoB, 'src/app.ts'));
  harness.queuedResults.push({ persistent: true });
  await harness.runCommand('pairofcleats.indexWatchStart');
  const b = harness.workspaceStateStore.get('pairofcleats.workflowSessions')[0];
  assert.notEqual(a.sessionId, b.sessionId);
  await harness.extension._test.stopManagedCommand({ targetId: 'pairofcleats.indexWatchStart' }, { sessionId: a.sessionId, repoRoot: repoA });
  assert.equal(initial.closed, true);
  assert.equal(harness.spawnCalls.at(-1).child.killed, false, 'A stop does not re-resolve focused repository B');
  await harness.extension._test.stopManagedCommand({ targetId: 'pairofcleats.indexWatchStart' }, { sessionId: b.sessionId });
  const before = harness.spawnCalls.length;
  await harness.extension._test.rerunWorkflowSession({ commandId: 'removed.command', repoRoot: repoA, invocation: { kind: 'operator' } });
  await harness.extension._test.rerunWorkflowSession({ commandId: 'pairofcleats.configDump', repoRoot: path.join(repoA, 'removed'), invocation: { kind: 'operator' } });
  assert.equal(harness.spawnCalls.length, before);
  harness.setActiveFile(path.join(repoA, 'src/app.ts'));
  harness.inputQueue.push('ranked needle');
  harness.quickPickQueue.push(items => items[0]);
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ code: [{ file: 'src/app.ts', chunkUid: 'chunk-A',
    startLine: 1, score: 7.25, scoreBreakdown: { sparse: { score: 1.25 }, ann: { score: 3 }, relation: { boost: 3 } } }],
  stats: { routing: { policy: 'fixture-routing' }, trust: { basis: 'captured-fixture' } } }) });
  await harness.runCommand('pairofcleats.explainSearch');
  const output = harness.outputEvents.filter(entry => entry.kind === 'append').map(entry => entry.line).join('\n');
  for (const evidence of ['ranking explanation', 'ranked needle', 'chunk-A', '1.25', '3', 'fixture-routing', 'captured-fixture']) {
    assert.ok(output.includes(evidence), evidence);
  }
  const saved = harness.workspaceStateStore.get('pairofcleats.searchHistory')[0];
  assert.equal(saved.hits[0].scoreBreakdown.ann.score, 3);
  assert.equal(saved.explanation.source, 'captured-response');
} finally { harness.restoreGlobals(); }

for (const id of ['setup', 'doctor', 'indexBuild', 'indexWatchStart', 'serviceApiStart']) {
  const required = createVsCodeRuntimeHarness({ repoRoot: repoA, globalConfigValues: { cliPath, apiExecutionMode: 'require' } });
  try {
    required.activate();
    await required.runCommand(`pairofcleats.${id}`);
    assert.equal(required.spawnCalls.length, 0, id);
    assert.ok(required.errorMessages.some(message => /API mode is not supported/.test(message)));
  } finally { required.restoreGlobals(); }
}
assert.equal(fs.existsSync(cliPath), true);
console.log('Registered editor commands preserve semantic replay, transport admission and captured explanation');
