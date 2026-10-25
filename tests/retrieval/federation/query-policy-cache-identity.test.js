import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFederatedSearch } from '../../../src/retrieval/federation/coordinator.js';
import { search as coreSearch } from '../../../src/integrations/core/search.js';
import { buildCoreSearchInvocation } from '../../../src/integrations/core/search-invocation.js';
import { INTERNAL_SEARCH_POLICY, captureEffectiveSearchPlan, consumeEffectiveSearchPlan,
  resolveEffectiveSearchPlanIdentity } from '../../../src/retrieval/cli/effective-plan.js';
import { loadFederatedSearchPolicy, captureFederatedSearchPolicy } from '../../../src/retrieval/federation/effective-plan.js';
import { getEnvConfig } from '../../../src/shared/env/runtime.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../../src/workspace/manifest.js';
import { createCompatibilityIndex } from '../../helpers/index-compatibility-fixture.js';
import { writeFederationRepoFixture } from './repo-fixture.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'poc-fed-policy-')));
const cacheRoot = path.join(root, 'cache');
applyTestEnv({ cacheRoot, embeddings: 'off' });
const originalStorageTier = process.env.PAIROFCLEATS_STORAGE_TIER;
const originalApiToken = process.env.PAIROFCLEATS_API_TOKEN;
process.env.PAIROFCLEATS_STORAGE_TIER = 'balanced';
try {
  const repos = new Map();
  const config = enabled => ({ cache: { root: cacheRoot }, quality: 'balanced',
    search: { annDefault: false }, retrieval: { relationBoost: { enabled, perCall: 2, perUse: 0, maxBoost: 2 } } });
  const writeConfig = (repo, value) => fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify(value));
  for (const name of ['a', 'b']) {
    const repo = path.join(root, name), descriptor = await writeFederationRepoFixture({ repoRoot: repo, cacheRoot });
    repos.set(name, repo); await writeConfig(repo, config(false));
    const dir = await createCompatibilityIndex(descriptor.buildRoot, { compatibilityKey: 'compat-code' });
    await fs.writeFile(path.join(dir, 'chunk_meta.json'), JSON.stringify([0, 1].map(id => ({
      id, chunkUid: name + ':' + id, file: id ? 'second.js' : 'first.js', name: id ? 'second' : 'first',
      lang: 'javascript', kind: 'FunctionDeclaration', start: 0, end: 5, tokens: ['alpha'], text: 'alpha',
      codeRelations: { calls: id ? [['caller', 'alpha']] : [], usages: [] }
    }))));
    await fs.writeFile(path.join(dir, 'token_postings.json'), JSON.stringify({ vocab: ['alpha'],
      postings: [[[0, 1], [1, 1]]], docLengths: [1, 1], avgDocLen: 1, totalDocs: 2 }));
  }
  const workspacePath = path.join(root, 'workspace.json');
  await fs.writeFile(workspacePath, JSON.stringify({ schemaVersion: 1, cacheRoot: './cache',
    repos: [{ root: './a', alias: 'a' }, { root: './b', alias: 'b' }] }));
  const request = { workspacePath, query: 'alpha', strict: true,
    search: { mode: 'code', backend: 'memory', ann: false, top: 4 } };
  const workspace = loadWorkspaceConfig(workspacePath);
  const generation = async () => (await generateWorkspaceManifest(workspace, { write: false })).manifest.manifestHash;
  const originalGeneration = await generation();
  let calls = 0;
  const context = { searchPolicyId: 'core-observer@1', searchFn: async (...args) => { calls++; return coreSearch(...args); } };
  const names = (result, alias) => result.code.filter(hit => hit.repoAlias === alias).map(hit => hit.name);
  const cold = await runFederatedSearch(request, context);
  assert.deepEqual(names(cold, 'a'), ['first', 'second']);
  assert.deepEqual(names(cold, 'b'), ['first', 'second']);
  assert.deepEqual(await runFederatedSearch(request, context), cold); assert.equal(calls, 2, 'unchanged policy exercises a real outer hit');

  await writeConfig(repos.get('a'), config(true));
  assert.equal(await generation(), originalGeneration, 'query-only policy change must not rebuild or change index generation');
  const changed = await runFederatedSearch(request, context);
  assert.equal(calls, 4, 'the old outer entry cannot bypass the child policy resolver');
  assert.deepEqual(names(changed, 'a'), ['second', 'first'], 'actual production relation ranking changes explicit expected order');
  assert.deepEqual(names(changed, 'b'), ['first', 'second'], 'the unchanged repository retains its independent policy');
  assert.deepEqual(await runFederatedSearch(request, context), changed); assert.equal(calls, 4);

  // The explicit ANN flag wins over both raw defaults. Cache-only policy does
  // not affect result meaning. Neither change should fragment the effective key.
  await writeConfig(repos.get('a'), { ...config(true), search: { annDefault: true },
    retrieval: { ...config(true).retrieval, queryCache: { prewarm: true } } });
  assert.deepEqual(await runFederatedSearch(request, context), changed); assert.equal(calls, 4);

  const rawArgs = ['--mode', 'code', '--backend', 'memory', '--no-ann', '--json', '--', 'alpha'];
  const inputs = await loadFederatedSearchPolicy(repos.get('a'));
  const token = captureFederatedSearchPolicy(inputs, { args: rawArgs, query: '', exactMode: 'code' });
  const invocation = buildCoreSearchInvocation(repos.get('a'), { args: rawArgs, argsMode: 'complete' });
  const binding = { rootDir: inputs.rootDir, rawArgs: invocation.rawArgs, exactMode: 'code' };
  const captured = consumeEffectiveSearchPlan(token, binding);
  assert.equal(captured.identity, token.identity);
  const proseArgs = rawArgs.slice(); proseArgs[1] = 'prose';
  assert.notEqual(captureFederatedSearchPolicy(inputs, { args: proseArgs, query: '', exactMode: 'prose' }).identity,
    token.identity, 'each selected mode owns its effective normalization');
  for (const override of [{ rootDir: repos.get('b') }, { rawArgs: [...rawArgs, '--explain'] }, { exactMode: 'prose' }, { scoreModeOverride: 'dense' }]) {
    assert.throws(() => consumeEffectiveSearchPlan(token, { ...binding, ...override }), { code: 'ERR_SEARCH_POLICY_IDENTITY' });
  }
  assert.throws(() => consumeEffectiveSearchPlan({ identity: token.identity }, binding), { code: 'ERR_SEARCH_POLICY_IDENTITY' });
  captured.normalized.relationBoostPerCall = 999;
  assert.equal(consumeEffectiveSearchPlan(token, binding).normalized.relationBoostPerCall, 2, 'downstream mutation cannot change private capture authority');

  let lazyCapabilityReads = 0;
  const policy = { quality: inputs.policy.quality, retrieval: inputs.policy.retrieval,
    get capabilities() { lazyCapabilityReads++; throw new Error('Full capability reporting is not query policy.'); } };
  const identityInput = { ...inputs, policy, normalized: captured.normalized, useStubEmbeddings: false };
  const identity = resolveEffectiveSearchPlanIdentity(identityInput);
  const alteredPrivateInput = { ...identityInput, userConfig: { ...identityInput.userConfig, api: { token: 'never-fingerprint-secret' } },
    normalized: { ...identityInput.normalized, embeddingsConfig: { token: 'never-fingerprint-secret' } } };
  assert.equal(resolveEffectiveSearchPlanIdentity(alteredPrivateInput), identity, 'raw private configuration is excluded');
  captureEffectiveSearchPlan({ ...identityInput, rootDir: binding.rootDir, rawArgs, exactMode: 'code' });
  assert.equal(lazyCapabilityReads, 0, 'policy snapshots cannot trigger lazy native capability enumeration');

  process.env.PAIROFCLEATS_API_TOKEN = 'private-one';
  const privateOne = captureFederatedSearchPolicy(await loadFederatedSearchPolicy(repos.get('a')),
    { args: rawArgs, query: '', exactMode: 'code' });
  process.env.PAIROFCLEATS_API_TOKEN = 'private-two';
  const privateTwo = captureFederatedSearchPolicy(await loadFederatedSearchPolicy(repos.get('a')),
    { args: rawArgs, query: '', exactMode: 'code' });
  assert.equal(privateOne.identity, privateTwo.identity, 'the real environment secret owner cannot fragment retrieval policy');

  // The environment override is consumed by the same normalizer for both paths.
  process.env.PAIROFCLEATS_STORAGE_TIER = 'fast';
  assert.equal(getEnvConfig().storageTier, 'fast');
  const envToken = captureFederatedSearchPolicy(await loadFederatedSearchPolicy(repos.get('a')),
    { args: rawArgs, query: '', exactMode: 'code' });
  assert.notEqual(envToken.identity, token.identity);
  process.env.PAIROFCLEATS_STORAGE_TIER = 'balanced';

  // Bind child execution to A even if config becomes B after outer admission.
  await writeConfig(repos.get('a'), config(false));
  const raceRequest = { ...request, query: 'alpha AND alpha' };
  let edited = false;
  const raceContext = { searchPolicyId: context.searchPolicyId, searchFn: async (repo, params) => {
    assert.ok(params[INTERNAL_SEARCH_POLICY]);
    if (!edited) { edited = true; await writeConfig(repos.get('a'), config(true)); }
    return coreSearch(repo, params);
  } };
  const capturedBeforeEdit = await runFederatedSearch(raceRequest, raceContext);
  assert.deepEqual(names(capturedBeforeEdit, 'a'), ['first', 'second']);
  const next = await runFederatedSearch(raceRequest, context);
  assert.deepEqual(names(next, 'a'), ['second', 'first']);

  let unqualifiedCalls = 0;
  const unqualified = { searchFn: async (...args) => { unqualifiedCalls++; return coreSearch(...args); } };
  const uncachedRequest = { ...request, query: 'alpha OR alpha' };
  await runFederatedSearch(uncachedRequest, unqualified); await runFederatedSearch(uncachedRequest, unqualified);
  assert.equal(unqualifiedCalls, 4, 'custom execution without stable host policy identity cannot persist/reuse outer results');
} finally {
  if (originalStorageTier == null) delete process.env.PAIROFCLEATS_STORAGE_TIER;
  else process.env.PAIROFCLEATS_STORAGE_TIER = originalStorageTier;
  if (originalApiToken == null) delete process.env.PAIROFCLEATS_API_TOKEN;
  else process.env.PAIROFCLEATS_API_TOKEN = originalApiToken;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Effective per-repository policy binds outer/local reuse and actual child ranking without leaking raw config or mixing invocation policy.');
