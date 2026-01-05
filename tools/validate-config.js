#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { fileURLToPath } from 'node:url';
import { resolveRepoRoot } from './dict-utils.js';
import { validateConfig } from '../src/config/validate.js';

const argv = createCli({
  scriptName: 'config-validate',
  options: {
    json: { type: 'boolean', default: false },
    repo: { type: 'string' },
    config: { type: 'string' }
  }
}).parse();

const repoArg = argv.repo ? path.resolve(argv.repo) : null;
const repoRoot = repoArg || resolveRepoRoot(process.cwd());
const configPath = argv.config ? path.resolve(argv.config) : path.join(repoRoot, '.pairofcleats.json');
const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(toolRoot, 'docs', 'config-schema.json');

if (!fs.existsSync(schemaPath)) {
  console.error(`Config schema not found: ${schemaPath}`);
  process.exit(1);
}

if (!fs.existsSync(configPath)) {
  const message = `Config file not found: ${configPath}`;
  if (argv.json) {
    console.log(JSON.stringify({ ok: true, found: false, configPath, message }, null, 2));
  } else {
    console.log(message);
  }
  process.exit(0);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (err) {
  const message = `Failed to parse config: ${err?.message || err}`;
  if (argv.json) {
    console.log(JSON.stringify({ ok: false, found: true, configPath, message }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}

if (!config || typeof config !== 'object' || Array.isArray(config)) {
  const message = 'Config root must be a JSON object.';
  if (argv.json) {
    console.log(JSON.stringify({ ok: false, found: true, configPath, message }, null, 2));
  } else {
    console.error(message);
  }
  process.exit(1);
}

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const result = validateConfig(schema, config);
const profileErrors = [];
const profileName = typeof config.profile === 'string' ? config.profile.trim() : '';
if (profileName) {
  const profilePath = path.join(toolRoot, 'profiles', `${profileName}.json`);
  if (!fs.existsSync(profilePath)) {
    profileErrors.push(`Profile not found: ${profilePath}`);
  } else {
    try {
      const profileRaw = JSON.parse(fs.readFileSync(profilePath, 'utf8'));
      if (!profileRaw || typeof profileRaw !== 'object' || Array.isArray(profileRaw)) {
        profileErrors.push(`Profile must be a JSON object: ${profilePath}`);
      }
    } catch (err) {
      profileErrors.push(`Failed to parse profile ${profilePath}: ${err?.message || err}`);
    }
  }
}
if (profileErrors.length) {
  result.ok = false;
  result.errors = result.errors.concat(profileErrors);
}
if (argv.json) {
  console.log(JSON.stringify({ ok: result.ok, found: true, configPath, errors: result.errors }, null, 2));
} else if (result.ok) {
  console.log(`Config OK: ${configPath}`);
} else {
  console.error(`Config errors in ${configPath}:`);
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
}

process.exit(result.ok ? 0 : 1);
