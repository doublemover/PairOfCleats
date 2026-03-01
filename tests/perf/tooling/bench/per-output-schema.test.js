#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import Ajv from 'ajv';

import { applyTestEnv } from '../../../helpers/test-env.js';

const testEnv = applyTestEnv({ testing: '1' });

const root = process.cwd();
const ajv = new Ajv({ allErrors: true, strict: false });

const parseTrailingJson = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (raw.startsWith('{') || raw.startsWith('[')) {
    return JSON.parse(raw);
  }
  const match = raw.match(/\{[\s\S]*\}\s*$/);
  return match ? JSON.parse(match[0]) : null;
};

const matrix = [
  {
    id: 'vfs-parallel-manifest',
    script: path.join(root, 'tools', 'bench', 'vfs', 'parallel-manifest-build.js'),
    args: ['--segments', '16', '--segmentBytes', '64', '--concurrency', '1,2', '--samples', '1', '--json'],
    schemaPath: path.join(root, 'docs', 'schemas', 'bench-vfs-parallel-manifest.schema.json')
  },
  {
    id: 'tree-sitter-load',
    script: path.join(root, 'tools', 'bench', 'index', 'tree-sitter-load.js'),
    args: ['--languages', 'javascript', '--filesPerLanguage', '2', '--repeats', '1', '--json'],
    schemaPath: path.join(root, 'docs', 'schemas', 'bench-tree-sitter-load.schema.json')
  }
];

for (const entry of matrix) {
  const result = spawnSync(
    process.execPath,
    [entry.script, ...entry.args],
    { cwd: root, env: testEnv, encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stdout || '');
    console.error(result.stderr || '');
    process.exit(result.status ?? 1);
  }

  const report = parseTrailingJson(result.stdout);
  assert.ok(report && typeof report === 'object', `expected JSON output for ${entry.id}`);

  const schema = JSON.parse(await fs.readFile(entry.schemaPath, 'utf8'));
  const validate = ajv.compile(schema);
  const ok = validate(report);
  assert.ok(ok, `${entry.id}: ${ajv.errorsText(validate.errors, { separator: '\n' })}`);
}

console.log('per-bench output schema test passed');
