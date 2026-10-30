import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext } from '../../helpers/triage.js';
import { runNode } from '../../helpers/run-node.js';
import { normalizeAwsInspector } from '../../../src/integrations/triage/normalize/aws-inspector.js';

// UNVALIDATED: actual normalizer and bounded ingest/persisted canonical output.
const entry = (baseScore, version = '3.1', source = 'NVD', scoringVector = 'CVSS:3.1/AV:N') =>
  ({ baseScore, version, source, scoringVector });
const finding = (name, cvss) => ({ findingArn: `arn:fixture:${name}`, severity: 'HIGH',
  packageVulnerabilityDetails: { vulnerabilityId: 'CVE-FIXTURE', cvss,
    vulnerablePackages: [{ name: 'fixture', version: '1' }] } });
const normalize = cvss => normalizeAwsInspector(finding('direct', cvss));
assert.deepEqual(normalize([entry(9.8)]).vuln.cvss, { score: 9.8, vector: 'CVSS:3.1/AV:N', version: '3.1' });
assert.deepEqual(normalize([entry(0)]).vuln.cvss, { score: 0, vector: 'CVSS:3.1/AV:N', version: '3.1' });
assert.equal(normalize([entry(9.8)]).parseWarnings, undefined);
for (const input of [undefined, null, [], {}]) assert.equal(normalize(input).vuln.cvss, null);
for (const bad of [null, false, '', '9.8', Infinity, NaN, -1, 11, {}]) {
  const result = normalize([entry(bad)]);
  assert.equal(result.vuln.cvss, null); assert.deepEqual(result.parseWarnings, ['malformed AWS CVSS entry at 0']);
}
for (const item of [null, [], {}, { ...entry(5), scoringVector: '' }, { ...entry(5), source: false },
  { ...entry(5), version: '' }, { ...entry(5), baseScore: undefined }]) {
  const result = normalize([item, entry(7)]);
  assert.equal(result.vuln.cvss.score, 7); assert.deepEqual(result.parseWarnings, ['malformed AWS CVSS entry at 0']);
}
assert.deepEqual(normalize({ score: '6.5', vector_string: 'legacy-vector', cvss_version: '3.0' }).vuln.cvss,
  { score: 6.5, vector: 'legacy-vector', version: '3.0' });
assert.deepEqual(normalize({ baseScore: 0, scoringVector: 'zero', version: '3.1' }).vuln.cvss,
  { score: 0, vector: 'zero', version: '3.1' });
assert.deepEqual(normalize({ vector: 'partial', version: '3.0' }).vuln.cvss,
  { score: null, vector: 'partial', version: '3.0' });
assert.equal(normalize({ score: false }).vuln.cvss, null);

const candidates = [entry(8, '4.0', 'Z', 'version4'), entry(9.8, '3.0', 'Z', 'old'),
  entry(9.8, '3.1', 'Z', 'z'), entry(9.8, '3.1', 'A', 'b'), entry(9.8, '3.1', 'A', 'a')];
const expected = { score: 9.8, vector: 'a', version: '3.1' };
const permutations = [candidates, [...candidates].reverse(), [...candidates.slice(2), ...candidates.slice(0, 2)]];
for (const input of permutations) {
  const value = normalize(input); assert.deepEqual(value.vuln.cvss, expected);
  assert.deepEqual(value.parseWarnings, ['AWS CVSS max-base-score.v1 selected A version 3.1 from 5 valid entries; canonical cvss projects one score']);
  const retained = normalizeAwsInspector(finding('raw', input), {}, { storeRawPayload: true });
  assert.deepEqual(retained.raw.packageVulnerabilityDetails.cvss, input, 'existing opted-in raw retention keeps all alternatives');
}
assert.deepEqual(normalize([entry(9, '3.9', 'A', 'minor9'), entry(9, '3.10', 'A', 'minor10')]).vuln.cvss,
  { score: 9, vector: 'minor10', version: '3.10' }, 'numeric version ordering cannot use lexical order');

const { root, repoRoot, cacheRoot, env } = await getTriageContext({ name: 'triage-inspector-cvss' });
const input = path.join(cacheRoot, 'cvss-input.json');
const findings = [finding('native', [entry(9.8)]), finding('zero', [entry(0)]), finding('multiple', candidates),
  finding('legacy', { score: '6.5', vectorString: 'legacy', version: '3.0' }), finding('missing', undefined)];
await fs.writeFile(input, JSON.stringify(findings));
const result = runNode([path.join(root, 'tools/triage/ingest.js'), '--source', 'aws_inspector', '--in', input, '--repo', repoRoot],
  'Inspector native CVSS persisted fidelity', root, env, { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
assert.equal(result.status, 0, result.stderr);
const receipt = JSON.parse(result.stdout); assert.equal(receipt.written, findings.length); assert.equal(receipt.errors, 0);
const scores = [{ score: 9.8, vector: 'CVSS:3.1/AV:N', version: '3.1' },
  { score: 0, vector: 'CVSS:3.1/AV:N', version: '3.1' }, expected, { score: 6.5, vector: 'legacy', version: '3.0' }, null];
for (const [index, artifact] of receipt.records.entries()) {
  const stored = JSON.parse(await fs.readFile(artifact.jsonPath, 'utf8'));
  assert.deepEqual(stored.vuln.cvss, scores[index]);
  if (index === 2) {
    assert.equal(stored.parseWarnings.length, 1); assert.match(stored.parseWarnings[0], /selected A version 3\.1 from 5/);
  } else assert.equal(stored.parseWarnings, undefined);
}
console.log('Inspector CVSS native arrays, deterministic projection and persisted fidelity controls authored; execution deferred.');
