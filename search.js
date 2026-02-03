#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (hasHelpArg(args)) {
  printHelp();
  process.exit(0);
}
if (hasVersionArg(args)) {
  printVersion();
  process.exit(0);
}

const { search } = await import('./src/integrations/core/index.js');
await search(null, { args, emitOutput: true, exitOnError: true });

function hasHelpArg(values) {
  return Array.isArray(values) && values.some((value) => (
    value === '--help' || value === '-h'
  ));
}

function hasVersionArg(values) {
  return Array.isArray(values) && values.some((value) => (
    value === '--version' || value === '-v'
  ));
}

function printHelp() {
  process.stdout.write(`Usage: search "<query>" [options]

Common options:
  --mode <code|prose|records|extracted-prose|default>
  --repo <path>
  --backend <auto|sqlite|sqlite-fts|lmdb>
  --json
  --compact
  --stats
  --ann / --no-ann

Examples:
  search "needle"
  search --mode code "symbol"
  search --help
  search --version
`);
}

function printVersion() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
  const pkgPath = path.join(root, 'package.json');
  try {
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    process.stdout.write(`${pkg.version || '0.0.0'}\n`);
  } catch {
    process.stdout.write('0.0.0\n');
  }
}
