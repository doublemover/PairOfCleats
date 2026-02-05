#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { getCurrentBuildInfo } from '../../../tools/shared/dict-utils.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture-trim-strict-v2'
});

const current = getCurrentBuildInfo(fixtureRoot, userConfig, { mode: 'code' });
const buildRoot = current?.activeRoot || current?.buildRoot || null;
if (!buildRoot) {
  console.error('Expected build root for fixture index.');
  process.exit(1);
}

const checkpointsPath = path.join(buildRoot, 'build_state.stage-checkpoints.json');
if (!fs.existsSync(checkpointsPath)) {
  console.error(`Missing stage checkpoints at ${checkpointsPath}`);
  process.exit(1);
}

const raw = JSON.parse(await fsPromises.readFile(checkpointsPath, 'utf8')) || {};
const modeEntry = raw.code || raw.prose || null;
if (!modeEntry || typeof modeEntry !== 'object') {
  console.error('Stage checkpoints missing mode entry.');
  process.exit(1);
}

const stageKey = Object.keys(modeEntry)[0];
const summary = stageKey ? modeEntry[stageKey] : null;
const checkpoints = Array.isArray(summary?.checkpoints) ? summary.checkpoints : null;
if (!checkpoints) {
  console.error('Stage checkpoints missing checkpoint list.');
  process.exit(1);
}

const chunkMetaCheckpoint = checkpoints.filter((entry) => entry?.label === 'chunk_meta').pop();
if (!chunkMetaCheckpoint) {
  console.error('Missing chunk_meta checkpoint entry.');
  process.exit(1);
}

const trimmedRows = Number(chunkMetaCheckpoint?.extra?.trimmedRows ?? 0);
const trimmedMetaV2 = Number(chunkMetaCheckpoint?.extra?.trimmedMetaV2 ?? 0);
const trimmedFields = chunkMetaCheckpoint?.extra?.trimmedFields || null;

if (trimmedRows !== 0) {
  console.error(`Expected no chunk_meta trimming, got trimmedRows=${trimmedRows}.`);
  process.exit(1);
}

if (trimmedMetaV2 !== 0) {
  console.error(`Expected metaV2 to remain intact, got trimmedMetaV2=${trimmedMetaV2}.`);
  process.exit(1);
}

if (trimmedFields) {
  const trimmedCount = Object.values(trimmedFields).reduce(
    (sum, value) => sum + (Number.isFinite(Number(value)) ? Number(value) : 0),
    0
  );
  if (trimmedCount !== 0) {
    console.error(`Expected no trimmed fields, got ${trimmedCount}.`);
    process.exit(1);
  }
}

console.log('Chunk meta trim strict ok.');
