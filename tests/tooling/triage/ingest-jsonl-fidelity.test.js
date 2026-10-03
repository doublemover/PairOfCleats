#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getTriageContext, runJson } from '../../helpers/triage.js';

const { root, repoRoot, cacheRoot, env } = await getTriageContext({
  name: 'triage-ingest-jsonl-fidelity'
});

const inputPath = path.join(cacheRoot, 'mixed.jsonl');
await fsPromises.writeFile(inputPath, [
  JSON.stringify({
    source: 'generic',
    recordType: 'finding',
    stableKey: 'jsonl-stable-1',
    title: 'valid stable record'
  }),
  '{"source":"generic","recordType":"finding","title":"broken"',
  JSON.stringify({
    source: 'generic',
    recordType: 'finding',
    title: 'fallback hash record'
  })
].join('\n'));

const result = runJson('ingest-jsonl-fidelity', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', inputPath,
  '--repo', repoRoot
], { env });

if (result.written !== 2 || result.errors !== 0) {
  console.error(`Expected 2 written records and 0 ingest errors; got written=${result.written} errors=${result.errors}`);
  process.exit(1);
}
if (result.ingestAudit?.policy !== 'permissive' || result.ingestAudit?.inputFormat !== 'jsonl') {
  console.error('Expected permissive JSONL ingest audit.');
  process.exit(1);
}
if (result.ingestAudit?.totalRecordsSeen !== 3 || result.ingestAudit?.parsedRecords !== 2) {
  console.error('Unexpected JSONL audit totals.');
  process.exit(1);
}
if (result.ingestAudit?.malformedRecords !== 1 || result.ingestAudit?.skippedRecords !== 1) {
  console.error('Expected one malformed/skipped JSONL record.');
  process.exit(1);
}
if (result.ingestAudit?.fallbackIdCount !== 1 || result.ingestAudit?.stableIdCount !== 1) {
  console.error('Expected one fallback ID and one stable ID in ingest audit.');
  process.exit(1);
}
if (result.ingestAudit?.idStability !== 'mixed-lower-trust') {
  console.error(`Expected mixed-lower-trust idStability; got ${result.ingestAudit?.idStability}`);
  process.exit(1);
}
if (!Array.isArray(result.ingestAudit?.malformedLineDiagnostics) || result.ingestAudit.malformedLineDiagnostics.length !== 1) {
  console.error('Expected one malformed line diagnostic.');
  process.exit(1);
}
if (result.ingestAudit.malformedLineDiagnostics[0]?.lineNumber !== 2) {
  console.error('Expected malformed JSONL line diagnostic for line 2.');
  process.exit(1);
}

const provenanceMethods = new Set(result.records.map((entry) => entry?.idProvenance?.method));
if (!provenanceMethods.has('stable-key') || !provenanceMethods.has('fallback-hash')) {
  console.error('Expected both stable-key and fallback-hash record provenance.');
  process.exit(1);
}

console.log('Triage ingest JSONL fidelity ok.');
