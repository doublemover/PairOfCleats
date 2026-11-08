import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerToolingProvider, TOOLING_PROVIDERS } from '../../../src/index/tooling/provider-registry.js';
import { createLspProviderTempRepo } from '../../helpers/lsp-provider-fixture.js';
import { createPyrightProvider } from '../../../src/index/tooling/pyright-provider.js';
import { createSourcekitProvider } from '../../../src/index/tooling/sourcekit-provider.js';
import { createClangdProvider } from '../../../src/index/tooling/clangd-provider.js';

// Authored actual-consumer regression; execution is deferred to the lead's
// frozen-candidate validation. No external server is required by this fixture.
const saved = new Map(TOOLING_PROVIDERS);
const root = await createLspProviderTempRepo({ name: 'provider-cancellation-admission' });
const inputs = { kinds: ['types'], documents: [{ virtualPath: 'app.fixture', text: 'fixture', languageId: 'fixture' }],
  targets: [{ virtualPath: 'app.fixture', languageId: 'fixture', chunkRef: {
    chunkUid: 'ck64:v1:test:provider-cancellation', chunkId: 'cancel-fixture', file: 'app.fixture', range: { start: 0, end: 7 }
  } }] };
const register = (id, run, extra = {}) => registerToolingProvider({ id, version: '1.0.0', priority: 1,
  languages: ['fixture'], kinds: ['types'], capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => `${id}-config`, run, ...extra });
const ctx = id => ({ repoRoot: root, buildRoot: root, toolingConfig: { enabledTools: [id] },
  cache: { enabled: true, dir: path.join(root, 'cache') } });
try {
  TOOLING_PROVIDERS.clear();
  let calls = 0;
  register('cancel-cache-fixture', async () => { calls += 1; return { byChunkUid: {
    'ck64:v1:test:provider-cancellation': { returnType: 'String' }
  } }; });
  const cacheCtx = ctx('cancel-cache-fixture');
  assert.equal((await runToolingProviders(cacheCtx, inputs)).byChunkUid.size, 1);
  assert.equal((await runToolingProviders(cacheCtx, inputs)).byChunkUid.size, 1);
  assert.equal(calls, 1, 'control proves the real provider-result cache was used');
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(runToolingProviders(cacheCtx, { ...inputs, abortSignal: cancelled.signal }), { name: 'AbortError' },
    'an admitted cached payload cannot turn a cancelled request into success');
  assert.equal(calls, 1);

  TOOLING_PROVIDERS.clear();
  let resolveStarted, resolveOutput, laterCalls = 0;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const output = new Promise(resolve => { resolveOutput = resolve; });
  const active = new AbortController(), inputSignal = new AbortController();
  register('cancel-live-fixture', async (_ctx, providerInputs) => {
    assert.equal(providerInputs.abortSignal.aborted, false);
    resolveStarted(providerInputs.abortSignal);
    await output;
    return { byChunkUid: { 'ck64:v1:test:provider-cancellation': { returnType: 'LateOutput' } } };
  });
  register('later-cancel-fixture', async () => { laterCalls += 1; return { byChunkUid: {} }; }, { priority: 2 });
  const liveCtx = { ...ctx('cancel-live-fixture'), abortSignal: active.signal,
    toolingConfig: { enabledTools: ['cancel-live-fixture', 'later-cancel-fixture'] } };
  const pending = runToolingProviders(liveCtx, { ...inputs, abortSignal: inputSignal.signal });
  const observed = assert.rejects(pending, { name: 'AbortError' });
  const observedSignal = await started;
  active.abort();
  assert.equal(observedSignal.aborted, true, 'context cancellation survives a separate live input signal');
  resolveOutput();
  await observed;
  assert.equal(laterCalls, 0, 'no subsequent provider starts after terminal cancellation');
  const files = await fs.readdir(path.join(root, 'cache'), { recursive: true });
  assert.equal(files.some(file => String(file).includes('cancel-live-fixture-')), false,
    'late provider results must never enter the durable cache');

  TOOLING_PROVIDERS.clear();
  let preflightCalls = 0, runCalls = 0;
  const preparing = new AbortController();
  register('cancel-prepare-fixture', async () => { runCalls += 1; return { byChunkUid: {} }; }, {
    preflight: async () => { preflightCalls += 1; return { state: 'ready' }; },
    preparePreflightInputs: (_ctx, prepared) => { preparing.abort(); return prepared; }
  });
  await assert.rejects(runToolingProviders(ctx('cancel-prepare-fixture'), { ...inputs, abortSignal: preparing.signal }), { name: 'AbortError' });
  assert.equal(preflightCalls, 0);
  assert.equal(runCalls, 0);

  for (const provider of [createPyrightProvider(), createSourcekitProvider(), createClangdProvider()]) {
    assert.equal(provider.profileContractVersion, 1, 'direct LSP providers require observed project/tool closure for durable replay');
    await assert.rejects(provider.run({ repoRoot: root, toolingConfig: {} }, {
      documents: [], targets: [], abortSignal: cancelled.signal
    }), { name: 'AbortError' }, `${provider.id} direct invocation checks input cancellation before work`);
  }
} finally {
  TOOLING_PROVIDERS.clear();
  for (const [id, provider] of saved) TOOLING_PROVIDERS.set(id, provider);
  await fs.rm(root, { recursive: true, force: true });
}
console.log('provider cache replay, preflight preparation and late output retain terminal cancellation');
