#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../../src/shared/cli.js';
import { readJsoncFile } from '../../src/shared/jsonc.js';
import { resolveRepoConfigPath, resolveRepoRootArg, resolveToolRoot } from '../shared/dict-utils.js';
import { emitJson } from '../shared/cli-utils.js';
import { validateConfig } from '../../src/config/validate.js';
import { explainEffectiveConfiguration, formatEffectiveConfiguration } from './effective.js';
import { CONFIG_VALIDATE_OPTIONS } from './options.js';

const runValidation = async () => {
const argv = createCli({
  scriptName: 'pairofcleats config validate',
  options: CONFIG_VALIDATE_OPTIONS
}).parse();

const repoRoot = resolveRepoRootArg(argv.repo);
const configPath = resolveRepoConfigPath(repoRoot, argv.config);
const toolRoot = resolveToolRoot();
const schemaPath = path.join(toolRoot, 'docs', 'config', 'schema.json');

if (argv.effective) {
  const report = await explainEffectiveConfiguration({ repoRoot, configPath: argv.config ? configPath : null });
  if (argv.json) emitJson(report);
  else console.error(formatEffectiveConfiguration(report));
  return report.ok ? 0 : 1;
}

if (!fs.existsSync(schemaPath)) {
  console.error(`Config schema not found: ${schemaPath}`);
  return 1;
}

if (!fs.existsSync(configPath)) {
  const message = `Config file not found: ${configPath}`;
  if (argv.json) {
    emitJson({ ok: !argv.config, found: false, configPath, message, validation: 'raw-schema', errorCode: argv.config ? 'ERR_CONFIG_FILE_MISSING' : null });
  } else {
    console.error(message);
  }
  return argv.config ? 1 : 0;
}

let config;
try {
  config = readJsoncFile(configPath);
} catch (err) {
  const message = `Failed to parse config: ${err?.message || err}`;
  if (argv.json) {
    emitJson({ ok: false, found: true, configPath, message });
  } else {
    console.error(message);
  }
  return 1;
}

if (!config || typeof config !== 'object' || Array.isArray(config)) {
  const message = 'Config root must be a JSON object.';
  if (argv.json) {
    emitJson({ ok: false, found: true, configPath, message });
  } else {
    console.error(message);
  }
  return 1;
}

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const result = validateConfig(schema, config);
if (argv.json) {
  emitJson({ ok: result.ok, found: true, configPath, errors: result.errors, validation: 'raw-schema', runtime: 'not-probed' });
} else if (result.ok) {
  console.error(`Config schema OK: ${configPath}. Effective settings/runtime not checked; use --effective.`);
} else {
  console.error(`Config errors in ${configPath}:`);
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
}

return result.ok ? 0 : 1;
};

process.exitCode = await runValidation();
