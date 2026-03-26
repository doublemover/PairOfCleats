#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../../src/shared/json-file.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-json-file-'));

try {
  const targetPath = path.join(tempRoot, 'nested', 'payload.json');
  await writeJsonFile(targetPath, { alpha: 1, beta: ['x', 'y'] });
  const raw = await fs.readFile(targetPath, 'utf8');
  assert.match(raw, /\n$/);
  assert.deepEqual(await readJsonFile(targetPath), { alpha: 1, beta: ['x', 'y'] });

  const compactPath = path.join(tempRoot, 'compact.json');
  await writeJsonFile(compactPath, { ok: true }, { spaces: 0, finalNewline: false });
  assert.equal(await fs.readFile(compactPath, 'utf8'), '{"ok":true}');
  assert.deepEqual(await readJsonFile(compactPath), { ok: true });

  console.log('json file helper test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
