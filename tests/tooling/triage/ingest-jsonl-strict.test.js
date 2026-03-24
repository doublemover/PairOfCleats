#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getTriageContext } from '../../helpers/triage.js';

const { root, repoRoot, cacheRoot, env } = await getTriageContext({
  name: 'triage-ingest-jsonl-strict'
});

const inputPath = path.join(cacheRoot, 'mixed-strict.jsonl');
await fsPromises.writeFile(inputPath, [
  JSON.stringify({
    source: 'generic',
    recordType: 'finding',
    stableKey: 'jsonl-strict-1',
    title: 'valid stable record'
  }),
  '{"source":"generic","recordType":"finding","title":"broken"',
  JSON.stringify({
    source: 'generic',
    recordType: 'finding',
    title: 'fallback hash record'
  })
].join('\n'));

const result = spawnSync(process.execPath, [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', inputPath,
  '--repo', repoRoot,
  '--strict'
], {
  encoding: 'utf8',
  env
});

if (result.status === 0) {
  console.error('Expected strict ingest to fail on malformed JSONL input.');
  process.exit(1);
}

let payload = null;
try {
  payload = JSON.parse(result.stderr || '{}');
} catch (error) {
  console.error(`Failed to parse strict-ingest error payload: ${error?.message || error}`);
  process.exit(1);
}

if (payload?.code !== 'ERR_TRIAGE_INGEST_STRICT_INPUT') {
  console.error(`Expected strict ingest error code ERR_TRIAGE_INGEST_STRICT_INPUT; got ${payload?.code}`);
  process.exit(1);
}
if (payload?.ingestAudit?.policy !== 'strict' || payload?.ingestAudit?.inputFormat !== 'jsonl') {
  console.error('Expected strict JSONL ingest audit in error payload.');
  process.exit(1);
}
if (payload?.ingestAudit?.malformedRecords !== 1 || payload?.ingestAudit?.skippedRecords !== 1) {
  console.error('Expected one malformed/skipped JSONL record in strict audit.');
  process.exit(1);
}
if (!Array.isArray(payload?.ingestAudit?.malformedLineDiagnostics) || payload.ingestAudit.malformedLineDiagnostics[0]?.lineNumber !== 2) {
  console.error('Expected strict ingest error payload to include malformed line 2 diagnostics.');
  process.exit(1);
}

console.log('Triage ingest strict JSONL ok.');
