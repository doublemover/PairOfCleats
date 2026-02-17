#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSearchCli } from '../../../src/retrieval/cli.js';

process.env.PAIROFCLEATS_TESTING = '1';

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-profile-mix-optional-state-'));
const proseDir = path.join(rootDir, 'index-prose');
await fs.mkdir(proseDir, { recursive: true });
await fs.writeFile(
  path.join(proseDir, 'index_state.json'),
  JSON.stringify({
    generatedAt: new Date().toISOString(),
    mode: 'prose',
    profile: {
      id: 'vector_only',
      schemaVersion: 1
    }
  }, null, 2)
);

let failed = false;
try {
  await runSearchCli([
    'alpha',
    '--repo',
    rootDir,
    '--mode',
    'prose',
    '--backend',
    'memory',
    '--non-strict',
    '--json',
    '--compact'
  ], {
    emitOutput: false,
    exitOnError: false
  });
} catch (err) {
  failed = true;
  const message = String(err?.message || err);
  assert.ok(
    !/mixed index profiles detected/i.test(message),
    'missing optional extracted-prose state should not trigger mixed-profile cohort rejection'
  );
  assert.ok(
    !/allow-unsafe-mix/i.test(message),
    'missing optional extracted-prose state should not require --allow-unsafe-mix'
  );
}

if (!failed) {
  throw new Error('Expected failure because prose index artifacts are incomplete in this fixture');
}

console.log('profile mix ignores missing optional state test passed');
