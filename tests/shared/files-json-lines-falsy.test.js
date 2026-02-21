#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureTestingEnv } from '../helpers/test-env.js';
import { readJsonLinesSyncSafe } from '../../src/shared/files.js';

ensureTestingEnv(process.env);

const root = process.cwd();
const tempFile = path.join(root, '.testCache', 'files-json-lines-falsy.jsonl');
await fsPromises.mkdir(path.dirname(tempFile), { recursive: true });
await fsPromises.writeFile(tempFile, '0\nfalse\n""\n{"ok":true}\n', 'utf8');

const rows = readJsonLinesSyncSafe(tempFile);
if (!Array.isArray(rows) || rows.length !== 4) {
  console.error('files json lines falsy test failed: expected 4 rows');
  process.exit(1);
}
if (rows[0] !== 0 || rows[1] !== false || rows[2] !== '' || rows[3]?.ok !== true) {
  console.error('files json lines falsy test failed: parsed values mismatch');
  process.exit(1);
}

console.log('files json lines falsy test passed');
