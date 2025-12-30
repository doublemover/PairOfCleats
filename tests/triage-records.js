#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const repoRoot = path.join(root, 'tests', 'fixtures', 'sample');
const triageFixtureRoot = path.join(root, 'tests', 'fixtures', 'triage');
const cacheRoot = path.join(root, 'tests', '.cache', 'triage-records');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

function runJson(label, args, options = {}) {
  const result = spawnSync(process.execPath, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    console.error(result.stderr || result.stdout || '');
    process.exit(result.status ?? 1);
  }
  try {
    return JSON.parse(result.stdout || '{}');
  } catch (error) {
    console.error(`Failed to parse JSON output for ${label}: ${error?.message || error}`);
    process.exit(1);
  }
}

function run(label, args, options = {}) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

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

runJson('ingest-dependabot', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'dependabot',
  '--in', path.join(triageFixtureRoot, 'dependabot.json'),
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env });

runJson('ingest-inspector', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'aws_inspector',
  '--in', path.join(triageFixtureRoot, 'inspector.json'),
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env });

runJson('decision', [
  path.join(root, 'tools', 'triage', 'decision.js'),
  '--repo', repoRoot,
  '--finding', findingId,
  '--status', 'accept',
  '--justification', 'Fixture decision for tests',
  '--reviewer', 'qa@example.com'
], { env });

run('build-index', [
  path.join(root, 'build_index.js'),
  '--stub-embeddings'
], { cwd: repoRoot, env });

run('build-records-index', [
  path.join(root, 'build_index.js'),
  '--mode', 'records',
  '--stub-embeddings'
], { cwd: repoRoot, env });

const recordSearch = runJson('search-records', [
  path.join(root, 'search.js'),
  'CVE-2024-0001',
  '--mode', 'records',
  '--meta', 'service=api',
  '--meta', 'env=prod',
  '--json',
  '--no-ann'
], { cwd: repoRoot, env });

if (!Array.isArray(recordSearch.records) || recordSearch.records.length === 0) {
  console.error('Record search returned no results.');
  process.exit(1);
}

const firstRecord = recordSearch.records[0];
if (!firstRecord.docmeta?.record?.service || firstRecord.docmeta.record.service !== 'api') {
  console.error('Record search did not preserve docmeta.record.service.');
  process.exit(1);
}

const contextOut = path.join(cacheRoot, 'context-pack.json');
runJson('context-pack', [
  path.join(root, 'tools', 'triage', 'context-pack.js'),
  '--record', findingId,
  '--repo', repoRoot,
  '--out', contextOut,
  '--stub-embeddings',
  '--no-ann'
], { cwd: repoRoot, env });

if (!fs.existsSync(contextOut)) {
  console.error('Context pack output was not written.');
  process.exit(1);
}

const pack = JSON.parse(await fsPromises.readFile(contextOut, 'utf8'));
if (!pack.recordId || !pack.finding || !pack.repoEvidence) {
  console.error('Context pack missing required fields.');
  process.exit(1);
}
if (!pack.finding.exposure || pack.finding.exposure.internetExposed !== true) {
  console.error('Context pack did not include exposure metadata.');
  process.exit(1);
}
if (!Array.isArray(pack.history) || pack.history.length === 0) {
  console.error('Context pack missing history records.');
  process.exit(1);
}
if (!Array.isArray(pack.repoEvidence.queries) || pack.repoEvidence.queries.length === 0) {
  console.error('Context pack missing evidence queries.');
  process.exit(1);
}
const importQuery = pack.repoEvidence.queries.some((entry) => entry.query === 'add-helper');
if (!importQuery) {
  console.error('Context pack evidence queries did not include import name.');
  process.exit(1);
}
const totalEvidenceHits = pack.repoEvidence.queries.reduce((sum, entry) => sum + (entry.hits?.length || 0), 0);
if (totalEvidenceHits === 0) {
  console.error('Context pack contains no evidence hits.');
  process.exit(1);
}

console.log('Triage records test complete.');
