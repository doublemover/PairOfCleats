import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createDedicatedLspProvider } from '../../../src/index/tooling/dedicated-lsp-provider.js';
import { createLspProviderTempRepo } from '../../helpers/lsp-provider-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const commandName = process.platform === 'win32' ? 'denied.cmd' : 'denied';
const root = await createLspProviderTempRepo({ name: 'dedicated-denied-command-preflight', files: [
  { path: commandName, content: process.platform === 'win32' ? '@echo off\r\nexit /b 99\r\n' : '#!/bin/sh\nexit 99\n' }
] });
let customCalls = 0;
const provider = createDedicatedLspProvider({
  id: 'fixture-denied', label: 'fixture denied', languages: ['fixture'], configKey: 'fixtureDenied',
  docExtensions: ['.fixture'], command: { defaultCmd: path.join(root, commandName) }, parseSignature: () => null,
  preflight: async () => { customCalls += 1; return { state: 'ready' }; }
});
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
    const ctx = { repoRoot: root, toolingConfig: { fixtureDenied: { enabled: true } } };
    const result = await provider.preflight(ctx, {});
    assert.equal(result.state, 'blocked');
    assert.equal(result.blockProvider, true);
    assert.equal(result.commandProfile.resolved.mode, 'blocked');
    assert.equal(customCalls, 0, 'denied executable must stop custom project preflight too');
    const output = await provider.run(ctx, {
      documents: [{ virtualPath: 'main.fixture', languageId: 'fixture', text: 'fixture' }],
      targets: [{ virtualPath: 'main.fixture', chunkRef: { chunkUid: 'fixture-denied' } }]
    });
    assert.deepEqual(output.byChunkUid, {});
    assert.equal(customCalls, 0);
    assert.ok(output.diagnostics.checks.some(check => check.name === 'fixture-denied_command_unavailable'));
  });
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
console.log('dedicated denied-command preflight stops before project preparation');
