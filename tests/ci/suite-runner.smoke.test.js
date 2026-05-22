#!/usr/bin/env node
import { getCombinedOutput } from '../helpers/stdio.js';
import { runNode } from '../helpers/run-node.js';
import { applyTestEnv } from '../helpers/test-env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(ROOT, 'tools', 'ci', 'run-suite.js');
const env = applyTestEnv({ syncProcess: false });

const runDrySuite = (mode) => {
  const result = runNode(
    [runnerPath, '--mode', mode, '--dry-run'],
    `suite runner dry-run mode=${mode}`,
    ROOT,
    env,
    { stdio: 'pipe' }
  );
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
  /--report-file/,
  /--timings-file/,
  /--stability-file/,
  /--profile/,
  /--coverage/,
  /tools[\\/]ci[\\/]capability-gate\.js --mode ci/,
  /tools[\\/]ci[\\/]tooling-doctor-gate\.js --mode ci/,
  /tools[\\/]ci[\\/]tooling-lsp-slo-gate\.js --mode ci --doctor/,
  /tools[\\/]ci[\\/]tooling-lsp-replay-gate\.js --json/,
  /tools[\\/]ci[\\/]tooling-lsp-default-enable-gate\.js/,
  /tools[\\/]ci[\\/]import-resolution-slo-gate\.js --mode ci/,
  /tools[\\/]ci[\\/]coverage-policy-report\.js --root/,
  /tools[\\/]bench[\\/]language[\\/]tooling-lsp-guardrail\.js --report/
], 'ci');

const nightlyOutput = runDrySuite('nightly');
assertRequired(nightlyOutput, [
  /tests[\\/]run\.js --lane ci --exclude services[\\/]api[\\/] --lane storage --lane perf/,
  /--report-file/,
  /--timings-file/,
  /--stability-file/,
  /--profile/,
  /--coverage/,
  /tools[\\/]ci[\\/]coverage-policy-report\.js --root/,
  /tools[\\/]bench[\\/]bench-runner\.js --suite sweet16-ci/
], 'nightly');

console.log('suite runner smoke test passed');
