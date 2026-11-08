#!/usr/bin/env node
// Authored source regression; no artifact is downloaded or executable launched.
import assert from 'node:assert/strict';
import { resolveOperationalManagedRecipe } from '../../../tools/tooling/operational-recipes.js';
import { identifyOperationalTool, verifyOperationalCapability } from '../../../tools/tooling/operational-probes.js';
import { validatePinnedInstallDescriptor } from '../../../tools/tooling/managed-install.js';
import { toolingFailureReport } from '../../../tools/tooling/cli-failure-report.js';

for (const [id, platform, arches] of [['graphviz', 'win32', ['x64', 'ia32']], ['ripgrep', 'win32', ['x64', 'ia32', 'arm64']],
  ['ripgrep', 'darwin', ['x64', 'arm64']], ['ripgrep', 'linux', ['x64', 'arm64']], ['scip', 'darwin', ['x64', 'arm64']],
  ['scip', 'linux', ['x64', 'arm64']], ['cargo-cyclonedx', 'win32', ['x64']], ['git-lfs', 'win32', ['x64', 'ia32', 'arm64']],
  ['git-lfs', 'darwin', ['x64', 'arm64']], ['git-lfs', 'linux', ['x64', 'arm64']]]) {
  for (const arch of arches) {
    const recipe = resolveOperationalManagedRecipe(id, { platform, arch });
    const pinned = validatePinnedInstallDescriptor(recipe.managedDescriptor, { ...recipe, platform, arch });
    assert.equal(pinned.toolId, id);
    assert.ok(pinned.archive.bytes > 0);
    assert.ok(pinned.storageEstimate.writes[0].requiredBytes > pinned.archive.bytes + 1024 * 1024 * 1024);
  }
}
assert.equal(resolveOperationalManagedRecipe('graphviz', { platform: 'win32', arch: 'arm64' }), null);
assert.equal(resolveOperationalManagedRecipe('scip', { platform: 'win32', arch: 'x64' }), null);
assert.equal(resolveOperationalManagedRecipe('cargo-cyclonedx', { platform: 'linux', arch: 'x64' }), null);
assert.equal(identifyOperationalTool('universal-ctags', { stdout: 'Exuberant Ctags 5.8' }), null);
assert.equal(identifyOperationalTool('gnu-global', { stdout: 'another global tool 1.0' }), null);
assert.equal(identifyOperationalTool('graphviz', { stderr: 'dot - graphviz version 16.1.0 (20260904)' }).version, '16.1.0');

for (const id of ['graphviz', 'ripgrep', 'scip', 'git-lfs']) {
  let calls = 0;
  const result = await verifyOperationalCapability({ id, command: 'explicit-inert-fixture-command' }, { probe: async (_command, args, options) => {
    calls++;
    if (args[0] === '--version' || args[0] === '-V' || args[0] === 'version') return { ok: true, stdout: ({ ripgrep: 'ripgrep 15.2.0', scip: 'scip version v0.10.0', graphviz: 'dot - graphviz version 16.1.0', 'git-lfs': 'git-lfs/3.8.1 (GitHub; windows amd64; go 1.27.0)' })[id] };
    assert.equal(options.timeoutMs, 4000);
    assert.equal(options.maxOutputBytes, 65536);
    if (id === 'graphviz') { assert.equal(args[0], '-Tsvg'); return { ok: true, stdout: '<svg><text>pairofcleats-render-probe</text></svg>' }; }
    if (id === 'ripgrep') return { ok: true, stdout: JSON.stringify({ type: 'match', data: { lines: { text: 'pairofcleats-rg-probe\n' } } }) };
    if (id === 'git-lfs') {
      assert.deepEqual(args, ['pointer', '--check', '--strict', '--stdin']);
      const valid = options.input.startsWith('version https://git-lfs.github.com/spec/v1\n');
      return { ok: valid, status: valid ? 0 : 1, stdout: '' };
    }
    assert.deepEqual(args, ['print', '--json', '-']);
    assert.ok(Buffer.isBuffer(options.input));
    assert.ok(options.input.includes(Buffer.from('pairofcleats-probe.js')));
    return { ok: true, stdout: JSON.stringify({ documents: [{ relative_path: 'pairofcleats-probe.js' }] }) };
  } });
  assert.equal(result.ok, true); assert.equal(calls, id === 'git-lfs' ? 3 : 2);
}
const falseLfs = await verifyOperationalCapability({ id: 'git-lfs', command: 'explicit-trusted-fixture' }, { probe: async (_command, args) =>
  ({ ok: true, status: 0, stdout: args[0] === 'version' ? 'git-lfs/3.8.1 (GitHub)' : '' }) });
assert.equal(falseLfs.ok, false, 'exit-zero on both valid and malformed input cannot qualify Git LFS pointer capability');
const missingPlugin = await verifyOperationalCapability({ id: 'graphviz', command: 'trusted-inert-fixture' }, { probe: async (_command, args) =>
  args[0] === '-V' ? { ok: true, stderr: 'dot - graphviz version 16.1.0' } : { ok: false, stderr: 'Format: "svg" not recognized' } });
assert.equal(missingPlugin.ok, false, 'a version string cannot qualify missing renderer libraries/plugins');
const wrongScip = await verifyOperationalCapability({ id: 'scip', command: 'trusted-inert-fixture' }, { probe: async (_command, args) =>
  ({ ok: true, stdout: args[0] === '--version' ? 'scip version v0.10.0' : '{}' }) });
assert.equal(wrongScip.ok, false, 'empty JSON is not the selected protobuf document');
let unreadable = 0;
const failure = toolingFailureReport(Object.defineProperty(new Error('bounded failure'), 'cacheOwnershipPending', { get() { unreadable++; throw new Error('unreadable owner'); } }));
assert.equal(failure.state, 'settlement-pending'); assert.equal(unreadable, 1);
const cancelled = new AbortController(); cancelled.abort();
assert.equal(toolingFailureReport(new Error('cancelled'), { signal: cancelled.signal }).state, 'cancelled');
console.log('Operational recipes pin exact vendor assets and distinguish byte/version, capability and unsettled failure evidence.');
