#!/usr/bin/env node
import fs from 'node:fs';
import { createCli } from '../../src/shared/cli.js';
import { normalizeBooleanString } from '../../src/shared/boolean-normalization.js';
import { resolveRepoConfigPath, resolveRepoRootArg } from '../shared/dict-utils.js';
import { emitJson } from '../shared/cli-utils.js';
import { DEFAULT_USER_CONFIG_TEMPLATE } from './default-template.js';

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

const forceRequested = argv.force
  || normalizeBooleanString(process.env.npm_config_force, { fallback: false });

const repoRoot = resolveRepoRootArg(argv.repo);
const configPath = resolveRepoConfigPath(repoRoot, argv.config);
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
    emitJson(result);
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

const template = DEFAULT_USER_CONFIG_TEMPLATE.trimEnd();
fs.writeFileSync(configPath, `${template}\n`, 'utf8');
result.reset = true;

if (argv.json) {
  emitJson(result);
} else {
  console.error(`[reset-config] Wrote default config to ${configPath}`);
  if (result.backupPath) {
    console.error(`[reset-config] Backup saved to ${result.backupPath}`);
  }
}
