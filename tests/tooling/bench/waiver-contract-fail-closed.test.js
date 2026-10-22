#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBenchPolicy, evaluateBenchVerdict } from '../../../tools/bench/language/verdict.js';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-waivers-'));
try {
  const file = path.join(root, 'waivers.json');
  const valid = { id: 'bounded', owner: 'fixture', justification: 'authored known case', allowedUntil: '2099-01-01T00:00:00Z', failureClass: 'repo_failure' };
  for (const row of [{ id: 'wildcard' }, { ...valid, allowedUntil: 'not-a-date' }, { ...valid, failureClass: '*' }]) {
    await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, waivers: [valid, row] }));
    const policy = await loadBenchPolicy({ waiverFile: file });
    assert.ok(policy.loadErrors.length); assert.equal(policy.waivers.length, 0);
    assert.equal(evaluateBenchVerdict({ tasks: [], policy }).run.exitCode, 1);
  }
  await fs.writeFile(file, JSON.stringify({ schemaVersion: 1, waivers: [valid] }));
  assert.equal((await loadBenchPolicy({ waiverFile: file })).loadErrors.length, 0);
} finally { await fs.rm(root, { recursive: true, force: true }); }
