import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingDoctor } from '../../../src/index/tooling/doctor.js';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { createLspProviderTempRepo } from '../../helpers/lsp-provider-fixture.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

// Authored source regression; the lead owns later runtime qualification.
const commandName = process.platform === 'win32' ? 'doctor-denied.cmd' : 'doctor-denied';
const root = await createLspProviderTempRepo({ name: 'doctor-command-denied', files: [
  { path: commandName, content: process.platform === 'win32'
    ? '@echo off\r\necho executed>doctor-denied.marker\r\nexit /b 0\r\n' : '#!/bin/sh\ntouch doctor-denied.marker\n' }
] });
registerDefaultToolingProviders();
try {
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '[]' }, async () => {
    const report = await runToolingDoctor({ repoRoot: root, buildRoot: root, strict: false,
      toolingConfig: { enabledTools: ['lsp-doctor-denied', 'phpactor'],
        phpactor: { cmd: 'must-not-be-probed' }, lsp: { enabled: true, servers: [{ id: 'doctor-denied',
          cmd: path.join(root, commandName), languages: ['fixture'] }] } } }, ['lsp-doctor-denied', 'phpactor'], { log: () => {} });
    const generic = report.providers.find(provider => provider.id === 'lsp-doctor-denied');
    assert.equal(generic.available, false);
    assert.equal(generic.handshake, undefined, 'denied commands never reach initialize/shutdown probing');
    assert.ok(generic.checks.some(check => check.name === 'lsp-doctor-denied-command-admission'));
    assert.equal(generic.checks.some(check => check.message.includes('probe inconclusive')), false);
    const phpactor = report.providers.find(provider => provider.id === 'phpactor');
    assert.equal(phpactor.available, false);
    assert.ok(phpactor.checks.some(check => check.name === 'phpactor_workspace_trust_required'));
    assert.equal(phpactor.command, undefined, 'workspace execution authority precedes Phpactor version probing');
    await assert.rejects(fs.access(path.join(root, 'doctor-denied.marker')), { code: 'ENOENT' });
  });
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('Doctor reports admission denial separately and avoids untrusted command/handshake execution');
