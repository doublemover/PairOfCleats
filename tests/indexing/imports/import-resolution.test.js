#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveImportLinks } from '../../../src/index/build/import-resolution.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'import-resolution');
const srcRoot = path.join(tempRoot, 'src');
await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(srcRoot, 'a'), { recursive: true });
await fs.mkdir(path.join(srcRoot, 'b'), { recursive: true });
await fs.mkdir(path.join(srcRoot, 'lib'), { recursive: true });
await fs.mkdir(path.join(srcRoot, 'alt'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'lib', 'rake'), { recursive: true });
await fs.mkdir(path.join(tempRoot, 'tasks'), { recursive: true });

await fs.writeFile(path.join(srcRoot, 'a', 'utils.js'), 'export const a = 1;\n');
await fs.writeFile(path.join(srcRoot, 'a', 'index.js'), "import './utils';\n");
await fs.writeFile(path.join(srcRoot, 'b', 'utils.js'), 'export const b = 2;\n');
await fs.writeFile(path.join(srcRoot, 'b', 'index.js'), "import './utils';\n");
await fs.writeFile(path.join(srcRoot, 'lib', 'util.ts'), 'export const util = true;\n');
await fs.writeFile(path.join(srcRoot, 'alt', 'util.ts'), 'export const alt = true;\n');
await fs.writeFile(path.join(srcRoot, 'main.ts'), "import '@lib/util';\nimport 'react';\n");
await fs.writeFile(path.join(tempRoot, 'lib', 'rake.rb'), "require 'rake/version'\nrequire 'json'\n");
await fs.writeFile(path.join(tempRoot, 'lib', 'rake', 'version.rb'), 'module Rake; VERSION = "0.0.0"; end\n');
await fs.writeFile(path.join(tempRoot, 'tasks', 'build.rake'), "require_relative 'helpers'\n");
await fs.writeFile(path.join(tempRoot, 'tasks', 'helpers.rb'), 'puts :ok\n');
await fs.writeFile(path.join(tempRoot, 'Rakefile'), "require 'rake'\n");

const writeTsconfig = async (paths) => {
  const payload = {
    compilerOptions: {
      baseUrl: '.',
      paths
    }
  };
  await fs.writeFile(path.join(tempRoot, 'tsconfig.json'), JSON.stringify(payload, null, 2));
};

await writeTsconfig({ '@lib/*': ['src/lib/*'] });

const entries = [
  { abs: path.join(srcRoot, 'a', 'index.js'), rel: 'src/a/index.js' },
  { abs: path.join(srcRoot, 'a', 'utils.js'), rel: 'src/a/utils.js' },
  { abs: path.join(srcRoot, 'b', 'index.js'), rel: 'src/b/index.js' },
  { abs: path.join(srcRoot, 'b', 'utils.js'), rel: 'src/b/utils.js' },
  { abs: path.join(srcRoot, 'lib', 'util.ts'), rel: 'src/lib/util.ts' },
  { abs: path.join(srcRoot, 'alt', 'util.ts'), rel: 'src/alt/util.ts' },
  { abs: path.join(srcRoot, 'main.ts'), rel: 'src/main.ts' },
  { abs: path.join(tempRoot, 'lib', 'rake.rb'), rel: 'lib/rake.rb' },
  { abs: path.join(tempRoot, 'lib', 'rake', 'version.rb'), rel: 'lib/rake/version.rb' },
  { abs: path.join(tempRoot, 'tasks', 'build.rake'), rel: 'tasks/build.rake' },
  { abs: path.join(tempRoot, 'tasks', 'helpers.rb'), rel: 'tasks/helpers.rb' },
  { abs: path.join(tempRoot, 'Rakefile'), rel: 'Rakefile' }
];

const importsByFile = {
  'src/a/index.js': ['./utils'],
  'src/b/index.js': ['./utils'],
  'src/main.ts': ['@lib/util', 'react'],
  'lib/rake.rb': ['rake/version', 'json'],
  'tasks/build.rake': ['./helpers'],
  Rakefile: ['rake']
};

const snapshot = (relations) => {
  const out = {};
  for (const [file, rel] of relations.entries()) {
    out[file] = {
      importLinks: rel.importLinks || [],
      externalImports: rel.externalImports || []
    };
  }
  return out;
};

const runResolution = () => {
  const relations = new Map();
  for (const [file, imports] of Object.entries(importsByFile)) {
    relations.set(file, { imports: imports.slice() });
  }
  resolveImportLinks({
    root: tempRoot,
    entries,
    importsByFile,
    fileRelations: relations,
    enableGraph: false
  });
  return relations;
};

const relationsA = runResolution();
const relA = relationsA.get('src/a/index.js');
const relB = relationsA.get('src/b/index.js');
const relMain = relationsA.get('src/main.ts');
const relRuby = relationsA.get('lib/rake.rb');
const relRakeTask = relationsA.get('tasks/build.rake');
const relRakefile = relationsA.get('Rakefile');

assert.deepEqual(relA.importLinks, ['src/a/utils.js']);
assert.deepEqual(relB.importLinks, ['src/b/utils.js']);
assert.ok(!relA.importLinks.includes('src/b/utils.js'));
assert.ok(!relB.importLinks.includes('src/a/utils.js'));

assert.deepEqual(relMain.importLinks, ['src/lib/util.ts']);
assert.deepEqual(relMain.externalImports, ['react']);
assert.ok(!relMain.importLinks.includes('react'));
assert.deepEqual(relRuby.importLinks, ['lib/rake/version.rb']);
assert.deepEqual(relRuby.externalImports, ['json']);
assert.deepEqual(relRakeTask.importLinks, ['tasks/helpers.rb']);
assert.deepEqual(relRakefile.importLinks, ['lib/rake.rb']);

const relationsB = runResolution();
assert.equal(JSON.stringify(snapshot(relationsA)), JSON.stringify(snapshot(relationsB)));

await writeTsconfig({ '@lib/*': ['src/alt/*'] });
const relationsC = runResolution();
const relMainUpdated = relationsC.get('src/main.ts');
assert.deepEqual(relMainUpdated.importLinks, ['src/alt/util.ts']);

console.log('import resolution tests passed');

