#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSearchCli } from '../../../src/retrieval/cli.js';

process.env.PAIROFCLEATS_TESTING = '1';

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-profile-mix-optional-extracted-comments-'));

const writeIndexState = async (mode, profileId) => {
  const indexDir = path.join(rootDir, `index-${mode}`);
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(
    path.join(indexDir, 'index_state.json'),
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      mode,
      profile: {
        id: profileId,
        schemaVersion: 1
      }
    }, null, 2)
  );
};

await writeIndexState('code', 'default');
await writeIndexState('extracted-prose', 'vector_only');

let failed = false;
try {
  await runSearchCli([
    'alpha',
    '--repo',
    rootDir,
    '--mode',
    'code',
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
    'optional extracted-prose (comments path) should not trigger mixed-profile cohort rejection'
  );
  assert.ok(
    !/allow-unsafe-mix/i.test(message),
    'optional extracted-prose (comments path) should not require --allow-unsafe-mix'
  );
}

if (!failed) {
  throw new Error('Expected failure because code index artifacts are incomplete in this fixture');
}

console.log('profile mix ignores optional extracted-prose comments test passed');
