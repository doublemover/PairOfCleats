#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import minimist from 'minimist';
import { loadUserConfig, resolveRepoRoot } from './dict-utils.js';
import { getVectorExtensionConfig, resolveVectorExtensionPath } from './vector-extension.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['json', 'load'],
  string: ['provider', 'dir', 'path', 'platform', 'arch', 'module', 'table', 'column', 'encoding', 'options', 'ann-mode', 'repo'],
  default: { json: false, load: true }
});

const rootArg = argv.repo ? path.resolve(argv.repo) : null;
const root = rootArg || resolveRepoRoot(process.cwd());
const userConfig = loadUserConfig(root);
const overrides = {
  provider: argv.provider,
  dir: argv.dir,
  path: argv.path,
  platform: argv.platform,
  arch: argv.arch,
  module: argv.module,
  table: argv.table,
  column: argv.column,
  encoding: argv.encoding,
  options: argv.options,
  annMode: argv['ann-mode']
};

const config = getVectorExtensionConfig(root, userConfig, overrides);
const resolvedPath = resolveVectorExtensionPath(config);
const exists = resolvedPath ? fs.existsSync(resolvedPath) : false;

const loadResult = { attempted: false, ok: false, reason: null };
if (argv.load && exists) {
  loadResult.attempted = true;
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.loadExtension(resolvedPath);
      loadResult.ok = true;
    } catch (err) {
      loadResult.reason = err?.message || String(err);
    } finally {
      db.close();
    }
  } catch (err) {
    loadResult.reason = err?.message || String(err);
  }
} else if (argv.load && !exists) {
  loadResult.attempted = true;
  loadResult.reason = 'extension path missing';
}

const payload = {
  config: {
    annMode: config.annMode,
    enabled: config.enabled,
    provider: config.provider,
    module: config.module,
    table: config.table,
    column: config.column,
    encoding: config.encoding,
    options: config.options,
    platform: config.platform,
    arch: config.arch,
    platformKey: config.platformKey
  },
  path: resolvedPath,
  exists,
  load: loadResult
};

if (argv.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log('SQLite extension verification');
  console.log(`- provider: ${config.provider}`);
  console.log(`- annMode: ${config.annMode}`);
  console.log(`- platform: ${config.platformKey}`);
  console.log(`- path: ${resolvedPath || 'unset'}`);
  console.log(`- exists: ${exists ? 'yes' : 'no'}`);
  if (loadResult.attempted) {
    console.log(`- load: ${loadResult.ok ? 'ok' : `failed (${loadResult.reason})`}`);
  } else {
    console.log('- load: skipped');
  }
}

const ok = exists && (!argv.load || loadResult.ok);
process.exit(ok ? 0 : 1);
