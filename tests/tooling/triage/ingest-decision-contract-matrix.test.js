#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { getTriageContext, runJson } from '../../helpers/triage.js';
import { promoteRecordFields, snapshotFindingPackages } from '../../../src/integrations/triage/record-utils.js';
import { buildTriageHistory } from '../../../tools/triage/history.js';

const runLegacyWrapperCase = async () => {
  const { root, repoRoot, cacheRoot, env } = await getTriageContext({
    name: 'triage-ingest-legacy-wrapper-matrix'
  });

  const inputPath = path.join(cacheRoot, 'legacy-wrapper.json');
  const payload = {
    metadata: ['ignore-this-array'],
    findings: [{
      recordType: 'finding',
      source: 'generic',
      stableKey: 'legacy-wrapper-findings-1',
      service: 'api',
      env: 'prod',
      vuln: {
        vulnId: 'CVE-2024-9999',
        title: 'Legacy findings payload compatibility check',
        description: 'Verify ingest selects findings array over unrelated arrays.',
        severity: 'high'
      }
    }]
  };

  await fsPromises.writeFile(inputPath, JSON.stringify(payload, null, 2));
  const ingestResult = runJson('ingest-legacy-wrapper', [
    path.join(root, 'tools', 'triage', 'ingest.js'),
    '--source', 'generic',
    '--in', inputPath,
    '--repo', repoRoot
  ], { env });

  assert.equal(ingestResult.written, 1);
  assert.ok(Array.isArray(ingestResult.recordIds) && ingestResult.recordIds.length === 1);

  const recordPath = ingestResult.records?.[0]?.jsonPath
    || path.join(ingestResult.recordsDir, `${ingestResult.recordIds[0]}.json`);
  const stored = JSON.parse(await fsPromises.readFile(recordPath, 'utf8'));
  assert.equal(stored.stableKey, 'legacy-wrapper-findings-1');
  assert.equal(stored.vuln?.title, 'Legacy findings payload compatibility check');
};

const runGenericExposureCase = async () => {
  const { root, repoRoot, triageFixtureRoot, env } = await getTriageContext({
    name: 'triage-ingest-generic-matrix'
  });

  const ingestGeneric = runJson('ingest-generic', [
    path.join(root, 'tools', 'triage', 'ingest.js'),
    '--source', 'generic',
    '--in', path.join(triageFixtureRoot, 'generic.json'),
    '--repo', repoRoot,
    '--meta', 'service=api',
    '--meta', 'env=prod'
  ], { env });

  assert.ok(Array.isArray(ingestGeneric.recordIds) && ingestGeneric.recordIds.length > 0);
  const findingId = ingestGeneric.recordIds[0];
  const recordJsonPath = ingestGeneric.records?.[0]?.jsonPath
    || path.join(ingestGeneric.recordsDir, `${findingId}.json`);
  const recordMdPath = ingestGeneric.records?.[0]?.mdPath
    || path.join(ingestGeneric.recordsDir, `${findingId}.md`);

  const storedRecord = JSON.parse(await fsPromises.readFile(recordJsonPath, 'utf8'));
  assert.equal(storedRecord.exposure?.internetExposed, true);
  assert.equal(storedRecord.idProvenance?.method, 'stable-key');
  assert.equal(storedRecord.idProvenance?.source, 'stableKey');

  const recordMarkdown = await fsPromises.readFile(recordMdPath, 'utf8');
  assert.ok(recordMarkdown.includes('## Exposure'));
  assert.ok(recordMarkdown.includes('Internet exposed'));
  assert.ok(recordMarkdown.includes('## Record identity'));
  assert.ok(recordMarkdown.includes('Method: stable-key'));
};

const runDecisionCase = async () => {
  const { root, repoRoot, triageFixtureRoot, env } = await getTriageContext({
    name: 'triage-decision-matrix'
  });

  const ingestGeneric = runJson('ingest-generic', [
    path.join(root, 'tools', 'triage', 'ingest.js'),
    '--source', 'generic',
    '--in', path.join(triageFixtureRoot, 'generic.json'),
    '--repo', repoRoot
  ], { env });

  assert.ok(Array.isArray(ingestGeneric.recordIds) && ingestGeneric.recordIds.length > 0);
  const findingId = ingestGeneric.recordIds[0];

  const decision = runJson('decision', [
    path.join(root, 'tools', 'triage', 'decision.js'),
    '--repo', repoRoot,
    '--finding', findingId,
    '--status', 'accept',
    '--justification', 'Fixture decision for tests',
    '--reviewer', 'qa@example.com'
  ], { env });

  assert.equal(decision.status, 'accept');
  assert.ok(decision.jsonPath && fs.existsSync(decision.jsonPath));
};

