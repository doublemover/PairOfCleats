#!/usr/bin/env node
// Source UNVALIDATED; verifies plan dependency calls, never real child execution.
import assert from 'node:assert/strict';
import { createToolInstallPreview } from '../../../tools/tooling/install-preview.js';

const tool = { id: 'fixture-tool', managedInstallation: { installId: 'a'.repeat(64) } };
let observations = 0;
const preview = createToolInstallPreview({ tools: [tool], scope: 'cache' }, {
  locate: () => { observations++; return { path: 'fixture-existing-command', source: 'located-without-probe' }; },
  select: () => ({ scope: 'cache', plan: { cmd: 'fixture-package-manager', args: ['install', 'fixture@1.0.0'],
    env: { SECRET_TOKEN: 'never-serialize-this-value' } } }),
  provisioning: input => {
    assert.equal(input.probe, undefined, 'preview never supplies executable prerequisite probes');
    return { steps: [{ id: 'fixture-runtime', state: 'not-probed' }] };
  }
});
assert.equal(observations, 1);
assert.equal(preview.execution, 'none');
assert.equal(preview.writes, 'none');
assert.equal(preview.entries[0].location.state, 'located-not-probed');
assert.equal(preview.entries[0].location.managedInstallId, 'a'.repeat(64));
assert.equal(preview.entries[0].location.protocol, 'not-probed');
assert.ok(preview.entries[0].blockers.some(value => value.code === 'storage-estimate-unavailable'));
assert.equal(JSON.stringify(preview).includes('never-serialize-this-value'), false);
const archive = createToolInstallPreview({ tools: [tool] }, {
  locate: () => ({ path: null, source: null }),
  select: () => ({ scope: 'cache', plan: { managedDescriptor: { archive: { sha256: 'b'.repeat(64) } },
    storageEstimate: { complete: true, writes: [{ destination: 'artifacts', requiredBytes: 64 }] } } }),
  provisioning: () => ({ steps: [] })
});
assert.equal(archive.entries[0].action.kind, 'immutable-managed-archive');
assert.equal(archive.state, 'planned-not-probed');
const unavailable = createToolInstallPreview({ tools: [tool] }, {
  locate: () => ({ path: null, source: null }), select: () => ({ scope: 'cache', plan: null }),
  provisioning: () => ({ steps: [{ id: 'fixture-runtime', state: 'missing', reason: 'command-bytes-unavailable' }] })
});
assert.ok(unavailable.entries[0].blockers.some(value => value.code === 'selected-recipe-unavailable'));
assert.ok(unavailable.entries[0].blockers.some(value => value.code === 'prerequisite-missing'));
console.log('Install preview no-execution source fixture completed.');
