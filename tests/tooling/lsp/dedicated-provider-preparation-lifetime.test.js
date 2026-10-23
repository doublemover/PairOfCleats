import assert from 'node:assert/strict';
import { createDedicatedLspProvider } from '../../../src/index/tooling/dedicated-lsp-provider.js';

for (const { skip, abort, cleanupFails } of [
  { skip: true, abort: false }, { skip: true, abort: true }, { skip: false, abort: true },
  { skip: true, abort: true, cleanupFails: true }
]) {
  const controller = new AbortController();
  let cleaned = 0, prepared = 0;
  const provider = createDedicatedLspProvider({
    id: 'fixture-preparation', label: 'fixture preparation', configKey: 'fixturePreparation',
    languages: ['fixture'], docExtensions: ['.fixture'], command: { defaultCmd: process.execPath },
    parseSignature: () => null,
    prepareCollect: async ({ abortSignal }) => {
      prepared += 1;
      assert.equal(abortSignal.aborted, false);
      if (abort) controller.abort();
      return { skip, cleanup: async () => {
        cleaned += 1;
        if (cleanupFails) throw Object.assign(new Error('fixture cleanup remains owned'), { cacheOwnershipPending: true });
      } };
    }
  });
  const result = provider.run({ repoRoot: process.cwd(), toolingConfig: { fixturePreparation: { enabled: true } } }, {
    abortSignal: controller.signal,
    documents: [{ virtualPath: 'main.fixture', languageId: 'fixture', text: 'fixture' }],
    targets: [{ virtualPath: 'main.fixture', chunkRef: { chunkUid: 'fixture-preparation' } }]
  });
  if (!abort) assert.deepEqual((await result).byChunkUid, {});
  else await assert.rejects(result, error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.code, 'ABORT_ERR');
    if (cleanupFails) {
      assert.equal(error.cause.name, 'AbortError');
      assert.equal(error.errors[1].message, 'fixture cleanup remains owned');
      assert.equal(error.cacheOwnershipPending, true);
      assert.equal(error.cacheOwnershipReleased(), false);
    }
    return true;
  });
  assert.equal(prepared, 1);
  assert.equal(cleaned, 1, 'preparation cleanup must run exactly once on skip and cancellation');
}
console.log('dedicated preparation owns its cleanup on skipped and cancelled launch');
