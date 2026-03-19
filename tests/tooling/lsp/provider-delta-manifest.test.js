#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { registerDefaultToolingProviders } from '../../../src/index/tooling/providers/index.js';
import { listToolingProviders } from '../../../src/index/tooling/provider-registry.js';
import { resolveLspServerPresetByKey } from '../../../src/index/tooling/lsp-presets.js';
import {
  getLspProviderDelta,
  listDefaultEnabledLspProviderIds,
  listLspProviderDeltas
} from '../../../src/index/tooling/lsp-provider-deltas.js';

const root = process.cwd();
const policyPath = path.join(root, 'docs', 'tooling', 'lsp-default-enable-policy.json');
const policy = JSON.parse(await fs.readFile(policyPath, 'utf8'));
const policyIds = (Array.isArray(policy?.providers) ? policy.providers : [])
  .filter((entry) => entry?.defaultEnabled === true)
  .map((entry) => String(entry.id || '').trim())
  .filter(Boolean)
  .sort((left, right) => left.localeCompare(right));

const deltas = listLspProviderDeltas().sort((left, right) => left.id.localeCompare(right.id));
const deltaIds = deltas.map((delta) => delta.id);
assert.deepEqual(deltaIds, policyIds, 'expected provider delta ids to align with default-enable policy ids');
assert.deepEqual(listDefaultEnabledLspProviderIds(), policyIds, 'expected default-enabled delta ids to match policy ids');

registerDefaultToolingProviders();
const providerIds = listToolingProviders({
  lsp: {
    enabled: true,
    servers: [
      { preset: 'gopls', languages: ['go'] },
      { preset: 'rust-analyzer', languages: ['rust'] },
      { preset: 'yaml-language-server', languages: ['yaml'] },
      { preset: 'lua-language-server', languages: ['lua'] },
      { preset: 'zls', languages: ['zig'] }
    ]
  }
})
  .map((provider) => String(provider?.id || '').trim())
  .filter(Boolean);

for (const delta of deltas) {
  assert.equal(Number.isFinite(Number(delta.requestBudgetWeight)), true, `expected requestBudgetWeight for ${delta.id}`);
  assert.equal(Number.isFinite(Number(delta.confidenceBias)), true, `expected confidenceBias for ${delta.id}`);
  assert.equal(Array.isArray(delta.fallbackReasonHints) && delta.fallbackReasonHints.length > 0, true, `expected fallback reason hints for ${delta.id}`);
  assert.equal(
    Boolean(delta.adaptiveDocScope) || delta.workspaceChecks.length > 0 || delta.bootstrapChecks.length > 0,
    true,
    `expected encoded provider delta detail for ${delta.id}`
  );
  assert.deepEqual(getLspProviderDelta(delta.id)?.id, delta.id, `expected provider delta lookup for ${delta.id}`);
  if (delta.class === 'preset') {
    assert.ok(resolveLspServerPresetByKey(delta.id), `expected preset resolution for ${delta.id}`);
  } else {
    assert.equal(providerIds.includes(delta.id), true, `expected registered dedicated provider for ${delta.id}`);
  }
}

console.log('LSP provider delta manifest test passed');
