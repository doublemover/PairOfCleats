#!/usr/bin/env node
import path from 'node:path';
import { getTriageContext, run, runJson } from '../../helpers/triage.js';

const { root, repoRoot, triageFixtureRoot, env, writeTestLog } = await getTriageContext({
  name: 'triage-records-index'
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

run('build-index', [
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--repo', repoRoot
], { cwd: repoRoot, env });

run('build-records-index', [
  path.join(root, 'build_index.js'),
  '--mode', 'records',
  '--stub-embeddings',
  '--repo', repoRoot
], { cwd: repoRoot, env });

const recordSearch = runJson('search-records', [
  path.join(root, 'search.js'),
  'CVE-2024-0001',
  '--mode', 'records',
  '--meta', 'service=api',
  '--meta', 'env=prod',
  '--json',
  '--no-ann',
  '--repo', repoRoot
], { cwd: repoRoot, env });

await writeTestLog('triage-record-search.json', recordSearch);

if (!Array.isArray(recordSearch.records) || recordSearch.records.length === 0) {
  console.error('Record search returned no results.');
  process.exit(1);
}

const firstRecord = recordSearch.records[0];
if (!firstRecord.docmeta?.record?.service || firstRecord.docmeta.record.service !== 'api') {
  console.error('Record search did not preserve docmeta.record.service.');
  process.exit(1);
}

console.log('Triage records index/search ok.');
