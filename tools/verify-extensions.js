#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createCli } from '../src/shared/cli.js';
import { loadUserConfig, resolveRepoRoot } from './dict-utils.js';
import {
  encodeVector,
  ensureVectorTable,
  getVectorExtensionConfig,
  resolveVectorExtensionPath
} from './vector-extension.js';

const argv = createCli({
  scriptName: 'verify-extensions',
  options: {
    json: { type: 'boolean', default: false },
    load: { type: 'boolean', default: true },
    provider: { type: 'string' },
    dir: { type: 'string' },
    path: { type: 'string' },
    platform: { type: 'string' },
    arch: { type: 'string' },
    module: { type: 'string' },
    table: { type: 'string' },
    column: { type: 'string' },
    encoding: { type: 'string' },
    options: { type: 'string' },
    'ann-mode': { type: 'string' },
    repo: { type: 'string' }
  }
}).parse();

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
const smoke = { attempted: false, ok: false, reason: null };
if (argv.load && exists) {
  loadResult.attempted = true;
  try {
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(':memory:');
    try {
      db.loadExtension(resolvedPath);
      loadResult.ok = true;
      smoke.attempted = true;
      const created = ensureVectorTable(db, config, 3);
      if (!created.ok) {
        smoke.reason = created.reason || 'failed to create vector table';
      } else {
        const payload = encodeVector([0.1, 0.2, 0.3], config);
        const insert = db.prepare(
          `INSERT OR REPLACE INTO ${created.tableName} (rowid, ${created.column}) VALUES (?, ?)`
        );
        insert.run(1, payload);
        db.prepare(`SELECT rowid FROM ${created.tableName} WHERE rowid = 1`).get();
        smoke.ok = true;
      }
    } catch (err) {
      loadResult.reason = err?.message || String(err);
      if (smoke.attempted && !smoke.ok && !smoke.reason) {
        smoke.reason = loadResult.reason;
      }
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
  load: loadResult,
  smoke
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
  if (smoke.attempted) {
    console.log(`- smoke: ${smoke.ok ? 'ok' : `failed (${smoke.reason})`}`);
  }
}

const ok = exists && (!argv.load || (loadResult.ok && (!smoke.attempted || smoke.ok)));
process.exit(ok ? 0 : 1);
