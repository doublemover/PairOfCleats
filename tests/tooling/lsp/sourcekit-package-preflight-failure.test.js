#!/usr/bin/env node
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { getToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { countNonEmptyLines } from '../../helpers/lsp-signature-fixtures.js';
import { createSourcekitPreflightFixture } from '../../helpers/sourcekit-preflight-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

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
const { ctx, document, target } = fixture.contextFor(logs);

try {
  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath }, async () => {
    registerDefaultToolingProviders();
    const provider = getToolingProvider('sourcekit');
    assert.ok(provider, 'expected sourcekit provider');

    const output = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.deepEqual(output.byChunkUid || {}, {}, 'expected sourcekit to skip enrichment after preflight failure');
    const checks = Array.isArray(output?.diagnostics?.checks) ? output.diagnostics.checks : [];
    assert.ok(
      checks.some((check) => check?.name === 'sourcekit_package_preflight_failed'),
      'expected sourcekit preflight failure check in diagnostics'
    );
    assert.ok(
      logs.some((line) => line.includes('sourcekit skipped because package preflight did not complete safely')),
      'expected sourcekit skip log after preflight failure'
    );
    const count = await countNonEmptyLines(fixture.counterPath);
    assert.equal(count, 1, 'expected one preflight resolve attempt');
  });
} finally {
  fixture.restorePath();
}

console.log('sourcekit package preflight failure test passed');
