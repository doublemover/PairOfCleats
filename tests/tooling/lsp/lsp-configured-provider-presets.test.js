#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createConfiguredLspProviders } from '../../../src/index/tooling/lsp-provider.js';

const providers = createConfiguredLspProviders({
  lsp: {
    enabled: true,
    servers: [
      { preset: 'gopls' },
      { preset: 'yaml', id: 'yaml-fast', timeoutMs: 5000 },
      { id: 'rust' }
    ]
  }
});

assert.equal(providers.length, 3, 'expected preset entries to compile into providers');

const gopls = providers.find((provider) => provider.id === 'lsp-gopls');
assert.ok(gopls, 'expected gopls preset provider');
assert.equal(gopls.requires?.cmd, 'gopls', 'expected gopls command');
assert.deepEqual(gopls.languages, ['go'], 'expected gopls language default');

const yamlFast = providers.find((provider) => provider.id === 'lsp-yaml-fast');
assert.ok(yamlFast, 'expected yaml preset provider with custom id');
assert.equal(yamlFast.requires?.cmd, 'yaml-language-server', 'expected yaml command default');
assert.deepEqual(yamlFast.languages, ['yaml', 'yml'], 'expected yaml language defaults');

const rust = providers.find((provider) => provider.id === 'lsp-rust');
assert.ok(rust, 'expected implicit rust preset provider');
assert.equal(rust.requires?.cmd, 'rust-analyzer', 'expected rust-analyzer command default');
assert.deepEqual(rust.languages, ['rust'], 'expected rust language default');

console.log('configured LSP preset provider test passed');
