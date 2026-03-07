#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getCombinedOutput } from '../../helpers/stdio.js';

const root = process.cwd();
const scriptPath = path.join(root, 'search.js');
const source = fs.readFileSync(scriptPath, 'utf8');

const helpIndex = source.indexOf('hasHelpArg(args)');
const versionIndex = source.indexOf('hasVersionArg(args)');
const importIndex = source.indexOf("await import('./src/integrations/core/index.js')");

if (helpIndex === -1 || versionIndex === -1 || importIndex === -1) {
  console.error('search help fastpath test failed: expected help/version checks and dynamic import.');
  process.exit(1);
}

if (!(helpIndex < importIndex && versionIndex < importIndex)) {
  console.error('search help fastpath test failed: help/version checks should occur before dynamic import.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [scriptPath, '--help'], { encoding: 'utf8' });
if (result.status !== 0) {
  console.error('search help fastpath test failed: expected exit code 0.');
  console.error(getCombinedOutput(result) || '<empty>');
  process.exit(result.status ?? 1);
}

const output = getCombinedOutput(result, { trim: true });
if (!output.includes('Usage: search')) {
  console.error('search help fastpath test failed: missing Usage banner.');
  console.error(output || '<empty>');
  process.exit(1);
}

console.log('search help fastpath test passed');
