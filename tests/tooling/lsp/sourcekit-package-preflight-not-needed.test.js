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
  name: 'sourcekit-package-preflight-not-needed',
  includeDependencies: false,
  resolveExitCode: 0
});
const logs = [];

try {
  await withSourcekitPreflightProvider({ fixture, logs }, async ({ provider, ctx, document, target }) => {
    const output = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.ok(output && typeof output.byChunkUid === 'object', 'expected sourcekit output');
    assert.equal(output?.diagnostics?.preflight?.workspaceKind, 'package_managed_workspace');
    assert.equal(output?.diagnostics?.preflight?.dependencyState, 'not_needed');
    assert.equal(output?.diagnostics?.preflight?.preflightState, 'ready');
    const checks = Array.isArray(output?.diagnostics?.checks) ? output.diagnostics.checks : [];
    assert.equal(
      checks.some((check) => String(check?.name || '').startsWith('sourcekit_package_preflight_')),
      false,
      'expected no preflight diagnostics when package resolution is not needed'
    );
    const count = await countNonEmptyLines(fixture.counterPath);
    assert.equal(count, 0, 'expected no swift package resolve invocation');
    assert.equal(
      logs.some((line) => line.includes('sourcekit package preflight: running')),
      false,
      'expected no preflight-run log when manifest has no package dependencies'
    );
  });
} finally {
  await fixture.restorePath();
}

console.log('sourcekit package preflight not-needed test passed');

