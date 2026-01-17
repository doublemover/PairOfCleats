#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext, runJson } from '../../helpers/triage.js';

const { root, repoRoot, triageFixtureRoot, env } = await getTriageContext({
  name: 'triage-ingest-generic'
});

const ingestGeneric = runJson('ingest-generic', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', path.join(triageFixtureRoot, 'generic.json'),
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env });

if (!Array.isArray(ingestGeneric.recordIds) || ingestGeneric.recordIds.length === 0) {
  console.error('No records written for generic ingest.');
  process.exit(1);
}

const findingId = ingestGeneric.recordIds[0];
const recordJsonPath = ingestGeneric.records?.[0]?.jsonPath
  || path.join(ingestGeneric.recordsDir, `${findingId}.json`);
const recordMdPath = ingestGeneric.records?.[0]?.mdPath
  || path.join(ingestGeneric.recordsDir, `${findingId}.md`);

const storedRecord = JSON.parse(await fsPromises.readFile(recordJsonPath, 'utf8'));
if (!storedRecord.exposure || storedRecord.exposure.internetExposed !== true) {
  console.error('Exposure metadata not preserved in stored record.');
  process.exit(1);
}
const recordMarkdown = await fsPromises.readFile(recordMdPath, 'utf8');
if (!recordMarkdown.includes('## Exposure') || !recordMarkdown.includes('Internet exposed')) {
  console.error('Exposure metadata not rendered in record markdown.');
  process.exit(1);
}

console.log('Triage ingest generic exposure ok.');
