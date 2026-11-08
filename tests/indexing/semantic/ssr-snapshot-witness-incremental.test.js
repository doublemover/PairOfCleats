import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSsrWitness, inspectSsrWitness } from '../../helpers/ssr-snapshot-witness.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ssr-witness-incremental-'));
try {
  const cold = await createSsrWitness(root);
  const expected = await inspectSsrWitness(cold, { backendParity: false, forwardOnly: true });
  const warm = await createSsrWitness(root, true);
  assert.deepEqual(await inspectSsrWitness(warm, { backendParity: false, forwardOnly: true }), expected,
    'cold and incremental publication retain the same complete forward witness content');
  console.log('Incremental publication retains exact forward witness content; other cases cover reverse and backend parity');
} finally { await fs.rm(root, { recursive: true, force: true }); }
