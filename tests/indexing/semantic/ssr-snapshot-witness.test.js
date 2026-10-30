import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSsrWitness, inspectSsrWitness } from '../../helpers/ssr-snapshot-witness.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-ssr-witness-cold-'));
try {
  const cold = await createSsrWitness(root);
  await inspectSsrWitness(cold);
  console.log('Cold published snapshot/MessageChannel/interpolation witness has artifact/SQLite parity');
} finally { await fs.rm(root, { recursive: true, force: true }); }
