#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const toolPath = path.join(repoRoot, 'tools', 'testing', 'shared-module-migration.js');

const makeTempDir = async () => {
  return await fsPromises.mkdtemp(path.join(os.tmpdir(), 'shared-module-migration-'));
};

const writeFixture = async (rootDir) => {
  await fsPromises.mkdir(path.join(rootDir, 'src'), { recursive: true });
  await fsPromises.writeFile(
    path.join(rootDir, 'src', 'consumer.js'),
    [
      "import { loadUserConfig } from 'tools/shared/dict-utils.js';",
      "export { normalizeSearchRequest } from 'tools/shared/search-request.js';",
      '',
      'void loadUserConfig;',
      ''
    ].join('\n'),
    'utf8'
  );
  await fsPromises.writeFile(
    path.join(rootDir, 'recipe.json'),
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        roots: ['src'],
        recipes: [
          {
            id: 'dict-utils-tools-to-src',
            from: 'tools/shared/dict-utils.js',
            to: 'src/shared/dict-utils.js',
            roots: ['src'],
            renames: {}
          },
          {
            id: 'search-request-tools-to-src',
            from: 'tools/shared/search-request.js',
            to: 'src/shared/search-request.js',
            roots: ['src'],
            renames: {}
          }
        ]
      },
      null,
      2
    ),
    'utf8'
  );
};

const runTool = (cwd, args) => {
  return spawnSync(process.execPath, [toolPath, ...args], {
    cwd,
    encoding: 'utf8'
  });
};

const tempRoot = await makeTempDir();

try {
  await writeFixture(tempRoot);

  const dryRun = runTool(tempRoot, ['--recipe', 'recipe.json', '--json']);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const drySummary = JSON.parse(dryRun.stdout);
  assert.equal(drySummary.filesChanged, 1, 'expected dry-run to report one changed file');
  assert.deepEqual(
    drySummary.selectedRecipes,
    ['dict-utils-tools-to-src', 'search-request-tools-to-src'],
    'expected both recipes to be selected'
  );

  const beforeWrite = fs.readFileSync(path.join(tempRoot, 'src', 'consumer.js'), 'utf8');
  assert.match(beforeWrite, /tools\/shared\/dict-utils\.js/, 'fixture should keep original import before write mode');

  const checkRun = runTool(tempRoot, ['--recipe', 'recipe.json', '--check', '--json']);
  assert.equal(checkRun.status, 1, 'check mode should fail when changes are pending');
  const checkSummary = JSON.parse(checkRun.stdout);
  assert.equal(checkSummary.filesChanged, 1, 'check mode should still report pending changes');

  const writeRun = runTool(tempRoot, ['--recipe', 'recipe.json', '--write', '--json']);
  assert.equal(writeRun.status, 0, writeRun.stderr);
  const writeSummary = JSON.parse(writeRun.stdout);
  assert.equal(writeSummary.filesChanged, 1, 'write mode should update one file');

  const afterWrite = fs.readFileSync(path.join(tempRoot, 'src', 'consumer.js'), 'utf8');
  assert.match(afterWrite, /src\/shared\/dict-utils\.js/, 'write mode should rewrite dict-utils import');
  assert.match(afterWrite, /src\/shared\/search-request\.js/, 'write mode should rewrite search-request export');
  assert.doesNotMatch(afterWrite, /tools\/shared\//, 'write mode should remove the legacy specifiers');

  const cleanCheck = runTool(tempRoot, ['--recipe', 'recipe.json', '--check', '--json']);
  assert.equal(cleanCheck.status, 0, cleanCheck.stderr);
  const cleanSummary = JSON.parse(cleanCheck.stdout);
  assert.equal(cleanSummary.filesChanged, 0, 'check mode should pass after write mode applies changes');
} finally {
  await fsPromises.rm(tempRoot, { recursive: true, force: true });
}

console.log('shared-module migration tooling test passed');
