#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext, runJson } from '../../helpers/triage.js';

const { root, repoRoot, cacheRoot, env } = await getTriageContext({
  name: 'triage-ingest-recordid-path-safety'
});

const payloadPath = path.join(cacheRoot, 'malicious-record-id.json');
await fsPromises.writeFile(payloadPath, JSON.stringify([
  {
    source: 'generic',
    recordType: 'finding',
    recordId: '../escape-record',
    title: 'malicious record id test'
  }
], null, 2));

const result = runJson('ingest-generic-malicious-record-id', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', payloadPath,
  '--repo', repoRoot
], { env });

if (result.written !== 0 || result.errors !== 1) {
  console.error(`Expected ingest to reject invalid recordId (written=0, errors=1); got written=${result.written} errors=${result.errors}`);
  process.exit(1);
}
if (!Array.isArray(result.errorDetails) || result.errorDetails.length !== 1) {
  console.error('Expected one ingest error detail for invalid recordId path.');
  process.exit(1);
}

const escapedJson = path.resolve(result.recordsDir, '..', 'escape-record.json');
const escapedMd = path.resolve(result.recordsDir, '..', 'escape-record.md');
if (fs.existsSync(escapedJson) || fs.existsSync(escapedMd)) {
  console.error('Ingest wrote escaped record artifacts outside recordsDir.');
  process.exit(1);
}

console.log('Triage ingest recordId path safety ok.');
