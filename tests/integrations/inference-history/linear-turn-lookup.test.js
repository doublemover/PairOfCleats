import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { createInferenceHistoryService } from '../../../src/integrations/inference-history/service.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);
for (const count of [80, 160, 320]) {
  const dir = await fs.realpath(await makeTempDir('poc-history-linear-turn-'));
  const vaultRoot = path.join(dir, 'vault'), input = path.join(dir, 'task.zip');
  await fs.mkdir(vaultRoot, { mode: 0o700 });
  const task = { id: 'linear-task', title: 'Bounded task lookup', archived: false, turns: Array.from({ length: count }, (_, index) => ({
    id: `linear-turn-${index}`, role: 'user', input_items: [{ type: 'message',
      content: [{ type: 'input_text', text: `visible-turn-${index}` }] }]
  })) };
  await fs.writeFile(input, zipSync({ 'codex.json': strToU8(JSON.stringify([task])) }));
  const service = createInferenceHistoryService({ vaultRoot, verifyPrivateVault: () => true,
    audit: () => ({ persisted: true }), resolveImportSource: () => ({ path: input, policyEpoch: '1' }),
    resolveAccess: () => ({ allowed: true, principalId: 'fixture', tenantId: 'fixture', ownerType: 'individual',
      ownerId: 'fixture', sourceScope: 'chatgpt', policyEpoch: '1' }) });
  const request = { requestContext: 'fixture', partition: 'own', source: 'fixture-upload' };
  const originalFind = Array.prototype.find;
  let comparisons = 0;
  try {
    Array.prototype.find = function(predicate, thisArg) {
      if (this.length !== count || this[0]?.id !== 'linear-turn-0') return originalFind.call(this, predicate, thisArg);
      return originalFind.call(this, function(...args) { comparisons += 1; return predicate.apply(this, args); }, thisArg);
    };
    const imported = await service.importExport(request);
    assert.equal(imported.newUnits, count);
    assert.equal(imported.tasks, 1);
    assert.ok(comparisons <= count * 2, `per-record turn selection must be linear, observed ${comparisons} comparisons for ${count} turns`);
    for (const ordinal of [0, count - 1]) {
      const hits = await service.search({ ...request, query: `visible-turn-${ordinal}` });
      const hit = hits.hits.find(hit => hit.text === `visible-turn-${ordinal}`);
      assert.ok(hit);
      const beforeRead = comparisons;
      const context = await service.readContext({ ...request, sourceRef: hit.sourceRef, snapshotRef: hit.snapshotRef, top: 1, before: 0, after: 0 });
      assert.equal(context.messages.length, 1);
      assert.equal(context.messages[0].text, `visible-turn-${ordinal}`);
      const timeline = await service.readTimeline({ ...request, sourceRef: hit.sourceRef, snapshotRef: hit.snapshotRef, top: 1, order: 'newest' });
      assert.equal(timeline.messages.length, 1);
      assert.equal(timeline.messages[0].text, `visible-turn-${count - 1}`);
      assert.ok(comparisons - beforeRead <= count * 2, `context/timeline task selection must stay linear at ${count} turns`);
    }
  } finally {
    Array.prototype.find = originalFind;
    await rmDirRecursive(dir);
  }
}
console.log('Task import, context and timeline preserve visible units with linear turn selection work');
