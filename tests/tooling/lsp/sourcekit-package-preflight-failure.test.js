#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import {
  createSourcekitPreflightFixture,
  withSourcekitPreflightProvider
} from '../../helpers/sourcekit-preflight-fixture.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const fixture = await createSourcekitPreflightFixture({
  root,
  name: 'sourcekit-package-preflight-failure',
  includeDependencies: true,
  dependencyVersion: '1.0.0',
  resolveExitCode: 7,
  resolveStderr: 'forced preflight failure'
});
const logs = [];

try {
  await withSourcekitPreflightProvider({ fixture, logs }, async ({ provider, ctx, document, target }) => {
    const output = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.deepEqual(output.byChunkUid || {}, {}, 'expected sourcekit to skip enrichment after preflight failure');
    const checks = Array.isArray(output?.diagnostics?.checks) ? output.diagnostics.checks : [];
    assert.ok(
      checks.some((check) => check?.name === 'sourcekit_package_preflight_failed'),
      'expected sourcekit preflight failure check in diagnostics'
    );
    assert.equal(output?.diagnostics?.preflight?.workspaceKind, 'package_managed_workspace');
    assert.equal(output?.diagnostics?.preflight?.preflightState, 'blocked_dependency');
    assert.equal(output?.diagnostics?.preflight?.reasonCode, 'sourcekit_blocked_dependency');
    assert.equal(output?.diagnostics?.admission?.startupMode, 'dependency_blocked', 'expected explicit dependency-blocked admission mode');
    assert.equal(output?.diagnostics?.fidelity?.preflight?.workspaceKind, 'package_managed_workspace');
    assert.equal(output?.diagnostics?.fidelity?.preflight?.dependencyState, 'required');
    assert.equal(
      Array.isArray(output?.diagnostics?.fidelity?.runtimeIssues)
      && output.diagnostics.fidelity.runtimeIssues.includes('package_resolution_blocked')
      && output.diagnostics.fidelity.runtimeIssues.includes('dependency_resolution_required'),
      true,
      'expected fidelity contract to preserve blocked dependency classification'
    );
    assert.equal(
      logs.some((line) => line.includes('sourcekit skipped because package preflight did not complete safely')),
      true,
      'expected sourcekit preflight failure to fail closed and skip provider execution'
    );
    const count = await countNonEmptyLines(fixture.counterPath);
    assert.equal(count, 1, 'expected one preflight resolve attempt');
  });
} finally {
  await fixture.restorePath();
}

console.log('sourcekit package preflight failure test passed');

