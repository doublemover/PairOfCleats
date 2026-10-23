import assert from 'node:assert/strict';
import { createDedicatedLspProvider } from '../../../src/index/tooling/dedicated-lsp-provider.js';

for (const skip of [true, false]) {
  const controller = new AbortController();
  let cleaned = 0, prepared = 0;
  const provider = createDedicatedLspProvider({
    id: 'fixture-preparation', label: 'fixture preparation', configKey: 'fixturePreparation',
    languages: ['fixture'], docExtensions: ['.fixture'], command: { defaultCmd: process.execPath },
    parseSignature: () => null,
    prepareCollect: async ({ abortSignal }) => {
      prepared += 1;
      assert.equal(abortSignal.aborted, false);
      if (!skip) controller.abort();
      return { skip, cleanup: async () => { cleaned += 1; } };
    }
  });
  const result = provider.run({ repoRoot: process.cwd(), toolingConfig: { fixturePreparation: { enabled: true } } }, {
    abortSignal: controller.signal,
    documents: [{ virtualPath: 'main.fixture', languageId: 'fixture', text: 'fixture' }],
    targets: [{ virtualPath: 'main.fixture', chunkRef: { chunkUid: 'fixture-preparation' } }]
  });
  if (skip) assert.deepEqual((await result).byChunkUid, {});
  else await assert.rejects(result, { name: 'AbortError' });
  assert.equal(prepared, 1);
  assert.equal(cleaned, 1, 'preparation cleanup must run exactly once on skip and cancellation');
}
console.log('dedicated preparation owns its cleanup on skipped and cancelled launch');
