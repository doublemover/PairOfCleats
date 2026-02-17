#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runSearchCli } from '../../../src/retrieval/cli.js';

process.env.PAIROFCLEATS_TESTING = '1';

const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-profile-mix-inactive-extracted-'));

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
  await fs.writeFile(
    path.join(indexDir, 'chunk_meta.json'),
    JSON.stringify([], null, 2)
  );
};

await writeIndexState('prose', 'default');
await writeIndexState('extracted-prose', 'vector_only');

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
    /mixed index profiles detected/i.test(message),
    'searched extracted-prose mode should participate in mixed-profile cohort rejection'
  );
  assert.ok(
    /allow-unsafe-mix/i.test(message),
    'mixed-profile cohort rejection should recommend --allow-unsafe-mix'
  );
}

if (!failed) {
  throw new Error('Expected mixed-profile cohort rejection when prose search includes extracted-prose');
}

console.log('profile mix includes searched extracted-prose test passed');
