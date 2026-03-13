#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const gatePath = path.join(ROOT, 'tools', 'ci', 'tooling-doctor-gate.js');

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-tooling-doctor-gate-'));
const repoRoot = path.join(tempRoot, 'repo');
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  `${JSON.stringify({ tooling: { enabledTools: ['typescript'] } }, null, 2)}\n`,
  'utf8'
);
const jsonPath = path.join(tempRoot, 'tooling-doctor-gate.json');

const result = spawnSync(process.execPath, [gatePath, '--mode', 'ci', '--repo', repoRoot, '--json', jsonPath], {
  encoding: 'utf8'
});

if (result.status !== 0) {
  console.error('tooling doctor gate smoke test failed');
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(await fsPromises.readFile(jsonPath, 'utf8'));
} catch {
  console.error('tooling doctor gate did not emit valid JSON');
  process.exit(1);
}

if (payload.status !== 'ok') {
  console.error(`expected tooling doctor gate status=ok, received ${String(payload.status)}`);
  process.exit(1);
}
if (typeof payload.reportPath !== 'string' || !payload.reportPath.endsWith('tooling_doctor_report.json')) {
  console.error('tooling doctor gate payload missing reportPath');
  process.exit(1);
}
if (!Array.isArray(payload.failures) || payload.failures.length !== 0) {
  console.error('expected zero tooling doctor gate failures');
  process.exit(1);
}

let report;
try {
  report = JSON.parse(await fsPromises.readFile(payload.reportPath, 'utf8'));
} catch {
  console.error('tooling doctor report missing or invalid');
  process.exit(1);
}

if (report.schemaVersion !== 2) {
  console.error(`expected schemaVersion=2, received ${String(report.schemaVersion)}`);
  process.exit(1);
}
if (report.reportFile !== 'tooling_doctor_report.json') {
  console.error(`expected reportFile=tooling_doctor_report.json, received ${String(report.reportFile)}`);
  process.exit(1);
}

console.log('tooling doctor gate smoke test passed');
