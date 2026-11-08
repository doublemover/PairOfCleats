import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
const require = createRequire(import.meta.url);
const { snapshotConfiguration } = require('../../../extensions/vscode/effective-settings.js');

const user = { cliArgs: ['--trace'], env: { TOKEN: 'original-secret' } };
const snapshot = snapshotConfiguration({ inspect: key => ({ globalValue: user[key] }), get: key => user[key] }, Object.keys(user));
user.cliArgs.push('changed'); user.env.TOKEN = 'changed';
assert.deepEqual(snapshot.get('cliArgs'), ['--trace']);
assert.throws(() => snapshot.get('cliArgs').push('injected'), TypeError);
assert.throws(() => { snapshot.get('env').TOKEN = 'injected'; }, TypeError);
assert.throws(() => { snapshot.inspect('env').globalValue.TOKEN = 'injected'; }, TypeError);
assert.throws(() => { snapshot.evidence[0].source = 'folder'; }, TypeError);
assert.equal(snapshot.evidence.find(item => item.key === 'env').value, '[redacted]');

const first = createVsCodeRuntimeTempRepo({ prefix: 'poc-target-snapshot-a-' });
const second = createVsCodeRuntimeTempRepo({ prefix: 'poc-target-snapshot-b-' });
const manifest = require('../../../extensions/vscode/package.json');
const settings = { mode: 'records', filter: 'type:record', snapshot: 'captured-snapshot' };
const harness = createVsCodeRuntimeHarness({ repoRoot: first, activeFile: path.join(first, 'src', 'app.ts'),
  workspaceFolders: [{ name: 'same name', path: first }, { name: 'same name', path: second }],
  globalConfigValues: { cliPath: path.join(first, 'bin', 'pairofcleats.js') } });
const machine = { cliPath: path.join(first, 'bin', 'pairofcleats.js'), apiExecutionMode: 'cli',
  inlineHoverEnabled: false, inlineDiagnosticsEnabled: false, inlineDecorationsEnabled: false };
const resources = [];
harness.fakeVscode.workspace.getConfiguration = (_namespace, resource) => {
  resources.push(resource?.fsPath);
  const values = resource?.fsPath?.startsWith(second) ? { searchMode: 'code', searchFilter: 'different' }
    : { searchMode: settings.mode, searchFilter: settings.filter, searchSnapshot: settings.snapshot };
  const inspect = key => ({ defaultValue: manifest.contributes.configuration.properties[`pairofcleats.${key}`]?.default,
    globalValue: machine[key], workspaceFolderValue: values[key] });
  return { inspect, get: key => values[key] ?? machine[key] ?? inspect(key).defaultValue };
};
const payload = { records: [], pagination: { kind: 'filter', generation: 'a'.repeat(64), total: 0,
  returned: 0, hasMore: false, nextCursor: null } };
try {
  harness.activate();
  const prompts = [];
  harness.fakeVscode.window.showInputBox = async options => {
    prompts.push(options); harness.setActiveFile(path.join(second, 'src', 'app.ts'));
    settings.mode = 'all'; settings.filter = 'changed'; settings.snapshot = 'new-snapshot';
    return 'type:record';
  };
  harness.queuedResults.push({ code: 0, stdout: JSON.stringify(payload) });
  await harness.runCommand('pairofcleats.browseIndexedMatches');
  assert.match(prompts[0].prompt, /records.*captured-snapshot/);
  assert(prompts[0].prompt.includes(first), 'filter prompt identifies the already resolved repository');
  const args = harness.spawnCalls.at(-1).args;
  assert.equal(args[args.indexOf('--repo') + 1], first);
  assert.equal(args[args.indexOf('--mode') + 1], 'records');
  assert.equal(args[args.indexOf('--snapshot') + 1], 'captured-snapshot');
  assert.equal(args[args.indexOf('--filter') + 1], 'type:record');
  assert(resources.includes(first));

  harness.setActiveFile(path.join(first, 'src', 'app.ts'));
  const count = harness.spawnCalls.length;
  harness.fakeVscode.window.showInputBox = async () => undefined;
  await harness.runCommand('pairofcleats.browseIndexedMatches');
  assert.equal(harness.spawnCalls.length, count, 'cancelled filter prompt retains previous results without dispatch');

  harness.fakeVscode.window.showQuickPick = async items => {
    harness.setActiveFile(path.join(second, 'src', 'app.ts'));
    return items.includes('Tooling Doctor') ? 'Tooling Doctor' : null;
  };
  harness.setActiveFile(path.join(first, 'src', 'app.ts'));
  harness.queuedResults.push({ code: 0, stdout: '{}' });
  await harness.runCommand('pairofcleats.showEffectiveSettings');
  const doctorArgs = harness.spawnCalls.at(-1).args;
  assert.equal(doctorArgs[doctorArgs.indexOf('--repo') + 1], first,
    'the settings inspector Doctor action retains the displayed repository after focus changes');
} finally {
  await harness.extension.deactivate(); harness.restoreGlobals();
  for (const root of [first, second]) fs.rmSync(root, { recursive: true, force: true });
}
console.log('Registered filter and settings workflows retain selected target/configuration snapshots; host acceptance separate.');
