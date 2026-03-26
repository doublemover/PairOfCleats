#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonFile, readJsonFile } from '../../src/shared/json-file.js';
import { createJsonGateHarness } from '../helpers/json-gate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tempRoot = path.join(ROOT, '.testLogs', `tooling-doctor-gate-scope-${process.pid}-${Date.now()}`);
const repoRoot = path.join(tempRoot, 'repo');

await fs.mkdir(repoRoot, { recursive: true });
await writeJsonFile(
  path.join(repoRoot, '.pairofcleats.json'),
  { tooling: { enabledTools: ['typescript', 'clangd'] } }
);
const harness = await createJsonGateHarness({
  rootDir: ROOT,
  scriptRelativePath: path.join('tools', 'ci', 'tooling-doctor-gate.js'),
  tempRoot,
  jsonFileName: 'tooling-doctor-gate.json'
});

const result = harness.run(
  ['--mode', 'ci', '--repo', repoRoot, '--require-provider', 'typescript'],
  { label: 'tooling doctor gate require-provider scope test' }
);
if (result.status !== 0) process.exit(result.status ?? 1);

const gatePayload = await harness.readPayload().catch(() => {
  console.error('tooling doctor gate scope payload invalid');
  process.exit(1);
});

const report = await readJsonFile(gatePayload.reportPath).catch(() => {
  console.error('tooling doctor report missing for scoped gate');
  process.exit(1);
});

const providerIds = new Set((Array.isArray(report.providers) ? report.providers : [])
  .map((provider) => String(provider?.id || '').trim())
  .filter(Boolean));

if (!providerIds.has('typescript')) {
  console.error('expected scoped tooling doctor report to include typescript');
  process.exit(1);
}
if (providerIds.has('clangd')) {
  console.error('expected scoped tooling doctor report to omit clangd');
  process.exit(1);
}

console.log('tooling doctor gate require-provider scope test passed');
await harness.cleanup();
