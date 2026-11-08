import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSsrWitness, inspectSsrWitness } from '../../helpers/ssr-snapshot-witness.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ssr-witness-incremental-parity-'));
try {
  await createSsrWitness(root);
  const warm = await createSsrWitness(root, true);
  await inspectSsrWitness(warm);
  console.log('Incremental snapshot/MessageChannel witness has artifact/SQLite parity');
} finally { await fs.rm(root, { recursive: true, force: true }); }
