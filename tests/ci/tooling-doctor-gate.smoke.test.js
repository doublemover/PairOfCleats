#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeJsonFile } from '../../src/shared/json-file.js';
import { createJsonGateHarness } from '../helpers/json-gate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const harness = await createJsonGateHarness({
  rootDir: ROOT,
  scriptRelativePath: path.join('tools', 'ci', 'tooling-doctor-gate.js'),
  tempPrefix: 'pairofcleats-tooling-doctor-gate-',
  jsonFileName: 'tooling-doctor-gate.json'
});
const { tempRoot } = harness;
const repoRoot = path.join(tempRoot, 'repo');
await fsPromises.mkdir(repoRoot, { recursive: true });
await writeJsonFile(
  path.join(repoRoot, '.pairofcleats.json'),
  { tooling: { enabledTools: ['typescript'] } }
);
const result = harness.run(['--mode', 'ci', '--repo', repoRoot], { label: 'tooling doctor gate smoke test' });
if (result.status !== 0) process.exit(result.status ?? 1);

const payload = await harness.readPayload().catch(() => {
  console.error('tooling doctor gate did not emit valid JSON');
  process.exit(1);
});

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
await harness.cleanup();
