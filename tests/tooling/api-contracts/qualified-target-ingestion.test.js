import { withFixtureCallArguments } from '../../helpers/call-arguments.js';
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
const call = withFixtureCallArguments({ callSiteId: 'sha1:' + createHash('sha1').update('call-A').digest('hex'), callerChunkUid: 'caller-A',
  callerDocId: null, file: 'use-a.ts', languageId: 'typescript', segmentId: null, start: 0, end: 6,
  startLine: 1, startCol: 1, endLine: 1, endCol: 7, calleeRaw: 'foo', calleeNormalized: 'foo', receiver: null,
  args: ['1'], kwargs: null, confidence: 1, evidence: [], targetChunkUid: 'chunk-A', targetDocId: null,
  targetCandidates: [], snippetHash: null });
assert.equal(validateArtifact('call_sites', [call]).ok, true);
const fixed = { caps: { maxWarnings: 0 }, indexSignature: 'generation-A',
  indexCompatKey: 'compat-A', now: () => '2026-10-23T00:00:00.000Z' };
const badB = { ...call, callSiteId: 'sha1:' + createHash('sha1').update('call-B').digest('hex'),
  file: 'use-b.ts', targetChunkUid: 'chunk-B' };
assert.equal(validateArtifact('call_sites', [badB]).ok, true);
const scenarios = [
  { name: 'healthy-a', calls: [call], counts: { 'moduleA.foo': 1, 'moduleB.foo': 0 } },
  { name: 'bad-b', calls: [badB], counts: { 'moduleA.foo': 0, 'moduleB.foo': 1 }, warns: true },
  { name: 'healthy-a-bad-b', calls: [call, badB], counts: { 'moduleA.foo': 1, 'moduleB.foo': 1 }, warns: true },
  { name: 'aliased-bad-b', calls: [{ ...badB, calleeNormalized: 'importedAlias' }], counts: { 'moduleA.foo': 0, 'moduleB.foo': 1 }, warns: true },
  { name: 'foreign-generation-b', calls: [call, badB], symbols: [symbols[0], { ...symbols[1], indexSignature: 'generation-B' }],
    counts: { 'moduleA.foo': 1, 'moduleB.foo': 0 }, unresolved: 'generation-mismatch' },
  { name: 'absent-b', calls: [call, badB], symbols: [symbols[0]], counts: { 'moduleA.foo': 1 }, unresolved: 'unknown-target' },
  { name: 'lexical-b', calls: [call, { ...badB, targetChunkUid: null }],
    counts: { 'moduleA.foo': 1, 'moduleB.foo': 0 }, unresolved: 'ambiguous-lexical' }
];
const assertJoins = (report, scenario) => {
  assert.equal(validateApiContracts(report).ok, true); assert.equal(report.warnings, null, 'zero detail cap does not fabricate warning rows');
  assert.deepEqual(Object.fromEntries(report.symbols.map(row => [row.symbol.symbolId, row.observedCalls.length])), scenario.counts);
  for (const row of report.symbols) for (const observed of row.observedCalls) {
    const target = row.symbol.symbolId === 'moduleA.foo' ? 'chunk-A' : 'chunk-B';
    assert.equal(observed.targetChunkUid, target); assert.equal(observed.join.targetChunkUid, target);
    assert.equal(observed.join.symbolId, row.symbol.symbolId); assert.equal(observed.join.indexSignature, 'generation-A');
    assert.equal(observed.callSiteId, row.symbol.symbolId === 'moduleA.foo' ? call.callSiteId : badB.callSiteId);
  }
  assert.equal(report.callEvidence.unresolvedCallCount, scenario.unresolved ? 1 : 0);
  if (scenario.unresolved) assert.equal(report.callEvidence.unresolvedByReason[scenario.unresolved], 1);
};
for (const scenario of scenarios) {
  const selected = { ...fixed, symbols: scenario.symbols || symbols };
  const expected = buildApiContractsReport({ ...selected, callSites: scenario.calls }); assertJoins(expected, scenario);
  for (const format of ['json', 'jsonl']) {
    const target = path.join(dir, `${scenario.name}-call_sites.${format}`);
    await fs.writeFile(target, format === 'json' ? JSON.stringify(scenario.calls) : scenario.calls.map(row => JSON.stringify(row)).join('\n') + '\n');
    const manifest = { artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
      pieces: [{ name: 'call_sites', path: path.basename(target), format }] };
    const rows = []; for await (const row of loadJsonArrayArtifactRows(dir, 'call_sites', { manifest, strict: true })) rows.push(row);
    const routes = [{ callSites: rows }, { callSitesByTarget: new Map([['untrusted-name-bucket', rows]]) }];
    if (format === 'jsonl') {
      const builder = createApiContractCallTargetIndex();
      for await (const row of readJsonlRows(target)) builder.add(row);
      routes.push({ callSitesByTarget: builder.finish() });
    }
    for (const route of routes) {
      const report = buildApiContractsReport({ ...selected, ...route }); assertJoins(report, scenario);
      assert.deepEqual(report, expected, scenario.name + '/' + format + ': exact downstream join/order/schema parity');
      if (scenario.warns) assert.throws(() => buildApiContractsReport({ ...selected, ...route, failOnWarn: true }), error => {
        assert.equal(error.code, 'ERR_API_CONTRACT_WARN'); assertJoins(error.report, scenario); return true;
      });
      else assertJoins(buildApiContractsReport({ ...selected, ...route, failOnWarn: true }), scenario);
    }
    if (format === 'jsonl') {
      await fs.appendFile(target, '{invalid-json\n');
      await assert.rejects(async () => { for await (const row of readJsonlRows(target)) void row; });
    }
  }
}
console.log('JSON/JSONL/caller-map ingestion preserves exact healthy/bad/absent/foreign-generation target joins and zero-cap warning failure.');
