#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createConfiguredLspProviders } from '../../../src/index/tooling/lsp-provider.js';

const providers = createConfiguredLspProviders({
  lsp: {
    enabled: true,
    servers: [
      { id: 'zls-default', preset: 'zls' },
      { id: 'zls-override', preset: 'zls', preflightTimeoutMs: 45000 }
    ]
  }
});

const zlsDefault = providers.find((provider) => provider.id === 'lsp-zls-default');
assert.ok(zlsDefault, 'expected zls default preset provider');
assert.equal(zlsDefault.preflightClass, 'workspace', 'expected zls preflight class to remain workspace');
assert.equal(zlsDefault.preflightTimeoutMs, 30000, 'expected zls default preflight timeout from preset');

const zlsOverride = providers.find((provider) => provider.id === 'lsp-zls-override');
assert.ok(zlsOverride, 'expected zls override preset provider');
assert.equal(zlsOverride.preflightTimeoutMs, 45000, 'expected zls preflight timeout override to be honored');

console.log('configured LSP zls preflight timeout test passed');
