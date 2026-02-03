#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCli } from '../../src/shared/cli.js';
import { loadRegistry, resolvePacks } from '../../src/experimental/structural/registry.js';
import { runStructuralSearch } from '../../src/experimental/structural/runner.js';
import { writeJson, writeJsonl } from '../../src/experimental/structural/io.js';
import { isAbsolutePathNative } from '../../src/shared/files.js';
import { resolveRepoConfig } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'structural-search',
  options: {
    repo: { type: 'string' },
    engine: { type: 'string' },
    pack: { type: 'array' },
    registry: { type: 'string' },
    rule: { type: 'array' },
    format: { type: 'string', default: 'jsonl' },
    out: { type: 'string' },
    json: { type: 'boolean', default: false },
    'list-packs': { type: 'boolean', default: false }
  }
}).parse();

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const { repoRoot } = resolveRepoConfig(argv.repo);
const registryPath = (() => {
  if (argv.registry) return path.resolve(argv.registry);
  const candidates = [
    path.resolve(repoRoot, 'rules', 'registry.json'),
    path.resolve(scriptRoot, '..', '..', 'rules', 'registry.json'),
    path.resolve(scriptRoot, '..', 'rules', 'registry.json')
  ];
  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  return existing || candidates[0];
})();
const outputPath = argv.out ? path.resolve(argv.out) : null;
const format = argv.json ? 'json' : (argv.format || 'jsonl');

const registry = loadRegistry(registryPath);
if (argv['list-packs']) {
  const output = registry.packs.map((pack) => ({
    id: pack.id,
    label: pack.label,
    engine: pack.engine,
    rules: pack.rules
  }));
  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

const packIds = (argv.pack || []).map((entry) => String(entry).trim()).filter(Boolean);
const rulePaths = (argv.rule || []).map((entry) => String(entry)).filter(Boolean);
const engineOverride = argv.engine ? String(argv.engine).trim() : '';

const { selectedPacks, missingPacks } = resolvePacks(registry, packIds);
if (missingPacks.length) {
  console.error(`Unknown packs: ${missingPacks.join(', ')}`);
}

if (!selectedPacks.length && !engineOverride) {
  console.error('No packs selected and no engine specified.');
  process.exit(1);
}

const registryDir = path.dirname(registryPath);
const registryRepoRoot = path.resolve(registryDir, '..');
const resolveRulePath = (rulePath) => {
  if (!rulePath) return null;
  if (isAbsolutePathNative(rulePath)) return fs.existsSync(rulePath) ? rulePath : null;
  const normalized = rulePath.replace(/\\/g, '/');
  const resolved = normalized.startsWith('rules/')
    ? path.resolve(registryRepoRoot, rulePath)
    : path.resolve(registryDir, rulePath);
  return fs.existsSync(resolved) ? resolved : null;
};

const packsToRun = selectedPacks.map((pack) => ({
  pack,
  engine: pack.engine,
  rules: pack.rules.map(resolveRulePath).filter(Boolean)
}));
if (engineOverride || rulePaths.length) {
  packsToRun.push({
    pack: null,
    engine: engineOverride,
    rules: rulePaths.map(resolveRulePath).filter(Boolean)
  });
}

const results = runStructuralSearch({ repoRoot, packsToRun });

if (format === 'json') {
  await writeJson(results, outputPath);
} else {
  await writeJsonl(results, outputPath);
}
