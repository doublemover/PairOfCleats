#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stderr as output } from 'node:process';
import { createCli } from '../../src/shared/cli.js';
import { clearCacheRoot, getCacheRootBase, resolveVersionedCacheRoot } from '../../src/shared/cache-roots.js';

const cli = createCli({
  scriptName: 'clear-cache',
  argv: process.argv,
  usage: 'usage: clear-cache [--all] [--force] [--cache-root <path>]',
  options: {
    all: { type: 'boolean', default: false, describe: 'clear legacy cache entries as well' },
    force: { type: 'boolean', default: false, describe: 'skip confirmation prompt' },
    'cache-root': { type: 'string', describe: 'override cache root' }
  }
});

const argv = cli.parse();
const baseRoot = argv['cache-root'] ? path.resolve(argv['cache-root']) : getCacheRootBase();
const versionedRoot = resolveVersionedCacheRoot(baseRoot);
const targetLabel = argv.all ? baseRoot : versionedRoot;

if (!argv.force) {
  if (!process.stdin.isTTY) {
    console.error('Refusing to clear cache without --force in non-interactive mode.');
    process.exit(1);
  }
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`This will delete cache data under ${targetLabel}. Continue? (y/N) `);
  await rl.close();
  if (!/^y(es)?$/i.test(String(answer).trim())) {
    console.error('Cache clear aborted.');
    process.exit(1);
  }
}

clearCacheRoot({ baseRoot, includeLegacy: argv.all === true });
if (fs.existsSync(targetLabel)) {
  try {
    fs.rmSync(targetLabel, { recursive: true, force: true });
  } catch {}
}

console.error(`Cache cleared: ${targetLabel}`);
