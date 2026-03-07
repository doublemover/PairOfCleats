#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-doctor-gate.js');
const tempRoot = path.join(ROOT, '.testLogs', `tooling-doctor-gate-scope-${process.pid}-${Date.now()}`);
const repoRoot = path.join(tempRoot, 'repo');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  `${JSON.stringify({ tooling: { enabledTools: ['typescript', 'clangd'] } }, null, 2)}\n`,
  'utf8'
);
const jsonPath = path.join(tempRoot, 'tooling-doctor-gate.json');

const result = spawnSync(
  process.execPath,
  [
    gatePath,
    '--mode', 'ci',
    '--repo', repoRoot,
    '--json', jsonPath,
    '--require-provider', 'typescript'
  ],
  { encoding: 'utf8' }
);

if (result.status !== 0) {
  console.error('tooling doctor gate require-provider scope test failed');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let gatePayload;
try {
  gatePayload = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
} catch {
  console.error('tooling doctor gate scope payload invalid');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(await fs.readFile(gatePayload.reportPath, 'utf8'));
} catch {
  console.error('tooling doctor report missing for scoped gate');
  process.exit(1);
}

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
