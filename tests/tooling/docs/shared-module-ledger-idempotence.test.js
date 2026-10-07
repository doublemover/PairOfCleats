#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildSharedModuleLedger } from '../../../tools/docs/shared-module-ledger.js';
import { writeStableGeneratedJsonReport, writeTextIfChanged } from '../../../tools/shared/generated-report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'shared-module-ledger-idempotence');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const outputJsonPath = path.join(tempRoot, 'shared-module-ledger.json');
const outputMdPath = path.join(tempRoot, 'shared-module-ledger.md');

const writeLedgerOutputs = async ({ report, markdown }) => {
  await writeStableGeneratedJsonReport(outputJsonPath, report);
  await writeTextIfChanged(outputMdPath, markdown);
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
