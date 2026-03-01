#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../helpers/stdio.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tools', 'ci', 'run-suite.js');

const runDrySuite = (mode) => {
  const result = spawnSync(process.execPath, [runnerPath, '--mode', mode, '--dry-run'], {
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.error(`suite runner dry-run failed for mode=${mode}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return getCombinedOutput(result);
};

const assertRequired = (output, required, mode) => {
  const missing = required.filter((regex) => !regex.test(output));
  if (!missing.length) return;
  console.error(`suite runner dry-run missing expected steps for mode=${mode}`);
  for (const regex of missing) {
    console.error(`Missing: ${regex}`);
  }
  process.exit(1);
};

const ciOutput = runDrySuite('ci');
assertRequired(ciOutput, [
  /npm(?:\.cmd)? run lint/,
  /npm(?:\.cmd)? run config:budget/,
  /npm(?:\.cmd)? run env:check/,
  /tests[\\/]run\.js --lane ci-lite/,
  /tools[\\/]ci[\\/]capability-gate\.js --mode ci/,
  /tools[\\/]ci[\\/]tooling-doctor-gate\.js --mode ci/,
  /tools[\\/]ci[\\/]tooling-lsp-slo-gate\.js --mode ci --doctor/,
  /tools[\\/]ci[\\/]tooling-lsp-default-enable-gate\.js/,
  /tools[\\/]ci[\\/]import-resolution-slo-gate\.js --mode ci/,
  /tools[\\/]bench[\\/]language[\\/]tooling-lsp-guardrail\.js --report/
], 'ci');

const nightlyOutput = runDrySuite('nightly');
assertRequired(nightlyOutput, [
  /tests[\\/]run\.js --lane ci --exclude services[\\/]api[\\/] --lane storage --lane perf/,
  /tools[\\/]bench[\\/]bench-runner\.js --suite sweet16-ci/
], 'nightly');

console.log('suite runner smoke test passed');
