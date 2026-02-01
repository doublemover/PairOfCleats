#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext, run, runJson } from '../../helpers/triage.js';

const { root, repoRoot, triageFixtureRoot, env, cacheRoot, writeTestLog } = await getTriageContext({
  name: 'triage-context-pack'
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

runJson('decision', [
  path.join(root, 'tools', 'triage', 'decision.js'),
  '--finding', findingId,
  '--status', 'accept',
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env });

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
await writeTestLog('triage-context-pack.json', pack);
await writeTestLog('triage-context-pack-evidence.json', pack.repoEvidence || {});
await writeTestLog('triage-context-pack-history.json', { history: pack.history || [] });

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

console.log('Triage context pack ok.');
