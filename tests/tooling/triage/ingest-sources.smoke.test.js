#!/usr/bin/env node
import path from 'node:path';
import { getTriageContext, runJson } from '../../helpers/triage.js';

const { root, repoRoot, triageFixtureRoot, env } = await getTriageContext({
  name: 'triage-ingest-sources'
});

const dependabot = runJson('ingest-dependabot', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'dependabot',
  '--in', path.join(triageFixtureRoot, 'dependabot.json'),
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env });

if (!Array.isArray(dependabot.recordIds) || dependabot.recordIds.length === 0) {
  console.error('Dependabot ingest produced no records.');
  process.exit(1);
}

const inspector = runJson('ingest-inspector', [
  path.join(root, 'tools', 'triage', 'ingest.js'),
  '--source', 'aws_inspector',
  '--in', path.join(triageFixtureRoot, 'inspector.json'),
  '--repo', repoRoot,
  '--meta', 'service=api',
  '--meta', 'env=prod'
], { env });

if (!Array.isArray(inspector.recordIds) || inspector.recordIds.length === 0) {
  console.error('Inspector ingest produced no records.');
  process.exit(1);
}

console.log('Triage ingest sources ok.');
