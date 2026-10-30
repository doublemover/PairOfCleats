#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { evaluationFileIdentity } from '../../../tools/bench/embeddings/evaluation-identity.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-eval-identity-'));
try {
  const file = path.join(root, 'dataset.json');
  await fs.writeFile(file, '[{"query":"same","gold":["old"]}]');
  const first = evaluationFileIdentity(file, { canonicalJson: true });
  await fs.writeFile(file, '[{"gold":["old"],"query":"same"}]');
  assert.deepEqual(evaluationFileIdentity(file, { canonicalJson: true }), first);
  await fs.writeFile(file, '[{"query":"same","gold":["new"]}]');
  assert.notDeepEqual(evaluationFileIdentity(file, { canonicalJson: true }), first);
  await fs.unlink(file);
  assert.throws(() => evaluationFileIdentity(file, { canonicalJson: true }), /ENOENT/);
} finally { await fs.rm(root, { recursive: true, force: true }); }
