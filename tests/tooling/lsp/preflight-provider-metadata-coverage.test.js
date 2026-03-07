#!/usr/bin/env node
import assert from 'node:assert/strict';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { listToolingProviders } from '../../../src/index/tooling/provider-registry.js';
import { listLspServerPresets } from '../../../src/index/tooling/lsp-presets.js';

registerDefaultToolingProviders();

const toolingConfig = {
  lsp: {
    enabled: true,
    servers: listLspServerPresets().map((preset) => ({
      id: preset.id,
      preset: preset.id,
      cmd: preset.cmd,
      args: Array.isArray(preset.args) ? preset.args : preset.args ? [preset.args] : [],
      languages: Array.isArray(preset.languages) ? preset.languages : []
    }))
  }
};

const providers = listToolingProviders(toolingConfig);
const preflightProviders = providers.filter((provider) => typeof provider?.preflight === 'function');
assert.equal(preflightProviders.length > 0, true, 'expected at least one preflight-enabled provider for metadata guard');

const validClasses = new Set(['probe', 'workspace', 'dependency']);
const validPolicies = new Set(['required', 'optional']);

for (const provider of preflightProviders) {
  const id = String(provider?.id || '<unknown>');
  assert.equal(typeof provider.preflightId === 'string' && provider.preflightId.trim().length > 0, true, `expected ${id} to define preflightId`);
  const preflightClass = String(provider.preflightClass || '').trim().toLowerCase();
  assert.equal(validClasses.has(preflightClass), true, `expected ${id} to define a supported preflightClass`);
  const preflightPolicy = String(provider.preflightPolicy || '').trim().toLowerCase();
  assert.equal(validPolicies.has(preflightPolicy), true, `expected ${id} to define preflightPolicy required|optional`);
  assert.equal(Array.isArray(provider.preflightRuntimeRequirements), true, `expected ${id} to define preflightRuntimeRequirements array`);
  for (const requirement of provider.preflightRuntimeRequirements) {
    const reqId = String(requirement?.id || '').trim();
    const reqCmd = String(requirement?.cmd || '').trim();
    assert.equal(Boolean(reqId), true, `expected ${id} runtime requirement id`);
    assert.equal(Boolean(reqCmd), true, `expected ${id} runtime requirement command`);
  }
}

console.log('preflight provider metadata coverage test passed');
