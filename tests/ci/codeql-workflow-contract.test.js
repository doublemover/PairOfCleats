#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';

ensureTestingEnv(process.env);

const root = process.cwd();
const workflowPath = path.join(root, '.github', 'workflows', 'codeql.yml');

if (!fs.existsSync(workflowPath)) {
  console.error(`Missing workflow: ${workflowPath}`);
  process.exit(1);
}

const workflow = fs.readFileSync(workflowPath, 'utf8');
const toolchainPath = path.join(root, 'crates', 'pairofcleats-tui', 'rust-toolchain.toml');
const pinnedToolchain = fs.readFileSync(toolchainPath, 'utf8').match(/channel\s*=\s*"(\d+\.\d+\.\d+)"/)?.[1];
if (!pinnedToolchain) throw new Error(`Missing exact Rust toolchain in ${toolchainPath}`);
const requiredPatterns = [
  /- language:\s*javascript/,
  /- language:\s*rust/,
  /build-mode:\s*\$\{\{\s*matrix\.build-mode\s*\}\}/,
  new RegExp(`toolchain:\\s*${pinnedToolchain.replace(/\./g, '\\.')}\\b`),
  /uses:\s*dtolnay\/rust-toolchain@stable/,
  /category:\s*['"]?\/language:\$\{\{\s*matrix\.language\s*\}\}['"]?/
];

for (const pattern of requiredPatterns) {
  if (!pattern.test(workflow)) {
    console.error(`CodeQL workflow contract failed: missing ${pattern}`);
    process.exit(1);
  }
}

const assertSupportedAnalysis = (config) => {
  assert.deepEqual(config.permissions, { actions: 'read', contents: 'read', 'security-events': 'write' });
  const analysis = config.jobs.analyze;
  assert.deepEqual(analysis.strategy.matrix.include, [
    { language: 'javascript', 'build-mode': 'none' },
    { language: 'rust', 'build-mode': 'none' }
  ], 'both languages must retain supported no-build analysis');
  assert.equal(analysis.steps.some((step) => step.uses?.startsWith('github/codeql-action/autobuild@')), false,
    'Rust CodeQL does not support autobuild');
  const rustSetup = analysis.steps.find((step) => step.uses === 'dtolnay/rust-toolchain@stable');
  assert.equal(rustSetup?.with?.toolchain, pinnedToolchain, 'Rust extraction must use the exact repository toolchain');
  assert.ok(analysis.steps.some((step) => step.uses === 'github/codeql-action/analyze@v4'),
    'the language matrix must still run analysis');
};

const parsedWorkflow = parse(workflow);
assertSupportedAnalysis(parsedWorkflow);
for (const mutate of [
  (config) => { config.jobs.analyze.strategy.matrix.include[1]['build-mode'] = 'autobuild'; },
  (config) => { config.jobs.analyze.strategy.matrix.include.pop(); },
  (config) => { config.jobs.analyze.steps.push({ uses: 'github/codeql-action/autobuild@v4' }); },
  (config) => { config.permissions.actions = 'write'; },
  (config) => {
    config.jobs.analyze.steps.find((step) => step.uses === 'dtolnay/rust-toolchain@stable').with.toolchain += '1';
  }
]) {
  const invalidWorkflow = structuredClone(parsedWorkflow);
  mutate(invalidWorkflow);
  assert.throws(() => assertSupportedAnalysis(invalidWorkflow));
}

console.log('codeql workflow contract test passed');
