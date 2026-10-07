#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyTestEnv } from '../../helpers/test-env.js';
import { runNode } from '../../helpers/run-node.js';
import { createPatchFixture, originalText, patchedText } from './patch-fixture.js';
import { probeSqliteNative, rebuildSqliteNativeFromSource } from '../../../tools/setup/rebuild-native-sqlite.js';

const env = applyTestEnv();
const scriptPath = path.join(process.cwd(), 'tools', 'setup', 'postinstall.js');
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-postinstall-rebuild-'));
const workingRoot = path.join(tempRoot, 'patch %PATH%!runner&cwd');
const markerPath = path.join(workingRoot, 'rebuild-ran.txt');
const run = (extraEnv = {}) => runNode([scriptPath], 'postinstall rebuild native contract', workingRoot, {
  ...env, ...extraEnv
}, { stdio: 'pipe', allowFailure: true, timeoutMs: 30000 });

try {
  const fixture = await createPatchFixture(workingRoot);
  await fs.mkdir(path.join(workingRoot, 'tools', 'setup'), { recursive: true });
  const rebuildScriptPath = path.join(workingRoot, 'tools', 'setup', 'rebuild-native.js');
  await fs.writeFile(rebuildScriptPath, `const fs = require('node:fs');
if (fs.readFileSync(${JSON.stringify(fixture.target)}, 'utf8') !== ${JSON.stringify(patchedText)}) process.exit(9);
fs.appendFileSync(${JSON.stringify(markerPath)}, 'ran\\n');
`);
  assert.equal(run().status, 0, 'clean install should patch before rebuilding');
  assert.equal(run({ npm_config_omit: 'dev' }).status, 0, 'reinstall should work without dev patch tooling');
  assert.equal(await fs.readFile(markerPath, 'utf8'), 'ran\nran\n');

  await fs.writeFile(rebuildScriptPath, 'process.exit(7);\n');
  assert.equal(run().status, 7, 'preserve native rebuild exit codes');
  if (process.platform !== 'win32') {
    await fs.writeFile(rebuildScriptPath, "process.kill(process.pid, 'SIGTERM');\n");
    assert.equal(run().signal, 'SIGTERM', 'preserve native rebuild child signals');
  }

  await fs.writeFile(fixture.target, originalText.replace('old one', 'new one'));
  assert.equal(run().status, 1, 'partial patches must block rebuilding');
  assert.equal(await fs.readFile(markerPath, 'utf8'), 'ran\nran\n');
  console.log('postinstall rebuild native contract test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}

const sqliteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-sqlite-native-recovery-'));
const sqlitePackage = path.join(sqliteRoot, 'node_modules', 'better-sqlite3');
const prebuildPath = path.join(sqlitePackage, 'prebuilds', 'host.node');
const compiledPath = path.join(sqlitePackage, 'build', 'Release', 'better_sqlite3.node');
const callsPath = path.join(sqlitePackage, 'calls.jsonl');
const modePath = path.join(sqlitePackage, 'mode');

try {
  await fs.mkdir(path.dirname(prebuildPath), { recursive: true });
  await fs.mkdir(path.dirname(compiledPath), { recursive: true });
  await fs.mkdir(path.join(sqlitePackage, 'lib'), { recursive: true });
  await fs.writeFile(path.join(sqlitePackage, 'package.json'), JSON.stringify({
    name: 'better-sqlite3', version: '13.0.3', main: 'index.js', exports: { '.': './index.js' }
  }));
  await fs.writeFile(path.join(sqlitePackage, 'index.js'), `
const fs = require('node:fs');
const prebuild = ${JSON.stringify(prebuildPath)};
const compiled = ${JSON.stringify(compiledPath)};
const mode = () => fs.existsSync(${JSON.stringify(modePath)}) ? fs.readFileSync(${JSON.stringify(modePath)}, 'utf8') : '';
const log = value => fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(value) + '\\n');
module.exports = class Database {
  constructor(filename, options = {}) {
    log({ phase: 'open', filename, nativeBinding: options.nativeBinding || null });
    if (!options.nativeBinding && mode() === 'reject-default') throw new Error('default loader rejected');
    const binding = options.nativeBinding || (fs.existsSync(prebuild) ? prebuild : compiled);
    if (fs.readFileSync(binding, 'utf8') !== 'healthy') throw new Error('native binding broken');
  }
  prepare(sql) { log({ phase: 'prepare', sql }); return { get: () => ({ ok: mode() === 'wrong-query' ? 0 : 1 }) }; }
  close() { log({ phase: 'close' }); }
};
`);
  await fs.writeFile(path.join(sqlitePackage, 'lib', 'binding.js'), `
const fs = require('node:fs');
exports.getPrebuildPath = () => fs.existsSync(${JSON.stringify(prebuildPath)}) ? ${JSON.stringify(prebuildPath)} : null;
`);

  // Import succeeds, but only constructing a database exposes a broken binary.
  await fs.writeFile(prebuildPath, 'broken');
  assert.match(probeSqliteNative(sqliteRoot).message, /native binding broken/);
  await fs.writeFile(prebuildPath, 'healthy');
  assert.equal(probeSqliteNative(sqliteRoot).ok, true);
  await fs.writeFile(modePath, 'wrong-query');
  assert.match(probeSqliteNative(sqliteRoot).message, /unexpected result/);
  const calls = (await fs.readFile(callsPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.at(-1).phase, 'close', 'close even when the query result is invalid');
  assert.ok(calls.some(call => call.filename === ':memory:' && call.phase === 'open'));
  assert.ok(calls.some(call => call.sql === 'SELECT 1 AS ok'));
  await fs.writeFile(modePath, '');

  const builds = [];
  const build = (args, buildOptions) => {
    builds.push({ args, buildOptions });
    return { ok: true, message: null };
  };
  await fs.writeFile(prebuildPath, 'broken');
  assert.equal(rebuildSqliteNativeFromSource(sqliteRoot, () => ({ ok: false, message: 'compiler failed' })).message, 'compiler failed');
  assert.equal(await fs.readFile(prebuildPath, 'utf8'), 'broken');
  assert.equal(rebuildSqliteNativeFromSource(sqliteRoot, build).ok, false, 'missing compiled binary must fail');
  await fs.writeFile(compiledPath, 'also broken');
  assert.match(rebuildSqliteNativeFromSource(sqliteRoot, build).message, /native binding broken/);
  assert.equal(await fs.readFile(prebuildPath, 'utf8'), 'broken', 'never promote an invalid source binding');

  await fs.writeFile(compiledPath, 'healthy');
  const renameSync = fsSync.renameSync;
  try {
    fsSync.renameSync = () => { throw new Error('prebuild replacement denied'); };
    assert.match(rebuildSqliteNativeFromSource(sqliteRoot, build).message, /prebuild replacement denied/);
  } finally {
    fsSync.renameSync = renameSync;
  }
  assert.equal(await fs.readFile(prebuildPath, 'utf8'), 'broken', 'failed replacement leaves original bytes intact');
  assert.deepEqual(await fs.readdir(path.dirname(prebuildPath)), ['host.node'], 'failed rename must clean temporary files');
  await fs.writeFile(modePath, 'reject-default');
  assert.match(rebuildSqliteNativeFromSource(sqliteRoot, build).message, /default loader rejected/);
  assert.equal(await fs.readFile(prebuildPath, 'utf8'), 'broken', 'restore the original if default loading still fails');
  assert.deepEqual(await fs.readdir(path.dirname(prebuildPath)), ['host.node'], 'failed promotion must clean temporary files');
  await fs.writeFile(modePath, '');
  assert.equal(rebuildSqliteNativeFromSource(sqliteRoot, build).ok, true);
  assert.equal(await fs.readFile(prebuildPath, 'utf8'), 'healthy');
  assert.deepEqual(await fs.readdir(path.dirname(prebuildPath)), ['host.node'], 'successful promotion must clean temporary files');
  assert.equal(probeSqliteNative(sqliteRoot).ok, true, 'normal callers must load the repaired binding');
  assert.deepEqual(builds[0], {
    args: ['run', 'build-release'],
    buildOptions: { cwd: sqlitePackage, buildFromSource: true }
  });

  await fs.rm(prebuildPath);
  assert.equal(rebuildSqliteNativeFromSource(sqliteRoot, build).ok, true, 'platforms without bundled prebuilds use the compiled binding');
  console.log('sqlite native runtime and v13 recovery contract test passed');
} finally {
  await fs.rm(sqliteRoot, { recursive: true, force: true });
}
