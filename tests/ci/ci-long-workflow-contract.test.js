#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'ci-long.yml');
const runSuitePath = path.join(ROOT, 'tools', 'ci', 'run-suite.js');

if (!fs.existsSync(workflowPath)) {
  console.error(`Missing workflow: ${workflowPath}`);
  process.exit(1);
}
if (!fs.existsSync(runSuitePath)) {
  console.error(`Missing CI runner: ${runSuitePath}`);
  process.exit(1);
}

const workflowText = fs.readFileSync(workflowPath, 'utf8');
const nodeVersionRegex = /node-version:\s*['"]?24\.13\.0['"]?/;
if (!nodeVersionRegex.test(workflowText)) {
  console.error('CI-long workflow does not pin Node 24.13.0');
  process.exit(1);
}
if (!/node\s+tools\/ci\/run-suite\.js/.test(workflowText)) {
  console.error('CI-long workflow does not invoke tools/ci/run-suite.js');
  process.exit(1);
}
if (!/--lane\s+ci-long/.test(workflowText)) {
  console.error('CI-long workflow does not pass --lane ci-long');
  process.exit(1);
}

console.log('ci-long workflow contract test passed');
