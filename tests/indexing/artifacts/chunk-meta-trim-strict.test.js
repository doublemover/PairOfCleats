#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { getCurrentBuildInfo } from '../../../tools/shared/dict-utils.js';

const { fixtureRoot, userConfig } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture-trim-strict-v2',
  cacheScope: 'shared',
  requiredModes: ['code']
});

const current = getCurrentBuildInfo(fixtureRoot, userConfig, { mode: 'code' });
const buildRoot = current?.activeRoot || current?.buildRoot || null;
if (!buildRoot) {
  console.error('Expected build root for fixture index.');
  process.exit(1);
}

const sidecarIndexPath = path.join(buildRoot, 'stage_checkpoints.v1.index.json');
if (!fs.existsSync(sidecarIndexPath)) {
  console.error(`Missing stage checkpoint index at ${sidecarIndexPath}`);
  process.exit(1);
}
const sidecarIndex = JSON.parse(await fsPromises.readFile(sidecarIndexPath, 'utf8')) || {};
const sidecarModeEntry = sidecarIndex?.modes?.code || sidecarIndex?.modes?.prose || null;
const relPath = typeof sidecarModeEntry?.path === 'string' ? sidecarModeEntry.path : null;
const modePath = relPath ? path.join(buildRoot, relPath) : null;
if (!modePath || !fs.existsSync(modePath)) {
  console.error(`Missing stage checkpoint mode sidecar at ${modePath || '<none>'}`);
  process.exit(1);
}
const raw = { code: JSON.parse(await fsPromises.readFile(modePath, 'utf8')) || {} };
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
