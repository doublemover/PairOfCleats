#!/usr/bin/env node
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { assembleIndexPieces } from '../src/index/build/piece-assembly.js';
import { loadUserConfig, resolveRepoRoot } from './dict-utils.js';

const argv = createCli({
  scriptName: 'assemble-pieces',
  argv: ['node', 'assemble-pieces.js', ...process.argv.slice(2)],
  options: {
    input: { type: 'string', array: true, describe: 'Input index directory (repeatable)' },
    inputs: { type: 'string', describe: 'Comma-separated input index directories' },
    out: { type: 'string', demandOption: true, describe: 'Output index directory' },
    mode: { type: 'string', default: 'code' },
    repo: { type: 'string' },
    stage: { type: 'string' },
    force: { type: 'boolean', default: false },
    'non-strict': {
      type: 'boolean',
      default: false,
      describe: 'Allow legacy filename guessing (manifest not required)'
    },
    sort: {
      type: 'boolean',
      default: true,
      describe: 'Sort input directories for deterministic assembly (disable with --no-sort)'
    }
  }
}).parse();

const inputDirs = [];
if (Array.isArray(argv.input)) {
  inputDirs.push(...argv.input.filter(Boolean));
}
if (typeof argv.inputs === 'string') {
  inputDirs.push(...argv.inputs.split(',').map((entry) => entry.trim()).filter(Boolean));
}
if (!inputDirs.length) {
  console.error('assemble-pieces requires at least one --input or --inputs entry.');
  process.exit(1);
}

const outDir = path.resolve(argv.out);
if (fsSync.existsSync(outDir) && !argv.force) {
  const entries = fsSync.readdirSync(outDir);
  if (entries.length) {
    console.error(`assemble-pieces output directory is not empty: ${outDir}`);
    console.error('Pass --force to reuse the directory.');
    process.exit(1);
  }
}
if (fsSync.existsSync(outDir) && argv.force) {
  await fs.rm(outDir, { recursive: true, force: true });
}
await fs.mkdir(outDir, { recursive: true });

const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(repoRoot);
const mode = argv.mode || 'code';
const strict = argv['non-strict'] !== true;

const resolvedInputs = inputDirs.map((dir) => path.resolve(dir));
if (argv.sort !== false) {
  resolvedInputs.sort((a, b) => (a < b ? -1 : (a > b ? 1 : 0)));
}

try {
  await assembleIndexPieces({
    inputs: resolvedInputs,
    outDir,
    root: repoRoot,
    mode,
    userConfig,
    stage: argv.stage,
    strict
  });
} catch (err) {
  if (!strict && err?.code === 'ERR_MANIFEST_MISSING') {
    console.error('Missing pieces manifest. Re-run without --non-strict to require manifest discovery.');
  }
  if (strict && err?.code === 'ERR_MANIFEST_MISSING') {
    console.error('Missing pieces manifest. Use --non-strict to allow legacy filename guessing.');
  }
  console.error(err?.message || err);
  process.exit(1);
}
