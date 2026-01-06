#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { resolveRepoRoot } from './dict-utils.js';
import { DEFAULT_USER_CONFIG } from './default-config.js';

const argv = createCli({
  scriptName: 'reset-config',
  options: {
    repo: { type: 'string' },
    config: { type: 'string' },
    force: { type: 'boolean', default: false },
    backup: { type: 'boolean', default: true },
    json: { type: 'boolean', default: false }
  }
}).parse();

const isTruthy = (value) => {
  if (value == null) return false;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
};

const forceRequested = argv.force
  || isTruthy(process.env.PAIROFCLEATS_RESET_FORCE)
  || isTruthy(process.env.npm_config_force);

const repoRoot = argv.repo ? path.resolve(argv.repo) : resolveRepoRoot(process.cwd());
const configPath = argv.config
  ? path.resolve(argv.config)
  : path.join(repoRoot, '.pairofcleats.json');
const existing = fs.existsSync(configPath);
const result = {
  ok: true,
  configPath,
  backupPath: null,
  reset: false
};

if (existing && !forceRequested) {
  result.ok = false;
  if (argv.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.error(`[reset-config] Refusing to overwrite ${configPath} without --force.`);
  }
  process.exit(1);
}

if (existing && argv.backup) {
  const backupPath = `${configPath}.bak`;
  fs.copyFileSync(configPath, backupPath);
  result.backupPath = backupPath;
}

fs.writeFileSync(configPath, `${JSON.stringify(DEFAULT_USER_CONFIG, null, 2)}\n`, 'utf8');
result.reset = true;

if (argv.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`[reset-config] Wrote default config to ${configPath}`);
  if (result.backupPath) {
    console.log(`[reset-config] Backup saved to ${result.backupPath}`);
  }
}
