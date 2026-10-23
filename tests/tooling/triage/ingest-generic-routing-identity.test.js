import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext } from '../../helpers/triage.js';
import { runNode } from '../../helpers/run-node.js';
import { normalizeGeneric } from '../../../src/integrations/triage/normalize/generic.js';
import { buildRecordId, promoteRecordFields } from '../../../src/integrations/triage/record-utils.js';

// UNVALIDATED: direct normalization plus actual bounded ingest/persisted views.
// No index, database, model, user record or external service is exercised.
const routing = { service: 'api', env: 'prod', team: 'payments', owner: 'alice', repo: 'owner/project' };
const source = { recordId: 'original-routing', ...Object.fromEntries(Object.entries(routing).map(([key, value]) => [key, ` ${value} `])),
  vuln: { vulnId: 'CVE-FIXTURE' } };
for (const overrides of [{}, { service: ' explicit ' }, { env: 'staging', owner: 'bob', repo: 'selected/project' },
  { team: null, env: false, repo: '   ' }]) {
  const record = normalizeGeneric(source, overrides, { repoRoot: '/invocation/default' });
  for (const [key, original] of Object.entries(routing)) assert.equal(record[key],
    typeof overrides[key] === 'string' && overrides[key].trim() ? overrides[key].trim() : original);
  assert.equal(record.recordId, source.recordId); assert.deepEqual(source.vuln, { vulnId: 'CVE-FIXTURE' });
}
for (const value of [undefined, null, false, 0, {}, '', '   ']) {
  const record = normalizeGeneric({ title: 'missing routing', repo: value }, { repo: value }, { repoRoot: '/invocation/default' });
  assert.equal(record.repo, '/invocation/default');
  for (const key of ['service', 'env', 'team', 'owner']) assert.equal(record[key], null);
}

const common = { source: 'generic', vuln: { vulnId: 'CVE-SHARED' }, package: { name: 'same-package' } };
const findings = [
  { ...common, package: { name: 'alpha', manifestPath: 'a/package.json' }, service: 'one' },
  { ...common, package: { name: 'beta', manifestPath: 'b/package.json' }, service: 'two' },
  { ...common, asset: { assetId: 'host-a' } }, { ...common, asset: { assetId: 'host-b' } },
  { ...common, package: { name: 'same-package', manifestPath: 'a/package.json' } },
  { ...common, package: { name: 'same-package', manifestPath: 'b/package.json' } },
  { ...common, service: 'route-a' }, { ...common, service: 'route-b' }
];
const expected = findings.map(raw => normalizeGeneric(raw));
assert.equal(new Set(expected.map(record => record.recordId)).size, findings.length,
  'CVE, package, asset, manifest and routing attributes alone cannot alias distinct findings');
for (const [index, record] of expected.entries()) {
  assert.equal(record.recordId, buildRecordId('generic', JSON.stringify(findings[index])));
  assert.deepEqual(record.idProvenance, { method: 'fallback-hash', stability: 'lower-trust', source: 'raw-payload-hash' });
}
assert.equal(normalizeGeneric({ ...common, recordId: 'explicit' }).recordId, 'explicit');
assert.equal(normalizeGeneric({ ...common, stableKey: 'explicit-key' }).recordId, buildRecordId('generic', 'explicit-key'));

const { root, repoRoot, cacheRoot, env } = await getTriageContext({ name: 'triage-generic-routing-identity' });
const input = path.join(cacheRoot, 'input.json');
const ingest = async (rows, meta = []) => {
  await fs.writeFile(input, JSON.stringify(rows));
  const args = [path.join(root, 'tools/triage/ingest.js'), '--source', 'generic', '--in', input, '--repo', repoRoot];
  for (const value of meta) args.push('--meta', value);
  const result = runNode(args, 'generic original routing and finding identities', root, env,
    { stdio: 'pipe', allowFailure: true, timeoutMs: 5000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
};
const mixed = [source, { ...source, recordId: 'second-routing', service: 'worker', repo: 'other/project' }, ...findings, findings[0]];
const receipt = await ingest(mixed, ['env=staging']);
assert.equal(receipt.total, mixed.length); assert.equal(receipt.written, mixed.length); assert.equal(receipt.errors, 0);
assert.equal(new Set(receipt.recordIds).size, mixed.length - 1, 'only the deliberately repeated identical payload shares an ID');
for (const [index, artifact] of receipt.records.entries()) {
  const persisted = JSON.parse(await fs.readFile(artifact.jsonPath, 'utf8'));
  const raw = mixed[index];
  assert.equal(persisted.service, raw.service?.trim() || null); assert.equal(persisted.env, 'staging');
  assert.equal(persisted.repo, raw.repo?.trim() || repoRoot);
  for (const key of ['team', 'owner']) assert.equal(persisted[key], raw[key]?.trim() || null);
  assert.deepEqual(promoteRecordFields(persisted, ['service', 'env', 'repo']), {
    ...(persisted.service ? { service: persisted.service } : {}), env: 'staging', repo: persisted.repo
  }, 'metadata-first indexing receives each persisted original route');
  const markdown = await fs.readFile(artifact.mdPath, 'utf8');
  assert.ok(markdown.includes(`- Repo: ${persisted.repo}`)); assert.ok(markdown.includes('- Env: staging'));
  if (persisted.service) assert.ok(markdown.includes(`- Service: ${persisted.service}`));
  if (persisted.team) assert.ok(markdown.includes(`- Team: ${persisted.team}`));
  if (persisted.owner) assert.ok(markdown.includes(`- Owner: ${persisted.owner}`));
  if (index >= 2) assert.equal(persisted.idProvenance.method, 'fallback-hash');
}
const updated = await ingest([{ ...source, service: 'updated', description: 'explicit update' },
  { ...common, stableKey: 'stable-update', description: 'before' },
  { ...common, stableKey: 'stable-update', description: 'after' }]);
assert.equal(updated.written, 3); assert.equal(updated.errors, 0);
assert.equal(updated.recordIds[0], source.recordId); assert.equal(updated.recordIds[1], updated.recordIds[2]);
assert.equal(JSON.parse(await fs.readFile(updated.records[0].jsonPath, 'utf8')).service, 'updated');
assert.equal(JSON.parse(await fs.readFile(updated.records[2].jsonPath, 'utf8')).description, 'after');
console.log('Generic original routing, distinct full-payload findings and explicit update controls authored; execution deferred.');
