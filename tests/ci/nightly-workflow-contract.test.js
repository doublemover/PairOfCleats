#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflowPath = path.join(ROOT, '.github', 'workflows', 'nightly.yml');
const packagePath = path.join(ROOT, 'package.json');

if (!fs.existsSync(workflowPath)) {
  console.error(`Missing workflow: ${workflowPath}`);
  process.exit(1);
}
if (!fs.existsSync(packagePath)) {
  console.error(`Missing package.json: ${packagePath}`);
  process.exit(1);
}

const workflowText = fs.readFileSync(workflowPath, 'utf8');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const scripts = pkg.scripts || {};

const scriptMatches = new Set();
const scriptRegex = /npm run\s+([A-Za-z0-9:_-]+)/g;
let match;
while ((match = scriptRegex.exec(workflowText)) !== null) {
  scriptMatches.add(match[1]);
}

const missingScripts = Array.from(scriptMatches).filter((name) => !(name in scripts));
if (missingScripts.length) {
  console.error(`Nightly workflow references missing scripts: ${missingScripts.join(', ')}`);
  process.exit(1);
}

const nodeVersionRegex = /node-version:\s*['"]?24\.13\.0['"]?/;
if (!nodeVersionRegex.test(workflowText)) {
  console.error('Nightly workflow does not pin Node 24.13.0');
  process.exit(1);
}

console.log('nightly workflow contract test passed');
