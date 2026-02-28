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
  name: 'sourcekit-package-preflight-not-needed',
  includeDependencies: false,
  resolveExitCode: 0
});
const logs = [];
const { ctx, document, target } = fixture.contextFor(logs);

try {
  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath }, async () => {
    registerDefaultToolingProviders();
    const provider = getToolingProvider('sourcekit');
    assert.ok(provider, 'expected sourcekit provider');

    const output = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.ok(output && typeof output.byChunkUid === 'object', 'expected sourcekit output');
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

