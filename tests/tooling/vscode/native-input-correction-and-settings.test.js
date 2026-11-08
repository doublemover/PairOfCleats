import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';

const root = createVsCodeRuntimeTempRepo({ prefix: 'poc-native-input-correction-' });
const harness = createVsCodeRuntimeHarness({ repoRoot: root, activeFile: path.join(root, 'src', 'app.ts'),
  globalConfigValues: { cliPath: path.join(root, 'bin', 'pairofcleats.js') } });
try {
  harness.activate();
  const input = harness.fakeVscode.window.showInputBox;
  harness.fakeVscode.window.showInputBox = async options => {
    if (/Context-pack traversal depth/.test(options.prompt)) {
      assert.match(options.validateInput('2.5'), /remains editable/);
      assert.equal(options.validateInput('3'), null); return '3';
    }
    return input(options);
  };
  harness.inputQueue.push('file:src/app.ts');
  harness.quickPickQueue.push(items => items.find(item => item.value === 'export'));
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify({ primary: { ref: {} }, warnings: [] }) });
  await harness.runCommand('pairofcleats.contextPack');
  const args = harness.spawnCalls.at(-1).args;
  assert.equal(args[args.indexOf('--hops') + 1], '3');

  const generation = { baseBuildId: 'input-correction-generation', semanticRevision: 0 };
  harness.quickPickQueue.push(items => items.find(item => item.value === 'manual'), 'Scalar literal', 'bigint', null);
  harness.fakeVscode.window.showInputBox = async options => {
    if (/baseBuildId/.test(options.prompt)) return generation.baseBuildId;
    assert.match(options.validateInput('9007199254740993n'), /without an n suffix/);
    assert.equal(options.validateInput('9007199254740993'), null); return '9007199254740993';
  };
  harness.queuedResults.push({ persistent: true });
  const semantic = harness.runCommand('pairofcleats.semanticEvidence', { resultSet: { repoRoot: root }, hit: { chunkUid: 'selected' } });
  await new Promise(setImmediate); await new Promise(setImmediate);
  const requestCall = harness.spawnCalls.at(-1);
  const requestPath = requestCall.args[requestCall.args.indexOf('--request') + 1];
  assert.equal(JSON.parse(fs.readFileSync(requestPath, 'utf8')).selector.literal.representation, '9007199254740993');
  requestCall.child.stdout.emit('data', Buffer.from(JSON.stringify({ generation, status: 'partial', records: [], edges: [], frontier: [] })));
  requestCall.child.emit('close', 0); await semantic;
  const output = harness.outputEvents.filter(row => row.kind === 'append').map(row => row.line).join('\n');
  assert.doesNotMatch(output, /9007199254740993n/, 'invalid native draft text never enters logs or persisted requests');
  assert.deepEqual(harness.errorMessages, []);

  harness.fakeVscode.window.showInputBox = input;
  harness.setConfiguration({ searchAsOf: '2026-10-23', searchSnapshot: 'conflicting-snapshot' });
  const count = harness.spawnCalls.length; harness.quickPickQueue.push('Done');
  await harness.runCommand('pairofcleats.showEffectiveSettings');
  const report = harness.openedDocuments.at(-1).uri.content;
  assert.match(report, /Search option validation: invalid/); assert.match(report, /cannot set both/);
  assert.equal(harness.spawnCalls.length, count, 'settings inspection validates options without backend or repository scripts');
} finally { await harness.extension.deactivate(); harness.restoreGlobals(); fs.rmSync(root, { recursive: true, force: true }); }
console.log('Registered native numeric/scalar correction and effective option validation controls authored; settings-save UI belongs to its existing native owner.');
