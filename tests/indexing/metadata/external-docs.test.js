#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'external-docs');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'index.js'),
  [
    "import foo from '@scope/pkg';",
    "import bar from 'left-pad';",
    "console.log(foo, bar);"
  ].join('\n') + '\n'
);

process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const buildResult = spawnSync(
  process.execPath,
  [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot],
  { cwd: repoRoot, env, stdio: 'inherit' }
);
if (buildResult.status !== 0) {
  console.error('external docs test failed: build_index failed');
  process.exit(buildResult.status ?? 1);
}

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const fileMetaPath = path.join(codeDir, 'file_meta.json');
if (!fs.existsSync(fileMetaPath)) {
  console.error(`Missing file metadata: ${fileMetaPath}`);
  process.exit(1);
}

const files = JSON.parse(fs.readFileSync(fileMetaPath, 'utf8'));
const expectedScoped = 'https://www.npmjs.com/package/@scope/pkg';
const expectedUnscoped = 'https://www.npmjs.com/package/left-pad';
const encodedScoped = 'https://www.npmjs.com/package/%40scope/pkg';

const allDocs = files.flatMap((file) => file.externalDocs || []);
const allowedHosts = ['npmjs.com', 'pypi.org', 'pkg.go.dev'];
const isAllowedHost = (urlValue) => {
  let host = '';
  try {
    host = new URL(urlValue).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
};
const invalidHosts = allDocs.filter((doc) => !isAllowedHost(doc));
if (invalidHosts.length) {
  console.error(`External docs must use allowed hosts: ${invalidHosts.join(', ')}`);
  process.exit(1);
}
if (!allDocs.includes(expectedScoped)) {
  console.error(`Missing scoped npm doc link: ${expectedScoped}`);
  process.exit(1);
}
if (allDocs.includes(encodedScoped)) {
  console.error(`Scoped npm doc link should preserve @: ${encodedScoped}`);
  process.exit(1);
}
if (!allDocs.includes(expectedUnscoped)) {
  console.error(`Missing npm doc link: ${expectedUnscoped}`);
  process.exit(1);
}

console.log('External docs test passed');

