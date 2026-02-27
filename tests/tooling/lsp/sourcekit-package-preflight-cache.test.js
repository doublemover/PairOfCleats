#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
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
  name: 'sourcekit-package-preflight-cache',
  includeDependencies: true,
  dependencyVersion: '1.0.0',
  resolveExitCode: 0
});
const logs = [];
const { ctx, document, target } = fixture.contextFor(logs);

try {
  await withTemporaryEnv({ POC_SWIFT_PREFLIGHT_COUNTER: fixture.counterPath }, async () => {
    registerDefaultToolingProviders();
    const provider = getToolingProvider('sourcekit');
    assert.ok(provider, 'expected sourcekit provider');

    const first = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.ok(first && typeof first.byChunkUid === 'object', 'expected first sourcekit run output');

    const firstCount = await countNonEmptyLines(fixture.counterPath);
    assert.equal(firstCount, 1, 'expected swift package preflight to run exactly once on first pass');

    const second = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.ok(second && typeof second.byChunkUid === 'object', 'expected second sourcekit run output');

    const secondCount = await countNonEmptyLines(fixture.counterPath);
    assert.equal(secondCount, 1, 'expected sourcekit package preflight cache to skip repeated resolve');

    await fixture.writePackage({ dependencyVersion: '1.1.0', includeDependencies: true });
    const third = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.ok(third && typeof third.byChunkUid === 'object', 'expected third sourcekit run output');
    const thirdCount = await countNonEmptyLines(fixture.counterPath);
    assert.equal(thirdCount, 2, 'expected manifest change to invalidate preflight cache');

    await fs.access(fixture.markerPath);
    assert.ok(
      logs.some((line) => line.includes('sourcekit package preflight cache hit')),
      'expected cache-hit log after repeated run'
    );
  });
} finally {
  fixture.restorePath();
}

console.log('sourcekit package preflight cache test passed');
