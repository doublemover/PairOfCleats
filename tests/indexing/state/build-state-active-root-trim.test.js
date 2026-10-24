#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runNode as runNodeFixture } from '../../helpers/run-node.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-active-state-trim-'));
try {
  const child = runNodeFixture(['--input-type=module', '-e', `
    import path from 'node:path';
    import { applyStatePatch, setActiveStateKeyResolver } from ${JSON.stringify(new URL('../../../src/index/build/build-state/store.js', import.meta.url).href)};
    setActiveStateKeyResolver(() => true);
    for (let index=0; index<65; index++) await applyStatePatch(path.join(${JSON.stringify(root)}, String(index)), { stage: 'test' }, [{ type:'test', at:'2026-10-21T00:00:00Z' }]);
    console.log('65 active roots completed');
  `], 'isolated Node fixture', process.cwd(), process.env, { allowFailure: true, spawnOptions: { cwd: process.cwd(), encoding: 'utf8', timeout: 5000 } });
  assert.equal(child.status, 0, child.stderr || child.error?.message);
  assert.match(child.stdout, /65 active roots completed/);
} finally { await fs.rm(root, { recursive: true, force: true }); }
console.log('build-state receipt trim returns when all cached roots are active');
