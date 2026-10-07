#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  getApiWorkflowCapabilities,
  getEditorCommandSpecs,
  getRuntimeCapabilityManifest,
  getTuiSupervisorCapabilities,
  RUNTIME_CAPABILITY_MANIFEST_VERSION
} from '../../src/shared/runtime-capability-manifest.js';
import { describeDispatchCommand, listDispatchManifest } from '../../src/shared/dispatch/registry.js';

const manifest = getRuntimeCapabilityManifest({
  runtimeCapabilities: {
    mcp: { sdk: true },
    embeddings: { available: true }
  }
});

assert.equal(manifest.manifestVersion, RUNTIME_CAPABILITY_MANIFEST_VERSION);
assert.equal(manifest.runtimeCapabilities.mcp.sdk, true);
assert.ok(manifest.flags['cache.gc'], 'expected cache.gc flag set to exist');
assert.ok(manifest.flags['report.compare-models'], 'expected report.compare-models flag set to exist');
assert.ok(Array.isArray(manifest.surfaces.cli.commands));
assert.ok(Array.isArray(manifest.surfaces.mcp.tools));
assert.equal(manifest.surfaces.tui.supervisor.protocol, 'poc.tui@1');

manifest.runtimeCapabilities.mcp.sdk = false;
manifest.flags['cache.gc'].flags.push({ name: 'mutated' });
const manifestAgain = getRuntimeCapabilityManifest({
  runtimeCapabilities: {
    mcp: { sdk: true }
  }
});
assert.equal(manifestAgain.runtimeCapabilities.mcp.sdk, true, 'manifest should clone runtime capabilities');
assert.equal(
  manifestAgain.flags['cache.gc'].flags.some((entry) => entry?.name === 'mutated'),
  false,
  'flag sets should be cloned per call'
);

const apiCapabilities = getApiWorkflowCapabilities();
assert.ok(apiCapabilities.search, 'expected API workflow capabilities to expose search');

const tuiCapabilities = getTuiSupervisorCapabilities();
tuiCapabilities.transport = 'mutated';
assert.equal(getTuiSupervisorCapabilities().transport, undefined, 'tui capabilities should be cloned');

const editorSpecs = getEditorCommandSpecs();
assert.ok(Array.isArray(editorSpecs));
editorSpecs[0].title = 'mutated';
assert.notEqual(getEditorCommandSpecs()[0].title, 'mutated', 'editor command specs should be cloned');

const dispatchList = listDispatchManifest();
assert.ok(dispatchList.length > 0, 'expected dispatch manifest entries');
const searchEntry = describeDispatchCommand('search');
assert.ok(searchEntry, 'expected dispatch entry for search');
assert.deepEqual(describeDispatchCommand(searchEntry.commandPath.join(' ')), searchEntry, 'lookup by path should match lookup by id');

dispatchList[0].description = 'mutated';
const dispatchListAgain = listDispatchManifest();
assert.notEqual(dispatchListAgain[0].description, 'mutated', 'dispatch manifest should be cloned per call');

console.log('runtime capability manifest contract test passed');
