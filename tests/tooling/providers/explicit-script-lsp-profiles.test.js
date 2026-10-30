import assert from 'node:assert/strict';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';
import { normalizeServerConfig, collectAutoPresetServers } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { admitScriptLspInputs } from '../../../src/index/tooling/script-lsp-profiles.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

const automatic = collectAutoPresetServers({ autoEnableOnDetect: true }, new Set());
for (const id of ['bash-language-server', 'perl-navigator']) assert.ok(!automatic.some(server => server.id === id));
const bash = normalizeServerConfig({ preset: 'bashls', id: 'renamed-bash-profile' }, 0);
assert.equal(bash.scriptProfileId, 'bash-language-server');
assert.deepEqual([bash.cmd, ...bash.args], ['bash-language-server', 'start']);
assert.equal(bash.initializationOptions.explainshellEndpoint, '');
assert.equal(bash.initializationOptions.shellcheckPath, '');
assert.equal(bash.initializationOptions.shfmt.path, '');
const docs = [
  { virtualPath: 'a.sh', containerPath: 'a.sh', text: '#!/bin/bash\necho x\n' },
  { virtualPath: 'b.sh', containerPath: 'b.sh', text: '#!/usr/bin/env sh\necho x\n' },
  { virtualPath: 'c.sh', containerPath: 'c.sh', text: '\uFEFF#!/usr/bin/env -S zsh\necho x\n' },
  { virtualPath: 'd.ksh', containerPath: 'd.ksh', text: '#!/bin/ksh\necho x\n' }
];
const targets = docs.map(doc => ({ virtualPath: doc.virtualPath }));
const admitted = admitScriptLspInputs({ serverId: bash.scriptProfileId, inputs: { documents: docs, targets } });
assert.deepEqual(admitted.documents.map(doc => doc.virtualPath), ['a.sh', 'b.sh']);
assert.equal(admitted.targets.length, 2);
const bashProvider = createConfiguredLspProvider(bash);
assert.equal(bashProvider.preparePreflightInputs({}, { documents: docs.slice(2), targets }).documents.length, 0);
const unsupported = await bashProvider.run({ toolingConfig: {} }, { documents: docs.slice(2), targets });
assert.ok(unsupported.diagnostics.checks.some(check => check.name === 'bash_lsp_unsupported_dialects'));
assert.equal((await bashProvider.preflight({}, { documents: docs.slice(2), targets })).reasonCode, 'bash_lsp_no_admitted_dialect',
  'no command probe or server starts for unsupported dialects');
const perl = normalizeServerConfig({ preset: 'perlnavigator', id: 'renamed-perl-profile', cmd: 'fixture-renamed-executable' }, 1);
assert.equal(resolveLspServerPresetByKey('perlnavigator').requiresWorkspaceExecution, true);
assert.equal(perl.initializationOptions.settings.perlnavigator.perlCompileEnabled, false);
await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: '' }, async () => {
  const provider = createConfiguredLspProvider(perl);
  const result = await provider.preflight({ repoRoot: process.cwd() }, {});
  assert.equal(result.reasonCode, 'perl_workspace_trust_required', 'renaming id/command cannot bypass the selected Perl execution policy');
  assert.equal(result.blockProvider, true);
});
console.log('explicit script LSP launch contracts, dialect filtering and Perl trust before preflight');
