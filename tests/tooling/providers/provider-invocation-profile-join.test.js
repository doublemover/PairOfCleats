// UNVALIDATED: actual orchestrator/cache and observed file owners, inert providers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { observeProviderProfile } from '../../../src/index/tooling/provider-profile.js';
import { createObservedProviderInvocation, matchObservedProviderInvocation, runObservedProviderInvocation } from '../../../src/index/tooling/provider-invocation.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { registerToolingProvider, TOOLING_PROVIDERS } from '../../../src/index/tooling/provider-registry.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { errorGraphIncludes } from '../../helpers/error-graph.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const selected = process.env.PAIROFCLEATS_TEST_ID?.split('provider-invocation-profile-join/')[1];
assert.ok(['matched', 'different-tool', 'arguments', 'variant', 'unbound', 'no-profile', 'changed-source',
  'same-version-bytes', 'mutated-policy', 'execution-mutation', 'coalesced-execution', 'serialized-capability', 'pending-output'].includes(selected));
const { dir } = await prepareIsolatedTestCacheDir(`provider-invocation-${selected}`);
applyTestEnv({ cacheRoot: path.join(dir, 'system-cache'), extraEnv: { PAIROFCLEATS_TRUSTED_CONFIG: null } });
const id = 'observed-invocation-fixture', version = '1.0.0', source = 'fixture source bytes\n';
const chunkUid = 'ck64:v1:test:observed-invocation';
await fs.writeFile(path.join(dir, 'source.fixture'), source);
await fs.writeFile(path.join(dir, 'tool-a'), 'inert tool A bytes');
await fs.writeFile(path.join(dir, 'tool-b'), 'inert tool B bytes');
await fs.writeFile(path.join(dir, 'project.json'), '{}');
const document = { virtualPath: 'source.fixture', containerPath: 'source.fixture', text: source,
  languageId: 'fixture', effectiveExt: '.fixture', docHash: 'caller label is not byte evidence' };
const inputs = { documents: [document], kinds: ['types'], targets: [{ virtualPath: 'source.fixture', languageId: 'fixture',
  chunkRef: { chunkUid, chunkId: 'source', file: 'source.fixture', range: { start: 0, end: source.length } } }] };
const ctx = { repoRoot: dir, buildRoot: dir, buildId: 'inert-build', mode: 'code',
  toolingConfig: { enabledTools: [id] }, cache: { enabled: true, dir: path.join(dir, 'provider-cache') } };
const profileFor = (tool = 'tool-a', args = [], variant = 'default') => observeProviderProfile({
  repoRoot: dir, providerId: id, adapterVersion: version, apiProfile: 'inert-v1', observedVersion: 'unchanged-version',
  configuredCommand: [path.join(dir, tool), ...args], resolvedCommand: [path.join(dir, tool), ...args],
  toolFiles: [{ path: tool }], sourceInputs: [{ path: 'source.fixture', hash: createHash('sha256').update(source).digest('hex') }],
  capabilities: ['types'], dependencyClosure: 'complete',
  project: { files: [{ path: 'project.json' }], variant, targets: ['source.fixture'] }
});
const expected = await profileFor(); ctx.providerProfiles = { [id]: expected };
const executionFor = profile => ({ kind: 'command', cwd: dir, environment: { FIXTURE: 'original-environment' },
  configuredCommand: profile.tool.configuredCommand, resolvedCommand: profile.tool.resolvedCommand });
