#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { repoRoot } from '../../helpers/root.js';

const root = repoRoot();
const ledgerPath = path.join(root, 'docs', 'tooling', 'shared-module-ledger.json');

const fail = (message) => {
  console.error(`shared module ledger policy failed: ${message}`);
  process.exit(1);
};

const expectArray = (value, label) => {
  if (!Array.isArray(value)) fail(`${label} is not an array`);
};

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(ledgerPath, 'utf8'));
} catch (error) {
  fail(error?.message || String(error));
}

if (payload?.schemaVersion !== '1.0.0') fail('schemaVersion mismatch');
if (typeof payload?.generatedAt !== 'string') fail('generatedAt missing');
if (!payload?.census || typeof payload.census !== 'object') fail('census missing');
if (!payload?.consumerMap || typeof payload.consumerMap !== 'object') fail('consumerMap missing');
if (!payload?.reviewLedger || typeof payload.reviewLedger !== 'object') fail('reviewLedger missing');
if (!payload?.scanLedger || typeof payload.scanLedger !== 'object') fail('scanLedger missing');
if (!payload?.gaps || typeof payload.gaps !== 'object') fail('gaps missing');

expectArray(payload.census.sharedFiles, 'census.sharedFiles');
expectArray(payload.reviewLedger.issues, 'reviewLedger.issues');
expectArray(payload.scanLedger?.h31?.issues, 'scanLedger.h31.issues');
expectArray(payload.scanLedger?.h32?.issues, 'scanLedger.h32.issues');
expectArray(payload.gaps.unownedSharedFiles, 'gaps.unownedSharedFiles');
expectArray(payload.gaps.unscannedH31Files, 'gaps.unscannedH31Files');
expectArray(payload.gaps.emptyH31Scopes, 'gaps.emptyH31Scopes');
expectArray(payload.gaps.emptyH32Scopes, 'gaps.emptyH32Scopes');

if (payload.gaps.unownedSharedFiles.length) {
  fail(`unowned shared files remain: ${payload.gaps.unownedSharedFiles.join(', ')}`);
}
if (payload.gaps.unscannedH31Files.length) {
  fail(`unscanned H31 files remain: ${payload.gaps.unscannedH31Files.slice(0, 10).join(', ')}`);
}
if (payload.gaps.emptyH31Scopes.length) {
  fail(`empty H31 scopes remain: ${payload.gaps.emptyH31Scopes.map((entry) => entry.issueId).join(', ')}`);
}
if (payload.gaps.emptyH32Scopes.length) {
  fail(`empty H32 scopes remain: ${payload.gaps.emptyH32Scopes.map((entry) => entry.issueId).join(', ')}`);
}

const censusPaths = new Set(payload.census.sharedFiles.map((entry) => entry.path));
for (const issue of payload.reviewLedger.issues) {
  expectArray(issue.files, `reviewLedger.issues[#${issue.issueId}].files`);
  for (const file of issue.files) {
    if (!censusPaths.has(file)) {
      fail(`review ledger file missing from census: ${file}`);
    }
  }
}

console.log('shared module ledger policy test passed');
