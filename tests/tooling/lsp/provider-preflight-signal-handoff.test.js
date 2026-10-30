import assert from 'node:assert/strict';
import { createDedicatedLspProvider } from '../../../src/index/tooling/dedicated-lsp-provider.js';
import { createConfiguredLspProvider } from '../../../src/index/tooling/lsp-provider/factory.js';
import { normalizeServerConfig } from '../../../src/index/tooling/lsp-provider/normalize.js';
import { createClangdProvider } from '../../../src/index/tooling/clangd-provider.js';
import { createPyrightProvider } from '../../../src/index/tooling/pyright-provider.js';
import { createSourcekitProvider } from '../../../src/index/tooling/sourcekit-provider.js';
import { resolveRuntimeCommandFromPreflight } from '../../../src/index/tooling/preflight/command-profile-preflight.js';
import { resolveRuntimeRequirementsPreflight } from '../../../src/index/tooling/preflight/runtime-requirements-preflight.js';

const descriptor = { id: 'fixture-signal', label: 'fixture signal', configKey: 'fixtureSignal',
  languages: ['fixture'], docExtensions: ['.fixture'], command: { defaultCmd: process.execPath },
  parseSignature: () => null, preflight: async () => ({ state: 'ready' }) };
const inputs = { documents: [{ virtualPath: 'source.fixture', languageId: 'fixture', text: 'source' }],
  targets: [{ virtualPath: 'source.fixture', chunkRef: { chunkUid: 'fixture-signal' } }] };
const cancelled = new AbortController();
cancelled.abort();
const healthy = new AbortController();
for (const contextField of ['signal', 'abortSignal']) {
  for (const inputField of ['signal', 'abortSignal']) {
    for (const provider of [createDedicatedLspProvider(descriptor), createClangdProvider(),
      createPyrightProvider(), createSourcekitProvider(), createConfiguredLspProvider(normalizeServerConfig({
        id: 'fixture-signal', cmd: 'must-not-probe', languages: ['fixture'] }, 0))]) {
      const ctx = { repoRoot: process.cwd(), toolingConfig: { fixtureSignal: { enabled: true } },
        [contextField]: cancelled.signal };
      await assert.rejects(provider.preflight(ctx, { ...inputs, [inputField]: healthy.signal }),
        { name: 'AbortError', code: 'ABORT_ERR' }, `${provider.id}: healthy request signal cannot hide cancelled context`);
      await assert.rejects(provider.preflight({ ...ctx, [contextField]: healthy.signal }, {
        ...inputs, [inputField]: cancelled.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
    }
  }
}
assert.throws(() => resolveRuntimeCommandFromPreflight({ signal: cancelled.signal,
  fallbackRequestedCommand: { cmd: 'must-not-probe' } }), { name: 'AbortError', code: 'ABORT_ERR' });
assert.throws(() => resolveRuntimeRequirementsPreflight({ providerId: 'fixture',
  ctx: { signal: cancelled.signal }, requirements: [{ id: 'runtime', cmd: 'must-not-probe' }] }),
{ name: 'AbortError', code: 'ABORT_ERR' });

const duringCustom = new AbortController();
const custom = createDedicatedLspProvider({ ...descriptor, preflight: async ({ ctx, abortSignal }) => {
  assert.equal(ctx.abortSignal, abortSignal, 'custom runtime probes inherit the composed preflight signal');
  duringCustom.abort();
  return { state: 'ready' };
} });
await assert.rejects(custom.preflight({ repoRoot: process.cwd(), toolingConfig: { fixtureSignal: { enabled: true } } },
  { ...inputs, signal: duringCustom.signal }), { name: 'AbortError', code: 'ABORT_ERR' });
console.log('Direct provider preflights and runtime command handoffs preserve every caller cancellation source');
