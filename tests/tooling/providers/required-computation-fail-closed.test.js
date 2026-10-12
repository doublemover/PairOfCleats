#!/usr/bin/env node
import assert from 'node:assert/strict';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import {
  ToolingRequiredComputationError,
  isRequiredToolingComputationError
} from '../../../src/index/tooling/required-computation.js';

const inputs = {
  documents: [],
  targets: [{
    chunkRef: { docId: 0, chunkUid: 'ck64:v1:test:src/a.ts:required', chunkId: 'required',
      file: 'src/a.ts', segmentUid: null, segmentId: null, range: { start: 0, end: 10 } },
    virtualPath: 'src/a.ts', virtualRange: { start: 0, end: 10 }
  }]
};
const register = (id, run, priority) => registerToolingProvider({
  id, version: '1.0.0', priority,
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash: () => `${id}-hash`, run
});
const cause = new Error('owned analysis reached its limit');
const incomplete = new ToolingRequiredComputationError('Required type answer is incomplete.', {
  operation: 'finite-string-membership', reason: 'work-budget', details: { work: 64, limit: 64 }, cause
});
assert.equal(incomplete.cause, cause);
assert.equal(incomplete.complete, false);
assert.equal(isRequiredToolingComputationError(incomplete), true);
assert.equal(isRequiredToolingComputationError({ code: incomplete.code }), true,
  'process adapters can preserve the stable failure code without preserving the prototype');
assert.equal(isRequiredToolingComputationError(new Error('optional unavailable')), false);

for (const failure of [incomplete, Object.assign(new Error('serialized incomplete'), { code: incomplete.code })]) {
  TOOLING_PROVIDERS.clear();
  let laterRan = false;
  const logs = [];
  register('required-answer', async () => { throw failure; }, 1);
  register('later-provider', async () => { laterRan = true; return { byChunkUid: {} }; }, 2);
  await assert.rejects(runToolingProviders({
    strict: true, toolingConfig: {}, cache: { enabled: false }, logger: line => logs.push(line)
  }, inputs), error => error === failure);
  assert.equal(laterRan, false, 'required incomplete work cannot silently continue with a partial provider set');
  assert.ok(logs.some(line => line.includes('outcome=incomplete')));
  assert.ok(!logs.some(line => line.includes('provider runtime done')),
    'a rejected run must not emit successful runtime completion');
}

// Unexpected implementation/transport failures in an explicitly required mode
// must not publish an index that silently omits that mode's answers.
TOOLING_PROVIDERS.clear();
const unexpected = new Error('unexpected symbolic integration failure');
register('typescript', async () => { throw unexpected; }, 1);
await assert.rejects(runToolingProviders({
  strict: true, toolingConfig: { typescript: { typeRepresentation: 'symbolic' } }, cache: { enabled: false }
}, inputs), error => isRequiredToolingComputationError(error) && error.cause === unexpected);

// Preserve the established optional-provider degradation policy.
TOOLING_PROVIDERS.clear();
register('optional-unavailable', async () => { throw new Error('optional unavailable'); }, 1);
register('available-provider', async () => ({ byChunkUid: {} }), 2);
const result = await runToolingProviders({ strict: true, toolingConfig: {}, cache: { enabled: false } }, inputs);
assert.ok(result.degradedProviders.some(entry => entry.providerId === 'optional-unavailable'));
TOOLING_PROVIDERS.clear();
console.log('required computation failure propagates without fail-open completion; optional providers still degrade');
