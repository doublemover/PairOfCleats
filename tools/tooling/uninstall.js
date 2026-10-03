#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { createCli } from '../../src/shared/cli.js';
import { getEnvConfig } from '../../src/shared/env/runtime.js';
import { isRootPath } from '../../src/shared/file-paths.js';
import { isPathUnderDir } from '../../src/shared/path-normalize.js';
import { assertSafeCacheDeletion } from '../../src/shared/cache-deletion.js';
import { getCacheRootBase } from '../../src/shared/cache-roots.js';
import { getCacheRoot, getDictConfig, getExtensionsDir, getModelsDir, resolveRepoConfig } from '../shared/dict-utils.js';

const argv = createCli({
  scriptName: 'pairofcleats tooling uninstall',
  options: {
    yes: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
    'allow-unmarked-cache': { type: 'boolean', default: false },
    repo: { type: 'string' }
  }
}).parse();

const { repoRoot: root, userConfig } = resolveRepoConfig(argv.repo);
const dictConfig = getDictConfig(root, userConfig);
const envConfig = getEnvConfig();
const defaultCacheRoot = getCacheRoot();
const configuredCacheRoot = (userConfig.cache && userConfig.cache.root) || envConfig.cacheRoot || defaultCacheRoot;
const envCacheRoot = envConfig.cacheRoot || null;
const modelsDir = getModelsDir(root, userConfig);
const extensionsDir = getExtensionsDir(root, userConfig);


const cacheRoots = new Set([defaultCacheRoot, configuredCacheRoot, envCacheRoot].filter(Boolean));
const targets = [];
for (const cacheRoot of cacheRoots) targets.push(cacheRoot);

const dictDir = dictConfig.dir;
if (dictDir && !Array.from(cacheRoots).some((rootPath) => isPathUnderDir(rootPath, dictDir))) {
  targets.push(dictDir);
}

if (modelsDir && !Array.from(cacheRoots).some((rootPath) => isPathUnderDir(rootPath, modelsDir))) {
  targets.push(modelsDir);
}

if (extensionsDir && !Array.from(cacheRoots).some((rootPath) => isPathUnderDir(rootPath, extensionsDir))) {
  targets.push(extensionsDir);
}

const uniqueTargets = Array.from(new Set(targets.map((target) => path.resolve(target))));
const authorizedRoots = [getCacheRootBase(), ...cacheRoots,
  envConfig.dictDir, envConfig.modelsDir, envConfig.extensionsDir];
const deletionPolicy = { allowUnmarked: argv['allow-unmarked-cache'] === true || argv['dry-run'] === true };
for (const target of uniqueTargets) {
  if (fs.existsSync(target)) assertSafeCacheDeletion(target, authorizedRoots, deletionPolicy);
}
if (!uniqueTargets.length) {
  console.error('No uninstall targets found.');
  process.exit(0);
}

if (!argv.yes) {
  console.error('This will delete all PairOfCleats caches, dictionaries, model files, and extensions.');
  console.error('Targets:');
  uniqueTargets.forEach((target) => console.error(`- ${target}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "yes" to confirm: ');
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.error('Uninstall cancelled.');
    process.exit(1);
  }
}

for (const target of uniqueTargets) {
  if (!fs.existsSync(target)) {
    console.error(`skip: ${target} (missing)`);
    continue;
  }
  if (isRootPath(target)) {
    console.error(`refusing to delete root path: ${target}`);
    process.exit(1);
  }

  if (argv['dry-run']) {
    console.error(`dry-run: would delete ${target}`);
    continue;
  }

  assertSafeCacheDeletion(target, authorizedRoots, deletionPolicy);
  await fsPromises.rm(target, { recursive: true, force: true });
  console.error(`deleted: ${target}`);
}

console.error('\nUninstall complete.');
