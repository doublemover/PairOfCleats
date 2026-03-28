#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { getTriageContext, runJson } from '../../helpers/triage.js';

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

await runLegacyWrapperCase();
await runGenericExposureCase();
await runDecisionCase();
await runSourceMatrixCase();
console.log('tooling triage ingest/decision contract matrix test passed');
