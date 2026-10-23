import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';
import { loadJsonArrayArtifactRows } from '../../../src/shared/artifact-io/loaders.js';
import { readJsonlRows } from '../../../src/shared/merge.js';
import { buildApiContractsReport } from '../../../src/integrations/tooling/api-contracts.js';
import { createApiContractCallTargetIndex } from '../../../src/integrations/tooling/api-contract-targets.js';
import { validateApiContracts } from '../../../src/contracts/validators/analysis.js';
import { validateArtifact } from '../../../src/contracts/validators/artifacts.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('api-qualified-target-ingestion');
const symbols = [
  { symbolId: 'moduleA.foo', chunkUid: 'chunk-A', file: 'a.ts', name: 'foo', signature: 'foo(a)' },
  { symbolId: 'moduleB.foo', chunkUid: 'chunk-B', file: 'b.ts', name: 'foo', signature: 'foo(a,b)' }
];
const call = { callSiteId: 'sha1:' + createHash('sha1').update('call-A').digest('hex'), callerChunkUid: 'caller-A',
  callerDocId: null, file: 'use-a.ts', languageId: 'typescript', segmentId: null, start: 0, end: 6,
  startLine: 1, startCol: 1, endLine: 1, endCol: 7, calleeRaw: 'foo', calleeNormalized: 'foo', receiver: null,
  args: ['1'], kwargs: null, confidence: 1, evidence: [], targetChunkUid: 'chunk-A', targetDocId: null,
  targetCandidates: [], snippetHash: null };
assert.equal(validateArtifact('call_sites', [call]).ok, true);
const fixed = { symbols, failOnWarn: true, caps: { maxWarnings: 0 }, indexSignature: 'generation-A',
  indexCompatKey: 'compat-A', now: () => '2026-10-23T00:00:00.000Z' };
const expected = buildApiContractsReport({ ...fixed, callSites: [call] });
for (const format of ['json', 'jsonl']) {
  const target = path.join(dir, `call_sites.${format}`);
  await fs.writeFile(target, format === 'json' ? JSON.stringify([call]) : JSON.stringify(call) + '\n');
  const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
    pieces: [{ name: 'call_sites', path: path.basename(target), format }] };
  const rows = []; for await (const row of loadJsonArrayArtifactRows(dir, 'call_sites', { manifest, strict: true })) rows.push(row);
  const report = buildApiContractsReport({ ...fixed, callSites: rows });
  assert.deepEqual(report, expected); assert.equal(validateApiContracts(report).ok, true);
  if (format === 'jsonl') {
    const builder = createApiContractCallTargetIndex();
    for await (const row of readJsonlRows(target)) builder.add(row);
    assert.deepEqual(buildApiContractsReport({ ...fixed, callSitesByTarget: builder.finish() }), expected,
      'the CLI streaming loader and strict array loader share one target index');
    await fs.appendFile(target, '{invalid-json\n');
    await assert.rejects(async () => { for await (const row of readJsonlRows(target)) void row; });
  }
}
console.log('JSON/JSONL/caller-map call ingestion preserves one exact target qualification.');
