#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  readJsonFile,
  readJsonFileResolved,
  readJsonFileResolvedSafe,
  readJsonFileSyncSafeResolved,
  writeJsonFile,
  writeJsonFileResolved,
  writeJsonFileSyncResolved
} from '../../src/shared/json-file.js';

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

  const resolvedPath = await writeJsonFileResolved(path.join(tempRoot, 'resolved', 'payload.json'), { gamma: 3 }, {
    finalNewline: true
  });
  assert.equal(path.isAbsolute(resolvedPath), true);
  assert.deepEqual(await readJsonFileResolved(resolvedPath), { gamma: 3 });
  assert.deepEqual(await readJsonFileResolvedSafe(resolvedPath), { gamma: 3 });
  assert.deepEqual(await readJsonFileResolvedSafe(path.join(tempRoot, 'missing.json'), { missing: true }), { missing: true });

  const invalidPath = path.join(tempRoot, 'invalid.json');
  await fs.writeFile(invalidPath, '{"broken":', 'utf8');
  await assert.rejects(
    readJsonFileResolved(invalidPath),
    SyntaxError,
    'readJsonFileResolved should preserve raw parse failures'
  );
  assert.deepEqual(
    await readJsonFileResolvedSafe(invalidPath, { parseFallback: true }),
    { parseFallback: true },
    'readJsonFileResolvedSafe should keep the safe fallback contract on parse errors'
  );

  const syncPath = writeJsonFileSyncResolved(path.join(tempRoot, 'sync', 'payload.json'), { delta: 4 }, {
    spaces: 0,
    finalNewline: false
  });
  assert.equal(fsSync.readFileSync(syncPath, 'utf8'), '{"delta":4}');
  assert.deepEqual(readJsonFileSyncSafeResolved(syncPath), { delta: 4 });
  assert.deepEqual(readJsonFileSyncSafeResolved(path.join(tempRoot, 'missing-sync.json'), { fallback: true }), { fallback: true });

  console.log('json file helper test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
