#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTriageContext, runJson } from '../../helpers/triage.js';

const { root, repoRoot, triageFixtureRoot, env } = await getTriageContext({
  name: 'triage-decision-finding-path-safety'
});

const ingest = runJson('ingest-generic', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', path.join(triageFixtureRoot, 'generic.json'),
  '--repo', repoRoot
], { env });
const recordsDir = ingest.recordsDir;
if (!recordsDir) {
  console.error('Missing recordsDir from ingest output.');
  process.exit(1);
}
await fsPromises.mkdir(recordsDir, { recursive: true });
const escapedFindingPath = path.resolve(recordsDir, '..', 'outside-finding.json');
await fsPromises.writeFile(escapedFindingPath, JSON.stringify({
  recordId: 'outside-finding',
  recordType: 'finding',
  source: 'generic',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
}, null, 2));

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'triage', 'decision.js'),
    '--repo', repoRoot,
    '--finding', '../outside-finding',
    '--status', 'accept'
  ],
  {
    encoding: 'utf8',
    env
  }
);

if (result.status === 0) {
  console.error('Decision accepted a traversal finding id and should have failed.');
  process.exit(1);
}

const output = `${result.stderr || ''}${result.stdout || ''}`;
if (!output.includes('Invalid finding record id')) {
  console.error('Decision path safety failure message missing.');
  process.exit(1);
}

if (!fs.existsSync(escapedFindingPath)) {
  console.error('Escaped finding fixture unexpectedly missing.');
  process.exit(1);
}

console.log('Triage decision finding path safety ok.');
