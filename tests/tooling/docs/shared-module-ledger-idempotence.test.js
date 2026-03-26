#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildSharedModuleLedger } from '../../../tools/docs/shared-module-ledger.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'shared-module-ledger-idempotence');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const outputJsonPath = path.join(tempRoot, 'shared-module-ledger.json');
const outputMdPath = path.join(tempRoot, 'shared-module-ledger.md');

const normalizeGeneratedPayload = (payload) => ({
  ...payload,
  generatedAt: null
});

const writeLedgerOutputs = async ({ report, markdown }) => {
  let existingPayload = null;
  let existingJsonText = null;
  try {
    existingJsonText = await fs.readFile(outputJsonPath, 'utf8');
    existingPayload = JSON.parse(existingJsonText);
  } catch {}

  const nextReport = typeof existingPayload?.generatedAt === 'string'
    && JSON.stringify(normalizeGeneratedPayload(existingPayload)) === JSON.stringify(normalizeGeneratedPayload(report))
    ? { ...report, generatedAt: existingPayload.generatedAt }
    : report;
  const nextJsonText = `${JSON.stringify(nextReport, null, 2)}\n`;
  if (existingJsonText !== nextJsonText) {
    await fs.writeFile(outputJsonPath, nextJsonText, 'utf8');
  }

  let existingMarkdown = null;
  try {
    existingMarkdown = await fs.readFile(outputMdPath, 'utf8');
  } catch {}
  if (existingMarkdown !== markdown) {
    await fs.writeFile(outputMdPath, markdown, 'utf8');
  }
};

await writeLedgerOutputs(await buildSharedModuleLedger(root));

const firstJsonText = await fs.readFile(outputJsonPath, 'utf8');
const firstMdText = await fs.readFile(outputMdPath, 'utf8');
const firstJson = JSON.parse(firstJsonText);

await new Promise((resolve) => setTimeout(resolve, 20));

await writeLedgerOutputs(await buildSharedModuleLedger(root));

const secondJsonText = await fs.readFile(outputJsonPath, 'utf8');
const secondMdText = await fs.readFile(outputMdPath, 'utf8');
const secondJson = JSON.parse(secondJsonText);

assert.equal(secondJson.generatedAt, firstJson.generatedAt, 'expected generatedAt to be preserved when shared module ledger content is unchanged');
assert.equal(secondJsonText, firstJsonText, 'expected shared module ledger json output to be byte-stable across identical reruns');
assert.equal(secondMdText, firstMdText, 'expected shared module ledger markdown output to be byte-stable across identical reruns');

console.log('shared module ledger idempotence test passed');
