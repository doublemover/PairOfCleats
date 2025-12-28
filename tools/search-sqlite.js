#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = process.argv.slice(2);
const hasBackend = args.includes('--backend');
const searchPath = path.join(process.cwd(), 'search.js');
const forwarded = hasBackend ? args : ['--backend', 'sqlite-fts', ...args];

const result = spawnSync(process.execPath, [searchPath, ...forwarded], {
  stdio: 'inherit',
  env: process.env
});

process.exit(result.status ?? 1);
