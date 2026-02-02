#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const packagePath = path.join(ROOT, 'package.json');

if (!fs.existsSync(packagePath)) {
  console.error(`Missing package.json: ${packagePath}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const scripts = pkg.scripts || {};

const scriptTargets = new Set();
const nodeRegex = /(?:^|&&|\|\||;)\s*node\s+([^\s]+)/g;
for (const command of Object.values(scripts)) {
  if (typeof command !== 'string') continue;
  let match;
  while ((match = nodeRegex.exec(command)) !== null) {
    const raw = match[1].replace(/^['"]|['"]$/g, '').trim();
    if (!raw || raw.startsWith('-')) continue;
    scriptTargets.add(raw);
  }
}

const missing = [];
for (const target of scriptTargets) {
  const resolved = path.resolve(ROOT, target);
  if (!fs.existsSync(resolved)) missing.push(target);
}

if (missing.length) {
  console.error(`npm scripts reference missing targets: ${missing.sort().join(', ')}`);
  process.exit(1);
}

console.log('npm script targets test passed');
