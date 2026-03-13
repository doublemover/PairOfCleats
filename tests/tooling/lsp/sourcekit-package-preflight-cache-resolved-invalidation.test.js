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
  name: 'sourcekit-package-preflight-cache-resolved-invalidation',
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
    assert.equal(firstCount, 1, 'expected sourcekit preflight to run once on first pass');

    const second = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.ok(second && typeof second.byChunkUid === 'object', 'expected second sourcekit run output');
    const secondCount = await countNonEmptyLines(fixture.counterPath);
    assert.equal(secondCount, 1, 'expected sourcekit package preflight cache to hit on second pass');

    await fs.writeFile(
      path.join(fixture.tempRoot, 'Package.resolved'),
      JSON.stringify({ pins: [{ identity: 'demo', version: '1.2.3' }] }, null, 2),
      'utf8'
    );

    const third = await provider.run(ctx, { documents: [document], targets: [target] });
    assert.ok(third && typeof third.byChunkUid === 'object', 'expected third sourcekit run output');
    const thirdCount = await countNonEmptyLines(fixture.counterPath);
    assert.equal(thirdCount, 2, 'expected Package.resolved change to invalidate sourcekit preflight cache');

    assert.ok(
      logs.some((line) => line.includes('sourcekit package preflight cache hit')),
      'expected sourcekit preflight cache hit log before resolved invalidation'
    );
  });
} finally {
  await fixture.restorePath();
}

console.log('sourcekit package preflight cache Package.resolved invalidation test passed');
