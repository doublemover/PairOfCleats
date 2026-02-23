#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveRunSearchQueryBootstrap } from '../../../src/retrieval/cli/run-search/query-bootstrap.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

let buildPlanCalled = false;
let resolvePlanCalled = false;
const shortCircuit = await resolveRunSearchQueryBootstrap({
  branchGateInput: { branchFilter: 'feature/*' },
  planInputConfig: { ignored: true },
  planResolutionInput: { ignored: true },
  dependencies: {
    runBranchFilterGate: async () => ({ gated: true }),
    buildQueryPlanInput: () => {
      buildPlanCalled = true;
      return {};
    },
    resolveRunSearchDictionaryAndPlan: async () => {
      resolvePlanCalled = true;
      return { queryPlan: {}, planIndexSignaturePayload: null };
    }
  }
});

assert.deepEqual(shortCircuit.branchGatePayload, { gated: true });
assert.equal(buildPlanCalled, false);
assert.equal(resolvePlanCalled, false);

let observedPlanInput = null;
let observedResolveInput = null;
const resolved = await resolveRunSearchQueryBootstrap({
  branchGateInput: { branchFilter: null },
  planInputConfig: { query: 'needle' },
  planResolutionInput: { stageTracker: true },
  dependencies: {
    runBranchFilterGate: async () => null,
    buildQueryPlanInput: (input) => {
      observedPlanInput = input;
      return { normalized: true, ...input };
    },
    resolveRunSearchDictionaryAndPlan: async (input) => {
      observedResolveInput = input;
      return { queryPlan: { id: 'plan' }, planIndexSignaturePayload: { signature: 'abc' } };
    }
  }
});

assert.equal(observedPlanInput.query, 'needle');
assert.equal(observedResolveInput.planInput.normalized, true);
assert.equal(resolved.queryPlan.id, 'plan');
assert.equal(resolved.planIndexSignaturePayload.signature, 'abc');
assert.equal(resolved.branchGatePayload, null);

console.log('run-search query bootstrap test passed');
