#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { copyFixtureToTemp } from '../helpers/fixtures.js';
import { repoRoot } from '../helpers/root.js';
import { rmDirRecursive } from '../helpers/temp.js';

const root = repoRoot();
const fixturePath = path.join(root, 'tests', 'fixtures', 'sample', 'README.md');
const original = await fsPromises.readFile(fixturePath, 'utf8');

const tempFixture = await copyFixtureToTemp('sample');
const tempRoot = path.dirname(tempFixture);
const tempReadme = path.join(tempFixture, 'README.md');
await fsPromises.writeFile(tempReadme, `${original}\nmutation`);

const updated = await fsPromises.readFile(fixturePath, 'utf8');
if (updated !== original) {
  console.error('copy fixture test failed: original fixture was mutated');
  await rmDirRecursive(tempRoot);
  process.exit(1);
}

await rmDirRecursive(tempRoot);
console.log('copy fixture test passed');
