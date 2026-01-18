#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { getTriageContext, runJson } from '../../helpers/triage.js';

const { root, repoRoot, triageFixtureRoot, env } = await getTriageContext({
  name: 'triage-decision'
});

const ingestGeneric = runJson('ingest-generic', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'generic',
  '--in', path.join(triageFixtureRoot, 'generic.json'),
  '--repo', repoRoot
], { env });

if (!Array.isArray(ingestGeneric.recordIds) || ingestGeneric.recordIds.length === 0) {
  console.error('No records written for generic ingest.');
  process.exit(1);
}
const findingId = ingestGeneric.recordIds[0];

const decision = runJson('decision', [
  path.join(root, 'tools', 'triage', 'decision.js'),
  '--repo', repoRoot,
  '--finding', findingId,
  '--status', 'accept',
  '--justification', 'Fixture decision for tests',
  '--reviewer', 'qa@example.com'
], { env });

if (decision.status !== 'accept') {
  console.error('Decision output missing accept status.');
  process.exit(1);
}
if (!decision.jsonPath || !fs.existsSync(decision.jsonPath)) {
  console.error('Decision JSON output missing on disk.');
  process.exit(1);
}

console.log('Triage decision ok.');
