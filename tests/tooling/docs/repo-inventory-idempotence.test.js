#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { buildRepoInventory } from '../../../tools/docs/repo-inventory.js';
import { normalizeGeneratedPayload, writeStableGeneratedJsonReport } from '../../../tools/shared/generated-report.js';
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

// A clean clone and a checkout with optional cached reports must describe the
// same source inventory, even when cached Markdown contains stale references.
const fixtureRoot = path.join(tempRoot, 'source-only-fixture');
for (const dir of ['docs/tooling', 'docs/testing', 'tools', '.github', 'tests']) {
  await fs.mkdir(path.join(fixtureRoot, dir), { recursive: true });
}
await fs.writeFile(path.join(fixtureRoot, 'package.json'), JSON.stringify({
  scripts: { authored: 'node authored.js', 'cache-only': 'node cache-only.js' }
}));
await fs.writeFile(path.join(fixtureRoot, 'README.md'), 'See docs/tooling/repo-inventory.md\n');
await fs.writeFile(path.join(fixtureRoot, 'docs/tooling/repo-inventory.md'), '# Authored guide\nRun npm run authored\n');
await fs.writeFile(path.join(fixtureRoot, 'docs/testing/orphan.md'), '# Authored unreferenced doc\n');

const baseline = normalizeGeneratedPayload(await buildRepoInventory(fixtureRoot));
assert.deepEqual(baseline.docs.files, ['docs/testing/orphan.md', 'docs/tooling/repo-inventory.md']);
assert.deepEqual(baseline.docs.orphans, ['docs/testing/orphan.md']);
assert.deepEqual(baseline.scripts.referencedByDocs, ['authored']);

const registry = JSON.parse(await fs.readFile(path.join(root, 'docs/tooling/generated-surfaces.json'), 'utf8'));
const localOutputs = registry.surfaces
  .filter((surface) => surface.committed === false)
  .flatMap((surface) => surface.outputs);
for (const contents of [
  'Stale report: npm run cache-only; docs/testing/orphan.md\n',
  'Changed report: npm run different-cache-only; docs/tooling/repo-inventory.md\n'
]) {
  for (const output of localOutputs) {
    await fs.writeFile(path.join(fixtureRoot, output), contents);
  }
  assert.deepEqual(
    normalizeGeneratedPayload(await buildRepoInventory(fixtureRoot)),
    baseline,
    'local report presence or content must not affect docs, references, or script inventory'
  );
}

console.log('repo inventory idempotence test passed');
