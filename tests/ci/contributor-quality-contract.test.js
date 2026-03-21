#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import fs from 'node:fs';
import path from 'node:path';

ensureTestingEnv(process.env);

const root = process.cwd();
const packagePath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const scripts = pkg.scripts || {};

if (scripts.test !== 'node tests/run.js --lane ci-lite') {
  console.error(`contributor quality contract failed: unexpected test script: ${scripts.test || '<missing>'}`);
  process.exit(1);
}

if (scripts.verify !== 'node tools/ci/run-suite.js --mode ci') {
  console.error(`contributor quality contract failed: unexpected verify script: ${scripts.verify || '<missing>'}`);
  process.exit(1);
}

console.log('contributor quality contract test passed');
