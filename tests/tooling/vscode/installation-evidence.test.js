import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { createVsCodeRuntimeHarness, createVsCodeRuntimeTempRepo } from '../../helpers/vscode/runtime-harness.js';
const require = createRequire(import.meta.url);
const { parseCliVersion, inspectCliVersion } = require('../../../extensions/vscode/installation-evidence.js');

assert.equal(parseCliVersion('1.2.3\n', ''), '1.2.3');
assert.equal(parseCliVersion('', 'PairOfCleats v1.2.3-beta.1\n'), '1.2.3-beta.1');
assert.equal(parseCliVersion('1.2.3\nsecret diagnostic', ''), null);
assert.equal(parseCliVersion('1.2.3', 'warning'), null);

const child = new EventEmitter();
child.stdout = new EventEmitter();
child.stderr = new EventEmitter();
let stops = 0;
const observed = inspectCliVersion({ command: 'configured-node', args: ['configured-cli.js', '--version'],
  cwd: '/selected-target', env: {},
  spawn(command, args, options) {
    assert.equal(command, 'configured-node');
    assert.deepEqual(args, ['configured-cli.js', '--version']);
    assert.equal(options.cwd, '/selected-target');
    assert.equal(options.shell, false);
    return { ok: true, child };
  }, stop() { stops += 1; return Promise.resolve({ ok: false }); } });
child.stdout.emit('data', Buffer.alloc(8193, 120));
child.emit('close', 0);
assert.equal((await observed).state, 'unobserved', 'truncated version output is never identity evidence');
assert.equal(stops, 1, 'output overflow uses the supplied child owner for termination');

const target = createVsCodeRuntimeTempRepo({ prefix: 'poc-editor-install-inspector-' });
const cliPath = path.join(target, 'bin', 'pairofcleats.js');
const harness = createVsCodeRuntimeHarness({ repoRoot: target,
  globalConfigValues: { cliPath, env: { TOKEN: 'never-display-fixture-secret' } } });
try {
  harness.activate();
  harness.quickPickQueue.push('Inspect Installation / Transport Evidence');
  harness.queuedResults.push({ code: 0, stderr: '1.2.3\n' });
  await harness.runCommand('pairofcleats.showEffectiveSettings');
  assert.equal(harness.spawnCalls.length, 1);
  assert.deepEqual(harness.spawnCalls[0].args, [cliPath, '--version']);
  assert.equal(harness.spawnCalls[0].options.cwd, target);
  const report = harness.openedDocuments.map(document => document.uri?.content || '').join('\n');
  assert.match(report, /CLI version: 1\.2\.3/);
  assert.match(report, /External runtime version: 26\./);
  assert.ok(report.includes(`CLI installation: ${cliPath}`));
  assert.doesNotMatch(report, /never-display-fixture-secret/);
} finally {
  await harness.extension.deactivate();
  harness.restoreGlobals();
  fs.rmSync(target, { recursive: true, force: true });
}
console.log('Effective settings observations retain configured installation identity, bounded evidence and secret redaction');
