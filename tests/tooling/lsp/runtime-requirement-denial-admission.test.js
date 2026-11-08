import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDedicatedLspProvider } from '../../../src/index/tooling/dedicated-lsp-provider.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { isProbeCommandDefinitelyMissing } from '../../../src/index/tooling/command-resolver.js';
import { createLspProviderTempRepo } from '../../helpers/lsp-provider-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// Authored denial regression; no runtime execution was performed in this wave.
const commandName = process.platform === 'win32' ? 'denied-runtime.cmd' : 'denied-runtime';
const root = await createLspProviderTempRepo({ name: 'runtime-requirement-denial', files: [{ path: commandName,
  content: process.platform === 'win32' ? '@echo off\r\necho executed>denied-runtime.marker\r\nexit /b 0\r\n' : '#!/bin/sh\ntouch denied-runtime.marker\n' }] });
const requirement = { id: 'fixture-runtime', cmd: path.join(root, commandName), args: ['--version'], label: 'Fixture runtime' };
const documents = [{ virtualPath: 'main.fixture', languageId: 'fixture', text: 'fixture' }];
const targets = [{ virtualPath: 'main.fixture', chunkRef: { chunkUid: 'runtime-denial' } }];
let customCalls = 0;
const dedicated = createDedicatedLspProvider({ id: 'runtime-denied-fixture', label: 'Runtime denied fixture',
  configKey: 'runtimeFixture', languages: ['fixture'], docExtensions: ['.fixture'],
  command: { defaultCmd: process.execPath }, parseSignature: () => null,
  preflightRuntimeRequirements: [requirement],
  preflight: async () => { customCalls += 1; return { state: 'degraded', reasonCode: 'optional_project_warning' }; } });
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
    const ctx = { repoRoot: root, toolingConfig: { runtimeFixture: { enabled: true } } };
    const preflight = await dedicated.preflight(ctx, { documents, targets });
    assert.equal(preflight.state, 'blocked');
    assert.equal(preflight.reasonCode, 'preflight_runtime_requirement_denied');
    assert.equal(preflight.blockProvider, true);
    assert.equal(customCalls, 0, 'denied runtime must stop project preparation');
    assert.equal(preflight.checks.some(check => /missing|inconclusive/u.test(check.name)), false);
    const blocked = await dedicated.run(ctx, { documents, targets });
    assert.deepEqual(blocked.byChunkUid, {});
    assert.equal(customCalls, 0);
    assert.ok(blocked.diagnostics.checks.some(check => check.name.endsWith('_blocked')));

    const configured = createConfiguredLspProvider(normalizeServerConfig({ id: 'runtime-denied-configured',
      cmd: process.execPath, args: ['--version'], languages: ['fixture'], preflightRuntimeRequirements: [requirement] }, 0));
    const configuredPreflight = await configured.preflight({ repoRoot: root, toolingConfig: {} }, { documents, targets });
    assert.equal(configuredPreflight.state, 'blocked');
    assert.equal(configuredPreflight.reasonCode, 'preflight_runtime_requirement_denied');
    const result = await configured.run({ repoRoot: root, toolingConfig: {} }, { documents, targets });
    assert.deepEqual(result.byChunkUid, {});
    assert.equal(result.diagnostics.fidelity.state, 'blocked');
    await assert.rejects(fs.access(path.join(root, 'denied-runtime.marker')), { code: 'ENOENT' });
  });
  assert.equal(isProbeCommandDefinitelyMissing({ resolvedPath: null, attempted: [],
    validationFailure: { reasonCode: 'untrusted-repository-command' } }), false);
  assert.equal(isProbeCommandDefinitelyMissing({ resolvedPath: null, attempted: [], cacheOwnershipPending: true }), false);
  assert.equal(isProbeCommandDefinitelyMissing({ resolvedPath: null, attempted: [] }), true, 'an actual absent command remains distinct');
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('runtime prerequisite denial reaches dedicated/configured consumers without missing-tool fallback');
