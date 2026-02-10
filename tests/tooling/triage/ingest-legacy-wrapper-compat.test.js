#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext, runJson } from '../../helpers/triage.js';

const { root, repoRoot, cacheRoot, env } = await getTriageContext({
  name: 'triage-ingest-legacy-wrapper'
});

const inputPath = path.join(cacheRoot, 'legacy-wrapper.json');
const payload = {
  metadata: ['ignore-this-array'],
  findings: [
    {
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
    }
  ]
};

await fsPromises.writeFile(inputPath, JSON.stringify(payload, null, 2));

const ingestResult = runJson('ingest-legacy-wrapper', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', inputPath,
  '--repo', repoRoot
], { env });

assert.equal(ingestResult.written, 1, 'expected exactly one ingested record');
assert.ok(Array.isArray(ingestResult.recordIds) && ingestResult.recordIds.length === 1, 'expected one record id');

const recordPath = ingestResult.records?.[0]?.jsonPath
  || path.join(ingestResult.recordsDir, `${ingestResult.recordIds[0]}.json`);
const stored = JSON.parse(await fsPromises.readFile(recordPath, 'utf8'));

assert.equal(stored.stableKey, 'legacy-wrapper-findings-1', 'expected record from findings array');
assert.equal(
  stored.vuln?.title,
  'Legacy findings payload compatibility check',
  'expected vulnerability details from findings payload'
);

console.log('Triage ingest legacy wrapper compatibility ok.');
