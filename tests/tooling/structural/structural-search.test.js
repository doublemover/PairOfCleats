#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'structural-search');
const repoRoot = path.join(tempRoot, 'repo');
const srcDir = path.join(repoRoot, 'src');
const docsDir = path.join(repoRoot, 'docs');
const binRoot = path.join(root, 'tests', 'fixtures', 'structural', 'bin');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(srcDir, { recursive: true });
await fsPromises.mkdir(docsDir, { recursive: true });
await fsPromises.writeFile(path.join(srcDir, 'example.js'), 'eval(\"x\");\n');
await fsPromises.writeFile(path.join(srcDir, 'example.ts'), 'eval(x);\n');
await fsPromises.writeFile(path.join(docsDir, 'notes.md'), 'TODO: update\n');

for (const binName of ['semgrep', 'sg', 'comby']) {
  try {
    await fsPromises.chmod(path.join(binRoot, binName), 0o755);
  } catch {}
}

const env = {
  ...process.env,
  PATH: `${binRoot}${path.delimiter}${process.env.PATH || ''}`,
  PAIROFCLEATS_PROFILE: 'full'
};

const result = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'structural-search.js'),
    '--repo', repoRoot,
    '--pack', 'semgrep-security',
    '--pack', 'astgrep-js-safety',
    '--pack', 'comby-docs',
    '--format', 'json'
  ],
  { encoding: 'utf8', env }
);

if (result.status !== 0) {
  console.error(result.stderr || result.stdout || 'structural-search failed');
  process.exit(result.status ?? 1);
}

const payload = JSON.parse(result.stdout || '{}');
assert.ok(Array.isArray(payload.results), 'expected results array');
assert.ok(payload.results.length >= 3, 'expected at least 3 results');

const engines = new Set(payload.results.map((entry) => entry.engine));
assert.ok(engines.has('semgrep'), 'expected semgrep result');
assert.ok(engines.has('ast-grep'), 'expected ast-grep result');
assert.ok(engines.has('comby'), 'expected comby result');

const comby = payload.results.find((entry) => entry.engine === 'comby');
assert.equal(comby.path, 'docs/notes.md');

console.log('structural search test passed');