const runSourceMatrixCase = async () => {
  const { root, repoRoot, triageFixtureRoot, env } = await getTriageContext({
    name: 'triage-ingest-sources-matrix'
  });

  const dependabot = runJson('ingest-dependabot', [
    path.join(root, 'tools', 'triage', 'ingest.js'),
    '--source', 'dependabot',
    '--in', path.join(triageFixtureRoot, 'dependabot.json'),
    '--repo', repoRoot,
    '--meta', 'service=api',
    '--meta', 'env=prod'
  ], { env });
  assert.ok(Array.isArray(dependabot.recordIds) && dependabot.recordIds.length > 0);

  const inspector = runJson('ingest-inspector', [
    path.join(root, 'tools', 'triage', 'ingest.js'),
    '--source', 'aws_inspector',
    '--in', path.join(triageFixtureRoot, 'inspector.json'),
    '--repo', repoRoot,
    '--meta', 'service=api',
    '--meta', 'env=prod'
  ], { env });
  assert.ok(Array.isArray(inspector.recordIds) && inspector.recordIds.length > 0);
};

const runInspectorDecisionOccurrences = async () => {
  const { root, repoRoot, cacheRoot, env } = await getTriageContext({ name: 'triage-inspector-decision-occurrences' });
  const input = path.join(cacheRoot, 'affected-packages.json');
  const packages = [
    { name: 'alpha', version: '1', filePath: '/a', fixedInVersion: '1.1' },
    { name: 'zeta', version: '2', filePath: '/b', fixedInVersion: '2.2' },
    { name: 'zeta', version: '3', filePath: '/c', fixedInVersion: '3.3' }
  ];
  const finding = { findingArn: 'synthetic:decision-occurrences', title: 'Affected packages',
    packageVulnerabilityDetails: { vulnerabilityId: 'CVE-MULTI', vulnerablePackages: packages } };
  const ingest = async value => {
    await fsPromises.writeFile(input, JSON.stringify([value]));
    return runJson('ingest Inspector occurrences', [path.join(root, 'tools/triage/ingest.js'), '--source', 'aws_inspector',
      '--in', input, '--repo', repoRoot], { env });
  };
  const first = await ingest(finding);
  const stored = JSON.parse(await fsPromises.readFile(first.records[0].jsonPath, 'utf8'));
  assert.equal(stored.packages.length, 3);
  const repeated = await ingest({ ...finding, packageVulnerabilityDetails: { ...finding.packageVulnerabilityDetails,
    vulnerablePackages: [...packages].reverse() } });
  assert.deepEqual(repeated.recordIds, first.recordIds, 'reordered import preserves parent identity');
  const reordered = JSON.parse(await fsPromises.readFile(repeated.records[0].jsonPath, 'utf8'));
  assert.deepEqual(reordered.packages, stored.packages, 'occurrence identity and associated values are order invariant');
  const saved = runJson('save Inspector decision', [path.join(root, 'tools/triage/decision.js'), '--repo', repoRoot,
    '--finding', first.recordIds[0], '--status', 'accept', '--justification', 'Full affected-package observation'], { env });
  const decision = JSON.parse(await fsPromises.readFile(saved.jsonPath, 'utf8'));
  assert.deepEqual(decision.packages, stored.packages);
  assert.equal(new Set(decision.packages.map(pkg => pkg.occurrenceId)).size, 3);
  assert.equal(decision.decision.findingRecordId, stored.recordId);
  assert.ok(decision.decision.findingObservation, 'the decision binds its saved finding observation');
  const markdown = await fsPromises.readFile(saved.mdPath, 'utf8');
  for (const pkg of stored.packages) {
    assert.ok(markdown.includes(pkg.name)); assert.ok(markdown.includes(pkg.installedVersion));
    assert.ok(markdown.includes(pkg.fixedVersion)); assert.ok(markdown.includes(pkg.manifestPath));
  }
  assert.deepEqual(promoteRecordFields(decision, ['packageName']).packageName, ['alpha', 'zeta']);
  const related = { recordId: 'other-finding', packages: [stored.packages.find(pkg => pkg.name === 'zeta')] };
  const history = await buildTriageHistory({ recordsDir: saved.recordsDir, recordId: related.recordId, finding: related });
  assert.ok(history.some(row => row.recordId === saved.recordId), 'nonrepresentative package alone contributes to actual history matching');
  const legacy = { package: { name: 'legacy', installedVersion: '1' } };
  assert.deepEqual(snapshotFindingPackages(legacy).packages, [legacy.package]);
  assert.deepEqual(snapshotFindingPackages({ packages: [] }).packages, []);
};

await runLegacyWrapperCase();
await runGenericExposureCase();
await runDecisionCase();
await runSourceMatrixCase();
await runInspectorDecisionOccurrences();
console.log('tooling triage ingest/decision contract matrix test passed');
