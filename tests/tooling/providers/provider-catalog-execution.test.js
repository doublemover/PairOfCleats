import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { TOOLING_PROVIDERS, registerToolingProvider } from '../../../src/index/tooling/provider-registry.js';
import { runToolingProviders } from '../../../src/index/tooling/orchestrator.js';
import { observeProviderProfile } from '../../../src/index/tooling/provider-profile.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

const root = await makeTempDir('provider-catalog-execution-'), saved = new Map(TOOLING_PROVIDERS);
const chunkUid = 'ck64:v1:test:provider-catalog', text = 'fixture';
const inputs = { kinds: ['types'], documents: [{ virtualPath: 'app.fixture', languageId: 'fixture', text }], targets: [{
  virtualPath: 'app.fixture', languageId: 'fixture', chunkRef: { chunkUid, chunkId: 'catalog', file: 'app.fixture', range: { start: 0, end: text.length } }
}] };
const calls = { hash: new Map(), preflight: new Map(), run: new Map() };
const increment = (map, id) => map.set(id, (map.get(id) || 0) + 1);
const provider = id => ({ id, version: '1', priority: 1, languages: ['fixture'], kinds: ['types'],
  capabilities: { supportsVirtualDocuments: true, supportsSegmentRouting: true },
  getConfigHash() { increment(calls.hash, id); return `fixture-${id}`; },
  async preflight() { increment(calls.preflight, id); return { state: 'ready', checks: [] }; },
  async run() { increment(calls.run, id); return { byChunkUid: { [chunkUid]: { payload: { returnType: 'FixtureType' } } }, diagnostics: { fixture: id } }; }
});
try {
  TOOLING_PROVIDERS.clear(); registerToolingProvider(provider('family-a'));
  const invalidCache = path.join(root, 'invalid-cache');
  const invalid = { autoEnableOnDetect: false, enabledTools: ['family-a'], lsp: { enabled: true, autoPresets: false,
    servers: [{ id: 'external', providerId: 'FAMILY-A', cmd: 'untrusted-never-launched', languages: ['fixture'] }] } };
  for (const order of [[], ['family-a']]) await assert.rejects(runToolingProviders({ repoRoot: root, buildRoot: root,
    toolingConfig: { ...invalid, providerOrder: order }, cache: { enabled: true, dir: invalidCache } }, inputs),
  { code: 'ERR_TOOLING_PROVIDER_ID_COLLISION' });
  assert.equal(calls.hash.size, 0); assert.equal(calls.preflight.size, 0); assert.equal(calls.run.size, 0);
  await assert.rejects(fs.stat(invalidCache), { code: 'ENOENT' }, 'ambiguous identity cannot prepare a durable cache');
  registerToolingProvider(provider('family-b'));
  await fs.writeFile(path.join(root, 'app.fixture'), text); await fs.writeFile(path.join(root, 'tool.bin'), 'fixture tool bytes');
  const providerProfiles = {};
  for (const id of ['family-a', 'family-b']) providerProfiles[id] = await observeProviderProfile({ repoRoot: root,
    providerId: id, adapterVersion: '1', apiProfile: 'fixture', configuredCommand: ['fixture'], resolvedCommand: [path.join(root, 'tool.bin')],
    observedVersion: 'fixture-1', toolFiles: [{ path: 'tool.bin' }], sourceInputs: [{ path: 'app.fixture', hash: createHash('sha256').update(text).digest('hex') }],
    capabilities: ['types'], dependencyClosure: 'complete', project: { files: [], sdkFiles: [], dependencies: [], targets: ['app.fixture'] } });
  assert.ok(Object.values(providerProfiles).every(profile => profile.durable));
  const ctx = { repoRoot: root, buildRoot: root, buildId: 'catalog-build', providerProfiles,
    toolingConfig: { enabledTools: ['family-a', 'family-b'] }, cache: { enabled: true, dir: path.join(root, 'cache') } };
  const output = await runToolingProviders(ctx, inputs);
  assert.equal(output.byChunkUid.size, 1);
  assert.deepEqual([...calls.run], [['family-a', 1], ['family-b', 1]]);
  assert.equal(calls.preflight.get('family-a'), 1); assert.equal(calls.preflight.get('family-b'), 1);
  assert.deepEqual(Object.keys(output.diagnostics).sort(), ['family-a', 'family-b']);
  assert.deepEqual(Object.keys(output.providerProfiles).sort(), ['family-a', 'family-b']);
  for (const id of ['family-a', 'family-b']) assert.equal(output.providerProfiles[id].profileHash, providerProfiles[id].profileHash);
  await runToolingProviders({ ...ctx, toolingConfig: { ...ctx.toolingConfig, providerOrder: ['family-b', 'family-a'] } }, inputs);
  assert.equal(calls.run.get('family-a'), 1); assert.equal(calls.run.get('family-b'), 1,
    'order-only change reuses the same independently qualified provider executions');
} finally { TOOLING_PROVIDERS.clear(); for (const [id, value] of saved) TOOLING_PROVIDERS.set(id, value); await rmDirRecursive(root); }
console.log('Actual orchestration rejects catalog collisions before hashes/preflight/cache work and keeps one qualified execution per independent instance.');
