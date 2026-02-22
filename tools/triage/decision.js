#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { getTriageConfig, resolveRepoConfig } from '../shared/dict-utils.js';
import { buildRecordId } from '../../src/integrations/triage/record-utils.js';
import { applyRoutingMeta } from '../../src/integrations/triage/normalize/helpers.js';
import { renderRecordMarkdown } from '../../src/integrations/triage/render.js';
import { parseMetaArgs } from '../shared/input-parsers.js';

const argv = createCli({
  scriptName: 'triage-decision',
  options: {
    repo: { type: 'string' },
    finding: { type: 'string' },
    record: { type: 'string' },
    status: { type: 'string' },
    justification: { type: 'string' },
    reviewer: { type: 'string' },
    expires: { type: 'string' },
    meta: { type: 'string', array: true },
    code: { type: 'string', array: true },
    evidence: { type: 'string', array: true }
  },
  aliases: { r: 'repo' }
}).parse();

const { repoRoot, userConfig } = resolveRepoConfig(argv.repo);
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

const meta = parseMetaArgs(argv.meta);
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

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [String(value)];
}
