#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createWatchAttemptManager } from '../../../src/index/build/watch/attempts.js';
import { createSettledWatchAttempt } from '../../helpers/watch-attempts.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-watch-attempts-'));
applyTestEnv({ cacheRoot: tempRoot, extraEnv: { PAIROFCLEATS_HOME: path.join(tempRoot, 'home') } });

const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const manager = createWatchAttemptManager({ repoRoot, userConfig: {}, log: () => {} });
const create = () => createSettledWatchAttempt(manager, repoRoot);
const record = (attempt, ok) => manager.recordOutcome(attempt, ok, { writersSettled: true });

const attempt1 = await create();
await fs.mkdir(attempt1.buildRoot, { recursive: true });
await record(attempt1, true);

const attempt2 = await create();
await fs.mkdir(attempt2.buildRoot, { recursive: true });
await record(attempt2, true);

const attempt3 = await create();
await fs.mkdir(attempt3.buildRoot, { recursive: true });
await record(attempt3, true);

await assert.rejects(
  () => fs.stat(attempt1.buildRoot),
  'expected oldest success attempt to be trimmed'
);
await fs.stat(attempt2.buildRoot);
await fs.stat(attempt3.buildRoot);

const failed1 = await create();
await fs.mkdir(failed1.buildRoot, { recursive: true });
await record(failed1, false);

const failed2 = await create();
await fs.mkdir(failed2.buildRoot, { recursive: true });
await record(failed2, false);

await assert.rejects(
  () => fs.stat(failed1.buildRoot),
  'expected oldest failed attempt to be trimmed immediately'
);
await fs.stat(failed2.buildRoot);

const success4 = await create();
await fs.mkdir(success4.buildRoot, { recursive: true });
await record(success4, true);

await fs.stat(failed2.buildRoot);

console.log('watch attempt retention tests passed');
