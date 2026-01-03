#!/usr/bin/env node
import { execaSync } from 'execa';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const hasBackend = args.includes('--backend');
const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const searchPath = path.join(scriptRoot, 'search.js');
const forwarded = hasBackend ? args : ['--backend', 'sqlite-fts', ...args];

const result = execaSync(process.execPath, [searchPath, ...forwarded], {
  stdio: 'inherit',
  env: process.env,
  reject: false
});

process.exit(result.exitCode ?? 1);
