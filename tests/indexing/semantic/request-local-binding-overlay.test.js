import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRecoveryFixture } from '../../helpers/semantic-recovery.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';
import { observeProviderProfile } from '../../../src/index/tooling/provider-profile.js';
import { createRequestLocalRefinementGrant, runRequestLocalBindingRefinement } from '../../../src/index/tooling/request-local-refinement.js';

const f = await createRecoveryFixture('value();');
try {
  const partition = await f.write([
    { family: 'node', row: { id: 0, kind: 'occurrence', span: [0, 5], scope: null,
      data: { nameId: 0, roles: ['reference'], expression: null, flags: [] } } },
    { family: 'lookup', row: { kind: 'name', id: 0, value: 'value' } }
  ]);
  const command = [path.join(f.root, 'original.js')];
  const profile = await observeProviderProfile({ repoRoot: f.root, providerId: 'ephemeral-fixture', adapterVersion: '1',
    apiProfile: 'authored-fixture', configuredCommand: command, resolvedCommand: command, toolFiles: [{ path: 'original.js' }],
    sourceInputs: [{ path: 'original.js', hash: f.source.byteHash }], dependencyClosure: 'complete' });
  const request = { schemaVersion: 1, action: 'ephemeral', factFamily: 'binding', repoRoot: f.root, generation: f.generation,
    ref: { partitionId: partition.partitionId, localId: 0 }, limits: { maxMs: 1000, maxFacts: 8, maxBytes: 16384, maxSourceBytes: 1024 } };
  let calls = 0;
  await withTemporaryEnv({ PAIROFCLEATS_TRUSTED_REPOS: JSON.stringify([f.root]) }, async () => {
    const grant = createRequestLocalRefinementGrant({ request, profile });
    const store = f.store([partition]);
    const provider = { sessionId: 'fixture', projectReady: 'ready', qualification: { state: 'qualified', profileHash: profile.profileHash,
      methods: ['textDocument/definition'] }, request: async (_method, params) => {
      calls++; return [{ uri: params.textDocument.uri, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } } }];
    } };
    const before = await f.partDirectories();
    const result = await runRequestLocalBindingRefinement({ request, grant, profile, provider, store });
    assert.equal(result.ephemeral, true); assert.equal(result.publishedGeneration, null);
    assert.equal(result.observation.facts[0].target.sourceHash, f.source.byteHash);
    assert.deepEqual(await f.partDirectories(), before, 'request-local success creates no generation partitions');
    const unavailable = await runRequestLocalBindingRefinement({ request, grant, profile, provider: null, store });
    assert.equal(unavailable.reason, 'qualified_binding_provider_unavailable');
    assert.equal(calls, 1);
    const mixed = { ...request, generation: { baseBuildId: 'other', semanticRevision: 0 } };
    assert.equal((await runRequestLocalBindingRefinement({ request: mixed, grant, profile, provider, store })).status, 'denied');
    await fs.writeFile(f.original, 'changed();');
    const stale = await runRequestLocalBindingRefinement({ request, grant, profile, provider, store });
    assert.equal(stale.status, 'stale'); assert.equal(calls, 1);
    assert.throws(() => createRequestLocalRefinementGrant({ request: { ...request, publish: true }, profile }), { code: 'ERR_SEMANTIC_REQUEST_LOCAL' });
  });
  console.log('explicit request-local binding overlay without task, generation or publication mutation');
} finally { await f.cleanup(); }