const saved = new Map(TOOLING_PROVIDERS);
let prepared = 0, captured = 0, live = 0, ready = false, cap;
const payload = name => Object.freeze({ byChunkUid: { [chunkUid]: { payload: { returnType: name } } } });
const pending = Object.freeze(Object.assign(new Error('original inert invocation result remains pending'), {
  cacheOwnershipPending: true, cacheOwnershipReleased() { assert.equal(this, pending); return ready; }
}));
const cacheFiles = async () => {
  const directory = path.join(ctx.cache.dir, 'format-' + ARTIFACT_SURFACE_VERSION);
  try { return (await fs.readdir(directory)).filter(file => file.includes('tooling-provider_lk5_')); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
try {
  TOOLING_PROVIDERS.clear();
  const provider = { id, version, profileContractVersion: 1, priority: 1, languages: ['fixture'], kinds: ['types'],
    capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true }, getConfigHash: () => 'fixed-inert-config',
    run: async () => { live++; return payload('Live'); },
    prepareInvocation: async (context, actualInputs) => {
      prepared++;
      const actualProfile = await profileFor(selected === 'different-tool' ? 'tool-b' : 'tool-a',
        selected === 'arguments' ? ['--changed-argument'] : [], selected === 'variant' ? 'another-variant' : 'default');
      cap = await createObservedProviderInvocation({ ctx: context, inputs: actualInputs, profile: actualProfile,
        execution: executionFor(actualProfile),
        execute: async () => {
          captured++;
          if (selected === 'execution-mutation') context.toolingConfig = { ...context.toolingConfig, changed: true };
          if (selected === 'pending-output') throw pending;
          return payload('Captured');
        } });
      if (selected === 'mutated-policy') context.toolingConfig = { ...context.toolingConfig, changed: prepared };
      return cap;
    } };
  if (selected === 'unbound') delete provider.prepareInvocation;
  if (selected === 'no-profile') delete ctx.providerProfiles;
  registerToolingProvider(provider);
  if (selected === 'changed-source') document.text = 'different selected bytes';
  if (selected === 'same-version-bytes') await fs.writeFile(path.join(dir, 'tool-a'), 'same version; different actual tool');
  if (['changed-source', 'same-version-bytes'].includes(selected)) {
    await assert.rejects(runToolingProviders(ctx, inputs));
    assert.equal(captured, 0); assert.equal(live, 0); assert.equal((await cacheFiles()).length, 0);
  } else if (['execution-mutation', 'pending-output'].includes(selected)) {
    let failure;
    await assert.rejects(runToolingProviders(ctx, inputs), error => { failure = error; return selected !== 'pending-output'
      || error.cacheOwnershipPending === true && errorGraphIncludes(error, pending); });
    assert.equal(captured, 1); assert.equal(live, 0); assert.equal((await cacheFiles()).length, 0);
    if (selected === 'pending-output') {
      assert.equal(failure.cacheOwnershipReleased(), false); ready = true; assert.equal(failure.cacheOwnershipReleased(), true);
    }
  } else if (['coalesced-execution', 'serialized-capability'].includes(selected)) {
    const profile = await profileFor();
    cap = await createObservedProviderInvocation({ ctx, inputs, profile, execution: executionFor(profile), execute: async () => { captured++; return payload('Captured'); } });
    const matching = { ctx, inputs, providerId: id, adapterVersion: version, profileHash: profile.profileHash };
    assert.equal(matchObservedProviderInvocation(cap, matching), true);
    if (selected === 'serialized-capability') {
      assert.equal(matchObservedProviderInvocation(JSON.parse(JSON.stringify(cap)), matching), false);
      assert.throws(() => runObservedProviderInvocation(JSON.parse(JSON.stringify(cap))), { code: 'ERR_TOOLING_INVOCATION_IDENTITY' });
      assert.equal(captured, 0);
    } else {
      const [first, second] = await Promise.all([runObservedProviderInvocation(cap), runObservedProviderInvocation(cap)]);
      assert.equal(first, second); assert.equal(captured, 1); assert.equal(first.invocation, cap);
      assert.ok(Object.isFrozen(cap));
    }
  } else {
    const first = await runToolingProviders(ctx, inputs);
    if (selected === 'matched') {
      assert.equal(first.byChunkUid.get(chunkUid).payload.returnType, 'Captured');
      assert.equal(first.providerProfiles[id].profileHash, expected.profileHash);
      const files = await cacheFiles(); assert.equal(files.length, 1);
      const cached = JSON.parse(await fs.readFile(path.join(ctx.cache.dir, 'format-' + ARTIFACT_SURFACE_VERSION, files[0]), 'utf8'));
      assert.equal(cached.invocation.invocationHash, cap.invocationHash);
      await runToolingProviders(ctx, inputs);
      assert.equal(prepared, 2); assert.equal(captured, 1, 'matched fresh preparation permits an actual persisted cache hit');
      assert.equal(live, 0, 'qualified execution uses its captured owner, never the independently resolving run method');
    } else {
      assert.equal(first.byChunkUid.get(chunkUid).payload.returnType, 'Live');
      assert.equal(first.providerProfiles[id], undefined, 'tool A is not reported as the observed producer of unbound live output');
      await runToolingProviders(ctx, inputs);
      assert.equal(captured, 0); assert.equal(live, 2); assert.equal((await cacheFiles()).length, 0);
      if (selected === 'no-profile') assert.equal(prepared, 0);
    }
  }
} finally {
  ready = true;
  TOOLING_PROVIDERS.clear(); for (const [key, provider] of saved) TOOLING_PROVIDERS.set(key, provider);
  await fs.rm(dir, { recursive: true, force: true });
}
console.log(`Provider invocation ${selected}: actual orchestration with inert execution, functional qualification deferred.`);
