#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { applyTestEnv } from '../../helpers/test-env.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'external-docs');
const repoRootRaw = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(path.join(repoRootRaw, 'src'), { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
const repoRoot = toRealPathSync(repoRootRaw);

await fsPromises.writeFile(
  path.join(repoRoot, 'src', 'index.js'),
  [
    "import foo from '@scope/pkg';",
    "import bar from 'left-pad';",
    "console.log(foo, bar);"
  ].join('\n') + '\n'
);

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub',
  testConfig: {
    indexing: {
      scm: { provider: 'none' }
    }
  }
});

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
const allDocs = files.flatMap((file) => file.externalDocs || []);
const allowedHosts = new Set(['www.npmjs.com', 'npmjs.com', 'pypi.org', 'pkg.go.dev']);
const isAllowedHost = (urlValue) => {
  let host = '';
  try {
    host = new URL(urlValue).hostname.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.has(host);
};
const invalidHosts = allDocs.filter((doc) => !isAllowedHost(doc));
if (invalidHosts.length) {
  console.error(`External docs must use allowed hosts: ${invalidHosts.join(', ')}`);
  process.exit(1);
}
const hasExactNpmPackageDoc = (packageName) => allDocs.some((docUrl) => {
  let parsed;
  try {
    parsed = new URL(docUrl);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const exactPath = `/package/${packageName}`;
  return (
    (host === 'www.npmjs.com' || host === 'npmjs.com')
    && parsed.protocol === 'https:'
    && parsed.pathname === exactPath
    && !parsed.search
    && !parsed.hash
    && parsed.username === ''
    && parsed.password === ''
  );
});

if (!hasExactNpmPackageDoc('@scope/pkg')) {
  console.error('Missing scoped npm doc link: https://www.npmjs.com/package/@scope/pkg');
  process.exit(1);
}
if (hasExactNpmPackageDoc('%40scope/pkg')) {
  console.error('Scoped npm doc link should preserve @: https://www.npmjs.com/package/%40scope/pkg');
  process.exit(1);
}
if (!hasExactNpmPackageDoc('left-pad')) {
  console.error('Missing npm doc link: https://www.npmjs.com/package/left-pad');
  process.exit(1);
}

console.log('External docs test passed');

