#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'setup-index-detection');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

await fsPromises.writeFile(path.join(repoRoot, 'README.md'), 'setup detection fixture\n');

const userConfig = loadUserConfig(repoRoot);
const codeIndexDir = getIndexDir(repoRoot, 'code', userConfig);

async function resetIndexDir() {
  await fsPromises.rm(codeIndexDir, { recursive: true, force: true });
  await fsPromises.mkdir(codeIndexDir, { recursive: true });
}

function runSetup(label) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(root, 'tools', 'setup', 'setup.js'),
      '--repo',
      repoRoot,
      '--non-interactive',
      '--json',
      '--skip-install',
      '--skip-dicts',
      '--skip-models',
      '--skip-extensions',
      '--skip-tooling',
      '--skip-index',
      '--skip-sqlite',
      '--skip-artifacts'
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, PAIROFCLEATS_CACHE_ROOT: cacheRoot }
    }
  );
  if (result.status !== 0) {
    console.error(`setup index detection failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }
  let payload = null;
  try {
    payload = JSON.parse(result.stdout || '{}');
  } catch {
    console.error(`setup index detection failed: ${label} (invalid JSON output)`);
    process.exit(1);
  }
  return payload;
}

const scenarios = [
  {
    label: 'chunk_meta.json',
    build: async () => {
      await fsPromises.writeFile(path.join(codeIndexDir, 'chunk_meta.json'), '[]');
    },
    expectReady: true
  },
  {
    label: 'chunk_meta.jsonl',
    build: async () => {
      await fsPromises.writeFile(path.join(codeIndexDir, 'chunk_meta.jsonl'), '{}\n');
    },
    expectReady: true
  },
  {
    label: 'chunk_meta.meta.json + parts',
    build: async () => {
      const partsDir = path.join(codeIndexDir, 'chunk_meta.parts');
      await fsPromises.mkdir(partsDir, { recursive: true });
      const partName = 'chunk_meta.part-00000.jsonl';
      const partPath = path.join(partsDir, partName);
      await fsPromises.writeFile(partPath, '{}\n');
      const partStat = await fsPromises.stat(partPath);
      const meta = {
        schemaVersion: '0.0.1',
        artifact: 'chunk_meta',
        format: 'jsonl-sharded',
        generatedAt: new Date().toISOString(),
        compression: 'none',
        totalRecords: 1,
        totalBytes: partStat.size,
        maxPartRecords: 1,
        maxPartBytes: partStat.size,
        targetMaxBytes: null,
        parts: [{
          path: path.posix.join('chunk_meta.parts', partName),
          records: 1,
          bytes: partStat.size
        }]
      };
      await fsPromises.writeFile(
        path.join(codeIndexDir, 'chunk_meta.meta.json'),
        JSON.stringify(meta, null, 2)
      );
    },
    expectReady: true
  },
  {
    label: 'chunk_meta.meta.json without parts',
    build: async () => {
      await fsPromises.writeFile(
        path.join(codeIndexDir, 'chunk_meta.meta.json'),
        JSON.stringify({
          schemaVersion: '0.0.1',
          artifact: 'chunk_meta',
          format: 'jsonl-sharded',
          generatedAt: new Date().toISOString(),
          compression: 'none',
          totalRecords: 0,
          totalBytes: 0,
          maxPartRecords: 0,
          maxPartBytes: 0,
          targetMaxBytes: null,
          parts: []
        }, null, 2)
      );
    },
    expectReady: false
  }
];

for (const scenario of scenarios) {
  await resetIndexDir();
  await scenario.build();
  const payload = runSetup(scenario.label);
  const ready = payload?.steps?.index?.ready === true;
  if (ready !== scenario.expectReady) {
    console.error(
      `setup index detection failed: ${scenario.label} expected ready=${scenario.expectReady}, got ${ready}`
    );
    process.exit(1);
  }
}

console.log('setup index detection tests passed');

