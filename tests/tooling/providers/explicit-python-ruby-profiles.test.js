import assert from 'node:assert/strict';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';
import { normalizeServerConfig, collectAutoPresetServers } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { TOOLING_PROVIDERS, registerToolingProvider, selectToolingProviders } from '../../../src/index/tooling/provider-registry.js';
import { parseRubyLspSignature } from '../../../src/index/tooling/signature-parse/ruby-lsp.js';

const auto = collectAutoPresetServers({ autoEnableOnDetect: true }, new Set());
for (const id of ['basedpyright', 'ty', 'pyrefly', 'ruby-lsp']) assert.ok(!auto.some(value => value.id === id));
for (const [id, cmd, args] of [['basedpyright', 'basedpyright-langserver', ['--stdio']], ['ty', 'ty', ['server']], ['pyrefly', 'pyrefly', ['lsp']]]) {
  const server = normalizeServerConfig({ preset: id, id }, 0);
  assert.equal(server.cmd, cmd); assert.deepEqual(server.args, args);
  assert.equal(createConfiguredLspProvider(server).profileContractVersion, 1);
}
assert.equal(resolveLspServerPresetByKey('ruby-lsp').requiresWorkspaceExecution, true);
const old = new Map(TOOLING_PROVIDERS);
try {
  TOOLING_PROVIDERS.clear();
  registerToolingProvider({ id: 'pyright', version: '1', languages: ['python'], kinds: ['types'], capabilities: {}, getConfigHash: () => 'fixture', run: async () => ({}) });
  const documents = [{ virtualPath: 'fixture.py', languageId: 'python' }];
  const plan = selectToolingProviders({ toolingConfig: { lsp: { servers: [{ id: 'ty', preset: 'ty' }] } }, documents, kinds: ['types'] });
  assert.deepEqual(plan.map(value => value.provider.id), ['lsp-ty']);
  const pinned = selectToolingProviders({ toolingConfig: { lsp: { servers: [{ id: 'ty', preset: 'ty' }] } }, documents, kinds: ['types'], providerIds: ['pyright'] });
  assert.deepEqual(pinned.map(value => value.provider.id), ['pyright']);
  assert.throws(() => selectToolingProviders({ toolingConfig: { lsp: { servers: [{ id: 'ty', preset: 'ty' }, { id: 'pyrefly', preset: 'pyrefly' }] } }, documents }), { code: 'ERR_TOOLING_PROVIDER_SELECTION' });
} finally { TOOLING_PROVIDERS.clear(); for (const [id, provider] of old) TOOLING_PROVIDERS.set(id, provider); }
assert.deepEqual(parseRubyLspSignature('```ruby\ndef self.value(item)\n```'), { signature: 'def self.value(item)' });
assert.equal(parseRubyLspSignature('value -> String'), null);
console.log('explicit Python/Ruby profiles, single engine selection and presentation-only Ruby signatures');
