#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import minimist from 'minimist';
import { getCacheRoot, getDictConfig, getExtensionsDir, getModelsDir, loadUserConfig } from './dict-utils.js';

const argv = minimist(process.argv.slice(2), {
  boolean: ['yes', 'dry-run'],
  default: { yes: false, 'dry-run': false }
});

const root = process.cwd();
const userConfig = loadUserConfig(root);
const dictConfig = getDictConfig(root, userConfig);
const defaultCacheRoot = getCacheRoot();
const configuredCacheRoot = (userConfig.cache && userConfig.cache.root) || process.env.PAIROFCLEATS_CACHE_ROOT || defaultCacheRoot;
const envCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT || null;
const modelsDir = getModelsDir(root, userConfig);
const extensionsDir = getExtensionsDir(root, userConfig);

/**
 * Check if a path is contained within another path.
 * @param {string} parent
 * @param {string} child
 * @returns {boolean}
 */
function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Guard against deleting filesystem root paths.
 * @param {string} targetPath
 * @returns {boolean}
 */
function isRootPath(targetPath) {
  const resolved = path.resolve(targetPath);
  return path.parse(resolved).root === resolved;
}

const cacheRoots = new Set([defaultCacheRoot, configuredCacheRoot, envCacheRoot].filter(Boolean));
const targets = [];
for (const cacheRoot of cacheRoots) targets.push(cacheRoot);

const dictDir = dictConfig.dir;
if (dictDir && !Array.from(cacheRoots).some((rootPath) => isInside(rootPath, dictDir))) {
  targets.push(dictDir);
}

if (modelsDir && !Array.from(cacheRoots).some((rootPath) => isInside(rootPath, modelsDir))) {
  targets.push(modelsDir);
}

if (extensionsDir && !Array.from(cacheRoots).some((rootPath) => isInside(rootPath, extensionsDir))) {
  targets.push(extensionsDir);
}

const uniqueTargets = Array.from(new Set(targets.map((target) => path.resolve(target))));
if (!uniqueTargets.length) {
  console.log('No uninstall targets found.');
  process.exit(0);
}

if (!argv.yes) {
  console.log('This will delete all PairOfCleats caches, dictionaries, model files, and extensions.');
  console.log('Targets:');
  uniqueTargets.forEach((target) => console.log(`- ${target}`));
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question('Type "yes" to confirm: ');
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') {
    console.log('Uninstall cancelled.');
    process.exit(1);
  }
}

for (const target of uniqueTargets) {
  if (!fs.existsSync(target)) {
    console.log(`skip: ${target} (missing)`);
    continue;
  }
  if (isRootPath(target)) {
    console.error(`refusing to delete root path: ${target}`);
    process.exit(1);
  }

  if (argv['dry-run']) {
    console.log(`dry-run: would delete ${target}`);
    continue;
  }

  await fsPromises.rm(target, { recursive: true, force: true });
  console.log(`deleted: ${target}`);
}

console.log('\nUninstall complete.');
