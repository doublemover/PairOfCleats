#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import minimist from 'minimist';
import { getTriageConfig, loadUserConfig } from '../dict-utils.js';
import { buildRecordId } from '../../src/triage/record-utils.js';
import { applyRoutingMeta } from '../../src/triage/normalize/helpers.js';
import { renderRecordMarkdown } from '../../src/triage/render.js';

const argv = minimist(process.argv.slice(2), {
  string: ['repo', 'finding', 'status', 'justification', 'reviewer', 'expires', 'meta', 'code', 'evidence'],
  alias: { r: 'repo' }
});

const repoRoot = argv.repo ? path.resolve(argv.repo) : process.cwd();
const findingId = argv.finding || argv.record;
const status = argv.status ? String(argv.status).toLowerCase() : '';

if (!findingId || !status) {
  console.error('usage: node tools/triage/decision.js --finding <recordId> --status fix|accept|defer|false_positive|not_affected [--justification "..."]');
  process.exit(1);
}

const allowedStatuses = new Set(['fix', 'accept', 'defer', 'false_positive', 'not_affected']);
if (!allowedStatuses.has(status)) {
  console.error(`Invalid status: ${status}`);
  process.exit(1);
}

const userConfig = loadUserConfig(repoRoot);
const triageConfig = getTriageConfig(repoRoot, userConfig);
const findingPath = path.join(triageConfig.recordsDir, `${findingId}.json`);

let finding;
try {
  const raw = await fsPromises.readFile(findingPath, 'utf8');
  finding = JSON.parse(raw);
} catch {
  console.error(`Finding record not found: ${findingPath}`);
  process.exit(1);
}

const meta = parseMeta(argv.meta);
const createdAt = new Date().toISOString();

const decisionRecord = {
  recordType: 'decision',
  source: 'manual',
  createdAt,
  updatedAt: createdAt,
  service: finding.service || null,
  env: finding.env || null,
  team: finding.team || null,
  owner: finding.owner || null,
  repo: finding.repo || repoRoot,
  vuln: finding.vuln || null,
  package: finding.package || null,
  asset: finding.asset || null,
  decision: {
    findingRecordId: finding.recordId || findingId,
    status,
    justification: argv.justification || '',
    justificationCodes: toArray(argv.code),
    reviewer: argv.reviewer || null,
    expiresAt: argv.expires || null,
    evidenceRefs: toArray(argv.evidence)
  }
};

applyRoutingMeta(decisionRecord, meta, repoRoot);

const stableKey = `${decisionRecord.decision.findingRecordId}:${status}:${createdAt}`;
decisionRecord.recordId = buildRecordId(decisionRecord.source, stableKey);

const jsonPath = path.join(triageConfig.recordsDir, `${decisionRecord.recordId}.json`);
const mdPath = path.join(triageConfig.recordsDir, `${decisionRecord.recordId}.md`);
await fsPromises.mkdir(triageConfig.recordsDir, { recursive: true });
await fsPromises.writeFile(jsonPath, JSON.stringify(decisionRecord, null, 2));
await fsPromises.writeFile(mdPath, renderRecordMarkdown(decisionRecord));

console.log(JSON.stringify({
  recordId: decisionRecord.recordId,
  findingId: decisionRecord.decision.findingRecordId,
  status,
  recordsDir: triageConfig.recordsDir,
  jsonPath,
  mdPath
}, null, 2));

function parseMeta(metaArg) {
  const entries = Array.isArray(metaArg) ? metaArg : (metaArg ? [metaArg] : []);
  const meta = {};
  for (const entry of entries) {
    const [rawKey, ...rest] = String(entry).split('=');
    const key = rawKey.trim();
    if (!key) continue;
    meta[key] = rest.join('=').trim();
  }
  return meta;
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [String(value)];
}
