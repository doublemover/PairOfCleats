#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildRepoInventory } from '../../../tools/docs/repo-inventory.js';
import { writeStableGeneratedJsonReport } from '../../../tools/shared/generated-report.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'repo-inventory-idempotence');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const outputJsonPath = path.join(tempRoot, 'repo-inventory.json');

await writeStableGeneratedJsonReport(outputJsonPath, await buildRepoInventory(root));

const firstJsonText = await fs.readFile(outputJsonPath, 'utf8');
const firstJson = JSON.parse(firstJsonText);

await new Promise((resolve) => setTimeout(resolve, 20));

await writeStableGeneratedJsonReport(outputJsonPath, await buildRepoInventory(root));

const secondJsonText = await fs.readFile(outputJsonPath, 'utf8');
const secondJson = JSON.parse(secondJsonText);

assert.equal(secondJson.generatedAt, firstJson.generatedAt, 'expected generatedAt to be preserved when repo inventory content is unchanged');
assert.equal(secondJsonText, firstJsonText, 'expected repo inventory output to be byte-stable across identical reruns');

console.log('repo inventory idempotence test passed');
