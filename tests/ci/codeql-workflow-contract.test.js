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
const requiredPatterns = [
  /- language:\s*javascript/,
  /- language:\s*rust/,
  /build-mode:\s*\$\{\{\s*matrix\.build-mode\s*\}\}/,
  /toolchain:\s*1\.83\.0/,
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
