#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'sqlite-auto');
const cacheRoot = path.join(tempRoot, '.cache');
const searchPath = path.join(root, 'search.js');
const buildIndexPath = path.join(root, 'build_index.js');
const buildSqlitePath = path.join(root, 'tools', 'build-sqlite-index.js');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });

const sampleCode = `
export function greet(name) {
  return "hello " + name;
}
`;
await fsPromises.writeFile(path.join(tempRoot, 'sample.js'), sampleCode);

const writeConfig = async (threshold) => {
  const config = {
    sqlite: { use: true },
    search: { sqliteAutoChunkThreshold: threshold, annDefault: false }
  };
  await fsPromises.writeFile(
    path.join(tempRoot, '.pairofcleats.json'),
    JSON.stringify(config, null, 2)
  );
};

await writeConfig(1);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { cwd: tempRoot, env, encoding: 'utf8' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  return result.stdout || '';
};

run([buildIndexPath, '--stub-embeddings', '--repo', tempRoot], 'build index');
run([buildSqlitePath, '--repo', tempRoot], 'build sqlite');

const backendA = JSON.parse(run([searchPath, 'greet', '--json', '--repo', tempRoot], 'search auto sqlite')).backend;
if (backendA !== 'sqlite') {
  console.error(`Expected sqlite backend for threshold=1, got ${backendA}`);
  process.exit(1);
}

await writeConfig(999999);
const backendB = JSON.parse(run([searchPath, 'greet', '--json', '--repo', tempRoot], 'search auto memory')).backend;
if (backendB !== 'memory') {
  console.error(`Expected memory backend for threshold=999999, got ${backendB}`);
  process.exit(1);
}

console.log('SQLite auto backend test passed');
