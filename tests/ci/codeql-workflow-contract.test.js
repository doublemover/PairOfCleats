#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

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
  /uses:\s*github\/codeql-action\/autobuild@v4/,
  /category:\s*['"]?\/language:\$\{\{\s*matrix\.language\s*\}\}['"]?/
];

for (const pattern of requiredPatterns) {
  if (!pattern.test(workflow)) {
    console.error(`CodeQL workflow contract failed: missing ${pattern}`);
    process.exit(1);
  }
}

console.log('codeql workflow contract test passed');
